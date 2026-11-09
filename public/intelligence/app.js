const api = "/api/v1/intelligence/demo";
const stages = [
  { id: "NEW", label: "Novos", tone: "blue" },
  { id: "CONTACTED", label: "Em contato", tone: "purple" },
  { id: "PROPOSAL", label: "Proposta", tone: "amber" },
  { id: "WON", label: "Ganhos", tone: "green" },
];
const example = {
  name: "Pessoa Demonstração",
  company: "Grupo Aurora (fictício)",
  role: "Diretor de operações",
  email: "contato@aurora.example",
  message: "Buscamos energia solar para três unidades. Temos orçamento aprovado e precisamos de uma proposta urgente.",
};
const byId = (id) => document.getElementById(id);
const views = [...document.querySelectorAll("[data-view]")];
const navLinks = [...document.querySelectorAll("[data-nav]")];
const form = byId("lead-form");
let leads = [];
let selectedId;
let feedbackTimer;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(path = "", method = "GET", payload) {
  const options = { method, signal: AbortSignal.timeout(90000) };
  if (payload) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(api + path, options);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("O servidor está temporariamente indisponível.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "A operação não pôde ser concluída.");
  return data;
}

function notify(text, error = false) {
  const feedback = byId("feedback");
  clearTimeout(feedbackTimer);
  feedback.textContent = text;
  feedback.classList.toggle("error", error);
  feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 5500);
}

