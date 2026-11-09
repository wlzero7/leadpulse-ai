import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

if (!process.env.LEADPULSE_PORTAL_TEST_CHILD) {
  const folder = await mkdtemp(join(tmpdir(), "leadpulse-portal-test-"));
  const file = join(folder, "portal.db");
  let exitCode = 1;
  try {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      env: {
        ...process.env, LEADPULSE_PORTAL_TEST_CHILD: "1",
        TURSO_DATABASE_URL: pathToFileURL(file).href,
      },
      stdio: "inherit",
    });
    const [code] = await once(child, "close");
    exitCode = typeof code === "number" ? code : 1;
  } finally {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) await rm(file + suffix, { force: true });
    await rmdir(folder);
  }
  process.exit(exitCode);
}

process.env.NODE_ENV = "production";
process.env.PORTAL_AUDIT_RETENTION_DAYS = "30";
assert.ok(process.env.TURSO_DATABASE_URL?.startsWith("file:"));

process.env.TURSO_AUTH_TOKEN = "";
process.env.GEMINI_API_KEY = "mock_or_env";
const { createApp } = await import("./src/app.js");
const { db } = await import("./src/config/database.js");
const { maintainPortal } = await import("./src/middlewares/portal-security.js");
const schema = readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8");
await db.executeMultiple(schema.split("-- Identity governance.")[0]);
await db.execute("INSERT INTO tenants (id, name, slug, api_key) VALUES ('legacy', 'Legacy fixture', 'legacy', 'fixture')");
await db.execute("INSERT INTO intelligence_demo_leads (id, session_key, payload, analysis, created_at) VALUES ('expired', 'fixture', '{}', '{}', datetime('now','-8 days')), ('fresh', 'fixture', '{}', '{}', datetime('now'))");
await db.execute("INSERT INTO portal_agencies VALUES ('prior-agency', 'Existing agency')");
await db.execute("INSERT INTO portal_invites VALUES ('prior-hash', 'prior-agency', NULL, 'prior@example.test', 'ADMIN', 9999999999999)");
await db.executeMultiple(schema);
const legacyInviteId = (await db.execute("SELECT id FROM portal_invite_ids WHERE token_hash = 'prior-hash'")).rows[0].id;
await db.executeMultiple(schema);
assert.equal((await db.execute("SELECT id FROM portal_invite_ids WHERE token_hash = 'prior-hash'")).rows[0].id, legacyInviteId);
await db.execute("INSERT INTO portal_audit (id, at, event, actor_id, agency_id) VALUES ('old-audit', 0, 'session.login', 'fixture', 'prior-agency')");
assert.equal((await db.execute("SELECT name FROM tenants WHERE id = 'legacy'")).rows[0].name, "Legacy fixture");
assert.equal((await db.execute("SELECT COUNT(*) AS count FROM intelligence_demo_leads")).rows[0].count, 2);
maintainPortal();
for (let i = 0; i < 15 && (await db.execute("SELECT id FROM intelligence_demo_leads WHERE id = 'expired'")).rows.length; i++) await delay(10);
assert.deepEqual((await db.execute("SELECT id FROM intelligence_demo_leads")).rows.map((row) => row.id), ["fresh"]);
assert.equal((await db.execute("SELECT id FROM portal_audit WHERE id = 'old-audit'")).rows.length, 0);
console.log("PASS additive migration, old invite IDs and audit/demo retention");

const mailbox: import("./src/services/portal-mail.js").PortalMail[] = [];
const server = createApp({ async send(mail) { mailbox.push(mail); } }).listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const prefix = "/api/v1/portal";
const password = "synthetic fixture password";
const changed = "synthetic replacement password";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function request(path: string, expected: number, options: { method?: string; cookie?: string; data?: unknown; headers?: Record<string, string>; raw?: boolean } = {}) {
  const { method = "GET", cookie, data, headers, raw } = options;
  const response = await fetch(base + (raw ? path : prefix + path), {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, expected, method + " " + path);
  return response;
}

function readCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  assert.ok(header.startsWith("__Host-lp_portal="));
  assert.ok(header.includes("HttpOnly") && header.includes("Secure") && header.includes("SameSite=Strict") && header.includes("Path=/"));
  return header.split(";")[0];
}

