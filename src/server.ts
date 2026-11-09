import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { db, testDbConnection } from "./config/database.js";

/**
 * Garante que o schema e o tenant demo estejam prontos antes de subir o servidor (Zero-Touch)
 */
async function ensureDatabaseReady(): Promise<void> {
  await testDbConnection();

  const tableCheck = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tenants', 'leads', 'qualifications')"
  );
  if (tableCheck.rows.length !== 3) {
    const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
    await db.executeMultiple(fs.readFileSync(schemaPath, "utf-8"));
    console.log("[Database] Schema SQL aplicado com sucesso.");
  }

  await db.execute({ sql: `
    INSERT INTO tenants (id, name, slug, api_key, plan, status, settings)
    SELECT 'tenant_demo_01', 'LeadPulse Demo Account', 'leadpulse-demo', ?, 'STARTER', 'ACTIVE', '{}'
    WHERE NOT EXISTS (SELECT 1 FROM tenants)
    ON CONFLICT DO NOTHING
  `, args: ["lp_live_sample_key_1234567890abcdef"] });
}

async function bootstrap() {
  try {
    // 1. Garante que o banco e tabelas estejam prontos
    await ensureDatabaseReady();

    // 2. Inicializa o aplicativo Express
    const app = createApp();

    // 3. Inicia o servidor HTTP
    const server = app.listen(env.PORT, "0.0.0.0", () => {
      console.log("==================================================================");
      console.log(`🚀 [LeadPulse AI] Plataforma Comercial Ativa na porta ${env.PORT}`);
      console.log(`🌐 Ambiente: ${env.NODE_ENV}`);
      console.log(`🩺 Healthcheck:     http://localhost:${env.PORT}/health`);
      console.log(`🎨 Brand Assets:   http://localhost:${env.PORT}/api/v1/brand`);
      console.log(`🖼️ Logo Oficial:   http://localhost:${env.PORT}/assets/logo.svg`);
      console.log(`⚡ Ingest Webhook: http://localhost:${env.PORT}/api/v1/webhooks/ingest`);
      console.log("==================================================================");
    });

    // 4. Encerramento gracioso (Graceful Shutdown)
    const gracefulShutdown = (signal: string) => {
      console.log(`\n🛑 Sinal ${signal} recebido. Encerrando servidor graciosamente...`);
      server.close(() => {
        console.log("🔒 Conexões HTTP encerradas com segurança.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch {
    console.error("[Startup] Falha ao inicializar a aplicação ou o banco de dados.");
    process.exit(1);
  }
}

bootstrap();
