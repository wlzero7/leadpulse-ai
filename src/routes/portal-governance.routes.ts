import { Router } from "express";
import { z } from "zod";
import { db } from "../config/database.js";
import { browserRequests, portalWrite } from "../middlewares/portal-security.js";
import { audit } from "../services/portal-audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { agencyAccess, param } from "./portal-access.js";
import { body, handle } from "./portal-auth.routes.js";

const action = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("remove"), clientId: z.uuid().optional() }),
  z.object({ operation: z.literal("sessions"), clientId: z.uuid().optional() }),
  z.object({ operation: z.literal("role"), clientId: z.uuid().optional(), role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER"]) }),
]);

export const governanceRoutes: Router = Router();
governanceRoutes.use(browserRequests);
const path = "/agencies/:agencyId/access";

governanceRoutes.get(path, handle(async (req, res) => {
  const access = await agencyAccess(req);
  const [members, invites, events] = await db.batch([
    { sql: `SELECT a.id, a.name, a.email, m.role, NULL AS clientId, NULL AS client, 1 AS privileged
        FROM portal_agency_members m JOIN portal_accounts a ON a.id = m.account_id WHERE m.agency_id = ?
      UNION ALL SELECT a.id, a.name, a.email, m.role, c.id, c.name,
        EXISTS (SELECT 1 FROM portal_agency_members ag WHERE ag.account_id = a.id AND ag.agency_id = m.agency_id)
        FROM portal_client_members m JOIN portal_accounts a ON a.id = m.account_id
        JOIN portal_clients c ON c.id = m.client_id AND c.agency_id = m.agency_id
        WHERE m.agency_id = ? ORDER BY clientId, name`, args: [access.agencyId, access.agencyId] },
    { sql: `SELECT ids.id, i.email, i.role, c.name AS client, i.expires_at AS expiresAt,
        CASE WHEN i.expires_at <= ? THEN 'EXPIRED' ELSE 'PENDING' END AS status
        FROM portal_invites i JOIN portal_invite_ids ids ON ids.token_hash = i.token_hash
        LEFT JOIN portal_clients c ON c.agency_id = i.agency_id AND c.id = i.client_id
        WHERE i.agency_id = ? ORDER BY i.expires_at DESC LIMIT 100`, args: [Date.now(), access.agencyId] },
    { sql: `SELECT e.at, e.event, e.actor_id AS actorId, a.name AS actor, e.client_id AS clientId,
        c.name AS client, e.subject_id AS subjectId, e.detail FROM portal_audit e
        LEFT JOIN portal_accounts a ON a.id = e.actor_id
        LEFT JOIN portal_clients c ON c.agency_id = e.agency_id AND c.id = e.client_id
        WHERE e.agency_id = ? ORDER BY e.at DESC, e.id DESC LIMIT 100`, args: [access.agencyId] },
  ], "read");
  res.json({ name: access.name, role: access.role, members: members.rows, invites: invites.rows, events: events.rows });
}));