async function verify(cookie: string, email: string, exerciseExpiry = false) {
  const issue = async () => {
    const response = await request("/auth/verification/request", 202, { cookie, method: "POST", data: {} });
    assert.deepEqual(await response.json(), { accepted: true });
    const mail = mailbox.at(-1);
    assert.ok(mail && mail.to === email && mail.kind === "verify");
    return mail.token;
  };
  const confirm = (token: string, status: number) =>
    request("/auth/verification/confirm", status, { cookie, method: "POST", data: { token } });
  let token = await issue();
  if (exerciseExpiry) {
    const replaced = token;
    token = await issue();
    await confirm(replaced, 400);
    await db.execute({ sql: "UPDATE portal_email_verifications SET expires_at = 0 WHERE token_hash = ?", args: [hash(token)] });
    await confirm(token, 400);
    token = await issue();
  }
  await confirm(token, 204);
  await confirm(token, 400);
}

async function register(agency: string, email: string) {
  const res = await request("/auth/register", 201, { method: "POST", data: { agency, name: agency + " Owner", email, password } });
  const cookie = readCookie(res);
  const { recoveryCode } = await res.json();
  const pending = await (await request("/workspaces", 200, { cookie })).json();
  assert.ok(!pending.account.verified && pending.agencies.length === 0 && pending.clients.length === 0);
  const ownId = (await db.execute({
    sql: "SELECT agency_id FROM portal_agency_members WHERE account_id = ?", args: [pending.account.id],
  })).rows[0].agency_id;
  await request("/agencies/" + ownId, 403, { cookie });
  await verify(cookie, email, agency === "Agency A");
  const workspaces = await (await request("/workspaces", 200, { cookie })).json();
  assert.equal(workspaces.agencies.length, 1);
  assert.equal(workspaces.clients.length, 0);
  assert.ok(!("password_hash" in workspaces.account) && !("recovery_hash" in workspaces.account));
  return { cookie, recoveryCode, agencyPath: "/agencies/" + workspaces.agencies[0].id, accountId: workspaces.account.id };
}

async function createClient(owner: { agencyPath: string; cookie: string }, name: string) {
  return (await request(owner.agencyPath + "/clients", 201, { cookie: owner.cookie, method: "POST", data: { name } })).json();
}

async function invite(owner: { agencyPath: string; cookie: string }, email: string, role: string, clientId?: string) {
  return (await request(owner.agencyPath + "/invites", 201, { cookie: owner.cookie, method: "POST", data: { email, role, clientId } })).json();
}

async function accept(token: string, cookie?: string) {
  return request("/auth/accept", 200, { cookie, method: "POST", data: cookie ? { token } : { token, name: "Synthetic Member", password } });
}

