import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Independent of the .env file and of any server already running.
process.env.NODE_ENV = "production";
process.env.TURSO_DATABASE_URL = "file::memory:";
process.env.TURSO_AUTH_TOKEN = "";
process.env.GEMINI_API_KEY = "synthetic-test-key";
process.env.GEMINI_MODEL = "gemini-test";

const originalFetch = globalThis.fetch;
const injectedMarker = "<script>SPRINT01</script>";
let providerMode: "ok" | "unavailable" | "invalid" = "ok";

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const { hostname } = new URL(request.url);
  if (hostname === "127.0.0.1") return originalFetch(request);
  assert.equal(hostname, "generativelanguage.googleapis.com");
  if (providerMode === "unavailable") {
    return Response.json({ error: { code: 503, status: "UNAVAILABLE", message: "Simulated outage" } }, { status: 503 });
  }
  const result = {
    score: providerMode === "ok" ? 87 : 101,
    fit_level: "HIGH",
    summary: injectedMarker,
    reasoning: "Simulated Gemini result",
    budget_detected: "UNKNOWN",
    urgency_detected: "HIGH",
    recommended_next_step: "Synthetic test only",
  };
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(result) }] } }],
  });
};

async function run() {
  const { createApp } = await import("./src/app.js");
  const { db } = await import("./src/config/database.js");
  await db.executeMultiple(readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8"));
  const demo = randomUUID();
  const second = randomUUID();
  const suspended = randomUUID();
  for (const [id, apiKey, status] of [
    ["tenant_demo_01", demo, "ACTIVE"], ["private-tenant", second, "ACTIVE"], ["suspended", suspended, "SUSPENDED"],
  ]) {
    await db.execute({
      sql: "INSERT INTO tenants (id, name, slug, api_key, status) VALUES (?, ?, ?, ?, ?)",
      args: [id, id, id, apiKey, status],
    });
  }

  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const analytics = "/api/v1/analytics/summary";
  const ingestPath = "/api/v1/webhooks/ingest";
  const auth = (key: string) => ({ "X-API-Key": key });

  async function request(path: string, expected: number, options?: RequestInit) {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, expected, path);
    return response;
  }

  function ingest(body: string, expected: number, key = demo, contentType = "application/json") {
    return request(ingestPath, expected, {
      method: "POST", headers: { ...auth(key), "Content-Type": contentType }, body,
    });
  }

  async function waitForLead(leadPath: string, key: string) {
    for (let i = 0; i < 60; i++) {
      const { data } = await (await request(leadPath, 200, { headers: auth(key) })).json();
      if (data.lead.status !== "NEW" && data.lead.status !== "PROCESSING") return data;
      await delay(50);
    }
    assert.fail("Lead processing did not finish");
  }

  try {
    await request("/", 200);
    for (const path of ["/api/v1/brand", "/assets/logo.svg", "/assets/logo.png", "/favicon.ico"]) {
      await request(path, 200);
    }
    const health = await (await request("/health", 200)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.database, "UP");
    console.log("OK landing, branding assets and healthy database");

    await request(analytics, 401);
    await request(analytics, 401, { headers: auth("invalid") });
    await request(analytics, 403, { headers: auth(suspended) });
    await request(analytics, 200, { headers: { Authorization: "Bearer " + second } });
    await request(ingestPath, 401, { method: "POST" });
    await ingest("{}", 400);
    await ingest('{"email":"invalid"}', 400);
    await ingest('{"name":"   "}', 400);
    await ingest('{"name":"QA","custom_fields":[]}', 400);
    const malformed = await (await ingest('{"name":', 400)).json();
    assert.equal(malformed.error.statusCode, 400);
    await ingest(JSON.stringify({ name: "QA", message: "x".repeat(2 * 1024 * 1024) }), 413);
    console.log("OK missing/wrong/suspended credentials, Bearer, invalid inputs, malformed JSON and request limit");

    const payload = JSON.stringify({
      name: injectedMarker, email: "lead@example.test", custom_fields: { nested: [1, { valid: true }] },
    });
    const { data: created } = await (await ingest(payload, 201)).json();
    const leadPath = "/api/v1/webhooks/leads/" + created.lead_id;
    await request(leadPath, 401);
    await request(leadPath + "/export", 401);
    await request(leadPath, 404, { headers: auth(second) });
    await request(leadPath + "/export", 404, { headers: auth(second) });
    const data = await waitForLead(leadPath, demo);
    assert.equal(data.lead.status, "QUALIFIED");
    assert.equal(data.qualification.model_used, "gemini-test");
    assert.equal(data.qualification.score, 87);
    const report = await request(leadPath + "/export", 200, { headers: auth(demo) });
    assert.match(report.headers.get("content-type") ?? "", /text\/html/);
    const html = await report.text();
    assert.ok(!html.includes(injectedMarker));
    assert.match(html, /&lt;script&gt;SPRINT01&lt;\/script&gt;/);
    const json = await (await request(leadPath + "/export?format=json", 200, { headers: auth(demo) })).json();
    assert.equal(json.qualification.summary, injectedMarker);
    const { data: summary } = await (await request(analytics, 200, { headers: auth(demo) })).json();
    assert.equal(summary.metrics.total_leads, 1);
    assert.deepEqual(summary.recent_leads, []);
    const { data: privateLead } = await (await ingest(payload, 201, second)).json();
    await waitForLead("/api/v1/webhooks/leads/" + privateLead.lead_id, second);
    const { data: privateSummary } = await (await request(analytics, 200, { headers: auth(second) })).json();
    assert.equal(privateSummary.recent_leads.length, 1);
    console.log("OK ingest, query, tenant isolation, HTML escaping, JSON and analytics (Gemini simulated)");

    for (const mode of ["unavailable", "invalid"] as const) {
      providerMode = mode;
      const { data: failed } = await (await ingest(payload, 201)).json();
      const result = await waitForLead("/api/v1/webhooks/leads/" + failed.lead_id, demo);
      assert.equal(result.lead.status, "ERROR");
      assert.equal(result.qualification, null);
    }
    console.log("OK simulated Gemini outage and invalid score");

    db.close();
    const failedHealth = await (await request("/health", 503)).json();
    assert.equal(failedHealth.database, "DOWN");
    await request(analytics, 500, { headers: auth(demo) });
    console.log("OK simulated database outage: health 503, protected request 500");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "Test failed");
  process.exitCode = 1;
});
