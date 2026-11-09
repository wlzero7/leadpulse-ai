import { randomUUID } from "node:crypto";
import type { Transaction } from "@libsql/client";

export async function audit(tx: Transaction, event: string, actor: string, agency: string, client: string | null = null, subject: string | null = null, detail: string | null = null) {
  await tx.execute({
    sql: "INSERT INTO portal_audit (id, at, event, actor_id, agency_id, client_id, subject_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), Date.now(), event, actor, agency, client, subject, detail],
  });
}

export async function auditIdentity(tx: Transaction, event: string, account: string) {
  await tx.execute({
    sql: `INSERT INTO portal_audit (id, at, event, actor_id, agency_id, client_id)
      SELECT lower(hex(randomblob(16))), ?, ?, ?, agency_id, NULL
      FROM portal_agency_members WHERE account_id = ?
      UNION ALL
      SELECT lower(hex(randomblob(16))), ?, ?, ?, c.agency_id, c.client_id FROM portal_client_members c
      WHERE c.account_id = ? AND NOT EXISTS (
        SELECT 1 FROM portal_agency_members a WHERE a.agency_id = c.agency_id AND a.account_id = c.account_id)`,
    args: [Date.now(), event, account, account, Date.now(), event, account, account],
  });
}