try {
  await request("/intelligence/portal/", 200, { raw: true });
  await request("/workspaces", 401);
  await request("/auth/register", 403, { method: "POST", headers: { Origin: "https://cross-site.example" }, data: {} });
  await request("/auth/login", 400, { method: "POST" });
  const owner = await register("Agency A", "owner-a@example.test");
  const rival = await register("Agency B", "owner-b@example.test");
  await request("/auth/login", 401, { method: "POST", data: { email: "owner-a@example.test", password: "incorrect" } });
  const stored = (await db.execute({ sql: "SELECT password_hash, recovery_hash FROM portal_accounts WHERE id = ?", args: [owner.accountId] })).rows[0];
  assert.ok(String(stored.password_hash).startsWith("$argon2id$") && stored.password_hash !== password);
  assert.ok(stored.recovery_hash === hash(owner.recoveryCode));
  await request(rival.agencyPath, 404, { cookie: owner.cookie });
  const a = await createClient(owner, "Client A");
  const a2 = await createClient(owner, "Client A2");
  const b = await createClient(rival, "Client B");
  const client = owner.agencyPath + "/clients/" + a.id;
  const sibling = owner.agencyPath + "/clients/" + a2.id;
  const rivalClient = rival.agencyPath + "/clients/" + b.id;
  await request(rivalClient, 404, { cookie: owner.cookie });
  await request(owner.agencyPath + "/clients/" + b.id, 404, { cookie: owner.cookie, method: "PATCH", data: { name: "Denied" } });
  await request(client, 200, { cookie: owner.cookie, method: "PATCH", data: { name: "Client A edited", segment: "Synthetic" } });
  await request(owner.agencyPath + "/invites", 404, { cookie: owner.cookie, method: "POST", data: { email: "bad@example.test", role: "VIEWER", clientId: b.id } });
  await request(client, 403, { cookie: owner.cookie, method: "PATCH", headers: { "Sec-Fetch-Site": "same-site" }, data: { name: "Denied" } });
  const fixture = { name: "Synthetic Lead", company: "Synthetic Company", role: "Diretor", message: "Temos orçamento e urgência." };
  const { id } = await (await request(client + "/opportunities", 201, { cookie: owner.cookie, method: "POST", data: fixture })).json();
  const opportunity = "/opportunities/" + id;
  await request(sibling + opportunity, 404, { cookie: owner.cookie, method: "PATCH", data: { stage: "WON", outcome: "Denied" } });
  await request(rivalClient + opportunity, 404, { cookie: rival.cookie, method: "PATCH", data: { stage: "WON", outcome: "Denied" } });
  const overview = await (await request(owner.agencyPath, 200, { cookie: owner.cookie })).json();
  assert.equal(overview.clients.find((entry: { id: string }) => entry.id === a.id).opportunities, 1);
  assert.ok(!overview.clients.some((entry: { id: string }) => entry.id === b.id));
  console.log("PASS agency registration, password storage, client editing, CSRF and cross-agency isolation");

  const editorInvite = await invite(owner, "editor@example.test", "EDITOR", a.id);
  const viewerInvite = await invite(owner, "viewer@example.test", "VIEWER", a.id);
  const expiredInvite = await invite(owner, "expired@example.test", "VIEWER", a.id);
  assert.ok((await db.execute({ sql: "SELECT token_hash FROM portal_invites WHERE token_hash = ?", args: [hash(editorInvite.token)] })).rows.length === 1);
  await db.execute({ sql: "UPDATE portal_invites SET expires_at = 0 WHERE token_hash = ?", args: [hash(expiredInvite.token)] });
  await request("/auth/accept", 400, { method: "POST", data: { token: expiredInvite.token, name: "Expired", password } });
  await request("/auth/accept", 401, { cookie: rival.cookie, method: "POST", data: { token: editorInvite.token } });
  const editor = readCookie(await accept(editorInvite.token));
  const viewer = readCookie(await accept(viewerInvite.token));
  await request(client, 403, { cookie: viewer });
  await verify(editor, "editor@example.test");
  await verify(viewer, "viewer@example.test");
  await request("/auth/accept", 400, { method: "POST", data: { token: editorInvite.token, name: "Replay", password } });
  const adminInvite = await invite(owner, "owner-b@example.test", "ADMIN");
  await request("/auth/accept", 401, { method: "POST", data: { token: adminInvite.token, name: "Existing", password } });
  await accept(adminInvite.token, rival.cookie);
  await request(owner.agencyPath, 200, { cookie: rival.cookie });
  await request(owner.agencyPath + "/invites", 403, { cookie: rival.cookie, method: "POST", data: { email: "another@example.test", role: "ADMIN" } });
  const access = await (await request("/workspaces", 200, { cookie: editor })).json();
  assert.equal(access.agencies.length, 0);
  assert.equal(access.clients.length, 1);
  assert.equal(access.clients[0].id, a.id);
  await request(owner.agencyPath, 404, { cookie: editor });
  await request(sibling, 404, { cookie: editor });
  await request(rivalClient, 404, { cookie: editor });
  await request(client, 404, { cookie: editor, method: "PATCH", data: { name: "Denied" } });
  await request(client + "/opportunities", 403, { cookie: editor, method: "POST", data: fixture });
  await request(client + opportunity, 403, { cookie: viewer, method: "PATCH", data: { stage: "WON", outcome: "Denied" } });
  await request(client + opportunity, 200, { cookie: editor, method: "PATCH", data: { stage: "WON", outcome: "Contrato fictício assinado" } });
  const detail = await (await request(client, 200, { cookie: viewer })).json();
  assert.equal(detail.opportunities[0].stage, "WON");
  assert.equal(detail.opportunities[0].outcome, "Contrato fictício assinado");
  assert.ok(detail.opportunities[0].analysis.qualification.score > 0);
  console.log("PASS simulated email verification, expiry, replay, invites, client roles and outcome");

  const governance = owner.agencyPath + "/access";
  const view = (cookie = owner.cookie) => request(governance, 200, { cookie }).then((res) => res.json());
  await request(governance, 404, { cookie: editor });
  const portal = await view();
  assert.ok(portal.invites.some((entry: { status: string }) => entry.status === "EXPIRED"));
  assert.ok(!JSON.stringify(portal).includes(expiredInvite.token));
  const editMember = (id: string, expected: number, data: unknown, cookie = owner.cookie) =>
    request(governance + "/members/" + id, expected, { cookie, method: "POST", data });
  const editorId = (await (await request("/auth/me", 200, { cookie: editor })).json()).id;
  await editMember(owner.accountId, 409, { operation: "remove" });
  await editMember(owner.accountId, 409, { operation: "role", role: "ADMIN" });
  await editMember(rival.accountId, 403, { operation: "role", role: "OWNER" }, rival.cookie);
  await editMember(owner.accountId, 403, { operation: "sessions" }, rival.cookie);
  await editMember(editorId, 400, { operation: "role", role: "OWNER", clientId: a.id });
  await editMember(editorId, 404, { operation: "sessions", clientId: b.id });
  await editMember(editorId, 204, { operation: "role", role: "VIEWER", clientId: a.id }, rival.cookie);
  await request(client, 404, { cookie: editor });
  const signedIn = readCookie(await request("/auth/login", 204, { method: "POST", data: { email: "editor@example.test", password } }));
  await request(client + opportunity, 403, { cookie: signedIn, method: "PATCH", data: { stage: "WON", outcome: "Denied" } });
  const lingering = await invite(owner, "editor@example.test", "EDITOR", a.id);
  await editMember(editorId, 204, { operation: "remove", clientId: a.id });
  await request("/auth/accept", 400, { cookie: signedIn, method: "POST", data: { token: lingering.token } });
  await request(client, 404, { cookie: signedIn });

  const revoked = await invite(owner, "revoked@example.test", "ADMIN");
  const pending = (await view()).invites.find((entry: { email: string }) => entry.email === "revoked@example.test");
  assert.ok(pending && pending.id !== revoked.token && pending.id !== hash(revoked.token));
  const revoke = governance + "/invites/" + pending.id + "/revoke";
  await request(revoke, 403, { cookie: rival.cookie, method: "POST", data: {} });
  await request(revoke, 204, { cookie: owner.cookie, method: "POST", data: {} });
  await request("/auth/accept", 400, { method: "POST", data: { token: revoked.token, name: "Rejected", password } });

  await editMember(rival.accountId, 204, { operation: "sessions" });
  await request(owner.agencyPath, 404, { cookie: rival.cookie });
  await request(rival.agencyPath, 200, { cookie: rival.cookie });
  await request(owner.agencyPath + "/clients", 404, { cookie: rival.cookie, method: "POST", data: { name: "Denied" } });
  const rivalAgain = readCookie(await request("/auth/login", 204, { method: "POST", data: { email: "owner-b@example.test", password } }));
  await request(owner.agencyPath, 200, { cookie: rivalAgain });
  await editMember(rival.accountId, 204, { operation: "remove" });
  await request(governance, 404, { cookie: rivalAgain });
  const eventData = (await view()).events;
  const eventTypes = new Set(eventData.map((entry: { event: string }) => entry.event));
  for (const type of ["session.login", "account.email_verified", "permission.changed", "member.removed", "sessions.revoked",
    "invite.issued", "invite.accepted", "invite.revoked", "opportunity.stage_changed", "client.settings_updated"]) assert.ok(eventTypes.has(type), type);
  assert.ok(!JSON.stringify(eventData).includes(revoked.token) && !JSON.stringify(eventData).includes("Contrato fictício"));
  const foreignAudit = await (await request(rival.agencyPath + "/access", 200, { cookie: rivalAgain })).json();
  assert.ok(!foreignAudit.events.some((entry: { event: string }) => entry.event === "opportunity.stage_changed"));
  console.log("PASS governance privileges, last owner, scoped revocation, audit isolation and minimization");

  const login = async (value: string, expected: number) => request("/auth/login", expected, { method: "POST", data: { email: "owner-a@example.test", password: value } });
  const secondSession = readCookie(await login(password, 204));
  await request("/auth/logout", 204, { cookie: secondSession, method: "POST", data: {} });
  await request("/workspaces", 401, { cookie: secondSession });
  const expiredSession = readCookie(await login(password, 204));
  await db.execute({ sql: "UPDATE portal_sessions SET expires_at = 0 WHERE token_hash = ?", args: [hash(expiredSession.split("=")[1])] });
  await request("/workspaces", 401, { cookie: expiredSession });
  const recover = () => request("/auth/recovery", 200, { method: "POST", data: { email: "owner-a@example.test", recoveryCode: owner.recoveryCode } });
  const oldToken = (await (await recover()).json()).resetToken;
  await db.execute({ sql: "UPDATE portal_resets SET expires_at = 0 WHERE token_hash = ?", args: [hash(oldToken)] });
  await request("/auth/reset", 400, { method: "POST", data: { token: oldToken, password: changed } });
  const superseded = (await (await recover()).json()).resetToken;
  const beforeMail = mailbox.length;
  const unknown = await request("/auth/recovery/email", 202, { method: "POST", data: { email: "missing@example.test" } });
  assert.equal(mailbox.length, beforeMail);
  const known = await request("/auth/recovery/email", 202, { method: "POST", data: { email: "owner-a@example.test" } });
  assert.deepEqual(await known.json(), await unknown.json());
  for (let i = 0; i < 25 && mailbox.length === beforeMail; i++) await delay(10);
  const recoveryMail = mailbox.at(-1);
  assert.ok(recoveryMail && recoveryMail.kind === "reset" && recoveryMail.to === "owner-a@example.test");
  await request("/auth/reset", 400, { method: "POST", data: { token: superseded, password: changed } });
  const resetToken = recoveryMail.token;
  const rotation = await (await request("/auth/reset", 200, { method: "POST", data: { token: resetToken, password: changed } })).json();
  assert.ok(rotation.recoveryCode !== owner.recoveryCode);
  await request("/auth/reset", 400, { method: "POST", data: { token: resetToken, password: changed } });
  await request("/auth/recovery", 400, { method: "POST", data: { email: "owner-a@example.test", recoveryCode: owner.recoveryCode } });
  await request("/workspaces", 401, { cookie: owner.cookie });
  await login(password, 401);
  const active = readCookie(await login(changed, 204));
  await request(client, 200, { cookie: active });
  const codeReset = await (await request("/auth/recovery", 200, {
    method: "POST", data: { email: "owner-a@example.test", recoveryCode: rotation.recoveryCode },
  })).json();
  await request("/auth/reset", 200, { method: "POST", data: { token: codeReset.resetToken, password: changed } });
  await request("/workspaces", 401, { cookie: active });
  const afterCode = readCookie(await login(changed, 204));
  const auditAfterReset = (await view(afterCode)).events;
  assert.ok(auditAfterReset.some((entry: { event: string }) => entry.event === "session.logout"));
  assert.ok(auditAfterReset.some((entry: { event: string }) => entry.event === "account.password_changed"));
  for (let i = 0; i < 10; i++) await request("/auth/login", 401, { method: "POST", data: { email: "missing@example.test", password } });
  const throttled = await request("/auth/login", 429, { method: "POST", data: { email: "missing@example.test", password } });
  assert.ok(Number(throttled.headers.get("retry-after")) > 0);
  const demo = await request("/api/v1/intelligence/demo", 200, { raw: true });
  const demoCookie = (demo.headers.get("set-cookie") ?? "").split(";")[0];
  await request("/workspaces", 401, { cookie: demoCookie });
  const demoLead = { ...fixture, email: "lead@example.test" };
  for (let i = 0; i < 24; i++) {
    await request("/api/v1/intelligence/demo/leads", 201, { raw: true, cookie: demoCookie, method: "POST", data: demoLead });
  }
  await request("/api/v1/intelligence/demo/leads", 409, { raw: true, cookie: demoCookie, method: "POST", data: demoLead });
  console.log("PASS logout, session/token expiration, recovery rotation, throttling and demo limits");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
