const root = "/api/v1/portal";
const screen = document.getElementById("screen");
const statusLine = document.getElementById("status");
const errorLine = document.getElementById("error");
const identityBox = document.getElementById("identity");
const workspacesButton = document.getElementById("workspaces");
const logoutButton = document.getElementById("logout");
const stageLabels = { NEW: "Novos", CONTACTED: "Em contato", PROPOSAL: "Proposta", WON: "Ganhos", LOST: "Perdidos" };
const roles = { OWNER: "Titular", ADMIN: "Administrador", EDITOR: "Editor", VIEWER: "Leitura" };
let workspaces;
let invite = new URLSearchParams(location.hash.slice(1)).get("invite");
if (invite) history.replaceState(null, "", location.pathname + location.search);

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, listener, className = "secondary") {
  const element = node("button", text, "button " + className);
  element.type = "button";
  element.addEventListener("click", listener);
  return element;
}

function field(name, label, options = {}) {
  const wrapper = node("label", label, "field");
  const input = node(options.choices ? "select" : options.type === "textarea" ? "textarea" : "input");
  if (options.choices) {
    for (const [value, text] of options.choices) {
      const option = node("option", text);
      option.value = value;
      input.append(option);
    }
  } else if (input.tagName === "INPUT") {
    input.type = options.type ?? "text";
  }
  input.name = name;
  input.required = options.required !== false;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.min) input.minLength = options.min;
  if (options.max) input.maxLength = options.max;
  if (options.value !== undefined) input.value = options.value;
  wrapper.append(input);
  return wrapper;
}

function password(label = "Senha", fresh = true) {
  return field("password", label, { type: "password", autocomplete: fresh ? "new-password" : "current-password", min: fresh ? 15 : 1, max: 128 });
}

function email() {
  return field("email", "E-mail", { type: "email", autocomplete: "username", max: 254 });
}

function message(element, text = "") {
  element.textContent = text;
  element.hidden = !text;
}

