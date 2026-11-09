import { Router } from "express";
import { webhookRoutes } from "./webhook.routes.js";
import { analyticsRoutes } from "./analytics.routes.js";
import { intelligenceRoutes } from "./intelligence.routes.js";
import { db } from "../config/database.js";

const router: Router = Router();

// Healthcheck do sistema
router.get("/health", async (_req, res) => {
  let dbStatus = "UP";
  try {
    await db.execute("SELECT 1");
  } catch {
    dbStatus = "DOWN";
  }

  res.status(dbStatus === "UP" ? 200 : 503).json({
    status: dbStatus === "UP" ? "ok" : "error",
    service: "LeadPulse AI Backend",
    version: "1.0.0",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Metadados oficiais de Branding e Assets da Marca
router.get("/api/v1/brand", (_req, res) => {
  res.status(200).json({
    brand: "LeadPulse AI",
    tagline: "Autonomous Commercial Intelligence & Cognitive Lead Qualification",
    colors: {
      primary_blue: "#2563EB",
      emerald_green: "#10B981",
      dark_slate: "#0F172A",
    },
    assets: {
      logo_svg: "/assets/logo.svg",
      icon_svg: "/assets/icon.svg",
      logo_png: "/assets/logo.png",
      favicon: "/favicon.ico",
      brand_guide: "/assets/brand-guide.json",
    },
  });
});

// Agrupamento de rotas v1
router.use("/api/v1/webhooks", webhookRoutes);
router.use("/api/v1/analytics", analyticsRoutes);
router.use("/api/v1/intelligence/demo", intelligenceRoutes);

export const appRoutes: Router = router;
