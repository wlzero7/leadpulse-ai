import assert from "node:assert/strict";
import { createResendMailer } from "./src/services/resend-mailer.js";
import type { PortalMail } from "./src/services/portal-mail.js";

const fixture = { NODE_ENV: "production", RESEND_API_KEY: "fake-fixture-key", MAIL_FROM: "notifications@example.test", PUBLIC_APP_URL: "https://portal.example.test" };
assert.equal(createResendMailer({ NODE_ENV: "production" }), undefined);
for (const config of [
  { ...fixture, RESEND_API_KEY: undefined }, { ...fixture, MAIL_FROM: "invalid" },
  { ...fixture, PUBLIC_APP_URL: "https://user:pass@portal.example.test" },
  { ...fixture, PUBLIC_APP_URL: "http://portal.example.test" },
  { ...fixture, PUBLIC_APP_URL: "https://portal.example.test/?redirect=another" },
]) {
  assert.throws(() => createResendMailer(config), /^Error: Configuração de e-mail incompleta ou inválida\.$/);
}

let current: PortalMail;
const token = "a".repeat(64);
const keys = new Set<string>();
const transport: typeof fetch = async (url, init) => {
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init?.method, "POST");
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal);
  const headers = new Headers(init?.headers);
  assert.ok(headers.get("authorization") === "Bearer " + fixture.RESEND_API_KEY);
  const key = headers.get("idempotency-key") ?? "";
  assert.ok(key.startsWith("leadpulse-" + current.kind + "-") && !key.includes(token));
  keys.add(key);
  const payload = JSON.parse(String(init?.body));
  const link = fixture.PUBLIC_APP_URL + "/intelligence/portal/#" + current.kind + "=" + token;
  assert.equal(payload.from, "LeadPulse AI <" + fixture.MAIL_FROM + ">");
  assert.deepEqual(payload.to, [current.to]);
  assert.ok(payload.html.includes('href="' + link + '"') && payload.text.includes(link));
  assert.ok(payload.html.includes("LeadPulse AI") && payload.html.includes("#2563EB"));
  assert.ok(!/<script|<img|<link/i.test(payload.html));
  return Response.json({ id: "mock-delivery-id" });
};
const mailer = createResendMailer(fixture, transport);
assert.ok(mailer);
for (const kind of ["verify", "reset", "invite"] as const) {
  current = { kind, token, to: "recipient@example.test", expiresAt: Date.now() + 60000 };
  await mailer.send(current);
  await mailer.send(current);
}
assert.equal(keys.size, 3);

for (const failing of [
  async () => new Response("Provider echoed " + token, { status: 429 }),
  async () => { throw new Error("Provider echoed " + fixture.RESEND_API_KEY); },
  async () => Response.json({ unexpected: true }),
]) {
  const unavailable = createResendMailer(fixture, failing);
  assert.ok(unavailable);
  await assert.rejects(unavailable.send(current!), /^Error: Falha na entrega de e-mail transacional\.$/);
}
console.log("PASS Resend HTTP adapter, templates, trusted URL, idempotency and sanitized failures");
