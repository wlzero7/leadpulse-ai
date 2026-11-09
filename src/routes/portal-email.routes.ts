import { setTimeout as delay } from "node:timers/promises";
import { Router } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, digest, limit, limitByAddress, portalWrite, secret, tokenPattern } from "../middlewares/portal-security.js";
import { auditIdentity } from "../services/portal-audit.js";
import type { PortalMailer } from "../services/portal-mail.js";
import { AppError, BadRequestError } from "../utils/errors.js";
import { body, emailInput, handle, requireAccount } from "./portal-auth.routes.js";

export const emailRoutes: Router = Router();
emailRoutes.use(browserRequests);

emailRoutes.post("/verification/request", limitByAddress("verify-ip", 20, 3600), handle(async (req, res) => {
  const account = await requireAccount(req);
  if (account.verified) return res.status(204).end();
  const mailer = req.app.locals.portalMailer as PortalMailer | undefined;
  if (!mailer) throw new AppError("O envio de confirmação ainda não está disponível neste ambiente.", 503);
  await limit(res, "verify-account", account.id, 5, 3600);
  const token = secret();
  const hash = digest(token);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const previous = await portalWrite(async (tx) => {
    const { rows } = await tx.execute({
      sql: "SELECT email, token_hash, expires_at FROM portal_email_verifications WHERE account_id = ? AND expires_at > ?",
      args: [account.id, Date.now()],
    });
    await tx.execute({
      sql: `INSERT INTO portal_email_verifications (account_id, email, token_hash, expires_at)
        VALUES (?, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET email = excluded.email,
          token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
      args: [account.id, account.email, hash, expiresAt],
    });
    return rows[0];
  });
  try {
    await mailer.send({ to: account.email, kind: "verify", token, expiresAt });
  } catch {
    // A failure must not erase a newer request or invalidate the last delivered link.
    if (previous?.email === account.email && Number(previous.expires_at) > Date.now()) {
      await db.execute({
        sql: "UPDATE portal_email_verifications SET token_hash = ?, expires_at = ? WHERE token_hash = ?",
        args: [previous.token_hash, previous.expires_at, hash],
      });
    } else {
      await db.execute({ sql: "DELETE FROM portal_email_verifications WHERE token_hash = ?", args: [hash] });
    }
    console.warn("[Portal] Falha de entrega de confirmação.");
    throw new AppError("Não foi possível enviar a confirmação agora. Tente reenviar em instantes.", 503);
  }
  res.status(202).json({ accepted: true });
}));

emailRoutes.post("/verification/confirm", limitByAddress("verify-confirm", 30, 900), handle(async (req, res) => {
  const input = body(z.object({ token: z.string().regex(tokenPattern) }), req);
  await portalWrite(async (tx) => {
    const account = await requireAccount(req, tx);
    const deleted = await tx.execute({
      sql: "DELETE FROM portal_email_verifications WHERE account_id = ? AND email = ? AND token_hash = ? AND expires_at > ?",
      args: [account.id, account.email, digest(input.token), Date.now()],
    });
    if (!deleted.rowsAffected) throw new BadRequestError("Confirmação inválida, expirada ou já utilizada.");
    await tx.execute({
      sql: `INSERT INTO portal_verified_emails (account_id, email, verified_at) VALUES (?, ?, ?)
        ON CONFLICT (account_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at`,
      args: [account.id, account.email, Date.now()],
    });
    await auditIdentity(tx, "account.email_verified", account.id);
  });
  res.status(204).end();
}));

emailRoutes.post("/recovery/email", limitByAddress("recovery-email-ip", 20, 3600), handle(async (req, res) => {
  const { email } = body(z.object({ email: emailInput }), req);
  const mailer = req.app.locals.portalMailer as PortalMailer | undefined;
  if (!mailer) return res.status(202).json({ available: false });
  await limit(res, "recovery-email-address", email, 5, 3600);
  const token = secret();
  const hash = digest(token);
  const expiresAt = Date.now() + 15 * 60 * 1000;
  // Keep the public response uniform. The production transport is capped at 3.5 seconds.
  const responseFloor = delay(5000);
  try {
    const issued = await portalWrite(async (tx) => {
      const { rows } = await tx.execute({
        sql: `SELECT a.id, a.recovery_hash FROM portal_accounts a JOIN portal_verified_emails v
          ON v.account_id = a.id AND v.email = a.email WHERE a.email = ?`, args: [email],
      });
      const account = rows[0];
      if (!account) return false;
      await tx.batch([
        { sql: "DELETE FROM portal_resets WHERE account_id = ?", args: [account.id] },
        { sql: "INSERT INTO portal_resets (token_hash, account_id, recovery_hash, expires_at) VALUES (?, ?, ?, ?)",
          args: [hash, account.id, account.recovery_hash, expiresAt] },
      ]);
      return true;
    });
    if (issued) {
      try {
        await mailer.send({ to: email, kind: "reset", token, expiresAt });
      } catch {
        await db.execute({ sql: "DELETE FROM portal_resets WHERE token_hash = ?", args: [hash] });
        console.warn("[Portal] Falha de entrega de recuperação.");
      }
    }
  } catch {
    console.warn("[Portal] Falha ao processar recuperação por e-mail.");
  } finally {
    await responseFloor;
  }
  res.status(202).json({ available: true });
}));
