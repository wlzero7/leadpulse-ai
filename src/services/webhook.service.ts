import crypto from "node:crypto";
import { leadRepository } from "../repositories/lead.repository.js";
import { qualificationRepository } from "../repositories/qualification.repository.js";
import { aiService } from "./ai.service.js";
import { NotFoundError } from "../utils/errors.js";
import type { Lead, Tenant, Qualification } from "../types/index.js";
import type { LeadIngestInput } from "../schemas/webhook.schema.js";

export class WebhookService {
  /**
   * Processa a ingestão do lead bruto e dispara a qualificação assíncrona por IA
   */
  async ingestLead(
    tenant: Tenant,
    payload: LeadIngestInput
  ): Promise<{
    lead: Lead;
    message: string;
  }> {
    const leadId = `lead_${crypto.randomUUID()}`;

    // Normalização dos dados de contato e empresa
    const normalizedName = payload.name?.trim() || null;
    const normalizedEmail = payload.email?.toLowerCase().trim() || null;
    const normalizedPhone = payload.phone?.trim() || null;
    const normalizedCompany = payload.company?.trim() || null;
    const normalizedRole = payload.role?.trim() || null;
    const normalizedMessage = payload.message?.trim() || null;
    const externalId = payload.external_id?.trim() || null;
    const source = payload.source?.toUpperCase().trim() || "WEBHOOK";

    // Preserva integralmente o payload original para análise profunda pela IA
    const rawPayloadJson = JSON.stringify(payload);

    // 1. Grava o lead no banco com status inicial 'NEW'
    const createdLead = await leadRepository.create({
      id: leadId,
      tenant_id: tenant.id,
      external_id: externalId,
      source,
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      company: normalizedCompany,
      role: normalizedRole,
      message: normalizedMessage,
      raw_payload: rawPayloadJson,
      status: "NEW",
      score: null,
    });

    console.log(`[Webhook] Lead [${createdLead.id}] gravado.`);

    // 2. DISPARO ASSÍNCRONO DA QUALIFICAÇÃO COGNITIVA POR IA (SPRINT 2)
    // O endpoint não trava a resposta para o remetente do webhook; a IA processa em segundo plano.
    setImmediate(async () => {
      try {
        await aiService.qualifyLead(tenant, createdLead);
      } catch {
        console.error(`[Webhook] Processamento em segundo plano falhou para o lead [${createdLead.id}].`);
      }
    });

    return {
      lead: createdLead,
      message: "Lead recebido com sucesso e enfileirado para qualificação por IA.",
    };
  }

  /**
   * Consulta os dados de um lead e sua respectiva qualificação gerada por IA
   */
  async getLeadDetails(
    tenant: Tenant,
    leadId: string
  ): Promise<{
    lead: Lead;
    qualification: Qualification | null;
  }> {
    const lead = await leadRepository.findById(leadId, tenant.id);
    if (!lead) {
      throw new NotFoundError(`Lead '${leadId}' não encontrado para este tenant.`);
    }

    const qualification = await qualificationRepository.findByLeadId(leadId, tenant.id);

    return {
      lead,
      qualification,
    };
  }
}

export const webhookService = new WebhookService();
