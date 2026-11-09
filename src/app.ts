import path from "node:path";
import express, { type Application } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { appRoutes } from "./routes/index.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { NotFoundError } from "./utils/errors.js";

export function createApp(): Application {
  const app = express();

  // 1. Middlewares de Segurança e Conectividade
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    })
  );

  // 2. Servidor de Arquivos Estáticos e Branding (/assets, /favicon.ico)
  const publicPath = path.resolve(process.cwd(), "public");
  app.use(express.static(publicPath));

  // 3. Parsers de Payload
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // 4. Montagem das Rotas da Aplicação
  app.use(appRoutes);

  // 5. Rota não encontrada (404 Fallback)
  app.use((_req, _res, next) => {
    next(new NotFoundError("Endpoint não encontrado nesta API."));
  });

  // 6. Tratamento Global de Erros
  app.use(errorHandler);

  return app;
}
