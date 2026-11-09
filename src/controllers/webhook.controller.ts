import type { Response, NextFunction } from "express";
import { webhookService } from "../services/webhook.service.js";
import { UnauthorizedError } from "../utils/errors.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
import type { AuthenticatedRequest } from "../types/index.js";

export class WebhookController {
  /**
   * Endpoint de Ingestão de Leads
   * POST /api/v1/webhooks/ingest
   */
  async ingest(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tenant = req.tenant;

      if (!tenant) {
        throw new UnauthorizedError("Tenant não identificado na requisição.");
      }

      const result = await webhookService.ingestLead(tenant, req.body);

      res.status(201).json({
        success: true,
        message: result.message,
        data: {
          lead_id: result.lead.id,
          tenant_id: result.lead.tenant_id,
          source: result.lead.source,
          status: result.lead.status,
          created_at: result.lead.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Consulta status e qualificação do lead
   * GET /api/v1/webhooks/leads/:id
   */
  async getLeadStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tenant = req.tenant;

      if (!tenant) {
        throw new UnauthorizedError("Tenant não identificado na requisição.");
      }

      const { id } = req.params;
      const result = await webhookService.getLeadDetails(tenant, id);

      res.status(200).json({
        success: true,
        data: {
          lead: {
            id: result.lead.id,
            name: result.lead.name,
            email: result.lead.email,
            company: result.lead.company,
            role: result.lead.role,
            status: result.lead.status,
            score: result.lead.score,
            created_at: result.lead.created_at,
          },
          qualification: result.qualification,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exporta a qualificação do lead em formato JSON ou Briefing HTML imprimível (PDF)
   * GET /api/v1/webhooks/leads/:id/export?format=json|html
   */
  async exportLead(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tenant = req.tenant;
      if (!tenant) {
        throw new UnauthorizedError("Tenant não identificado na requisição.");
      }

      const { id } = req.params;
      const format = String(req.query.format || "html").toLowerCase();
      const result = await webhookService.getLeadDetails(tenant, id);

      const qual = result.qualification;
      const lead = result.lead;

      if (format === "json") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="leadpulse-report-${id}.json"`
        );
        res.status(200).json({
          project: "LeadPulse AI",
          exported_at: new Date().toISOString(),
          tenant: { id: tenant.id, name: tenant.name },
          lead,
          qualification: qual,
        });
        return;
      }

      const isHot = qual && qual.score >= 80;
      const isMid = qual && qual.score >= 50 && qual.score < 80;
      const badgeClass = isHot ? "badge-hot" : isMid ? "badge-mid" : "badge-cold";
      const scoreColor = isHot ? "#34D399" : isMid ? "#F59E0B" : "#EF4444";

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório Executivo LeadPulse AI — ${escapeHtml(lead.name || lead.company || id)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0F172A; color: #F8FAFC; padding: 40px; margin: 0; line-height: 1.6; }
    .container { max-width: 760px; margin: 0 auto; background: #1E293B; border: 1px solid #334155; border-radius: 16px; padding: 36px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { font-size: 22px; font-weight: 800; color: #60A5FA; }
    .badge { padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 13px; text-transform: uppercase; }
    .badge-hot { background: #10B981; color: #0F172A; }
    .badge-mid { background: #F59E0B; color: #0F172A; }
    .badge-cold { background: #EF4444; color: #FFFFFF; }
    .score-box { background: rgba(37, 99, 235, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; align-items: center; gap: 24px; }
    .score-num { font-size: 48px; font-weight: 900; color: ${scoreColor}; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .info-card { background: #0F172A; border: 1px solid #334155; border-radius: 10px; padding: 14px; }
    .label { font-size: 11px; text-transform: uppercase; color: #94A3B8; margin-bottom: 4px; }
    .val { font-size: 15px; font-weight: 600; color: #FFFFFF; }
    .section-title { font-size: 14px; font-weight: 700; color: #93C5FD; margin-bottom: 8px; text-transform: uppercase; }
    .block { background: #0F172A; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin-bottom: 20px; }
    .footer { text-align: center; color: #64748B; font-size: 12px; margin-top: 30px; }
    @media print { body { background: #FFF; color: #000; } .container { border: none; box-shadow: none; background: #FFF; } .block, .info-card { background: #F8FAFC; border-color: #E2E8F0; color: #000; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">⚡ LeadPulse AI — Relatório Cognitivo</div>
      <div class="badge ${badgeClass}">Status: ${escapeHtml(lead.status)}</div>
    </div>

    <div class="score-box">
      <div class="score-num">${qual ? qual.score : 0}<span style="font-size: 18px; color: #94A3B8;">/100</span></div>
      <div>
        <div style="font-size: 20px; font-weight: 700;">${escapeHtml(lead.name || "Contato Comercial")}</div>
        <div style="color: #94A3B8; font-size: 14px;">${escapeHtml(lead.company || "Empresa sob consulta")} • ${escapeHtml(lead.role || "Cargo não especificado")}</div>
        <div style="margin-top: 6px; font-size: 13px; font-weight: 700; color: #34D399;">FIT: ${escapeHtml(qual ? qual.fit_level : "UNQUALIFIED")}</div>
      </div>
    </div>

    <div class="grid">
      <div class="info-card"><div class="label">E-mail</div><div class="val">${escapeHtml(lead.email || "Não informado")}</div></div>
      <div class="info-card"><div class="label">Telefone</div><div class="val">${escapeHtml(lead.phone || "Não informado")}</div></div>
      <div class="info-card"><div class="label">Urgência Detectada</div><div class="val">${escapeHtml(qual ? qual.urgency_detected : "UNKNOWN")}</div></div>
      <div class="info-card"><div class="label">Orçamento Estimado</div><div class="val">${escapeHtml(qual ? qual.budget_detected : "UNKNOWN")}</div></div>
    </div>

    <div class="section-title">📋 Resumo Executivo para Vendas</div>
    <div class="block">${escapeHtml(qual ? qual.summary : "Sem resumo disponível.")}</div>

    <div class="section-title">🔍 Racional da Pontuação</div>
    <div class="block" style="color: #CBD5E1;">${escapeHtml(qual ? qual.reasoning : "Sem justificativa.")}</div>

    <div class="section-title">🎯 Ação Recomendada para o Closer</div>
    <div class="block" style="border-color: #10B981; background: rgba(16, 185, 129, 0.08); font-weight: 600;">
      ${escapeHtml(qual ? qual.recommended_next_step : "Realizar triagem manual.")}
    </div>

    <div class="footer">
      Gerado automaticamente pelo LeadPulse AI em ${new Date().toLocaleString("pt-BR")} • Tenant: ${escapeHtml(tenant.name)} (${escapeHtml(tenant.id)})
    </div>
  </div>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="leadpulse-report-${id}.html"`
      );
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }
}

export const webhookController = new WebhookController();
