import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, digest, limit, portalWrite, secret } from "../middlewares/portal-security.js";
import { evaluateHeuristically } from "../services/ai.service.js";
import type { PortalMailer } from "../services/portal-mail.js";
import { audit } from "../services/portal-audit.js";
import { agencyAccess, clientAccess, param } from "./portal-access.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { body, emailInput, handle, personInput, requireAccount } from "./portal-auth.routes.js";

const clientInput = z.object({ name: personInput, segment: z.string().trim().max(120).default("") });
const inviteInput = z.object({ email: emailInput, role: z.enum(["ADMIN", "EDITOR", "VIEWER"]), clientId: z.uuid().optional(), sendEmail: z.boolean().optional() });
const stage = z.enum(["NEW", "CONTACTED", "PROPOSAL", "WON", "LOST"]);
const opportunityInput = z.object({
  name: personInput,
  company: personInput,
  role: z.string().trim().max(100).default(""),
  email: z.union([emailInput, z.literal("")]).default(""),
  message: z.string().trim().min(8).max(1200),
});
const updateInput = z.object({ stage, outcome: z.string().trim().max(1000) });

export const portalRoutes: Router = Router();
portalRoutes.use(browserRequests);
portalRoutes.get("/workspaces", handle(async (req, res) => {
  const { issuedAt, ...account } = await requireAccount(req);
  const mailAvailable = Boolean(req.app.locals.portalMailer);
  if (!account.verified) return res.json({ account, mailAvailable, agencies: [], clients: [] });
  const [agencies, clients] = await db.batch([
    { sql: `SELECT a.id, a.name, m.role FROM portal_agency_members m JOIN portal_agencies a ON a.id = m.agency_id
      WHERE m.account_id = ? AND NOT EXISTS (
        SELECT 1 FROM portal_access_revocations r WHERE r.agency_id = m.agency_id
          AND r.account_id = m.account_id AND r.scope = '' AND r.revoked_at >= ?)
      ORDER BY a.name, a.id`, args: [account.id, issuedAt] },
    { sql: `SELECT c.id, c.name, c.agency_id AS agencyId, a.name AS agency, m.role
      FROM portal_client_members m JOIN portal_clients c ON c.agency_id = m.agency_id AND c.id = m.client_id
      JOIN portal_agencies a ON a.id = c.agency_id WHERE m.account_id = ? AND NOT EXISTS (
        SELECT 1 FROM portal_access_revocations r WHERE r.agency_id = m.agency_id
          AND r.account_id = m.account_id AND r.scope IN ('', c.id) AND r.revoked_at >= ?)
      ORDER BY c.name, c.id`, args: [account.id, issuedAt] },
  ], "read");
  res.json({ account, mailAvailable, agencies: agencies.rows, clients: clients.rows });
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
  await portalWrite(async (tx) => {
    const current = await agencyAccess(req, tx);
    await tx.execute({
      sql: "INSERT INTO portal_clients (id, agency_id, name, segment) VALUES (?, ?, ?, ?)",
      args: [id, current.agencyId, input.name, input.segment],
    });
    await audit(tx, "client.created", current.accountId, current.agencyId, id);
  });
  res.status(201).json({ id, ...input });
}));

portalRoutes.patch("/agencies/:agencyId/clients/:clientId", handle(async (req, res) => {
  const clientId = param(req, "clientId");
  const input = body(clientInput, req);
  await portalWrite(async (tx) => {
    const access = await agencyAccess(req, tx);
    const result = await tx.execute({
      sql: "UPDATE portal_clients SET name = ?, segment = ? WHERE agency_id = ? AND id = ?",
      args: [input.name, input.segment, access.agencyId, clientId],
    });
    if (!result.rowsAffected) throw new NotFoundError("Empresa não encontrada.");
    await audit(tx, "client.settings_updated", access.accountId, access.agencyId, clientId);
  });
  res.json({ id: clientId, ...input });
}));

