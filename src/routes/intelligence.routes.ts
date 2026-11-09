import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, limitByAddress } from "../middlewares/portal-security.js";
import { env } from "../config/env.js";
import { evaluateHeuristically } from "../services/ai.service.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";

const stages = z.enum(["NEW", "CONTACTED", "PROPOSAL", "WON"]);
const leadInput = z.object({
  name: z.string().trim().min(2).max(80),
  company: z.string().trim().min(2).max(80),
  role: z.string().trim().max(80).optional(),
  email: z.union([z.literal(""), z.email().max(120).regex(/\.(test|example|invalid)$/i)]).optional(),
  message: z.string().trim().min(8).max(1200),
});
const stageInput = z.object({ stage: stages });
const cookieName = "lp_intelligence_demo";
const sessionPath = "/api/v1/intelligence/demo";

function sessionKey(req: Request, res: Response, create = false): string {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
    return createHash("sha256").update(cookie).digest("hex");
  }
  if (!create) throw new ForbiddenError("Abra a demonstração para iniciar uma sessão.");
  const token = randomBytes(32).toString("hex");
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: sessionPath,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return createHash("sha256").update(token).digest("hex");
}

function publicLead(row: { [column: string]: unknown }) {
  return {
    id: String(row.id),
    stage: stages.parse(row.stage),
    createdAt: String(row.created_at),
    ...JSON.parse(String(row.payload)) as z.infer<typeof leadInput>,
    analysis: JSON.parse(String(row.analysis)) as ReturnType<typeof evaluateHeuristically>,
  };
}

export const intelligenceRoutes: Router = Router();

intelligenceRoutes.use(browserRequests);

intelligenceRoutes.get("/", limitByAddress("demo-read", 120, 60), async (req, res, next) => {
  try {
    const key = sessionKey(req, res, true);
    const { rows } = await db.execute({
      sql: "SELECT id, stage, payload, analysis, created_at FROM intelligence_demo_leads WHERE session_key = ? AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC, rowid DESC",
      args: [key],
    });
    res.json({ mode: "heuristic-demo", leads: rows.map(publicLead) });
  } catch (error) {
    next(error);
  }
});

intelligenceRoutes.post("/leads", limitByAddress("demo-create", 60, 3600), async (req, res, next) => {
  try {
    const key = sessionKey(req, res);
    const parsed = leadInput.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Preencha os campos obrigatórios e use um e-mail fictício, como contato@empresa.test.");
    const lead = parsed.data;
    const analysis = evaluateHeuristically({
      ...lead,
      role: lead.role || null,
      email: lead.email || null,
      raw_payload: JSON.stringify(lead),
    });
    const { rows } = await db.execute({
      sql: `INSERT INTO intelligence_demo_leads (id, session_key, payload, analysis)
        SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM intelligence_demo_leads WHERE session_key = ? AND created_at >= datetime('now', '-7 days')) < 24
        RETURNING id, stage, payload, analysis, created_at`,
      args: [randomUUID(), key, JSON.stringify(lead), JSON.stringify(analysis), key],
    });
    if (!rows[0]) throw new ConflictError("Esta sessão atingiu o limite de 24 leads de demonstração.");
    res.status(201).json(publicLead(rows[0]));
  } catch (error) {
    next(error);
  }
});

intelligenceRoutes.patch("/leads/:id/stage", limitByAddress("demo-move", 90, 60), async (req, res, next) => {
  try {
    const key = sessionKey(req, res);
    const parsed = stageInput.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Selecione uma etapa comercial válida.");
    const result = await db.execute({
      sql: "UPDATE intelligence_demo_leads SET stage = ? WHERE id = ? AND session_key = ? AND created_at >= datetime('now', '-7 days')",
      args: [parsed.data.stage, req.params.id, key],
    });
    if (!result.rowsAffected) throw new NotFoundError("Lead de demonstração não encontrado.");
    res.json({ id: req.params.id, stage: parsed.data.stage });
  } catch (error) {
    next(error);
  }
});
