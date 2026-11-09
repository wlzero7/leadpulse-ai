import crypto from "node:crypto";
import { ApiError, GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";
import { env } from "../config/env.js";
import { qualificationRepository } from "../repositories/qualification.repository.js";
import { leadRepository } from "../repositories/lead.repository.js";
import type { Lead, Tenant, Qualification } from "../types/index.js";

const qualificationSchema = z.object({
  score: z.number().int().min(0).max(100),
  fit_level: z.enum(["HIGH", "MEDIUM", "LOW", "UNQUALIFIED"]),
  summary: z.string(),
  reasoning: z.string(),
  budget_detected: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  urgency_detected: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  recommended_next_step: z.string(),
});

export type AIQualificationOutput = z.infer<typeof qualificationSchema>;

export class AIService {
  private client: GoogleGenAI | null = null;
  private readonly modelName = env.GEMINI_MODEL;

  constructor() {
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY !== "mock_or_env") {
      this.client = new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY,
        httpOptions: { timeout: 22_000, retryOptions: { attempts: 1 } },
      });
    }
  }

  /**
   * Qualifica cognitivamente um lead usando a API do Google Gemini
   */
  async qualifyLead(tenant: Tenant, lead: Lead): Promise<Qualification> {
    console.log(`[AI] Iniciando qualificação do lead [${lead.id}].`);

    let qualificationData: AIQualificationOutput;
    let modelUsed = this.modelName;
    let rawApiResponse = "";

    try {
      if (this.client) {
        const result = await this.analyzeWithGemini(tenant, lead);
        qualificationData = result.data;
        rawApiResponse = result.rawResponse;
      } else {
        // Fallback cognitivo para testes locais, offline ou validações sem chave de API ativa
        console.warn("⚠️ [AI Service] GEMINI_API_KEY não configurada ou definida como mock. Executando qualificação heurística local.");
        qualificationData = evaluateHeuristically(lead).qualification;
        modelUsed = "leadpulse-heuristic-v1";
        rawApiResponse = JSON.stringify({
          source: "local-heuristic-engine",
          evaluated_at: new Date().toISOString(),
          output: qualificationData,
        });
      }

      // 1. Grava o resultado na tabela de qualificações
      const qualificationId = `qual_${crypto.randomUUID()}`;
      const savedQualification = await qualificationRepository.create({
        id: qualificationId,
        tenant_id: tenant.id,
        lead_id: lead.id,
        score: qualificationData.score,
        fit_level: qualificationData.fit_level,
        summary: qualificationData.summary,
        reasoning: qualificationData.reasoning,
        budget_detected: qualificationData.budget_detected,
        urgency_detected: qualificationData.urgency_detected,
        recommended_next_step: qualificationData.recommended_next_step,
        raw_ai_response: rawApiResponse,
        model_used: modelUsed,
      });

      // 2. Atualiza o status e score do lead na tabela 'leads'
      const finalStatus: Lead["status"] = qualificationData.score >= 50 ? "QUALIFIED" : "DISQUALIFIED";
      await leadRepository.updateStatusAndScore(lead.id, tenant.id, finalStatus, qualificationData.score);

      console.log(`✨ [AI Service] Lead [${lead.id}] qualificado com sucesso! Score: ${qualificationData.score}/100 | Fit: ${qualificationData.fit_level} | Status: ${finalStatus}`);

      return savedQualification;
    } catch (error) {
      const cause = error instanceof ApiError ? `Gemini HTTP ${error.status}` : "falha interna ou de comunicação";
      console.error(`[AI] Falha na qualificação do lead [${lead.id}] (${cause}).`);
      await leadRepository.updateStatusAndScore(lead.id, tenant.id, "ERROR", null);
      throw error;
    }
  }

  /**
   * Chamada oficial estruturada ao modelo Google Gemini 3.1 Flash-Lite
   */
  private async analyzeWithGemini(
    tenant: Tenant,
    lead: Lead
  ): Promise<{ data: AIQualificationOutput; rawResponse: string }> {
    const prompt = `
Você é o Especialista Chefe em Inteligência Comercial e Qualificação B2B do LeadPulse AI.
Sua missão é analisar meticulosamente os dados brutos recebidos deste lead comercial, identificar sinais de compra, orçamento, urgência, autoridade do contato e adequação para o cliente.

=== CONTEXTO DO CLIENTE (TENANT) ===
Tenant ID: ${tenant.id}
Nome da Conta: ${tenant.name}
Configurações / Regras do Tenant: ${tenant.settings}

=== DADOS RECEBIDOS DO LEAD ===
Lead ID: ${lead.id}
Origem / Canal: ${lead.source}
Nome: ${lead.name ?? "Não informado"}
E-mail: ${lead.email ?? "Não informado"}
Telefone: ${lead.phone ?? "Não informado"}
Empresa: ${lead.company ?? "Não informada"}
Cargo / Função: ${lead.role ?? "Não informado"}
Mensagem: ${lead.message ?? "Não informada"}
Payload Bruto Integral:
${lead.raw_payload}

=== CRITÉRIOS DE AVALIAÇÃO ===
1. SCORE (0 a 100):
   - 80 a 100: Lead Quente (fit perfeito, tomador de decisão, urgência imediata e orçamento).
   - 60 a 79: Lead Morno (bom potencial, interesse claro, pode precisar de validação de budget).
   - 40 a 59: Lead Frio (perfil duvidoso, pouca urgência ou empresa muito pequena).
   - 0 a 39: Desqualificado (spam, estudantes, concorrentes, dados inconsistentes).
2. FIT_LEVEL: HIGH | MEDIUM | LOW | UNQUALIFIED
3. SUMMARY: Resumo executivo em português com 2 a 3 frases sintetizando quem é o lead e o que ele busca.
4. REASONING: Explicação detalhada dos fatores que justificam o score atribuído.
5. BUDGET_DETECTED: HIGH | MEDIUM | LOW | UNKNOWN
6. URGENCY_DETECTED: HIGH | MEDIUM | LOW | UNKNOWN
7. RECOMMENDED_NEXT_STEP: Ação tática específica recomendada para a equipe de vendas.
`;

    const response = await this.client!.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: {
              type: Type.INTEGER,
              description: "Pontuação de propensão de compra de 0 a 100",
            },
            fit_level: {
              type: Type.STRING,
              enum: ["HIGH", "MEDIUM", "LOW", "UNQUALIFIED"],
              description: "Nível de adequação do lead com o perfil de cliente ideal",
            },
            summary: {
              type: Type.STRING,
              description: "Resumo executivo do lead",
            },
            reasoning: {
              type: Type.STRING,
              description: "Justificativa da pontuação e fit atribuídos",
            },
            budget_detected: {
              type: Type.STRING,
              enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"],
              description: "Nível de orçamento estimado",
            },
            urgency_detected: {
              type: Type.STRING,
              enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"],
              description: "Nível de urgência para compra/implementação",
            },
            recommended_next_step: {
              type: Type.STRING,
              description: "Próxima ação recomendada para a equipe comercial",
            },
          },
          required: [
            "score",
            "fit_level",
            "summary",
            "reasoning",
            "budget_detected",
            "urgency_detected",
            "recommended_next_step",
          ],
        },
      },
    });

    const responseText = response.text || "{}";
    const parsedData = qualificationSchema.parse(JSON.parse(responseText));

    return {
      data: parsedData,
      rawResponse: responseText,
    };
  }
}