portalRoutes.post("/agencies/:agencyId/invites", handle(async (req, res) => {
  const access = await agencyAccess(req);
  const input = body(inviteInput, req);
  if (input.role === "ADMIN" && access.role !== "OWNER") throw new ForbiddenError("Somente o titular pode convidar administradores.");
  if ((input.role === "ADMIN") === Boolean(input.clientId)) throw new BadRequestError("Selecione a empresa para o acesso de cliente.");
  await limit(res, "agency-invite", access.agencyId, 40, 3600);
  const value = secret();
  const hash = digest(value);
  const id = secret().slice(0, 32);
  const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
  await portalWrite(async (tx) => {
    const current = await agencyAccess(req, tx);
    if (input.role === "ADMIN" && current.role !== "OWNER") throw new ForbiddenError("Somente o titular pode convidar administradores.");
    const result = await tx.execute({
      sql: `INSERT INTO portal_invites (token_hash, agency_id, client_id, email, role, expires_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM portal_clients WHERE agency_id = ? AND id = ?)`,
      args: [hash, current.agencyId, input.clientId ?? null, input.email, input.role, expiresAt,
        input.clientId ?? null, current.agencyId, input.clientId ?? null],
    });
    if (!result.rowsAffected) throw new NotFoundError("Empresa não encontrada.");
    await tx.execute({ sql: "INSERT INTO portal_invite_ids (id, token_hash) VALUES (?, ?)", args: [id, hash] });
    await audit(tx, "invite.issued", current.accountId, current.agencyId, input.clientId ?? null, id, input.role);
  });
  let emailDelivery: "accepted" | "unavailable" | "failed" | undefined;
  if (input.sendEmail) {
    const mailer = req.app.locals.portalMailer as PortalMailer | undefined;
    emailDelivery = "unavailable";
    if (mailer) {
      try {
        await mailer.send({ to: input.email, kind: "invite", token: value, expiresAt });
        emailDelivery = "accepted";
      } catch {
        emailDelivery = "failed";
        console.warn("[Portal] Falha de entrega de convite.");
      }
    }
  }
  res.status(201).json({ token: value, expiresAt, emailDelivery });
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
  await portalWrite(async (tx) => {
    const current = await clientAccess(req, tx);
    if (current.role !== "OWNER" && current.role !== "ADMIN") throw new ForbiddenError("Somente a agência pode cadastrar oportunidades.");
    await tx.execute({
      sql: "INSERT INTO portal_opportunities (id, agency_id, client_id, name, company, analysis) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, current.agencyId, current.clientId, input.name, input.company, JSON.stringify(analysis)],
    });
  });
  res.status(201).json({ id });
}));

portalRoutes.patch(clientPath + "/opportunities/:opportunityId", handle(async (req, res) => {
  const id = param(req, "opportunityId");
  const input = body(updateInput, req);
  await portalWrite(async (tx) => {
    const access = await clientAccess(req, tx);
    if (access.role === "VIEWER") throw new ForbiddenError("Esta conta tem acesso somente à leitura.");
    const scope = [id, access.agencyId, access.clientId];
    const { rows } = await tx.execute({
      sql: "SELECT stage, outcome FROM portal_opportunities WHERE id = ? AND agency_id = ? AND client_id = ?", args: scope,
    });
    if (!rows.length) throw new NotFoundError("Oportunidade não encontrada.");
    if (rows[0].stage === input.stage && rows[0].outcome === input.outcome) return;
    await tx.execute({
      sql: "UPDATE portal_opportunities SET stage = ?, outcome = ? WHERE id = ? AND agency_id = ? AND client_id = ?",
      args: [input.stage, input.outcome, ...scope],
    });
    const detail = rows[0].stage !== input.stage ? String(rows[0].stage) + " → " + input.stage : null;
    await audit(tx, detail ? "opportunity.stage_changed" : "opportunity.outcome_updated",
      access.accountId, access.agencyId, access.clientId, id, detail);
  });
  res.json({ id, ...input });
}));
