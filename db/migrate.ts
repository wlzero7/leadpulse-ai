import fs from "node:fs";
import path from "node:path";
import { db } from "../src/config/database.js";

async function runMigration() {
  console.log("⚡ [LeadPulse AI] Iniciando migração do banco de dados Turso/LibSQL...");

  try {
    const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");

    // Executa todo o script DDL no Turso
    await db.executeMultiple(schemaSql);
    console.log("✅ Schema executado com sucesso.");

    // Verifica se já existe ao menos 1 tenant de demonstração/teste
    const existing = await db.execute({
      sql: "SELECT id FROM tenants LIMIT 1",
      args: [],
    });

    if (existing.rows.length === 0) {
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

      console.log("Tenant de demonstração criado.");
    } else {
      console.log(`ℹ️  Tenants existentes encontrados no banco (${existing.rows.length}).`);
    }

    console.log("🎉 Migração concluída com êxito!");
    process.exit(0);
  } catch {
    console.error("Falha crítica ao executar migração.");
    process.exit(1);
  }
}

runMigration();
