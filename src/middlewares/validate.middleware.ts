import type { Request, Response, NextFunction } from "express";
import { type ZodTypeAny, ZodError } from "zod";
import { BadRequestError } from "../utils/errors.js";

/**
 * Middleware genérico para validação de esquemas Zod (body, query, params)
 */
export function validateRequest(schema: ZodTypeAny) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }));
        next(new BadRequestError("Erro de validação nos dados fornecidos.", formattedErrors));
        return;
      }
      next(error);
    }
  };
}
