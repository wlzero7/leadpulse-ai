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

  try {
    const tableCheck = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'"
    );

    if (tableCheck.rows.length === 0) {
      console.log("⚡ [LeadPulse AI] Tabelas não encontradas. Executando migrações DDL automáticas...");
      const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
      const schemaSql = fs.readFileSync(schemaPath, "utf-8");
      await db.executeMultiple(schemaSql);
      console.log("✅ [LeadPulse AI] Schema SQL aplicado com sucesso.");
    }

    const tenantCheck = await db.execute("SELECT id FROM tenants LIMIT 1");
    if (tenantCheck.rows.length === 0) {
      const demoTenantId = "tenant_demo_01";
      const demoApiKey = "lp_live_sample_key_1234567890abcdef";

      await db.execute({
        sql: `
          INSERT INTO tenants (id, name, slug, api_key, plan, status, settings)
          VALUES (?, ?, ?, ?, 'STARTER', 'ACTIVE', '{}')
        `,
        args: [
          demoTenantId,
          "LeadPulse Demo Account",
          "leadpulse-demo",
          demoApiKey,
        ],
      });
      console.log(`🌱 [LeadPulse AI] Tenant de demonstração criado com chave de acesso: ${demoApiKey}`);
    }
  } catch (error) {
    console.error("⚠️ [LeadPulse AI] Aviso durante a inicialização automática do banco:", error);
  }
}

async function bootstrap() {
  try {
    // 1. Garante que o banco e tabelas estejam prontos
    await ensureDatabaseReady();

    // 2. Inicializa o aplicativo Express
    const app = createApp();

    // 3. Inicia o servidor HTTP
    const server = app.listen(env.PORT, () => {
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
  } catch (error) {
    console.error("💥 Falha fatal ao inicializar o servidor LeadPulse AI:", error);
    process.exit(1);
  }
}

bootstrap();
