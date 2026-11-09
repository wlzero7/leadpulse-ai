import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Request, RequestHandler, Response } from "express";
import { db } from "../config/database.js";
import { env } from "../config/env.js";
import { AppError, BadRequestError, ForbiddenError } from "../utils/errors.js";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export const tokenPattern = /^[a-f0-9]{64}$/;
export const secureCookie = env.NODE_ENV === "production";

export function cookieValue(req: Request, name: string) {
  return req.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(name + "="))?.slice(name.length + 1);
}

export const browserRequests: RequestHandler = (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  const site = req.get("Sec-Fetch-Site");
  const origin = req.get("Origin");
  if (site === "cross-site" || site === "same-site" ||
      (origin && origin !== "https://" + req.get("Host") &&
        (secureCookie || origin !== "http://" + req.get("Host")))) {
    return next(new ForbiddenError("Abra o portal no próprio site."));
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !req.is("application/json")) {
    return next(new BadRequestError("Envie dados no formato JSON."));
  }
  next();
};

function clientAddress(req: Request): string {
  // Render overwrites CF-Connecting-IP at the public edge. Outside Render, ignore proxy headers.
  const edge = process.env.RENDER === "true" ? req.get("CF-Connecting-IP") : undefined;
  return edge && isIP(edge) ? edge : (req.socket.remoteAddress ?? "unknown");
}

export async function limit(res: Response, scope: string, key: string, maximum: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const expires = now - (now % seconds) + seconds;
  const result = await db.execute({
    sql: `INSERT INTO portal_rate_limits (scope, hits, expires_at) VALUES (?, 1, ?)
      ON CONFLICT (scope) DO UPDATE SET hits = CASE WHEN expires_at = excluded.expires_at THEN hits + 1 ELSE 1 END,
        expires_at = excluded.expires_at
      WHERE portal_rate_limits.expires_at != excluded.expires_at OR portal_rate_limits.hits < ?
      RETURNING hits`,
    args: [digest(scope + ":" + key), expires, maximum],
  });
  if (!result.rows.length) {
    res.setHeader("Retry-After", expires - now);
    throw new AppError("Muitas tentativas. Aguarde e tente novamente.", 429);
  }
}

export function limitByAddress(scope: string, maximum: number, seconds: number): RequestHandler {
  return (req, res, next) => {
    limit(res, scope, clientAddress(req), maximum, seconds).then(() => next(), next);
  };
}

export function maintainPortal() {
  // Do not keep an instance awake. Startup also runs the sweep after scale-to-zero.
  const sweep = () => {
    const now = Date.now();
    void db.batch([
      "DELETE FROM intelligence_demo_leads WHERE created_at < datetime('now', '-7 days')",
      { sql: "DELETE FROM portal_sessions WHERE expires_at <= ?", args: [now] },
      { sql: "DELETE FROM portal_invites WHERE expires_at <= ?", args: [now] },
      { sql: "DELETE FROM portal_resets WHERE expires_at <= ?", args: [now] },
      { sql: "DELETE FROM portal_rate_limits WHERE expires_at <= ?", args: [Math.floor(now / 1000)] },
    ], "write").catch(() => console.warn("[Portal] Limpeza periódica adiada."));
  };
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
}
