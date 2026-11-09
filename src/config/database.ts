import { createClient, type Client } from "@libsql/client";
import { env } from "./env.js";

/**
 * Cliente central do banco de dados Turso (LibSQL).
 * Suporta tanto a conexão remota na nuvem (libsql://...) quanto SQLite local (file:local.db)
 * para desenvolvimento ágil e custo zero na fase de validação.
 */
export const db: Client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

/**
 * Utilitário de checagem de saúde e conectividade do banco de dados.
 */
export async function testDbConnection(): Promise<void> {
  await db.execute("SELECT 1 AS alive");
  console.log("[Database] Conexão estabelecida com sucesso.");
}
