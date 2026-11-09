import type { Response, NextFunction } from "express";
import { tenantRepository } from "../repositories/tenant.repository.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";
import type { AuthenticatedRequest } from "../types/index.js";

/**
 * Middleware de Autenticação Multi-tenant via API Key.
 * Extrai a chave de cabeçalhos comuns ('x-api-key' ou 'Authorization: Bearer <key>'),
 * valida o tenant no banco Turso e bloqueia tenants inativos/suspensos.
 */
export async function tenantAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let apiKey: string | undefined = req.headers["x-api-key"] as string | undefined;

    if (!apiKey && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        apiKey = parts[1];
      }
    }

    if (!apiKey) {
      throw new UnauthorizedError(
        "Chave de API não informada. Envie o cabeçalho 'X-API-Key' ou 'Authorization: Bearer <token>'."
      );
    }

    const tenant = await tenantRepository.findByApiKey(apiKey.trim());

    if (!tenant) {
      throw new UnauthorizedError("Chave de API inválida ou inexistente.");
    }

    if (tenant.status !== "ACTIVE") {
      throw new ForbiddenError(
        `O acesso para a conta '${tenant.name}' está suspenso ou cancelado. Entre em contato com o suporte.`
      );
    }

    // Injeta o tenant autenticado no ciclo da requisição
    req.tenant = tenant;
    next();
  } catch (error) {
    next(error);
  }
}
