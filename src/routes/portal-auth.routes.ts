import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, cookieValue, digest, limit, limitByAddress, secret, secureCookie, tokenPattern } from "../middlewares/portal-security.js";
import { BadRequestError, ConflictError, UnauthorizedError } from "../utils/errors.js";

export const emailInput = z.string().trim().max(254).toLowerCase().pipe(z.email());
export const personInput = z.string().trim().min(2).max(100);
const newPassword = z.string().min(15).max(128);
const token = z.string().regex(tokenPattern);
const settings = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const dummyHash = argon2.hash(secret(), settings);
const cookie = secureCookie ? "__Host-lp_portal" : "lp_portal";
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: secureCookie, path: "/" };
const twelveHours = 12 * 60 * 60 * 1000;

export function body<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const value = schema.safeParse(req.body);
  if (!value.success) {
    const passwordIssue = value.error.issues.some((issue) => issue.path[0] === "password");
    throw new BadRequestError(passwordIssue ? "Verifique a senha informada. Senhas novas precisam ter de 15 a 128 caracteres." : "Revise os campos informados.");
  }
  return value.data;
}

export function handle(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void fn(req, res).catch(next); };
}

function sessionHash(req: Request) {
  const value = cookieValue(req, cookie);
  return value && tokenPattern.test(value) ? digest(value) : null;
}

