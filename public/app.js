/**
 * LeadPulse AI — Interactive Sandbox Client & Analytics Integration
 * Comunicação direta com a API REST Express + Turso DB + Gemini 3.1 Flash-Lite
 */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("lead-form");
  const submitBtn = document.getElementById("submit-btn");
  const emptyState = document.getElementById("empty-state");
  const loadingState = document.getElementById("loading-state");
  const resultState = document.getElementById("result-state");
  const statusTag = document.getElementById("status-tag");
  const loadingStep = document.getElementById("loading-step");
  const presetButtons = document.querySelectorAll(".btn-preset");
  const channelAlertBox = document.getElementById("channel-alert-box");
  const btnExportHtml = document.getElementById("btn-export-html");
  const btnExportJson = document.getElementById("btn-export-json");

  // Chave pública do Tenant de Demonstração (LeadPulse Demo Account)
  const DEMO_API_KEY = "lp_live_sample_key_1234567890abcdef";

  for (const [link, format] of [[btnExportHtml, "html"], [btnExportJson, "json"]]) {
    link?.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const response = await fetch(link.href, { headers: { "X-API-Key": DEMO_API_KEY } });
        if (!response.ok) throw new Error("Exportação indisponível.");
        const url = URL.createObjectURL(await response.blob());
        const download = document.createElement("a");
        download.href = url;
        download.download = `leadpulse-report.${format}`;
        download.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        alert("Não foi possível exportar o relatório.");
      }
    });
  }

  // Presets para testes rápidos
  const presets = {
    hot: {
      name: "Roberto Albuquerque",
      email: "roberto.albuquerque@logtechbrasil.com.br",
      company: "LogTech Brasil Soluções Logísticas S/A",
      role: "Diretor Comercial e de Operações",
      phone: "+55 (11) 98765-4321",
      message:
        "Temos urgência imediata. Recebemos mais de 8.000 leads por mês e nossa equipe de pré-vendas não consegue qualificar a tempo. Temos orçamento corporativo aprovado de R$ 15.000/mês para implementar automação por IA agora.",
    },
    warm: {
      name: "Camila Rocha",
      email: "camila.rocha@inboundgrowth.com.br",
      company: "Inbound Growth Marketing",
      role: "Head de Marketing & Growth",
      phone: "+55 (21) 98888-4444",
      message:
        "Estamos avaliando soluções de qualificação para o próximo trimestre. Nosso volume atual é de cerca de 1.200 leads/mês. Gostaria de entender como integrar ao nosso CRM HubSpot.",
    },
    cold: {
      name: "Lucas Fernandes",
      email: "lucas.fernandes2026@gmail.com",
      company: "Projeto Acadêmico Independente",
      role: "Estudante / Pesquisador",
      phone: "",
      message:
        "Olá, gostaria de saber se vocês oferecem plano gratuito para projetos de faculdade ou desconto para estudantes.",
    },
  };

  // Carrega o preset inicial (hot)
  loadPreset("hot");

  // Busca métricas reais do banco Turso
  fetchLiveMetrics();

  // Gerenciamento de cliques nos presets
  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      presetButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const presetKey = btn.getAttribute("data-preset");
      if (presetKey && presets[presetKey]) {
        loadPreset(presetKey);
      }
    });
  });

  function loadPreset(key) {
    const data = presets[key];
    document.getElementById("name").value = data.name;
    document.getElementById("email").value = data.email;
    document.getElementById("company").value = data.company;
    document.getElementById("role").value = data.role;
    document.getElementById("phone").value = data.phone;
    document.getElementById("message").value = data.message;
  }

  // Busca métricas reais do banco Turso
  async function fetchLiveMetrics() {
    try {
      const res = await fetch("/api/v1/analytics/summary", {
        headers: { "X-API-Key": DEMO_API_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        const m = json.data?.metrics;
        if (m) {
          const totalEl = document.getElementById("metric-total-leads");
          const qualEl = document.getElementById("metric-qual-rate");
          const scoreEl = document.getElementById("metric-avg-score");

          if (totalEl && m.total_leads > 0) {
            totalEl.textContent = `${m.total_leads} Leads`;
          }
          if (qualEl && m.qualification_rate) {
            qualEl.textContent = m.qualification_rate;
          }
          if (scoreEl && m.average_score > 0) {
            scoreEl.textContent = `${m.average_score} pts`;
          }
        }
      }
    } catch {
      // Mantém os valores default
    }
  }

  // Manipulador de submissão do formulário
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      source: "LANDING_PAGE_SANDBOX",
      name: document.getElementById("name").value.trim(),
      email: document.getElementById("email").value.trim(),
      company: document.getElementById("company").value.trim(),
      role: document.getElementById("role").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      message: document.getElementById("message").value.trim(),
      custom_fields: {
        tested_from: "LeadPulse AI Public Sandbox",
        client_timestamp: new Date().toISOString(),
      },
    };

    // 1. Transição de UI para carregamento com Skeleton Loader
    setLoadingState(true);

    try {
      updateLoadingStep("Enviando webhook seguro para POST /api/v1/webhooks/ingest...");

      // 2. Dispara a ingestão no backend
      const ingestRes = await fetch("/api/v1/webhooks/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": DEMO_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      const ingestData = await ingestRes.json();

      if (!ingestRes.ok || !ingestData.success) {
        throw new Error(ingestData.error?.message || "Falha ao enviar webhook do lead.");
      }

      const leadId = ingestData.data.lead_id;
      updateLoadingStep("Lead registrado no Turso DB! Analisando semântica e sinais de compra...");

      // 3. Polling reativo em tempo real para aguardar a IA
      let attempts = 0;
      const maxAttempts = 60; // até 30s, além da latência das consultas
      let qualificationData = null;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;

        const checkRes = await fetch(`/api/v1/webhooks/leads/${leadId}`, {
          headers: {
            "X-API-Key": DEMO_API_KEY,
          },
        });

        if (checkRes.ok) {
          const checkJson = await checkRes.json();
          const lead = checkJson.data?.lead;
          const qual = checkJson.data?.qualification;
          if (lead?.status === "ERROR") {
            throw new Error("A qualificação falhou. Tente novamente mais tarde.");
          }

          if (lead?.status === "QUALIFIED" || lead?.status === "DISQUALIFIED") {
            qualificationData = {
              lead,
              qualification: qual,
            };
            break;
          }
        }
      }

      if (!qualificationData || !qualificationData.qualification) {
        throw new Error("Tempo limite excedido aguardando qualificação da IA.");
      }

      // 4. Renderiza o relatório completo na tela
      renderReport(qualificationData.lead, qualificationData.qualification);
      fetchLiveMetrics();
    } catch (error) {
      alert(`Erro ao analisar lead: ${error.message}`);
      setLoadingState(false);
      loadingState.classList.add("hidden");
      statusTag.textContent = "Falha na qualificação";
      statusTag.className = "status-tag";
      emptyState.classList.remove("hidden");
    }
  });

  function setLoadingState(isLoading) {
    if (isLoading) {
      submitBtn.disabled = true;
      submitBtn.querySelector(".btn-text").textContent = "Processando com IA...";
      submitBtn.querySelector(".spinner")?.classList.remove("hidden");

      emptyState.classList.add("hidden");
      resultState.classList.add("hidden");
      loadingState.classList.remove("hidden");

      statusTag.textContent = "Processando";
      statusTag.className = "status-tag status-loading";
    } else {
      submitBtn.disabled = false;
      submitBtn.querySelector(".btn-text").textContent = "🚀 Qualificar Lead com IA Agora";
      submitBtn.querySelector(".spinner")?.classList.add("hidden");
    }
  }

  function updateLoadingStep(text) {
    if (loadingStep) {
      loadingStep.textContent = text;
    }
  }

  function renderReport(lead, qual) {
    setLoadingState(false);
    loadingState.classList.add("hidden");
    resultState.classList.remove("hidden");

    statusTag.textContent = "Qualificado";
    statusTag.className = "status-tag status-done";

    // Score e Fit
    const scoreEl = document.getElementById("res-score");
    const fitEl = document.getElementById("res-fit");

    scoreEl.textContent = qual.score;

    // Cores e Badges
    if (qual.score >= 80) {
      scoreEl.style.color = "#34D399";
      fitEl.style.background = "#10B981";
      fitEl.style.color = "#0F172A";
      if (channelAlertBox) channelAlertBox.style.display = "flex";
    } else if (qual.score >= 50) {
      scoreEl.style.color = "#F59E0B";
      fitEl.style.background = "#F59E0B";
      fitEl.style.color = "#0F172A";
      if (channelAlertBox) channelAlertBox.style.display = "none";
    } else {
      scoreEl.style.color = "#EF4444";
      fitEl.style.background = "#EF4444";
      fitEl.style.color = "#FFFFFF";
      if (channelAlertBox) channelAlertBox.style.display = "none";
    }

    fitEl.textContent = `FIT: ${qual.fit_level}`;
    document.getElementById("res-lead-name").textContent = lead.name || "Contato Comercial";
    document.getElementById("res-lead-company").textContent =
      `${lead.company || "Empresa não informada"} • ${lead.role || "Cargo não especificado"}`;

    // Sinais
    document.getElementById("res-urgency").textContent = qual.urgency_detected;
    document.getElementById("res-budget").textContent = qual.budget_detected;
    document.getElementById("res-model").textContent = qual.model_used;

    // Blocos textuais
    document.getElementById("res-summary").textContent = qual.summary;
    document.getElementById("res-reasoning").textContent = qual.reasoning;
    document.getElementById("res-action").textContent = qual.recommended_next_step;

    // Links de Exportação
    if (btnExportHtml) {
      btnExportHtml.href = `/api/v1/webhooks/leads/${lead.id}/export?format=html`;
    }
    if (btnExportJson) {
      btnExportJson.href = `/api/v1/webhooks/leads/${lead.id}/export?format=json`;
    }
  }
});
