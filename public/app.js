/**
 * LeadPulse AI — Interactive Sandbox Client
 * Comunicação direta com a API REST Express + Turso DB + Gemini 2.5 Flash
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

  // Chave pública do Tenant de Demonstração (LeadPulse Demo Account)
  const DEMO_API_KEY = "lp_live_sample_key_1234567890abcdef";

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

    // 1. Transição de UI para carregamento
    setLoadingState(true);

    try {
      updateLoadingStep("Enviando webhook para POST /api/v1/webhooks/ingest...");

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
      updateLoadingStep("Lead registrado no Turso DB! Processando com IA cognitiva...");

      // 3. Polling em tempo real para aguardar a qualificação da IA
      let attempts = 0;
      const maxAttempts = 20; // até 10 segundos
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
    } catch (error) {
      console.error("Erro na qualificação:", error);
      alert(`Erro ao analisar lead: ${error.message}`);
      setLoadingState(false);
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

    // Cores de acordo com o score
    if (qual.score >= 80) {
      scoreEl.style.color = "#34D399";
      fitEl.style.background = "#10B981";
      fitEl.style.color = "#0F172A";
    } else if (qual.score >= 50) {
      scoreEl.style.color = "#F59E0B";
      fitEl.style.background = "#F59E0B";
      fitEl.style.color = "#0F172A";
    } else {
      scoreEl.style.color = "#EF4444";
      fitEl.style.background = "#EF4444";
      fitEl.style.color = "#FFFFFF";
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
  }
});
