import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const api = "/api/v1/intelligence/demo";
const folder = await mkdtemp(join(tmpdir(), "leadpulse-intelligence-"));
const file = join(folder, "demo.db");
const fixture = {
  name: "Pessoa Demonstração",
  company: "Empresa fictícia",
  role: "Diretor",
  email: "contato@example.test",
  message: "Precisamos de orçamento urgente para energia solar.",
};

async function withServer(run: (request: (path: string, status: number, options?: RequestInit) => Promise<Response>) => Promise<void>) {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const server = spawn(process.execPath, ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
      TURSO_DATABASE_URL: pathToFileURL(file).href,
      TURSO_AUTH_TOKEN: "",
      GEMINI_API_KEY: "mock_or_env",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stopped = once(server, "close");
  let started = false;
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("Plataforma Comercial Ativa")) started = true;
  });
  try {
    for (let attempt = 0; !started && attempt < 60; attempt++) {
      assert.equal(server.exitCode, null, "Server exited during startup");
      await delay(100);
    }
    assert.ok(started, "Server did not start");
    await run(async (path, status, options) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, status, path);
      return response;
    });
  } finally {
    server.kill();
    await stopped;
  }
}

function mutation(method: string, payload: unknown, cookie?: string): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(payload),
  };
}

function session(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /Path=\/api\/v1\/intelligence\/demo/i);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return cookie.split(";")[0];
}

let cookie = "";
let leadId = "";
try {
  await withServer(async (request) => {
    await request("/health", 200);
    await request("/", 200);
    const portal = await request("/intelligence/", 200);
    assert.match(await portal.text(), /LeadPulse Intelligence/);
    await request("/intelligence/app.js", 200);
    await request("/intelligence/style.css", 200);
    const first = await request(api, 200);
    cookie = session(first);
    assert.deepEqual(await first.json(), { mode: "heuristic-demo", leads: [] });
    await request(api + "/leads", 403, mutation("POST", fixture));
    await request(api + "/leads", 400, mutation("POST", { ...fixture, email: "contact@real.com" }, cookie));
    await request(api + "/leads", 400, mutation("POST", { ...fixture, message: " " }, cookie));
    await request(api, 403, { headers: { "Sec-Fetch-Site": "cross-site", Cookie: cookie } });

    const lead = await (await request(api + "/leads", 201, mutation("POST", fixture, cookie))).json();
    leadId = lead.id;
    assert.equal(lead.stage, "NEW");
    assert.equal(lead.analysis.qualification.score, 98);
    assert.equal(lead.analysis.evidence.length, 3);
    assert.ok(lead.analysis.qualification.recommended_next_step);
    const path = api + "/leads/" + leadId + "/stage";
    await request(path, 400, mutation("PATCH", { stage: "QUALIFIED" }, cookie));
    const second = await request(api, 200);
    const otherCookie = session(second);
    assert.notEqual(otherCookie, cookie);
    assert.deepEqual((await second.json()).leads, []);
    await request(path, 404, mutation("PATCH", { stage: "WON" }, otherCookie));

    const moved = await (await request(path, 200, mutation("PATCH", { stage: "PROPOSAL" }, cookie))).json();
    assert.equal(moved.stage, "PROPOSAL");
    const persisted = await (await request(api, 200, { headers: { Cookie: cookie } })).json();
    assert.equal(persisted.leads[0].stage, "PROPOSAL");
    assert.deepEqual(persisted.leads[0].analysis, lead.analysis);
    console.log("PASS static portal, validation, qualification, cross-session isolation and pipeline move");
  });
  await withServer(async (request) => {
    const workspace = await (await request(api, 200, { headers: { Cookie: cookie } })).json();
    assert.equal(workspace.leads.length, 1);
    assert.equal(workspace.leads[0].id, leadId);
    assert.equal(workspace.leads[0].stage, "PROPOSAL");
    assert.equal(workspace.leads[0].analysis.qualification.score, 98);
    console.log("PASS lead, analysis and pipeline stage persist across server restart");
  });
} finally {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) await rm(file + suffix, { force: true });
  await rmdir(folder);
}
