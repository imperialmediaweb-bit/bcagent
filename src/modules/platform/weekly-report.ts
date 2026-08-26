import { getDB } from "@/lib/db";
import { alAgentiei } from "@/lib/org-scope";
import { listOrgAgents } from "./repo";
import { isAIEnabled, streamCompletion } from "@/lib/llm";

/**
 * Raportul săptămânal al firmei: cifrele săptămânii per agent + totaluri,
 * refolosit de pagina /agentie/raport, de emailul de luni dimineața (cron)
 * și de butonul „trimite-mi pe email".
 */

export interface WeeklyAgentRow {
  name: string;
  visitsThisWeek: number;
  visitsLastWeek: number;
  conversions: number;
  ordersCount: number;
  ordersValue: number;
  targetPct: number | null;
}

export interface WeeklyReport {
  orgName: string;
  periodLabel: string;
  agents: WeeklyAgentRow[];
  totals: {
    visits: number;
    visitsLastWeek: number;
    conversions: number;
    ordersCount: number;
    ordersValue: number;
    dueClients: number;
    restanteRON: number;
  };
  aiBriefing: string;
}

const fmt = (n: number) => new Intl.NumberFormat("ro-RO").format(Math.round(n));

export async function buildWeeklyReport(
  orgId: string,
  orgName: string,
  withAI = true,
): Promise<WeeklyReport> {
  const db = getDB();
  if (!db) throw new Error("DATABASE_URL lipsește");
  const agents = await listOrgAgents(orgId);
  const ids = agents.map((a) => a.agentId);
  const names = agents.map((a) => a.name);
  const month = new Date().toISOString().slice(0, 7);

  const visitRows = await db<
    Array<{ agent_id: string; sapt: string; trecuta: string; conversii: string }>
  >`
    SELECT agent_id,
      COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()))::text AS sapt,
      COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()) - INTERVAL '7 days'
        AND visited_at < date_trunc('week', NOW()))::text AS trecuta,
      COUNT(*) FILTER (WHERE result = 'client'
        AND visited_at >= date_trunc('week', NOW()))::text AS conversii
    FROM visits WHERE agent_id = ANY(${ids.length ? ids : [""]})
    GROUP BY agent_id
  `;
  const orderRows = await db<
    Array<{ agent_id: string; n: string; valoare: string }>
  >`
    SELECT agent_id, COUNT(*)::text AS n,
           COALESCE(SUM(total_value), 0)::text AS valoare
    FROM orders WHERE agent_id = ANY(${ids.length ? ids : [""]})
      AND created_at >= date_trunc('week', NOW())
    GROUP BY agent_id
  `;
  const targets = await db<Array<{ agent_name: string; target_value: number }>>`
    SELECT agent_name, target_value FROM targets
    WHERE org_id = ${orgId} AND month = ${month}
  `;
  const sales = await db<Array<{ agent: string; value: string; volume: string }>>`
    SELECT r->>'agent' AS agent,
           COALESCE(SUM((r->>'value')::float), 0)::text AS value,
           COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
    FROM batches b, jsonb_array_elements(b.rows) r
    WHERE b.agent_id = ANY(${["org:" + orgId, ...ids]})
      AND (r->>'date') LIKE ${month + "%"}
      AND r->>'agent' = ANY(${names.length ? names : [""]})
    GROUP BY 1
  `;
  const [extra] = await db<[{ scadenti: string; restante: string }]>`
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT p.cui FROM prospects p LEFT JOIN visits v ON v.cui = p.cui
        WHERE p.status = 'client'
          AND ${alAgentiei(db, orgId, names)}
        GROUP BY p.cui
        HAVING MAX(v.visited_at) IS NULL
            OR MAX(v.visited_at) < NOW() - INTERVAL '7 days'
      ) t)::text AS scadenti,
      COALESCE((SELECT SUM(sold_cents) FROM prospects
        WHERE sold_cents > 0
          AND ${alAgentiei(db, orgId, names)}), 0)::text AS restante
  `;

  const rows: WeeklyAgentRow[] = agents
    .filter((a) => a.active)
    .map((a) => {
      const v = visitRows.find((x) => x.agent_id === a.agentId);
      const o = orderRows.find((x) => x.agent_id === a.agentId);
      const t = targets.find((x) => x.agent_name === a.name)?.target_value ?? 0;
      const s = sales.find((x) => x.agent === a.name);
      const realized = s
        ? parseFloat(s.value) > 0
          ? parseFloat(s.value)
          : parseFloat(s.volume)
        : 0;
      return {
        name: a.name,
        visitsThisWeek: parseInt(v?.sapt ?? "0", 10),
        visitsLastWeek: parseInt(v?.trecuta ?? "0", 10),
        conversions: parseInt(v?.conversii ?? "0", 10),
        ordersCount: parseInt(o?.n ?? "0", 10),
        ordersValue: Math.round(parseFloat(o?.valoare ?? "0")),
        targetPct: t > 0 ? Math.round((realized / t) * 100) : null,
      };
    })
    .sort((x, y) => y.visitsThisWeek - x.visitsThisWeek);

  const totals = {
    visits: rows.reduce((s, r) => s + r.visitsThisWeek, 0),
    visitsLastWeek: rows.reduce((s, r) => s + r.visitsLastWeek, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
    ordersCount: rows.reduce((s, r) => s + r.ordersCount, 0),
    ordersValue: rows.reduce((s, r) => s + r.ordersValue, 0),
    dueClients: parseInt(extra.scadenti, 10),
    restanteRON: Math.round(parseInt(extra.restante, 10) / 100),
  };

  let aiBriefing = "";
  if (withAI && isAIEnabled()) {
    try {
      let acc = "";
      await streamCompletion(
        {
          system:
            "Ești consultantul firmei de distribuție. Primești cifrele săptămânii. Scrie 4-5 fraze în română, dur pe cifre: ce a mers, ce a scăzut, cine e vedeta, cel mai mare risc, plus O acțiune concretă pentru săptămâna viitoare. Fără titluri, doar text curgător.",
          messages: [
            {
              role: "user",
              content: JSON.stringify({ agenti: rows, totaluri: totals }),
            },
          ],
          maxTokens: 400,
          onText: (t) => {
            acc += t;
          },
        },
        "analiza",
      );
      aiBriefing = acc.trim();
    } catch {
      // fără AI raportul rămâne pe cifre
    }
  }

  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return {
    orgName,
    periodLabel: `săptămâna din ${monday.toLocaleDateString("ro-RO")}`,
    agents: rows,
    totals,
    aiBriefing,
  };
}

/** HTML de email — inline styles, compatibil cu orice client de mail. */
export function renderReportHTML(r: WeeklyReport): string {
  const row = (cells: string[], bold = false) =>
    `<tr>${cells
      .map(
        (c, i) =>
          `<td style="padding:8px 10px;border-bottom:1px solid #eee;${i > 0 ? "text-align:right;" : ""}${bold ? "font-weight:700;" : ""}">${c}</td>`,
      )
      .join("")}</tr>`;
  return `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#161412">
  <div style="background:#161412;color:#ffd23f;padding:16px 20px;border-radius:12px 12px 0 0">
    <strong style="font-size:18px">PROVENDI</strong>
    <span style="color:#f5efe4;float:right">${r.periodLabel}</span>
  </div>
  <div style="border:2px solid #161412;border-top:none;border-radius:0 0 12px 12px;padding:20px">
    <h2 style="margin:0 0 4px">${r.orgName} — raportul săptămânii</h2>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      ${row(["", "Vizite", "Săpt. trecută", "Clienți noi", "Comenzi", "Target"], true)}
      ${r.agents
        .map((a) =>
          row([
            a.name,
            String(a.visitsThisWeek),
            String(a.visitsLastWeek),
            String(a.conversions),
            `${a.ordersCount}${a.ordersValue ? ` (${fmt(a.ordersValue)} lei)` : ""}`,
            a.targetPct !== null ? `${a.targetPct}%` : "—",
          ]),
        )
        .join("")}
      ${row(
        [
          "TOTAL",
          String(r.totals.visits),
          String(r.totals.visitsLastWeek),
          String(r.totals.conversions),
          `${r.totals.ordersCount}${r.totals.ordersValue ? ` (${fmt(r.totals.ordersValue)} lei)` : ""}`,
          "",
        ],
        true,
      )}
    </table>
    <p style="margin:14px 0 0;font-size:14px">
      ⏰ Clienți nevizitați de peste 7 zile: <strong>${r.totals.dueClients}</strong>
      &nbsp;·&nbsp; 💰 Restanțe: <strong>${fmt(r.totals.restanteRON)} lei</strong>
    </p>
    ${
      r.aiBriefing
        ? `<div style="margin-top:14px;background:#fdf3d8;border-radius:10px;padding:14px;font-size:14px;line-height:1.5"><strong>🧠 Pe scurt:</strong> ${r.aiBriefing}</div>`
        : ""
    }
    <p style="margin-top:16px;font-size:12px;color:#888">
      Trimis automat de Provendi. Detalii complete în panoul firmei.
    </p>
  </div>
</div>`;
}
