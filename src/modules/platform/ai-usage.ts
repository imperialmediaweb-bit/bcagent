import { getDB } from "@/lib/db";
import { ensurePlatformSchema } from "./schema";

function db() {
  const d = getDB();
  if (!d) throw new Error("DATABASE_URL lipsește");
  return d;
}

/**
 * CONTORUL DE CONSUM AI. Fiecare apel AI lasă o urmă cu un cost estimat,
 * ca adminul să vadă cât îl costă o firmă și să nu vândă în pierdere.
 *
 * Costurile sunt ESTIMĂRI (bani, adică sutimi de leu), calibrate pe
 * modelele folosite azi — nu factura reală a furnizorului, ci un semnal
 * bun de ordin de mărime. Se ajustează dintr-un singur loc, aici.
 */
export type AiKind =
  | "ocr" // poză la factură (Gemini vision)
  | "analiza" // insights / vânzări (OpenAI)
  | "briefing" // briefingul firmei
  | "client_voice" // vocea clientului (note vizite)
  | "coach" // antrenorul (Claude)
  | "chat" // chat agent
  | "brief_client" // fișa unui client
  | "issue"; // triaj problemă

/** Cost estimat per apel, în BANI (1 leu = 100 bani). */
const COST_BANI: Record<AiKind, number> = {
  ocr: 1, // ~0,01 lei
  analiza: 10, // ~0,10 lei
  briefing: 12,
  client_voice: 12,
  coach: 15,
  chat: 6,
  brief_client: 8,
  issue: 3,
};

/**
 * Înregistrează un apel AI. FIRE-AND-FORGET: dacă pică, apelul AI care l-a
 * declanșat NU se strică. Dacă avem doar agentId, aflăm firma din el.
 */
export async function recordAiUsage(opts: {
  kind: AiKind;
  orgId?: string | null;
  agentId?: string | null;
  costBani?: number;
}): Promise<void> {
  try {
    await ensurePlatformSchema();
    let orgId = opts.orgId ?? null;
    const agentId = opts.agentId ?? null;
    if (!orgId && agentId) {
      const rows = await db()<Array<{ org_id: string }>>`
        SELECT org_id FROM org_agents WHERE agent_id = ${agentId} LIMIT 1
      `;
      orgId = rows[0]?.org_id ?? null;
    }
    const cost = opts.costBani ?? COST_BANI[opts.kind] ?? 0;
    await db()`
      INSERT INTO ai_usage (org_id, agent_id, kind, cost_bani)
      VALUES (${orgId}, ${agentId}, ${opts.kind}, ${cost})
    `;
  } catch (e) {
    console.error("[ai-usage] nu am putut înregistra consumul:", e);
  }
}

export interface AiUsageSummary {
  days: number;
  totalCalls: number;
  totalBani: number;
  byKind: Array<{ kind: string; calls: number; bani: number }>;
}

/** Consumul unei firme pe ultimele `days` zile, defalcat pe tip. */
export async function aiUsageForOrg(
  orgId: string,
  days = 30,
): Promise<AiUsageSummary> {
  await ensurePlatformSchema();
  const d = Math.min(365, Math.max(1, Math.floor(days) || 30));
  const rows = await db()<
    Array<{ kind: string; calls: string; bani: string }>
  >`
    SELECT kind, COUNT(*)::text AS calls, COALESCE(SUM(cost_bani),0)::text AS bani
    FROM ai_usage
    WHERE org_id = ${orgId}
      AND created_at > NOW() - (${d} || ' days')::interval
    GROUP BY kind
    ORDER BY SUM(cost_bani) DESC
  `;
  const byKind = rows.map((r) => ({
    kind: r.kind,
    calls: parseInt(r.calls, 10),
    bani: parseInt(r.bani, 10),
  }));
  return {
    days: d,
    totalCalls: byKind.reduce((s, k) => s + k.calls, 0),
    totalBani: byKind.reduce((s, k) => s + k.bani, 0),
    byKind,
  };
}