async function request(path, method = "GET", payload) {
  const options = { method, signal: AbortSignal.timeout(90000) };
  if (payload !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(root + path, options);
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : undefined;
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? "O serviço está temporariamente indisponível.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function run(task) {
  message(errorLine);
  message(statusLine, "Processando…");
  try {
    await task();
    if (statusLine.textContent === "Processando…") message(statusLine);
  } catch (error) {
    if (error.status === 401 && workspaces && !invite) {
      setIdentity();
      renderAccess("login");
    }
    message(statusLine);
    message(errorLine, error.message);
  }
}

function form(fields, submitText, submit) {
  const element = node("form");
  const send = node("button", submitText, "button primary");
  send.type = "submit";
  element.append(...fields, send);
  element.addEventListener("submit", async (event) => {
    event.preventDefault();
    send.disabled = true;
    element.setAttribute("aria-busy", "true");
    try {
      await run(() => submit(Object.fromEntries(new FormData(element))));
    } finally {
      send.disabled = false;
      element.setAttribute("aria-busy", "false");
    }
  });
  return element;
}

function heading(title, subtitle) {
  const wrapper = node("div", undefined, "heading");
  const h = node("h1", title);
  h.tabIndex = -1;
  wrapper.append(node("p", "LEADPULSE INTELLIGENCE", "eyebrow"), h, node("p", subtitle));
  return wrapper;
}

function panel(title, description) {
  const card = node("article", undefined, "panel");
  card.append(node("h2", title));
  if (description) card.append(node("p", description));
  return card;
}

function display(...items) {
  screen.replaceChildren(...items);
  screen.querySelector("h1")?.focus({ preventScroll: true });
}

function actions(...items) {
  const wrapper = node("div", undefined, "actions");
  wrapper.append(...items);
  return wrapper;
}

function showSecret(title, description, value, next) {
  const card = panel(title, description);
  card.classList.add("stack");
  const wrapper = field("copy", title, { value });
  const input = wrapper.querySelector("input");
  input.readOnly = true;
  input.autocomplete = "off";
  card.append(wrapper, actions(button("Copiar", async () => {
    try {
      await navigator.clipboard.writeText(value);
      message(statusLine, "Copiado.");
    } catch {
      input.select();
      message(statusLine, "Texto selecionado para cópia.");
    }
  }), button("Continuar", next, "primary")));
  display(heading(title, "Guarde esta informação em um local seguro."), card);
}

function setIdentity(value) {
  workspaces = value;
  identityBox.hidden = !value;
  workspacesButton.hidden = !value;
  logoutButton.hidden = !value;
  identityBox.replaceChildren();
  if (value) {
    const name = node("div");
    name.append(node("strong", value.account.name), node("span", value.account.email));
    identityBox.append(node("span", value.account.name.slice(0, 2).toUpperCase(), "initials"), name);
  }
}

async function loadWorkspaces() {
  setIdentity(await request("/workspaces"));
  if (invite) renderAccess("invite");
  else renderWorkspaces();
}

function renderAccess(mode, resetToken) {
  const titles = { login: "Entrar", register: "Cadastrar agência", recovery: "Recuperar acesso", reset: "Criar nova senha", invite: "Aceitar convite" };
  const card = panel(titles[mode], mode === "invite"
    ? (workspaces ? "Confirme o convite para a conta em uso." : "Defina sua senha para a conta convidada. Se ela já existe, entre primeiro.")
    : "Use seu acesso para trabalhar no portal.");
  if (mode === "login") {
    card.append(form([email(), password("Senha", false)], "Entrar", async (data) => {
      await request("/auth/login", "POST", data);
      await loadWorkspaces();
    }));
  }
  if (mode === "register") {
    card.append(form([field("agency", "Nome da agência", { min: 2, max: 100 }), field("name", "Seu nome", { min: 2, max: 100 }), email(), password("Senha · pelo menos 15 caracteres")], "Cadastrar agência", async (data) => {
      const { recoveryCode } = await request("/auth/register", "POST", data);
      showSecret("Código de recuperação", "Ele aparece uma vez. Você precisará deste código se esquecer a senha.", recoveryCode, () => run(loadWorkspaces));
    }));
  }
  if (mode === "recovery") {
    card.append(form([email(), field("recoveryCode", "Código salvo no cadastro", { min: 64, max: 64, autocomplete: "off" })], "Validar código", async (data) => {
      const { resetToken: temporary } = await request("/auth/recovery", "POST", data);
      renderAccess("reset", temporary);
    }));
  }
  if (mode === "reset") {
    card.append(form([password("Nova senha · pelo menos 15 caracteres")], "Salvar nova senha", async (data) => {
      const { recoveryCode } = await request("/auth/reset", "POST", { token: resetToken, ...data });
      setIdentity();
      showSecret("Novo código de recuperação", "Este código substitui o anterior. As sessões anteriores foram encerradas.", recoveryCode, () => renderAccess("login"));
    }));
  }
  if (mode === "invite") {
    const fields = workspaces ? [] : [field("name", "Seu nome", { min: 2, max: 100 }), password("Senha · pelo menos 15 caracteres")];
    card.append(form(fields, "Aceitar convite", async (data) => {
      const { recoveryCode } = await request("/auth/accept", "POST", { token: invite, ...data });
      invite = null;
      if (recoveryCode) {
        showSecret("Código de recuperação", "Guarde o código para recuperar seu acesso.", recoveryCode, () => run(loadWorkspaces));
      } else await loadWorkspaces();
    }));
  }
  if (!workspaces) {
    const links = [];
    if (mode !== "login") links.push(button("Entrar", () => renderAccess("login")));
    if (mode !== "register" && !invite) links.push(button("Cadastrar agência", () => renderAccess("register")));
    if (mode !== "recovery") links.push(button("Recuperar acesso", () => renderAccess("recovery")));
    if (invite && mode !== "invite") links.push(button("Voltar ao convite", () => renderAccess("invite")));
    card.append(actions(...links));
  }
  const layout = node("div", undefined, "access-layout");
  const hero = node("div", undefined, "hero");
  hero.append(node("span", "PORTAL COMERCIAL", "hero-label"), node("h2", "Agências e clientes no mesmo fluxo."), node("p", "Organize empresas, acompanhe oportunidades e trabalhe com o acesso definido para cada workspace."));
  layout.append(hero, card);
  display(heading(titles[mode], "Gerencie oportunidades nos workspaces que você pode acessar."), layout);
}

function workspaceCard(name, subtitle, open, extra) {
  const wrapper = node("div", undefined, "workspace-card");
  const text = node("div");
  text.append(node("strong", name), node("p", subtitle));
  wrapper.append(text, actions(button("Abrir", open, "primary"), ...(extra ? [extra] : [])));
  return wrapper;
}

function renderWorkspaces() {
  const agencies = panel("Agências", "Administração de empresas, convites e oportunidades.");
  const clients = panel("Empresas clientes", "Acesso às empresas que convidaram você.");
  const agencyList = node("div", undefined, "workspace-list");
  const clientList = node("div", undefined, "workspace-list");
  for (const agency of workspaces.agencies) agencyList.append(workspaceCard(agency.name, roles[agency.role], () => run(() => renderAgency(agency.id))));
  for (const client of workspaces.clients) clientList.append(workspaceCard(client.name, client.agency + " · " + roles[client.role], () => run(() => renderClient(client.agencyId, client.id))));
  if (!agencyList.childElementCount) agencyList.append(node("p", "Nenhuma agência disponível.", "empty"));
  if (!clientList.childElementCount) clientList.append(node("p", "Nenhuma empresa convidou esta conta.", "empty"));
  agencies.append(agencyList);
  clients.append(clientList);
  const grid = node("div", undefined, "identity-grid");
  grid.append(agencies, clients);
  display(heading("Meus workspaces", "Escolha uma agência ou empresa cliente."), grid);
}

function agencyPath(id) { return "/agencies/" + encodeURIComponent(id); }
function clientPath(agency, client) { return agencyPath(agency) + "/clients/" + encodeURIComponent(client); }

async function renderAgency(id, editing) {
  const agency = await request(agencyPath(id));
  const clients = panel("Empresas clientes", "Consulte a carteira de clientes e abra as oportunidades autorizadas.");
  const list = node("div", undefined, "workspace-list");
  for (const client of agency.clients) {
    list.append(workspaceCard(client.name, [client.segment, client.opportunities + (client.opportunities === 1 ? " oportunidade" : " oportunidades"), client.won + (client.won === 1 ? " ganho" : " ganhos")].filter(Boolean).join(" · "),
      () => run(() => renderClient(id, client.id)), button("Editar", () => run(() => renderAgency(id, client)))));
  }
  if (!list.childElementCount) list.append(node("p", "Cadastre a primeira empresa cliente.", "empty"));
  clients.append(list);
  const editor = panel(editing ? "Editar cliente" : "Cadastrar cliente", "Identifique a empresa pelo nome e segmento.");
  editor.append(form([
    field("name", "Nome da empresa", { min: 2, max: 100, value: editing?.name }),
    field("segment", "Segmento", { required: false, max: 120, value: editing?.segment }),
  ], editing ? "Salvar cliente" : "Cadastrar cliente", async (data) => {
    await request(editing ? clientPath(id, editing.id) : agencyPath(id) + "/clients", editing ? "PATCH" : "POST", data);
    await renderAgency(id);
    message(statusLine, "Cliente salvo.");
  }));
  if (editing) editor.append(actions(button("Cancelar edição", () => run(() => renderAgency(id)))));

  const invites = panel("Convidar usuário", "Copie o link de uso único e compartilhe-o pelo canal de sua preferência. Ele vence em 48 horas.");
  invites.classList.add("stack");
  const permissions = [["EDITOR", "Cliente · pode mover e registrar resultados"], ["VIEWER", "Cliente · somente leitura"]];
  if (agency.role === "OWNER") permissions.push(["ADMIN", "Administrador da agência"]);
  const invitation = form([
    email(), field("role", "Permissão", { choices: permissions }),
    field("clientId", "Empresa cliente", { required: false, choices: [["", "Selecione"], ...agency.clients.map((client) => [client.id, client.name])] }),
  ], "Gerar convite", async (data) => {
    if (data.role === "ADMIN" || !data.clientId) delete data.clientId;
    const { token } = await request(agencyPath(id) + "/invites", "POST", data);
    const url = new URL("/intelligence/portal/", location.origin);
    url.hash = "invite=" + token;
    showSecret("Link de convite", "Envie o link somente à pessoa convidada. O portal não envia e-mail.", url.href, () => run(() => renderAgency(id)));
  });
  const permission = invitation.elements.namedItem("role");
  const company = invitation.elements.namedItem("clientId");
  permission.addEventListener("change", () => { company.disabled = permission.value === "ADMIN"; });
  invites.append(invitation);
  const sidebar = node("div");
  sidebar.append(editor, invites);
  const grid = node("div", undefined, "identity-grid");
  grid.append(clients, sidebar);
  display(heading(agency.name, "Overview da agência · " + roles[agency.role]), grid);
}

async function renderClient(agencyId, clientId) {
  const path = clientPath(agencyId, clientId);
  const client = await request(path);
  const admin = client.role === "OWNER" || client.role === "ADMIN";
  const info = panel("Client Workspace", [client.segment, roles[client.role], client.opportunities.length + " oportunidades exibidas"].filter(Boolean).join(" · "));
  if (admin) {
    info.append(actions(button("Voltar à agência", () => run(() => renderAgency(agencyId)))));
    const add = node("details");
    add.append(node("summary", "Cadastrar oportunidade"), form([
      field("name", "Nome do lead", { min: 2, max: 100 }), field("company", "Empresa do lead", { min: 2, max: 100 }),
      field("role", "Cargo", { required: false, max: 100 }),
      field("email", "E-mail", { type: "email", required: false, max: 254 }),
      field("message", "Contexto comercial", { type: "textarea", min: 8, max: 1200 }),
    ], "Cadastrar e analisar", async (data) => {
      await request(path + "/opportunities", "POST", data);
      await renderClient(agencyId, clientId);
      message(statusLine, "Oportunidade cadastrada.");
    }));
    info.append(add);
  }
  const board = node("div", undefined, "board");
  for (const [stage, label] of Object.entries(stageLabels)) {
    const column = node("section", undefined, "column");
    const opportunities = client.opportunities.filter((lead) => lead.stage === stage);
    const title = node("header");
    title.append(node("h2", label), node("span", opportunities.length, "badge blue"));
    column.append(title);
    if (!opportunities.length) column.append(node("p", "Sem oportunidades", "empty"));
    for (const lead of opportunities) {
      const card = node("article", undefined, "pipeline-card");
      const { qualification, evidence } = lead.analysis;
      card.append(node("strong", lead.name), node("small", lead.company), node("span", "Score " + qualification.score, "badge blue"));
      const details = node("details");
      details.append(node("summary", "Análise disponível"), node("p", "Qualificação heurística"), node("p", qualification.reasoning));
      const signals = node("ul");
      for (const signal of evidence) signals.append(node("li", signal.label + " (" + signal.impact + " pts)"));
      details.append(signals, node("p", qualification.recommended_next_step));
      card.append(details);
      if (client.role !== "VIEWER") {
        card.append(form([
          field("stage", "Etapa", { choices: Object.entries(stageLabels), value: lead.stage }),
          field("outcome", "Resultado comercial", { type: "textarea", max: 1000, required: false, value: lead.outcome }),
        ], "Salvar oportunidade", async (data) => {
          await request(path + "/opportunities/" + encodeURIComponent(lead.id), "PATCH", data);
          await renderClient(agencyId, clientId);
          message(statusLine, "Oportunidade atualizada.");
        }));
      } else if (lead.outcome) {
        card.append(node("p", "Resultado · " + lead.outcome));
      }
      column.append(card);
    }
    board.append(column);
  }
  const section = node("section", undefined, "stack");
  section.append(heading("Smart Pipeline", "Consulte análises e acompanhe o resultado das oportunidades."), board);
  display(heading(client.name, "Portal da empresa cliente"), info, section);
}

workspacesButton.addEventListener("click", () => run(loadWorkspaces));
logoutButton.addEventListener("click", () => run(async () => {
  await request("/auth/logout", "POST", {});
  setIdentity();
  renderAccess(invite ? "invite" : "login");
  message(statusLine, "Sessão encerrada.");
}));

run(async () => {
  try {
    await loadWorkspaces();
  } catch (error) {
    if (error.status !== 401) throw error;
    renderAccess(invite ? "invite" : "login");
  }
});
