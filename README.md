# LeadPulse AI — Full-Stack Platform & Cognitive Lead Qualifier

> Plataforma B2B de Inteligência Comercial e Qualificação Autônoma de Leads Inbound via IA.

---

## 🏗️ Visão Geral da Arquitetura

O **LeadPulse AI** foi desenvolvido com foco em custo zero na validação, alta escalabilidade e isolamento multi-tenant seguro. Integra um motor cognitivo baseado no **Google Gemini 2.5 Flash**, banco de dados no Edge via **Turso DB (LibSQL)** e uma **Landing Page B2B interativa** com sandbox funcional em tempo real.

### Stack Tecnológica
* **Frontend:** HTML5 Semântico, CSS3 Moderno (Dark Theme), Vanilla JavaScript com polling reativo.
* **Backend:** Node.js v20+ / v24, Express.js 4.22+ em TypeScript (`NodeNext`).
* **Banco de Dados:** Turso DB (SQLite no Edge / LibSQL local).
* **Motor Cognitivo (IA):** Google Gemini 2.5 Flash (`@google/genai` v3.0) com fallback heurístico.
* **Segurança:** Helmet, CORS, Argon2, JWT com segredos criptográficos de 64 caracteres.
* **Deploy Cloud:** Render (Web Service Node.js / Docker) e Turso Cloud.

---

## 📁 Estrutura do Projeto

```text
leadpulse-ai/
├── db/
│   ├── schema.sql                 # DDL completo das tabelas Turso/LibSQL
│   └── migrate.ts                 # Script de migração com seed de tenant demo
├── dist/                          # Código compilado em JavaScript para produção
├── public/                        # Landing Page B2B e Assets Estáticos
│   ├── assets/
│   │   ├── logo.svg               # Logo oficial vetorial (Funil + Pulso + Nós de IA)
│   │   ├── logo.png               # Logo rasterizada
│   │   ├── icon.svg               # Ícone vetorial quadrado
│   │   └── brand-guide.json       # Diretrizes e cores oficiais da marca
│   ├── favicon.ico                # Favicon padrão
│   ├── index.html                 # Landing Page B2B corporativa
│   ├── style.css                  # Folha de estilos Dark Theme (#0F172A)
│   └── app.js                     # Controlador do Sandbox com integração à API
├── src/
│   ├── config/
│   │   ├── database.ts            # Conexão e pooling Turso LibSQL
│   │   └── env.ts                 # Validação de variáveis de ambiente com Zod
│   ├── controllers/
│   │   └── webhook.controller.ts  # Ingestão e consulta de status do lead
│   ├── middlewares/
│   │   ├── auth.middleware.ts     # Validação multi-tenant via X-API-Key
│   │   ├── error.middleware.ts    # Handler global de exceções
│   │   └── validate.middleware.ts # Validação de payloads com Zod
│   ├── repositories/
│   │   ├── lead.repository.ts     # Acesso a dados de leads
│   │   ├── qualification.repository.ts # Acesso aos relatórios cognitivos
│   │   └── tenant.repository.ts   # Acesso a tenants e chaves de API
│   ├── routes/
│   │   ├── index.ts               # Agrupamento de rotas e metadados /brand
│   │   └── webhook.routes.ts      # Endpoints /ingest e /leads/:id
│   ├── schemas/
│   │   └── webhook.schema.ts      # Schema Zod para leads brutos
│   ├── services/
│   │   ├── ai.service.ts          # Orquestrador Gemini 2.5 Flash
│   │   └── webhook.service.ts     # Ingestão e disparo em background
│   ├── types/
│   │   └── index.ts               # Tipagens TypeScript compartilhadas
│   ├── utils/
│   │   └── errors.ts              # Hierarquia de erros HTTP (AppError)
│   ├── app.ts                     # Configuração Express, static files e rotas
│   └── server.ts                  # Bootstrap, auto-migração e graceful shutdown
├── Dockerfile                     # Imagem de produção multi-stage Node.js 20
├── render.yaml                    # Blueprint de infraestrutura para o Render
├── test-ingest.ts                 # Script de validação de ponta a ponta (E2E)
├── .dockerignore
├── .env                           # Configurações com segredos criptográficos
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## 🌐 Endpoints e Rotas Disponíveis

| Método | Endpoint | Acesso | Descrição |
| :--- | :--- | :---: | :--- |
| `GET` | `/` | Público | **Landing Page B2B** com Sandbox Interativo de IA |
| `GET` | `/health` | Público | Checagem de integridade da API e do banco Turso |
| `GET` | `/api/v1/brand` | Público | Metadados oficiais de Branding e Cores |
| `GET` | `/assets/logo.svg` | Público | Logo Oficial Vetorial |
| `POST` | `/api/v1/webhooks/ingest` | `X-API-Key` | Recebe dados brutos de leads e dispara a IA |
| `GET` | `/api/v1/webhooks/leads/:id` | `X-API-Key` | Retorna o status e relatório cognitivo do lead |

---

## 🚀 Execução Local

```bash
# Iniciar o servidor em modo de desenvolvimento (watch mode)
npm run dev

# Ou compilar e rodar a versão de produção
npm run build
npm start
```

Acesse no navegador: **[http://localhost:3000](http://localhost:3000)**

---

## ☁️ Deploy no Render (Via GitHub)

1. Crie o repositório na organização `leadpulse-ai` no GitHub.
2. No terminal do projeto, execute:
   ```bash
   git init
   git add .
   git commit -m "feat: complete LeadPulse AI platform with B2B landing page"
   git branch -M main
   git remote add origin https://github.com/leadpulse-ai/leadpulse-ai.git
   git push -u origin main
   ```
3. No painel do **Render.com**:
   - Clique em **New** > **Blueprint**.
   - Conecte o repositório `leadpulse-ai/leadpulse-ai`.
   - O Render lerá automaticamente o arquivo `render.yaml` e provisionará o serviço Web.
4. No painel de variáveis de ambiente do Render, configure:
   - `TURSO_DATABASE_URL`: `libsql://leadpulse-production-...turso.io`
   - `TURSO_AUTH_TOKEN`: `seu_token_do_turso`
   - `GEMINI_API_KEY`: `sua_chave_do_google_gemini`
