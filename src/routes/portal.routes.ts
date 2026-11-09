import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, digest, limit, secret } from "../middlewares/portal-security.js";
import { evaluateHeuristically } from "../services/ai.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { body, emailInput, handle, personInput, requireAccount } from "./portal-auth.routes.js";

const clientInput = z.object({ name: personInput, segment: z.string().trim().max(120).default("") });
const inviteInput = z.object({ email: emailInput, role: z.enum(["ADMIN", "EDITOR", "VIEWER"]), clientId: z.uuid().optional() });
const stage = z.enum(["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"]);
const opportunityInput = z.object({
  name: personInput,
  company: personInput,
  role: z.string().trim().max(100).default(""),
  email: z.union([emailInput, z.literal("")]).default(""),
  message: z.string().trim().min(8).max(1200),
});
const updateInput = z.object({ stage, outcome: z.string().trim().max(1000) });

function param(req: Request, name: string) {
  const result = z.uuid().safeParse(req.params[name]);
  if (!result.success) throw new NotFoundError("Recurso não encontrado.");
  return result.data;
}

async function agencyAccess(req: Request) {
  const account = await requireAccount(req);
  const agencyId = param(req, "agencyId");
  const { rows } = await db.execute({
    sql: `SELECT m.role, a.name FROM portal_agency_members m JOIN portal_agencies a ON a.id = m.agency_id
      WHERE m.agency_id = ? AND m.account_id = ?`, args: [agencyId, account.id],
  });
  if (!rows.length) throw new NotFoundError("Agência não encontrada.");
  return { agencyId, accountId: account.id, role: String(rows[0].role), name: String(rows[0].name) };
}

async function clientAccess(req: Request) {
  const account = await requireAccount(req);
  const agencyId = param(req, "agencyId");
  const clientId = param(req, "clientId");
  const { rows } = await db.execute({
    sql: `SELECT c.name, c.segment, COALESCE(am.role, cm.role) AS role
      FROM portal_clients c
      LEFT JOIN portal_agency_members am ON am.agency_id = c.agency_id AND am.account_id = ?
      LEFT JOIN portal_client_members cm ON cm.agency_id = c.agency_id AND cm.client_id = c.id AND cm.account_id = ?
      WHERE c.agency_id = ? AND c.id = ? AND (am.account_id IS NOT NULL OR cm.account_id IS NOT NULL)`,
    args: [account.id, account.id, agencyId, clientId],
  });
  if (!rows.length) throw new NotFoundError("Empresa não encontrada.");
  return { agencyId, clientId, role: String(rows[0].role), name: String(rows[0].name), segment: String(rows[0].segment) };
}

export const portalRoutes: Router = Router();
portalRoutes.use(browserRequests);
portalRoutes.get("/workspaces", handle(async (req, res) => {
  const account = await requireAccount(req);
  const [agencies, clients] = await db.batch([
    { sql: `SELECT a.id, a.name, m.role FROM portal_agency_members m JOIN portal_agencies a ON a.id = m.agency_id
      WHERE m.account_id = ? ORDER BY a.name, a.id`, args: [account.id] },
    { sql: `SELECT c.id, c.name, c.agency_id AS agencyId, a.name AS agency, m.role
      FROM portal_client_members m JOIN portal_clients c ON c.agency_id = m.agency_id AND c.id = m.client_id
      JOIN portal_agencies a ON a.id = c.agency_id WHERE m.account_id = ? ORDER BY c.name, c.id`, args: [account.id] },
  ], "read");
  res.json({ account, agencies: agencies.rows, clients: clients.rows });
}));

portalRoutes.get("/agencies/:agencyId", handle(async (req, res) => {
  const access = await agencyAccess(req);
  const { rows } = await db.execute({
    sql: `SELECT c.id, c.name, c.segment, COUNT(o.id) AS opportunities,
      COUNT(CASE WHEN o.stage = 'WON' THEN 1 END) AS won
      FROM portal_clients c LEFT JOIN portal_opportunities o ON o.agency_id = c.agency_id AND o.client_id = c.id
      WHERE c.agency_id = ? GROUP BY c.id, c.name, c.segment ORDER BY c.name, c.id`, args: [access.agencyId],
  });
  res.json({ name: access.name, role: access.role, clients: rows });
}));

