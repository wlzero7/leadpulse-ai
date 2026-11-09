import type { Request } from "express";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  api_key: string;
  plan: "FREE" | "STARTER" | "PRO" | "ENTERPRISE";
  status: "ACTIVE" | "SUSPENDED" | "CANCELLED";
  settings: string; // JSON String
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  status: "ACTIVE" | "INVITED" | "INACTIVE";
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  external_id?: string | null;
  source: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  message?: string | null;
  raw_payload: string; // JSON String
  status: "NEW" | "PROCESSING" | "QUALIFIED" | "DISQUALIFIED" | "ERROR";
  score?: number | null;
  created_at: string;
  updated_at: string;
}

export interface Qualification {
  id: string;
  tenant_id: string;
  lead_id: string;
  score: number;
  fit_level: "HIGH" | "MEDIUM" | "LOW" | "UNQUALIFIED";
  summary: string;
  reasoning: string;
  budget_detected: string;
  urgency_detected: string;
  recommended_next_step: string;
  raw_ai_response: string;
  model_used: string;
  created_at: string;
}

export interface WebhookConfig {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  secret?: string | null;
  events: string; // JSON String array
  is_active: number;
  headers: string; // JSON String object
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedRequest extends Request {
  tenant?: Tenant;
}
