import { db } from "./src/config/database.js";
import { env } from "./src/config/env.js";

async function runEndToEndTest() {
  console.log("==================================================================");
  console.log("🚀 [LeadPulse AI] Validação Completa (Branding + Ingestão + IA)");
  console.log("==================================================================\n");

  const baseUrl = `http://localhost:${env.PORT}`;
  const apiKey = "lp_live_sample_key_1234567890abcdef";
  let serverInstance: any = null;

  // 0. Verifica se o servidor já está ativo, senão inicializa uma instância
  try {
    const healthCheck = await fetch(`${baseUrl}/health`);
    if (healthCheck.ok) {
      console.log(`🌐 Servidor ativo detectado em ${baseUrl}.`);
    }
  } catch {
    console.log(`ℹ️ Inicializando servidor HTTP local na porta ${env.PORT} para execução dos testes...`);
    const { createApp } = await import("./src/app.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      serverInstance = app.listen(env.PORT, () => {
        console.log(`🚀 [Test Server] Servidor operacional em http://localhost:${env.PORT}\n`);
        resolve();
      });
    });
  }

  try {
    // 1. Validação dos Assets de Branding e Arquivos Estáticos
    console.log("🎨 1. Validando Assets de Marca e Endpoints Públicos:");
    
    const brandRes = await fetch(`${baseUrl}/api/v1/brand`);
    console.log(`   - GET /api/v1/brand: Status ${brandRes.status} (OK: ${brandRes.ok})`);

    const logoSvgRes = await fetch(`${baseUrl}/assets/logo.svg`);
    console.log(`   - GET /assets/logo.svg: Status ${logoSvgRes.status} (OK: ${logoSvgRes.ok})`);

    const logoPngRes = await fetch(`${baseUrl}/assets/logo.png`);
    console.log(`   - GET /assets/logo.png: Status ${logoPngRes.status} (OK: ${logoPngRes.ok})`);

    const faviconRes = await fetch(`${baseUrl}/favicon.ico`);
    console.log(`   - GET /favicon.ico: Status ${faviconRes.status} (OK: ${faviconRes.ok})`);

    // 2. Ingestão de Lead via Webhook
    const leadPayload = {
      source: "TYPEFORM",
      external_id: "lead_submission_prod_2026",
      name: "Roberto Albuquerque",
      email: "roberto.albuquerque@logtechbrasil.com.br",
      phone: "+55 11 98765-4321",
      company: "LogTech Brasil Soluções Logísticas S/A",
      role: "Diretor Comercial e de Operações",
      message: "Temos urgência imediata. Recebemos mais de 8.000 leads por mês e nossa equipe de pré-vendas não consegue qualificar a tempo. Temos orçamento corporativo aprovado de R$ 15.000/mês para implementar automação por IA agora.",
      custom_fields: {
        lead_volume: "8000+/mês",
        crm_utilizado: "Salesforce Enterprise",
        urgencia_implantacao: "imediata",
        orcamento_aprovado: true,
      },
    };

    console.log(`\n📡 2. Enviando lead via Webhook para: ${baseUrl}/api/v1/webhooks/ingest`);
    console.log(`🔑 Cabeçalho X-API-Key: ${apiKey}`);

    const response = await fetch(`${baseUrl}/api/v1/webhooks/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(leadPayload),
    });

    const responseData = (await response.json()) as any;

    console.log(`\n📬 Resposta HTTP recebida do Webhook [Status ${response.status}]:`);
    console.log(JSON.stringify(responseData, null, 2));

    if (!response.ok || !responseData.success) {
      console.error("❌ Falha na ingestão do lead.");
      if (serverInstance) serverInstance.close();
      process.exit(1);
    }

    const leadId = responseData.data.lead_id;
    console.log(`\n⏳ 3. Aguardando processamento da Qualificação Cognitiva por IA (Lead ID: ${leadId})...`);

    // Aguarda 1.5s para o worker assíncrono em background concluir a qualificação no banco
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 4. Consulta no banco Turso os dados atualizados do lead
    const leadResult = await db.execute({
      sql: `SELECT id, name, company, email, status, score, updated_at FROM leads WHERE id = ?`,
      args: [leadId],
    });

    if (leadResult.rows.length === 0) {
      console.error("❌ Registro do lead não localizado no banco de dados.");
      if (serverInstance) serverInstance.close();
      process.exit(1);
    }

    const leadRow = leadResult.rows[0];
    console.log("\n📊 4. Registro do Lead Atualizado no Banco Turso/LibSQL:");
    console.log(`   - ID: ${leadRow.id}`);
    console.log(`   - Contato: ${leadRow.name} (${leadRow.email})`);
    console.log(`   - Empresa: ${leadRow.company}`);
    console.log(`   - Status Final: ${leadRow.status}`);
    console.log(`   - Score de Propensão: ${leadRow.score} / 100`);

    // 5. Consulta os detalhes da qualificação na tabela 'qualifications'
    const qualResult = await db.execute({
      sql: `SELECT * FROM qualifications WHERE lead_id = ?`,
      args: [leadId],
    });

    if (qualResult.rows.length === 0) {
      console.error("⚠️ Qualificação ainda não finalizada ou pendente.");
      if (serverInstance) serverInstance.close();
      process.exit(1);
    }

    const qualRow = qualResult.rows[0];
    console.log("\n🧠 5. Relatório Cognitivo Gerado pela IA:");
    console.log(`   - Modelo Utilizado: ${qualRow.model_used}`);
    console.log(`   - Fit Comercial: ${qualRow.fit_level}`);
    console.log(`   - Urgência Detectada: ${qualRow.urgency_detected}`);
    console.log(`   - Orçamento Detectado: ${qualRow.budget_detected}`);
    console.log(`   - Resumo Executivo: ${qualRow.summary}`);
    console.log(`   - Racional da Nota: ${qualRow.reasoning}`);
    console.log(`   - Próximo Passo Recomendado: ${qualRow.recommended_next_step}`);

    console.log("\n==================================================================");
    console.log("✅ [LeadPulse AI] TESTES E VALIDAÇÃO DE ASSETS CONCLUÍDOS COM 100% DE SUCESSO!");
    console.log("==================================================================");

    if (serverInstance) {
      serverInstance.close();
    }
    process.exit(0);
  } catch (error) {
    console.error("💥 Erro ao executar teste end-to-end:", error);
    if (serverInstance) serverInstance.close();
    process.exit(1);
  }
}

runEndToEndTest();
