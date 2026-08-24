import { mesajEroareAI } from "@/lib/ai-error";
import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { listOrgAgents, orgAIFeatures, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Briefingul AI al firmei — pentru manager/patron: TOT ce mișcă în firmă,
 * comprimat în 5 fraze + 3 acțiuni, generat din datele reale la apăsarea
 * unui buton.
 */

const BRIEFING_SYSTEM = `Ești consultantul-șef al unei firme de distribuție FMCG/tutun din România. Primești situația completă a firmei (vânzări per agent cu evoluția pe 6 luni, vizite, comenzi, targeturi cu proiecția de sfârșit de lună, clienți scadenți, restanțe). Scrie BRIEFINGUL PATRONULUI în markdown, română, dur pe cifre:

## Situația
Exact 5 fraze: ce merge, ce scade, vedeta echipei, cel mai mare risc, cea mai mare oportunitate. Fiecare cu cifre concrete.

## Prognoza lunii
Pe baza ritmului actual (proiecțiile din date) și a evoluției pe 6 luni: cine își FACE targetul, cine îl RATEAZĂ și cu cât, încotro merge firma luna asta. Numește agenții.

## Cu cine lucrezi săptămâna asta
Agentul care are cea mai mare nevoie de atenția managerului (rămas în urmă / în scădere) + exact ce faci cu el (vizită comună, coaching pe un brand, realocare de zonă).

## 3 acțiuni pentru săptămâna asta
Exact 3, fiecare cu numele agentului/clientului vizat și un pas concret măsurabil. Fără generalități.`;

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const rl = rateLimit(`agentie-briefing:${clientIP(req)}`, {
    max: 6,
    windowMs: 60_000,
  });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  if (!isAIEnabled()) {
    return Response.json({ error: "AI neconfigurat" }, { status: 503 });
  }
  const feats = await orgAIFeatures(auth.session.orgId);
  if (!feats.aiInsights) {
    return Response.json(
      { error: "Briefingul AI e inclus de la planul Pro.", upsell: true },
      { status: 403 },
    );
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    // Izolare pe firmă: doar fișierele urcate de firma asta sau de agenții ei.
    const ownerIds = ["org:" + auth.session.orgId, ...agents.map((a) => a.agentId)];
    const ids = agents.map((a) => a.agentId);
    const names = agents.map((a) => a.name);
    const month = new Date().toISOString().slice(0, 7);

    const salesByAgent = await db<
      Array<{ agent: string; value: string; volume: string; clienti: string }>
    >`
      SELECT r->>'agent' AS agent,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume,
             COUNT(DISTINCT r->>'client')::text AS clienti
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE b.agent_id = ANY(${ownerIds})
        AND r->>'agent' = ANY(${names.length ? names : [""]})
        AND (r->>'date') LIKE ${month + "%"}
      GROUP BY 1
    `;
    const visitsByAgent = await db<
      Array<{ agent_name: string; sapt: string; conversii: string }>
    >`
      SELECT agent_name,
             COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()))::text AS sapt,
             COUNT(*) FILTER (WHERE result = 'client'
               AND visited_at >= NOW() - INTERVAL '30 days')::text AS conversii
      FROM visits WHERE agent_id = ANY(${ids.length ? ids : [""]})
      GROUP BY 1
    `;
    const targets = await db<Array<{ agent_name: string; target_value: number }>>`
      SELECT agent_name, target_value FROM targets
      WHERE org_id = ${auth.session.orgId} AND month = ${month}
    `;
    const [dueRestante] = await db<[{ scadenti: string; restante: string }]>`
      SELECT
        (SELECT COUNT(*) FROM (
          SELECT p.cui FROM prospects p LEFT JOIN visits v ON v.cui = p.cui
          WHERE p.status = 'client' AND p.assigned_agent = ANY(${names.length ? names : [""]})
          GROUP BY p.cui
          HAVING MAX(v.visited_at) IS NULL OR MAX(v.visited_at) < NOW() - INTERVAL '7 days'
        ) t)::text AS scadenti,
        COALESCE((SELECT SUM(sold_cents) FROM prospects
          WHERE sold_cents > 0 AND assigned_agent = ANY(${names.length ? names : [""]})), 0)::text AS restante
    `;
    const [ordersWeek] = await db<[{ n: string; valoare: string }]>`
      SELECT COUNT(*)::text AS n, COALESCE(SUM(total_value), 0)::text AS valoare
      FROM orders WHERE agent_id = ANY(${ids.length ? ids : [""]})
        AND created_at >= date_trunc('week', NOW())
    `;

    // Evoluția pe 6 luni per agent — combustibilul prognozei.
    const since6 = new Date();
    since6.setMonth(since6.getMonth() - 5);
    const evol = await db<
      Array<{ agent: string; luna: string; value: string; volume: string }>
    >`
      SELECT r->>'agent' AS agent, substr(r->>'date', 1, 7) AS luna,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE b.agent_id = ANY(${ownerIds})
        AND r->>'agent' = ANY(${names.length ? names : [""]})
        AND (r->>'date') >= ${since6.toISOString().slice(0, 7) + "-01"}
      GROUP BY 1, 2 ORDER BY 2
    `;

    // Proiecția de sfârșit de lună: ritmul de până azi extrapolat (run-rate).
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsed = Math.max(0.05, now.getDate() / daysInMonth);

    const context = {
      luna: month,
      azi: new Date().toISOString().slice(0, 10),
      agenti: agents.map((a) => ({
        nume: a.name,
        activ: a.active,
        concediu: a.awayUntil ? `${a.awayFrom} → ${a.awayUntil}` : null,
        vanzariLunaAsta: (() => {
          const s = salesByAgent.find((x) => x.agent === a.name);
          return s
            ? {
                valoare: Math.round(parseFloat(s.value)),
                volum: Math.round(parseFloat(s.volume)),
                clienti: parseInt(s.clienti, 10),
              }
            : null;
        })(),
        target: targets.find((t) => t.agent_name === a.name)?.target_value ?? null,
        // Prognoza: pe ritmul de până azi, unde ajunge la sfârșitul lunii.
        prognozaSfarsitLuna: (() => {
          const s = salesByAgent.find((x) => x.agent === a.name);
          if (!s) return null;
          const realized =
            parseFloat(s.value) > 0 ? parseFloat(s.value) : parseFloat(s.volume);
          return Math.round(realized / elapsed);
        })(),
        evolutie6Luni: evol
          .filter((e) => e.agent === a.name)
          .map((e) => ({
            luna: e.luna,
            total: Math.round(
              parseFloat(e.value) > 0 ? parseFloat(e.value) : parseFloat(e.volume),
            ),
          })),
        viziteSaptamanaAsta: parseInt(
          visitsByAgent.find((v) => v.agent_name === a.name)?.sapt ?? "0",
          10,
        ),
        conversii30Zile: parseInt(
          visitsByAgent.find((v) => v.agent_name === a.name)?.conversii ?? "0",
          10,
        ),
      })),
      clientiScadenti: parseInt(dueRestante.scadenti, 10),
      restanteTotaleRON: Math.round(parseInt(dueRestante.restante, 10) / 100),
      comenziSaptamanaAsta: {
        numar: parseInt(ordersWeek.n, 10),
        valoareRON: Math.round(parseFloat(ordersWeek.valoare)),
      },
    };

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          void (await import("@/modules/platform")).recordAiUsage({ kind: "briefing", orgId: auth.session.orgId });
          await streamCompletion(
            {
              system: BRIEFING_SYSTEM,
              messages: [
                {
                  role: "user",
                  content: `Situația firmei:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
                },
              ],
              maxTokens: 1200,
              onText: (t) => controller.enqueue(encoder.encode(t)),
            },
            "analiza",
          );
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              mesajEroareAI(e),
            ),
          );
          controller.close();
        }
      },
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[agentie briefing]", e);
    return Response.json({ error: "Eroare la briefing" }, { status: 500 });
  }
}