governanceRoutes.post(path + "/members/:accountId", handle(async (req, res) => {
  const id = param(req, "accountId");
  const input = body(action, req);
  await portalWrite(async (tx) => {
    const access = await agencyAccess(req, tx);
    const client = input.clientId;
    const agencyMember = await tx.execute({
      sql: "SELECT role FROM portal_agency_members WHERE agency_id = ? AND account_id = ?", args: [access.agencyId, id],
    });
    if ((!client || agencyMember.rows.length) && access.role !== "OWNER") {
      throw new ForbiddenError("Somente o titular pode administrar membros com acesso à agência.");
    }
    const member = client ? await tx.execute({
      sql: "SELECT role FROM portal_client_members WHERE agency_id = ? AND client_id = ? AND account_id = ?",
      args: [access.agencyId, client, id],
    }) : agencyMember;
    const target = member.rows[0];
    if (!target) throw new NotFoundError("Vínculo não encontrado.");
    if (input.operation === "role") {
      const clientRole = input.role === "EDITOR" || input.role === "VIEWER";
      if (Boolean(client) !== clientRole) throw new BadRequestError("O papel não corresponde ao tipo de vínculo.");
      if (target.role === input.role) return;
    }
    if (!client && target.role === "OWNER" && input.operation !== "sessions") {
      const remaining = await tx.execute({
        sql: "SELECT 1 FROM portal_agency_members WHERE agency_id = ? AND role = 'OWNER' AND account_id != ? LIMIT 1",
        args: [access.agencyId, id],
      });
      if (!remaining.rows.length) throw new ConflictError("A agência precisa manter pelo menos um titular.");
    }
    if (input.operation === "remove") {
      if (client) await tx.execute({
        sql: "DELETE FROM portal_client_members WHERE agency_id = ? AND client_id = ? AND account_id = ?",
        args: [access.agencyId, client, id],
      });
      else await tx.batch([
        { sql: "DELETE FROM portal_agency_members WHERE agency_id = ? AND account_id = ?", args: [access.agencyId, id] },
        { sql: "DELETE FROM portal_client_members WHERE agency_id = ? AND account_id = ?", args: [access.agencyId, id] },
      ]);
    }
    if (input.operation === "remove") {
      const pending = await tx.execute({
        sql: `SELECT ids.id, i.token_hash, i.client_id, i.role
          FROM portal_invites i JOIN portal_invite_ids ids ON ids.token_hash = i.token_hash
          JOIN portal_accounts a ON a.email = i.email
          WHERE i.agency_id = ? AND a.id = ? AND i.expires_at > ? AND (? IS NULL OR i.client_id = ?)`,
        args: [access.agencyId, id, Date.now(), client ?? null, client ?? null],
      });
      for (const invite of pending.rows) {
        await tx.batch([
          { sql: "DELETE FROM portal_invite_ids WHERE id = ?", args: [invite.id] },
          { sql: "DELETE FROM portal_invites WHERE token_hash = ?", args: [invite.token_hash] },
        ]);
        await audit(tx, "invite.revoked", access.accountId, access.agencyId,
          invite.client_id ? String(invite.client_id) : null, String(invite.id), String(invite.role));
      }
    }
    if (input.operation === "role") {
      await tx.execute(client ? {
        sql: "UPDATE portal_client_members SET role = ? WHERE agency_id = ? AND client_id = ? AND account_id = ?",
        args: [input.role, access.agencyId, client, id],
      } : {
        sql: "UPDATE portal_agency_members SET role = ? WHERE agency_id = ? AND account_id = ?",
        args: [input.role, access.agencyId, id],
      });
    }
    await tx.execute({
      sql: `INSERT INTO portal_access_revocations (agency_id, scope, account_id, revoked_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (agency_id, scope, account_id) DO UPDATE SET revoked_at = excluded.revoked_at`,
      args: [access.agencyId, client ?? "", id, Date.now()],
    });
    const event = input.operation === "role" ? "permission.changed" : input.operation === "remove" ? "member.removed" : "sessions.revoked";
    await audit(tx, event, access.accountId, access.agencyId, client ?? null, id,
      input.operation === "role" ? String(target.role) + " → " + input.role : null);
  });
  res.status(204).end();
}));

governanceRoutes.post(path + "/invites/:inviteId/revoke", handle(async (req, res) => {
  const id = req.params.inviteId;
  if (!/^[a-f0-9]{32}$/.test(id)) throw new NotFoundError("Convite não encontrado.");
  await portalWrite(async (tx) => {
    const access = await agencyAccess(req, tx);
    const { rows } = await tx.execute({
      sql: `SELECT i.token_hash, i.client_id, i.role FROM portal_invites i JOIN portal_invite_ids ids
        ON ids.token_hash = i.token_hash WHERE ids.id = ? AND i.agency_id = ? AND i.expires_at > ?`,
      args: [id, access.agencyId, Date.now()],
    });
    const invite = rows[0];
    if (!invite) throw new NotFoundError("Convite pendente não encontrado.");
    if (invite.role === "ADMIN" && access.role !== "OWNER") throw new ForbiddenError("Somente o titular pode revogar convites de administradores.");
    await tx.batch([
      { sql: "DELETE FROM portal_invite_ids WHERE id = ?", args: [id] },
      { sql: "DELETE FROM portal_invites WHERE token_hash = ?", args: [invite.token_hash] },
    ]);
    await audit(tx, "invite.revoked", access.accountId, access.agencyId, invite.client_id ? String(invite.client_id) : null, id, String(invite.role));
  });
  res.status(204).end();
}));
