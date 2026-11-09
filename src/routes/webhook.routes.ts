import { Router } from "express";
import { webhookController } from "../controllers/webhook.controller.js";
import { tenantAuthMiddleware } from "../middlewares/auth.middleware.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import { leadIngestSchema } from "../schemas/webhook.schema.js";

const router: Router = Router();

/**
 * @route   POST /api/v1/webhooks/ingest
 * @desc    Recebe dados brutos de formulários/webhooks externos, valida o tenant e armazena o lead
 * @access  Private (Requer cabeçalho 'X-API-Key')
 */
router.post(
  "/ingest",
  tenantAuthMiddleware,
  validateRequest(leadIngestSchema),
  (req, res, next) => webhookController.ingest(req, res, next)
);

/**
 * @route   GET /api/v1/webhooks/leads/:id
 * @desc    Consulta o status e o relatório cognitivo gerado por IA para o lead
 * @access  Private (Requer cabeçalho 'X-API-Key')
 */
router.get(
  "/leads/:id",
  tenantAuthMiddleware,
  (req, res, next) => webhookController.getLeadStatus(req, res, next)
);

export const webhookRoutes: Router = router;
