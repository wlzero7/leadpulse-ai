-- ============================================================
-- LeadPulse AI - Database Schema (Turso / LibSQL / SQLite)
-- Multi-tenant B2B Architecture
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1. TENANTS TABLE (Clientes B2B / Contas Corporativas)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL DEFAULT 'FREE' CHECK(plan IN ('FREE', 'STARTER', 'PRO', 'ENTERPRISE')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
    settings TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- 2. USERS TABLE (Membros e Administradores do Tenant)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INVITED', 'INACTIVE')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

-- 3. WEBHOOKS_CONFIG TABLE (Webhooks de saída para Notificação/CRM)
CREATE TABLE IF NOT EXISTS webhooks_config (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT,
    events TEXT NOT NULL DEFAULT '["lead.qualified"]',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    headers TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhooks_config_tenant ON webhooks_config(tenant_id, is_active);

-- 4. LEADS TABLE (Leads brutos e processados recebidos via Ingestão)
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    external_id TEXT,
    source TEXT NOT NULL DEFAULT 'WEBHOOK',
    name TEXT,
    email TEXT,
    phone TEXT,
    company TEXT,
    role TEXT,
    message TEXT,
    raw_payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW', 'PROCESSING', 'QUALIFIED', 'DISQUALIFIED', 'ERROR')),
    score INTEGER DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_email ON leads(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON leads(tenant_id, created_at DESC);

-- 5. QUALIFICATIONS TABLE (Resultados da Análise Cognitiva por IA)
CREATE TABLE IF NOT EXISTS qualifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
    fit_level TEXT NOT NULL CHECK(fit_level IN ('HIGH', 'MEDIUM', 'LOW', 'UNQUALIFIED')),
    summary TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    budget_detected TEXT DEFAULT 'UNKNOWN',
    urgency_detected TEXT DEFAULT 'UNKNOWN',
    recommended_next_step TEXT NOT NULL,
    raw_ai_response TEXT NOT NULL,
    model_used TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qualifications_lead_id ON qualifications(lead_id);
CREATE INDEX IF NOT EXISTS idx_qualifications_tenant_id ON qualifications(tenant_id);

-- Isolated commercial demo. No relation to tenant data or API credentials.
CREATE TABLE IF NOT EXISTS intelligence_demo_leads (
    id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'NEW' CHECK(stage IN ('NEW', 'CONTACTED', 'PROPOSAL', 'WON')),
    payload TEXT NOT NULL,
    analysis TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_intelligence_demo_session ON intelligence_demo_leads(session_key, created_at DESC);

-- Authenticated workspaces. Legacy API tenants and the public demo stay separate.
CREATE TABLE IF NOT EXISTS portal_accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS portal_agencies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_agency_members (
    agency_id TEXT NOT NULL REFERENCES portal_agencies(id),
    account_id TEXT NOT NULL REFERENCES portal_accounts(id),
    role TEXT NOT NULL CHECK(role IN ('OWNER', 'ADMIN')),
    PRIMARY KEY (agency_id, account_id)
);
CREATE TABLE IF NOT EXISTS portal_clients (
    id TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES portal_agencies(id),
    name TEXT NOT NULL, segment TEXT NOT NULL DEFAULT '',
    UNIQUE (agency_id, id)
);
CREATE TABLE IF NOT EXISTS portal_client_members (
    agency_id TEXT NOT NULL, client_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES portal_accounts(id),
    role TEXT NOT NULL CHECK(role IN ('EDITOR', 'VIEWER')),
    PRIMARY KEY (agency_id, client_id, account_id),
    FOREIGN KEY (agency_id, client_id) REFERENCES portal_clients(agency_id, id)
);
CREATE TABLE IF NOT EXISTS portal_sessions (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES portal_accounts(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_invites (
    token_hash TEXT PRIMARY KEY, agency_id TEXT NOT NULL REFERENCES portal_agencies(id), client_id TEXT,
    email TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL,
    CHECK ((client_id IS NULL AND role = 'ADMIN') OR (client_id IS NOT NULL AND role IN ('EDITOR', 'VIEWER'))),
    FOREIGN KEY (agency_id, client_id) REFERENCES portal_clients(agency_id, id)
);
CREATE TABLE IF NOT EXISTS portal_resets (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES portal_accounts(id),
    recovery_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portal_opportunities (
    id TEXT PRIMARY KEY, agency_id TEXT NOT NULL, client_id TEXT NOT NULL,
    name TEXT NOT NULL, company TEXT NOT NULL, analysis TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'NEW' CHECK(stage IN ('NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST')),
    outcome TEXT NOT NULL DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agency_id, client_id) REFERENCES portal_clients(agency_id, id)
);
CREATE TABLE IF NOT EXISTS portal_rate_limits (
    scope TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_agency_account ON portal_agency_members(account_id, agency_id);
CREATE INDEX IF NOT EXISTS idx_portal_client_account ON portal_client_members(account_id, agency_id, client_id);
CREATE INDEX IF NOT EXISTS idx_portal_session_account ON portal_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_portal_reset_account ON portal_resets(account_id);
CREATE INDEX IF NOT EXISTS idx_portal_opportunity_client ON portal_opportunities(agency_id, client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_demo_retention ON intelligence_demo_leads(created_at);