portalRoutes.post("/agencies/:agencyId/clients", handle(async (req, res) => {
  const access = await agencyAccess(req);
  const input = body(clientInput, req);
  const id = randomUUID();
  await limit(res, "agency-client", access.agencyId, 60, 3600);
  await db.execute({
    sql: "INSERT INTO portal_clients (id, agency_id, name, segment) VALUES (?, ?, ?, ?)",
    args: [id, access.agencyId, input.name, input.segment],
  });
  res.status(201).json({ id, ...input });
}));

portalRoutes.patch("/agencies/:agencyId/clients/:clientId", handle(async (req, res) => {
  const access = await agencyAccess(req);
  const clientId = param(req, "clientId");
  const input = body(clientInput, req);
  const result = await db.execute({
    sql: "UPDATE portal_clients SET name = ?, segment = ? WHERE agency_id = ? AND id = ?",
    args: [input.name, input.segment, access.agencyId, clientId],
  });
  if (!result.rowsAffected) throw new NotFoundError("Empresa não encontrada.");
  res.json({ id: clientId, ...input });
}));

portalRoutes.post("/agencies/:agencyId/invites", handle(async (req, res) => {
  const access = await agencyAccess(req);
  const input = body(inviteInput, req);
  if (input.role === "ADMIN" && access.role !== "OWNER") throw new ForbiddenError("Somente o titular pode convidar administradores.");
  if ((input.role === "ADMIN") === Boolean(input.clientId)) throw new BadRequestError("Selecione a empresa para o acesso de cliente.");
  await limit(res, "agency-invite", access.agencyId, 40, 3600);
  const value = secret();
  const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
  const result = await db.execute({
    sql: `INSERT INTO portal_invites (token_hash, agency_id, client_id, email, role, expires_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM portal_clients WHERE agency_id = ? AND id = ?)`,
    args: [digest(value), access.agencyId, input.clientId ?? null, input.email, input.role, expiresAt,
      input.clientId ?? null, access.agencyId, input.clientId ?? null],
  });
  if (!result.rowsAffected) throw new NotFoundError("Empresa não encontrada.");
  res.status(201).json({ token: value, expiresAt });
}));

const clientPath = "/agencies/:agencyId/clients/:clientId";
portalRoutes.get(clientPath, handle(async (req, res) => {
  const access = await clientAccess(req);
  const { rows } = await db.execute({
    sql: `SELECT id, name, company, stage, outcome, analysis FROM portal_opportunities
      WHERE agency_id = ? AND client_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`,
    args: [access.agencyId, access.clientId],
  });
  res.json({
    name: access.name, segment: access.segment, role: access.role,
    opportunities: rows.map((row) => ({ ...row, analysis: JSON.parse(String(row.analysis)) })),
  });
}));

portalRoutes.post(clientPath + "/opportunities", handle(async (req, res) => {
  const access = await clientAccess(req);
  if (access.role !== "OWNER" && access.role !== "ADMIN") throw new ForbiddenError("Somente a agência pode cadastrar oportunidades.");
  const input = body(opportunityInput, req);
  await limit(res, "client-opportunity", access.clientId, 100, 3600);
  const id = randomUUID();
  const analysis = evaluateHeuristically({ ...input, raw_payload: JSON.stringify(input) });
  await db.execute({
    sql: "INSERT INTO portal_opportunities (id, agency_id, client_id, name, company, analysis) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, access.agencyId, access.clientId, input.name, input.company, JSON.stringify(analysis)],
  });
  res.status(201).json({ id });
}));

portalRoutes.patch(clientPath + "/opportunities/:opportunityId", handle(async (req, res) => {
  const access = await clientAccess(req);
  if (access.role === "VIEWER") throw new ForbiddenError("Esta conta tem acesso somente à leitura.");
  const id = param(req, "opportunityId");
  const input = body(updateInput, req);
  const result = await db.execute({
    sql: "UPDATE portal_opportunities SET stage = ?, outcome = ? WHERE id = ? AND agency_id = ? AND client_id = ?",
    args: [input.stage, input.outcome, id, access.agencyId, access.clientId],
  });
  if (!result.rowsAffected) throw new NotFoundError("Oportunidade não encontrada.");
  res.json({ id, ...input });
}));