export async function account(req: Request) {
  const hash = sessionHash(req);
  if (!hash) return null;
  const { rows } = await db.execute({
    sql: `SELECT a.id, a.email, a.name FROM portal_sessions s JOIN portal_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [hash, Date.now()],
  });
  const row = rows[0];
  return row ? { id: String(row.id), email: String(row.email), name: String(row.name) } : null;
}

export async function requireAccount(req: Request) {
  const identity = await account(req);
  if (!identity) throw new UnauthorizedError("Entre para acessar o workspace.");
  return identity;
}

async function startSession(req: Request, res: Response, accountId: string, passwordHash: string) {
  const value = secret();
  const old = sessionHash(req);
  const result = await db.batch([
    { sql: "DELETE FROM portal_sessions WHERE token_hash = ?", args: [old] },
    { sql: `INSERT INTO portal_sessions (token_hash, account_id, expires_at)
      SELECT ?, id, ? FROM portal_accounts WHERE id = ? AND password_hash = ?`,
      args: [digest(value), Date.now() + twelveHours, accountId, passwordHash] },
  ], "write");
  if (!result[1].rowsAffected) throw new UnauthorizedError("Entre novamente para continuar.");
  res.cookie(cookie, value, { ...cookieOptions, maxAge: twelveHours });
}

const registerInput = z.object({ agency: personInput, name: personInput, email: emailInput, password: newPassword });
const loginInput = z.object({ email: emailInput, password: z.string().min(1).max(128) });
const recoveryInput = z.object({ email: emailInput, recoveryCode: token });
const resetInput = z.object({ token, password: newPassword });
const inviteInput = z.object({ token, name: personInput.optional(), password: newPassword.optional() });
export const portalAuth: Router = Router();
portalAuth.use(browserRequests);

portalAuth.get("/me", handle(async (req, res) => res.json(await requireAccount(req))));

portalAuth.post("/register", limitByAddress("register", 12, 3600), handle(async (req, res) => {
  const input = body(registerInput, req);
  const passwordHash = await argon2.hash(input.password, settings);
  const recoveryCode = secret();
  const id = randomUUID();
  const agencyId = randomUUID();
  const tx = await db.transaction("write");
  try {
    const created = await tx.execute({
      sql: "INSERT INTO portal_accounts VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
      args: [id, input.email, input.name, passwordHash, digest(recoveryCode)],
    });
    if (!created.rowsAffected) throw new ConflictError("Não foi possível cadastrar. Se já tiver uma conta, entre ou recupere o acesso.");
    await tx.batch([
      { sql: "INSERT INTO portal_agencies VALUES (?, ?)", args: [agencyId, input.agency] },
      { sql: "INSERT INTO portal_agency_members VALUES (?, ?, 'OWNER')", args: [agencyId, id] },
    ]);
    await tx.commit();
  } finally {
    tx.close();
  }
  await startSession(req, res, id, passwordHash);
  res.status(201).json({ recoveryCode });
}));

portalAuth.post("/login", limitByAddress("login-ip", 30, 900), handle(async (req, res) => {
  const input = body(loginInput, req);
  await limit(res, "login-account", input.email, 10, 900);
  const { rows } = await db.execute({
    sql: "SELECT id, password_hash FROM portal_accounts WHERE email = ?", args: [input.email],
  });
  const hash = rows.length ? String(rows[0].password_hash) : await dummyHash;
  const valid = await argon2.verify(hash, input.password);
  if (!rows.length || !valid) throw new UnauthorizedError("E-mail ou senha inválidos.");
  await startSession(req, res, String(rows[0].id), hash);
  res.status(204).end();
}));

portalAuth.post("/logout", handle(async (req, res) => {
  const hash = sessionHash(req);
  if (hash) await db.execute({ sql: "DELETE FROM portal_sessions WHERE token_hash = ?", args: [hash] });
  res.clearCookie(cookie, cookieOptions).status(204).end();
}));

portalAuth.post("/recovery", limitByAddress("recovery", 12, 900), handle(async (req, res) => {
  const input = body(recoveryInput, req);
  const resetToken = secret();
  const inserted = await db.execute({
    sql: `INSERT INTO portal_resets (token_hash, account_id, recovery_hash, expires_at)
      SELECT ?, id, recovery_hash, ? FROM portal_accounts WHERE email = ? AND recovery_hash = ?`,
    args: [digest(resetToken), Date.now() + 15 * 60 * 1000, input.email, digest(input.recoveryCode)],
  });
  if (!inserted.rowsAffected) throw new BadRequestError("Não foi possível validar o código de recuperação.");
  res.json({ resetToken });
}));

portalAuth.post("/reset", limitByAddress("reset", 12, 900), handle(async (req, res) => {
  const input = body(resetInput, req);
  const hash = digest(input.token);
  const lookup = `SELECT r.account_id FROM portal_resets r JOIN portal_accounts a ON a.id = r.account_id
    WHERE r.token_hash = ? AND r.expires_at > ? AND r.recovery_hash = a.recovery_hash`;
  const valid = await db.execute({ sql: lookup, args: [hash, Date.now()] });
  if (!valid.rows.length) throw new BadRequestError("Token de recuperação inválido ou expirado.");
  const passwordHash = await argon2.hash(input.password, settings);
  const recoveryCode = secret();
  const tx = await db.transaction("write");
  try {
    const active = await tx.execute({ sql: lookup, args: [hash, Date.now()] });
    if (!active.rows.length) throw new BadRequestError("Token de recuperação inválido ou expirado.");
    const id = String(active.rows[0].account_id);
    await tx.batch([
      { sql: "UPDATE portal_accounts SET password_hash = ?, recovery_hash = ? WHERE id = ?", args: [passwordHash, digest(recoveryCode), id] },
      { sql: "DELETE FROM portal_sessions WHERE account_id = ?", args: [id] },
      { sql: "DELETE FROM portal_resets WHERE account_id = ?", args: [id] },
    ]);
    await tx.commit();
  } finally {
    tx.close();
  }
  res.clearCookie(cookie, cookieOptions).json({ recoveryCode });
}));

portalAuth.post("/accept", limitByAddress("accept", 20, 900), handle(async (req, res) => {
  const input = body(inviteInput, req);
  const hash = digest(input.token);
  const inviteQuery = "SELECT agency_id, client_id, email, role FROM portal_invites WHERE token_hash = ? AND expires_at > ?";
  const invalid = () => new BadRequestError("Convite inválido, expirado ou já utilizado.");
  const lookup = await db.execute({ sql: inviteQuery, args: [hash, Date.now()] });
  if (!lookup.rows.length) throw invalid();
  const identity = await account(req);
  const email = String(lookup.rows[0].email);
  if (identity && identity.email !== email) throw new UnauthorizedError("Entre com a conta correspondente ao convite.");
  const existing = await db.execute({ sql: "SELECT id FROM portal_accounts WHERE email = ?", args: [email] });
  if (existing.rows.length && !identity) throw new UnauthorizedError("Entre com a conta correspondente ao convite.");
  if (!identity && (!input.name || !input.password)) throw new BadRequestError("Informe nome e uma senha com pelo menos 15 caracteres.");
  const passwordHash = !identity && input.password ? await argon2.hash(input.password, settings) : null;
  const recoveryCode = passwordHash ? secret() : null;
  const id = identity?.id ?? randomUUID();
  const tx = await db.transaction("write");
  try {
    const { rows } = await tx.execute({ sql: inviteQuery, args: [hash, Date.now()] });
    const invite = rows[0];
    if (!invite) throw invalid();
    if (passwordHash && recoveryCode) {
      const created = await tx.execute({
        sql: "INSERT INTO portal_accounts VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
        args: [id, email, input.name ?? "", passwordHash, digest(recoveryCode)],
      });
      if (!created.rowsAffected) throw new UnauthorizedError("Entre com a conta correspondente ao convite.");
    }
    if (invite.client_id) {
      await tx.execute({
        sql: "INSERT INTO portal_client_members VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        args: [invite.agency_id, invite.client_id, id, invite.role],
      });
    } else {
      await tx.execute({
        sql: "INSERT INTO portal_agency_members VALUES (?, ?, 'ADMIN') ON CONFLICT DO NOTHING",
        args: [invite.agency_id, id],
      });
    }
    await tx.execute({ sql: "DELETE FROM portal_invites WHERE token_hash = ?", args: [hash] });
    await tx.commit();
  } finally {
    tx.close();
  }
  if (passwordHash) await startSession(req, res, id, passwordHash);
  res.json(recoveryCode ? { recoveryCode } : {});
}));
