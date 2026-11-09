import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";

/**
 * Middleware de tratamento global de exceções e erros da API
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        name: err.name,
        message: err.message,
        statusCode: err.statusCode,
        details: err.details ?? null,
        timestamp,
      },
    });
    return;
  }

  const parserError = err as Error & { type?: string };
  const parseFailed = parserError.type === "entity.parse.failed";
  const tooLarge = parserError.type === "entity.too.large";
  if (parseFailed || tooLarge) {
    const statusCode = parseFailed ? 400 : 413;
    res.status(statusCode).json({
      success: false,
      error: {
        name: parseFailed ? "BadRequestError" : "PayloadTooLargeError",
        message: parseFailed ? "Corpo da requisição inválido." : "Corpo da requisição excede o limite permitido.",
        statusCode,
        timestamp,
      },
    });
    return;
  }

  console.error("[HTTP] Falha interna ao processar a requisição.");

  res.status(500).json({
    success: false,
    error: {
      name: "InternalServerError",
      message: "Ocorreu um erro interno no servidor ao processar a requisição.",
      statusCode: 500,
      timestamp,
    },
  });
}
