import { Router } from "express";
import { analyticsController } from "../controllers/analytics.controller.js";
import { tenantAuthMiddleware } from "../middlewares/auth.middleware.js";

const router: Router = Router();

/**
 * @route   GET /api/v1/analytics/summary
 * @desc    Retorna métricas consolidadas em tempo real do tenant
 * @access  Private (Requer cabeçalho 'X-API-Key')
 */
router.get("/summary", tenantAuthMiddleware, (req, res, next) =>
  analyticsController.getSummary(req, res, next)
);

export const analyticsRoutes: Router = router;
