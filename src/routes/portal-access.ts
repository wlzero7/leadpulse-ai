import type { Transaction } from "@libsql/client";
import type { Request } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import { requireAccount } from "./portal-auth.routes.js";

export function param(req: Request, name: string) {
  const result = z.uuid().safeParse(req.params[name]);
  if (!result.success) throw new NotFoundError("Recurso não encontrado.");
  return result.data;
}

export async function verifiedAccount(req: Request, executor: Pick<Transaction, "execute"> = db) {
  const account = await requireAccount(req, executor);
  if (!account.verified) throw new ForbiddenError("Confirme seu e-mail antes de acessar dados empresariais.");
  return account;
}

export async function agencyAccess(req: Request, executor: Pick<Transaction, "execute"> = db) {
  const account = await verifiedAccount(req, executor);
  const agencyId = param(req, "agencyId");
  const { rows } = await executor.execute({
    sql: `SELECT m.role, a.name FROM portal_agency_members m JOIN portal_agencies a ON a.id = m.agency_id
      WHERE m.agency_id = ? AND m.account_id = ? AND NOT EXISTS (
        SELECT 1 FROM portal_access_revocations r WHERE r.agency_id = m.agency_id
          AND r.account_id = m.account_id AND r.scope = '' AND r.revoked_at >= ?)`,
    args: [agencyId, account.id, account.issuedAt],
  });
  if (!rows.length) throw new NotFoundError("Agência não encontrada ou sessão revogada para esta agência.");
  return { agencyId, accountId: account.id, role: String(rows[0].role), name: String(rows[0].name) };
}

export async function clientAccess(req: Request, executor: Pick<Transaction, "execute"> = db) {
  const account = await verifiedAccount(req, executor);
  const agencyId = param(req, "agencyId");
  const clientId = param(req, "clientId");
  const { rows } = await executor.execute({
    sql: `SELECT c.name, c.segment, COALESCE(am.role, cm.role) AS role
      FROM portal_clients c
      LEFT JOIN portal_agency_members am ON am.agency_id = c.agency_id AND am.account_id = ?
      LEFT JOIN portal_client_members cm ON cm.agency_id = c.agency_id AND cm.client_id = c.id AND cm.account_id = ?
      WHERE c.agency_id = ? AND c.id = ? AND (am.account_id IS NOT NULL OR cm.account_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM portal_access_revocations r WHERE r.agency_id = c.agency_id
          AND r.account_id = ? AND r.scope IN ('', c.id) AND r.revoked_at >= ?)`,
    args: [account.id, account.id, agencyId, clientId, account.id, account.issuedAt],
  });
  if (!rows.length) throw new NotFoundError("Empresa não encontrada ou sessão revogada para esta empresa.");
  return { agencyId, clientId, accountId: account.id, role: String(rows[0].role), name: String(rows[0].name), segment: String(rows[0].segment) };
}
