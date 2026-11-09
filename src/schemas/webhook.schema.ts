import { z } from "zod";

/**
 * Schema de validação do Webhook Ingest
 * Permite campos comuns de formulários B2B enquanto aceita propriedades dinâmicas adicionais
 * para que o payload bruto nunca seja truncado ou rejeitado por conter dados extras da fonte original.
 */
export const leadIngestSchema = z
  .object({
    source: z.string().default("WEBHOOK"),
    external_id: z.string().optional(),
    name: z.string().min(1, "O nome do contato é obrigatório.").optional(),
    email: z.string().email("Endereço de e-mail inválido.").optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    role: z.string().optional(),
    message: z.string().optional(),
    // Dados customizados adicionais
    custom_fields: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (data) => Boolean(data.email || data.phone || data.message || data.name),
    {
      message: "O payload deve conter pelo menos um identificador de contato (email, telefone) ou mensagem/nome.",
      path: ["email"],
    }
  );

export type LeadIngestInput = z.infer<typeof leadIngestSchema>;
