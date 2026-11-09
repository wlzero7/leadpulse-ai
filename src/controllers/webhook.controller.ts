import type { Response, NextFunction } from "express";
import { webhookService } from "../services/webhook.service.js";
import { UnauthorizedError } from "../utils/errors.js";
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
}

export const webhookController = new WebhookController();
