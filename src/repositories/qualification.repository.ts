import { db } from "../config/database.js";
import type { Qualification } from "../types/index.js";

export interface CreateQualificationDTO {
  id: string;
  tenant_id: string;
  lead_id: string;
  score: number;
  fit_level: Qualification["fit_level"];
  summary: string;
  reasoning: string;
  budget_detected?: string;
  urgency_detected?: string;
  recommended_next_step: string;
  raw_ai_response: string;
  model_used: string;
}

export class QualificationRepository {
  /**
   * Grava a análise cognitiva do lead produzida pelo Gemini
   */
  async create(data: CreateQualificationDTO): Promise<Qualification> {
    await db.execute({
      sql: `
        INSERT INTO qualifications (
          id, tenant_id, lead_id, score, fit_level, summary,
          reasoning, budget_detected, urgency_detected,
          recommended_next_step, raw_ai_response, model_used
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        data.id,
        data.tenant_id,
        data.lead_id,
        data.score,
        data.fit_level,
        data.summary,
        data.reasoning,
        data.budget_detected ?? "UNKNOWN",
        data.urgency_detected ?? "UNKNOWN",
        data.recommended_next_step,
        data.raw_ai_response,
        data.model_used,
      ],
    });

    const qualification = await this.findByLeadId(data.lead_id, data.tenant_id);
    if (!qualification) {
      throw new Error("Falha ao recuperar a qualificação recém-criada.");
    }
    return qualification;
  }

  /**
   * Busca a qualificação de um lead garantindo o tenant_id
   */
  async findByLeadId(leadId: string, tenantId: string): Promise<Qualification | null> {
    const result = await db.execute({
      sql: `
        SELECT id, tenant_id, lead_id, score, fit_level, summary, reasoning,
               budget_detected, urgency_detected, recommended_next_step,
               raw_ai_response, model_used, created_at
        FROM qualifications
        WHERE lead_id = ? AND tenant_id = ?
        LIMIT 1
      `,
      args: [leadId, tenantId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      lead_id: String(row.lead_id),
      score: Number(row.score),
      fit_level: String(row.fit_level) as Qualification["fit_level"],
      summary: String(row.summary),
      reasoning: String(row.reasoning),
      budget_detected: String(row.budget_detected),
      urgency_detected: String(row.urgency_detected),
      recommended_next_step: String(row.recommended_next_step),
      raw_ai_response: String(row.raw_ai_response),
      model_used: String(row.model_used),
      created_at: String(row.created_at),
    };
  }
}

export const qualificationRepository = new QualificationRepository();
