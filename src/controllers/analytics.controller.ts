import type { Response, NextFunction } from "express";
import { analyticsService } from "../services/analytics.service.js";
import { UnauthorizedError } from "../utils/errors.js";
import type { AuthenticatedRequest } from "../types/index.js";

export class AnalyticsController {
  /**
   * Retorna sumário analítico e KPIs comerciais do tenant
   * GET /api/v1/analytics/summary
   */
  async getSummary(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tenant = req.tenant;
      if (!tenant) {
        throw new UnauthorizedError("Tenant não identificado na requisição.");
      }

      const summary = await analyticsService.getSummary(tenant);

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const analyticsController = new AnalyticsController();
