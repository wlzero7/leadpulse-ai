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

  // Falha não tratada (Internal Server Error)
  console.error("💥 [Unhandled Error]:", err);

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
