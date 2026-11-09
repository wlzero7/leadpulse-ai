import { db } from "../config/database.js";
import type { Lead } from "../types/index.js";

export interface CreateLeadDTO {
  id: string;
  tenant_id: string;
  external_id?: string | null;
  source: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  message?: string | null;
  raw_payload: string;
  status: Lead["status"];
  score?: number | null;
}

export class LeadRepository {
  /**
   * Insere um novo registro de Lead com isolamento estrito de Tenant
   */
  async create(data: CreateLeadDTO): Promise<Lead> {
    await db.execute({
      sql: `
        INSERT INTO leads (
          id, tenant_id, external_id, source, name, email, phone,
          company, role, message, raw_payload, status, score
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        data.id,
        data.tenant_id,
        data.external_id ?? null,
        data.source,
        data.name ?? null,
        data.email ?? null,
        data.phone ?? null,
        data.company ?? null,
        data.role ?? null,
        data.message ?? null,
        data.raw_payload,
        data.status,
        data.score ?? null,
      ],
    });

    const lead = await this.findById(data.id, data.tenant_id);
    if (!lead) {
      throw new Error("Falha ao recuperar o lead recém-criado.");
    }
    return lead;
  }

  /**
   * Busca um lead garantindo o isolamento multi-tenant
   */
  async findById(id: string, tenantId: string): Promise<Lead | null> {
    const result = await db.execute({
      sql: `
        SELECT id, tenant_id, external_id, source, name, email, phone,
               company, role, message, raw_payload, status, score, created_at, updated_at
        FROM leads
        WHERE id = ? AND tenant_id = ?
        LIMIT 1
      `,
      args: [id, tenantId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      external_id: row.external_id ? String(row.external_id) : null,
      source: String(row.source),
      name: row.name ? String(row.name) : null,
      email: row.email ? String(row.email) : null,
      phone: row.phone ? String(row.phone) : null,
      company: row.company ? String(row.company) : null,
      role: row.role ? String(row.role) : null,
      message: row.message ? String(row.message) : null,
      raw_payload: String(row.raw_payload),
      status: String(row.status) as Lead["status"],
      score: row.score !== null ? Number(row.score) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  /**
   * Atualiza o status e a pontuação do lead após processamento por IA
   */
  async updateStatusAndScore(
    id: string,
    tenantId: string,
    status: Lead["status"],
    score?: number | null
  ): Promise<void> {
    await db.execute({
      sql: `
        UPDATE leads
        SET status = ?, score = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
      `,
      args: [status, score ?? null, id, tenantId],
    });
  }
}

export const leadRepository = new LeadRepository();