function showView(focus = false) {
  const id = location.hash.slice(1);
  const target = views.find((section) => section.dataset.view === id) || views[0];
  for (const view of views) view.hidden = view !== target;
  for (const link of navLinks) {
    if (link.dataset.nav === target.dataset.view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (focus) target.querySelector("h1").focus();
}

function newLead() {
  if (location.hash !== "#intelligence") history.pushState(null, "", "#intelligence");
  showView();
  form.elements.namedItem("name").focus();
}

function openAnalysis(id) {
  selectedId = id;
  renderAnalysis();
  if (location.hash !== "#intelligence") location.hash = "intelligence";
  else byId("intelligence-title").focus();
}

function renderSummary() {
  const counts = Object.fromEntries(stages.map((stage) => [stage.id, leads.filter((lead) => lead.stage === stage.id).length]));
  const scores = leads.map((lead) => lead.analysis.qualification.score);
  byId("kpi-total").textContent = leads.length;
  byId("kpi-score").textContent = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : "—";
  byId("kpi-proposal").textContent = counts.PROPOSAL;
  byId("kpi-won").textContent = counts.WON;
  byId("pipeline-count").textContent = leads.length + (leads.length === 1 ? " oportunidade" : " oportunidades");

  for (const target of [byId("funnel"), byId("client-funnel")]) {
    target.replaceChildren();
    for (const stage of stages) {
      const item = el("li");
      const progress = el("progress");
      progress.max = Math.max(1, leads.length);
      progress.value = counts[stage.id];
      progress.setAttribute("aria-label", stage.label);
      item.append(el("span", "", stage.label), progress, el("strong", "", counts[stage.id]));
      target.append(item);
    }
  }

  const recent = byId("recent");
  recent.replaceChildren();
  if (!leads.length) recent.append(el("li", "empty", "Nenhum lead ainda. Cadastre um exemplo para começar."));
  for (const lead of leads.slice(0, 4)) {
    const item = el("li");
    const button = el("button");
    const label = el("span");
    label.append(el("strong", "", lead.name), el("small", "", lead.company));
    button.append(label, el("span", "badge blue", lead.analysis.qualification.score + "/100"));
    button.addEventListener("click", () => openAnalysis(lead.id));
    item.append(button);
    recent.append(item);
  }
}

function block(title, text) {
  const wrapper = el("div", "analysis-block");
  wrapper.append(el("h3", "", title), el("p", "", text));
  return wrapper;
}

function renderAnalysis() {
  const target = byId("analysis");
  target.replaceChildren();
  const lead = leads.find((item) => item.id === selectedId);
  if (!lead) {
    target.append(el("div", "empty", "Cadastre um lead ou abra uma oportunidade existente para ver a análise."));
    return;
  }
  const { qualification, evidence } = lead.analysis;
  const title = el("div", "analysis-title");
  const name = el("div");
  name.append(el("h3", "", lead.name), el("p", "", lead.company));
  const score = el("span", "score", qualification.score);
  score.append(el("small", "", "/100"));
  title.append(name, score);

  const signals = el("div", "analysis-block");
  const list = el("ul", "evidence");
  for (const { label, impact } of evidence) {
    const item = el("li");
    item.append(el("span", "", label), el("strong", "", (impact > 0 ? "+" : "") + impact + " pts"));
    list.append(item);
  }
  if (!evidence.length) list.append(el("li", "", "Nenhum critério adicional alterou a nota-base."));
  signals.append(el("h3", "", "Evidências consideradas"), el("p", "", "Nota-base de 50 pontos. A nota final fica entre 5 e 98."), list);
  const link = el("a", "text-link", "Abrir Smart Pipeline →");
  link.href = "#pipeline";
  target.append(title, block("Justificativa", qualification.reasoning), signals, block("Próximo passo", qualification.recommended_next_step), link);
}

async function moveLead(lead, select) {
  const stage = select.value;
  select.disabled = true;
  try {
    const updated = await request("/leads/" + encodeURIComponent(lead.id) + "/stage", "PATCH", { stage });
    lead.stage = updated.stage;
    renderSummary();
    renderBoard();
    byId("stage-" + lead.id)?.focus();
    notify("Etapa atualizada para " + stages.find((item) => item.id === lead.stage).label + ".");
  } catch (error) {
    select.value = lead.stage;
    notify(error.message, true);
  } finally {
    select.disabled = false;
  }
}

function renderBoard() {
  const board = byId("board");
  board.replaceChildren();
  for (const stage of stages) {
    const column = el("section", "column");
    const list = leads.filter((lead) => lead.stage === stage.id);
    const header = el("header");
    header.append(el("h2", "", stage.label), el("span", "badge " + stage.tone, list.length));
    column.append(header);
    if (!list.length) column.append(el("div", "empty", "Sem oportunidades"));
    for (const lead of list) {
      const card = el("article", "pipeline-card");
      const name = el("button", "lead-title", lead.name);
      name.addEventListener("click", () => openAnalysis(lead.id));
      const select = el("select");
      select.id = "stage-" + lead.id;
      select.setAttribute("aria-label", "Etapa comercial de " + lead.name);
      for (const optionStage of stages) {
        const option = el("option", "", optionStage.label);
        option.value = optionStage.id;
        select.append(option);
      }
      select.value = lead.stage;
      select.addEventListener("change", () => moveLead(lead, select));
      card.append(name, el("small", "", lead.company), el("span", "badge blue", "Score " + lead.analysis.qualification.score), select);
      column.append(card);
    }
    board.append(column);
  }
}

async function loadWorkspace() {
  byId("load-error").hidden = true;
  byId("load-state").hidden = false;
  byId("new-lead").disabled = true;
  byId("workspace").hidden = true;
  byId("workspace").setAttribute("aria-busy", "true");
  try {
    const data = await request();
    leads = data.leads;
    selectedId = leads[0]?.id;
    renderSummary();
    renderBoard();
    renderAnalysis();
    showView();
    byId("workspace").hidden = false;
    byId("new-lead").disabled = false;
  } catch (error) {
    byId("load-message").textContent = "Falha ao carregar o workspace. " + error.message;
    byId("load-error").hidden = false;
  } finally {
    byId("load-state").hidden = true;
    byId("workspace").setAttribute("aria-busy", "false");
  }
}

byId("new-lead").addEventListener("click", newLead);
byId("start-demo").addEventListener("click", newLead);
byId("reload").addEventListener("click", loadWorkspace);
window.addEventListener("hashchange", () => {
  if (location.hash !== "#main") showView(true);
});
byId("example").addEventListener("click", () => {
  for (const [key, value] of Object.entries(example)) form.elements.namedItem(key).value = value;
  notify("Exemplo fictício preenchido.");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("qualify");
  const errorBox = byId("form-error");
  errorBox.hidden = true;
  button.disabled = true;
  form.setAttribute("aria-busy", "true");
  const previous = [...button.childNodes];
  button.textContent = "Qualificando…";
  try {
    const lead = await request("/leads", "POST", Object.fromEntries(new FormData(form)));
    leads.unshift(lead);
    selectedId = lead.id;
    form.reset();
    renderSummary();
    renderAnalysis();
    renderBoard();
    notify("Lead cadastrado e qualificado. Veja a análise ou abra o Pipeline.");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.replaceChildren(...previous);
    button.disabled = false;
    form.setAttribute("aria-busy", "false");
  }
});

loadWorkspace();
