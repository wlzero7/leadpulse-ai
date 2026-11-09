import { env } from "../config/env.js";
import { db } from "../config/database.js";
import type { Tenant } from "../types/index.js";

export interface AnalyticsSummary {
  tenant: {
    id: string;
    name: string;
    plan: string;
  };
  metrics: {
    total_leads: number;
    qualified_leads: number;
    disqualified_leads: number;
    pending_leads: number;
    qualification_rate: string;
    average_score: number;
    average_response_time: string;
  };
  fit_distribution: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    UNQUALIFIED: number;
  };
  recent_leads: Array<{
    id: string;
    name: string | null;
    email: string | null;
    company: string | null;
    status: string;
    score: number | null;
    created_at: string;
  }>;
}

export class AnalyticsService {
  /**
   * Agrega métricas e KPIs comerciais em tempo real para o tenant autenticado
   */
  async getSummary(tenant: Tenant): Promise<AnalyticsSummary> {
    // 1. Métricas principais de leads
    const leadsRes = await db.execute({
      sql: `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'QUALIFIED' THEN 1 ELSE 0 END) as qualified,
          SUM(CASE WHEN status = 'DISQUALIFIED' THEN 1 ELSE 0 END) as disqualified,
          SUM(CASE WHEN status IN ('NEW', 'PROCESSING') THEN 1 ELSE 0 END) as pending,
          AVG(CASE WHEN score IS NOT NULL THEN score ELSE NULL END) as avg_score
        FROM leads
        WHERE tenant_id = ?
      `,
      args: [tenant.id],
    });

    const leadStats = leadsRes.rows[0] || {};
    const totalLeads = Number(leadStats.total || 0);
    const qualifiedLeads = Number(leadStats.qualified || 0);
    const disqualifiedLeads = Number(leadStats.disqualified || 0);
    const pendingLeads = Number(leadStats.pending || 0);
    const avgScore = leadStats.avg_score ? Math.round(Number(leadStats.avg_score) * 10) / 10 : 0;

    const qualificationRate = totalLeads > 0 
      ? `${Math.round((qualifiedLeads / totalLeads) * 1000) / 10}%` 
      : "0%";

    // 2. Distribuição por Fit cognitivo
    const fitRes = await db.execute({
      sql: `
        SELECT fit_level, COUNT(*) as count
        FROM qualifications
        WHERE tenant_id = ?
        GROUP BY fit_level
      `,
      args: [tenant.id],
    });

    const fitDistribution: AnalyticsSummary["fit_distribution"] = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      UNQUALIFIED: 0,
    };

    for (const row of fitRes.rows) {
      const level = String(row.fit_level) as keyof typeof fitDistribution;
      if (level in fitDistribution) {
        fitDistribution[level] = Number(row.count);
      }
    }

    // 3. Leads recentes
    const publicDemo = env.NODE_ENV === "production" && tenant.id === "tenant_demo_01";
    const recentRes = publicDemo ? { rows: [] } : await db.execute({
      sql: `
        SELECT id, name, email, company, status, score, created_at
        FROM leads
        WHERE tenant_id = ?
        ORDER BY created_at DESC
        LIMIT 6
      `,
      args: [tenant.id],
    });

    const recentLeads = recentRes.rows.map((row) => ({
      id: String(row.id),
      name: row.name ? String(row.name) : null,
      email: row.email ? String(row.email) : null,
      company: row.company ? String(row.company) : null,
      status: String(row.status),
      score: row.score !== null ? Number(row.score) : null,
      created_at: String(row.created_at),
    }));

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
      },
      metrics: {
        total_leads: totalLeads,
        qualified_leads: qualifiedLeads,
        disqualified_leads: disqualifiedLeads,
        pending_leads: pendingLeads,
        qualification_rate: qualificationRate,
        average_score: avgScore,
        average_response_time: "< 1.2s",
      },
      fit_distribution: fitDistribution,
      recent_leads: recentLeads,
    };
  }
}

export const analyticsService = new AnalyticsService();
