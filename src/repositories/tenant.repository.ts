import { db } from "../config/database.js";
import type { Tenant } from "../types/index.js";

export class TenantRepository {
  /**
   * Busca um tenant pela sua API Key (utilizado para autenticar requisições de ingestão)
   */
  async findByApiKey(apiKey: string): Promise<Tenant | null> {
    const result = await db.execute({
      sql: `
        SELECT id, name, slug, api_key, plan, status, settings, created_at, updated_at
        FROM tenants
        WHERE api_key = ?
        LIMIT 1
      `,
      args: [apiKey],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      api_key: String(row.api_key),
      plan: String(row.plan) as Tenant["plan"],
      status: String(row.status) as Tenant["status"],
      settings: String(row.settings ?? "{}"),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  /**
   * Busca um tenant pelo ID único
   */
  async findById(id: string): Promise<Tenant | null> {
    const result = await db.execute({
      sql: `
        SELECT id, name, slug, api_key, plan, status, settings, created_at, updated_at
        FROM tenants
        WHERE id = ?
        LIMIT 1
      `,
      args: [id],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      api_key: String(row.api_key),
      plan: String(row.plan) as Tenant["plan"],
      status: String(row.status) as Tenant["status"],
      settings: String(row.settings ?? "{}"),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
}

export const tenantRepository = new TenantRepository();