export function evaluateHeuristically(lead: Pick<Lead, "name" | "company" | "role" | "email" | "message" | "raw_payload">) {
  let score = 50;
  const evidence: { label: string; impact: number }[] = [];
  let urgency: AIQualificationOutput["urgency_detected"] = "MEDIUM";
  let budget: AIQualificationOutput["budget_detected"] = "UNKNOWN";

  const payloadText = (lead.raw_payload + " " + (lead.message ?? "")).toLowerCase();
  const role = (lead.role ?? "").toLowerCase();

  // Sinais de Autoridade (Decisor)
  if (/diretor|vp|head|ceo|coo|cfo|fundador|owner|gerente/i.test(role)) {
    score += 20;
    evidence.push({ label: "Cargo com sinal de decisão", impact: 20 });
  }

  // Sinais de Urgência
  if (/urgente|imediato|r[aá]pido|este m[eê]s|o quanto antes/i.test(payloadText)) {
    score += 15;
    evidence.push({ label: "Menção a urgência", impact: 15 });
    urgency = "HIGH";
  }

  // Sinais de Volume / Orçamento
  if (/mil|or[çc]amento|budget|investimento|5000|10000|crm|equipe/i.test(payloadText)) {
    score += 15;
    evidence.push({ label: "Menção a orçamento ou volume", impact: 15 });
    budget = "HIGH";
  }

  // Penalizações por dados incompletos
  if (!lead.email || !lead.email.includes("@")) {
    score -= 30;
    evidence.push({ label: "E-mail ausente", impact: -30 });
  }
  if (!lead.company) {
    score -= 10;
    evidence.push({ label: "Empresa ausente", impact: -10 });
  }

  score = Math.max(5, Math.min(98, score));

  let fit: AIQualificationOutput["fit_level"] = "MEDIUM";
  if (score >= 80) fit = "HIGH";
  else if (score >= 50) fit = "MEDIUM";
  else if (score >= 30) fit = "LOW";
  else fit = "UNQUALIFIED";

  const qualification: AIQualificationOutput = {
    score,
    fit_level: fit,
    summary: `Lead B2B de ${lead.company || "Empresa sob consulta"}, representado por ${lead.name || "Contato Comercial"} (${lead.role || "Cargo não especificado"}).`,
    reasoning: `Análise baseada em autoridade (${lead.role || "Não declarada"}), menção a volume operacional e canais de contato fornecidos (${lead.email || "E-mail pendente"}).`,
    budget_detected: budget,
    urgency_detected: urgency,
    recommended_next_step:
      score >= 70
        ? "Priorizar contato telefônico e agendamento de call de demonstração nas próximas 2 horas."
        : "Encaminhar para cadência de nutrição e e-mail comercial com apresentação institucional.",
  };
  return { qualification, evidence };
}

export const aiService = new AIService();
