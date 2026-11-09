import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform((val) => parseInt(val, 10)),
  TURSO_DATABASE_URL: z.string().default("file:local.db"),
  TURSO_AUTH_TOKEN: z.string().optional().default(""),
  JWT_SECRET: z
    .string()
    .default("87fe2b0db7d7a59d2795adfa5a051d25e5a684cedd425639aa6c2d4bbddbe5b1"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  WEBHOOK_SECRET: z
    .string()
    .default("whsec_7e4d51d20baebd17490a2e3b177f69f80d6c7c9389a83f92"),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.1-flash-lite"),
  GEMINI_API_KEY: z.string().optional().default("mock_or_env"),
  OPENAI_API_KEY: z.string().optional().default(""),
  RESEND_API_KEY: z.string().trim().optional(),
  MAIL_FROM: z.string().trim().optional(),
  PUBLIC_APP_URL: z.string().trim().optional(),
  PORTAL_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(180),
  CORS_ORIGIN: z.string().default("*"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Configuração de variáveis de ambiente inválida:", parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
