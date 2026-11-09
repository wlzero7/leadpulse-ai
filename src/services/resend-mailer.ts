import { createHash } from "node:crypto";
import { z } from "zod";
import type { PortalMail, PortalMailer } from "./portal-mail.js";

const copy = {
  verify: {
    title: "Confirme seu e-mail",
    message: "Confirme este endereço para acessar o workspace da sua agência ou empresa.",
    action: "Confirmar endereço",
    notice: "Se você não iniciou este cadastro, ignore a mensagem.",
  },
  reset: {
    title: "Redefina sua senha",
    message: "Use o link abaixo para escolher uma nova senha. Suas sessões anteriores serão encerradas.",
    action: "Criar nova senha",
    notice: "Se você não solicitou a recuperação, ignore a mensagem. Sua senha atual permanece válida.",
  },
  invite: {
    title: "Seu convite para o LeadPulse Intelligence",
    message: "Você recebeu um convite para acessar um workspace. Abra o link e entre com o endereço convidado.",
    action: "Abrir convite",
    notice: "Se você não esperava este convite, ignore a mensagem.",
  },
};

function renderEmail(message: PortalMail, origin: string) {
  if (!/^[a-f0-9]{64}$/.test(message.token)) throw new Error("Token de e-mail inválido.");
  const link = new URL("/intelligence/portal/", origin);
  link.hash = message.kind + "=" + message.token;
  const { title, message: description, action, notice } = copy[message.kind];
  const expiry = "Link de uso único. Válido até " + new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(message.expiresAt) + " (horário de Brasília).";
  const text = [title, description, action + ": " + link.href, expiry, notice, "LeadPulse AI"].join("\n\n");
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f8fafc;color:#0F172A;font:16px/1.55 Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
        <tr><td style="padding:18px 24px;background:#0F172A;color:#fff;border-top:4px solid #10B981"><strong>LeadPulse AI</strong> · Intelligence</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${title}</h1>
          <p style="margin:0 0 20px">${description}</p>
          <p style="margin:0 0 18px"><a href="${link.href}" style="display:inline-block;padding:12px 18px;background:#2563EB;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">${action}</a></p>
          <p style="margin:0 0 8px;font-size:14px;color:#334155">${expiry}</p>
          <p style="margin:0;font-size:14px;color:#334155">${notice}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { subject: title + " · LeadPulse AI", html, text };
}

export function createResendMailer(
  config: { RESEND_API_KEY?: string; MAIL_FROM?: string; PUBLIC_APP_URL?: string; NODE_ENV: string },
  transport: typeof fetch = fetch,
): PortalMailer | undefined {
  const { RESEND_API_KEY: key, MAIL_FROM: from, PUBLIC_APP_URL: url } = config;
  if (!key && !from && !url) return;
  const origin = URL.parse(url ?? "");
  const secureOrigin = origin && (origin.protocol === "https:" ||
    (config.NODE_ENV !== "production" && origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
  if (!key || !from || !z.email().safeParse(from).success || !secureOrigin ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Configuração de e-mail incompleta ou inválida.");
  }
  return {
    async send(message) {
      const content = renderEmail(message, origin.origin);
      const id = createHash("sha256").update(message.token).digest("hex");
      try {
        const response = await transport("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
            "Idempotency-Key": "leadpulse-" + message.kind + "-" + id,
          },
          redirect: "error",
          signal: AbortSignal.timeout(3500),
          body: JSON.stringify({ from: "LeadPulse AI <" + from + ">", to: [message.to], ...content }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Envio recusado.");
        }
        const result = await response.json() as { id?: string } | null;
        if (!result?.id || typeof result.id !== "string") throw new Error("Resposta de envio inválida.");
      } catch {
        // Provider responses and transport errors may contain credentials or message content.
        throw new Error("Falha na entrega de e-mail transacional.");
      }
    },
  };
}
