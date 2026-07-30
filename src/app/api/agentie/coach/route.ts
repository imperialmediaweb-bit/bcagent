import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { listOrgAgents, orgAIFeatures, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Evaluarea AI a unui agent, pentru manager: adună TOATE datele agentului
 * din bază (vizite, conversii, comenzi, target, clienți adormiți) și cere
 * o analiză logică: unde e bun, unde pierde, ce training îi trebuie.
 */

const EVAL_SYSTEM = `Ești consultant senior de vânzări pentru firme de distribuție FMCG/tutun din România. Managerul îți dă datele reale ale unui agent de teren. Fă o EVALUARE logică și dură dar corectă, în markdown, română:

## Verdict (2 fraze)
Cum performează agentul, pe scurt, cu cifrele-cheie.

## Punctele forte
2-3, doar din date.

## Unde pierde bani firma cu el
2-3 slăbiciuni concrete cu cifre (vizite puține? conversie slabă? target ratat? clienți adormiți ignorați? comenzi mici?). Compară cu media echipei unde ai date.

## Ce training îi trebuie
2-3 abilități de antrenat, deduse LOGIC din slăbiciuni, cu exercițiul concret pentru fiecare.

## Recomandarea pentru manager
O acțiune concretă săptămâna asta (vizită comună? realocarea unei zone? discuție de target?).

Fără generalități. Dacă datele sunt puține, spune explicit ce lipsește.`;

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const rl = rateLimit(`agentie-coach:${clientIP(req)}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  if (!isAIEnabled()) {
    return Response.json({ error: "AI neconfigurat" }, { status: 503 });
  }
  const feats = await orgAIFeatures(auth.session.orgId);
  if (!feats.aiVision) {
    return Response.json(
      {
        error:
          "Evaluările AI ale agenților sunt incluse în planul Business.",
        upsell: true,
      },
      { status: 403 },
    );
  }

  let body: { agentId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const agent = agents.find((a) => a.agentId === String(body.agentId ?? ""));
    if (!agent) {
      return Response.json({ error: "Agentul nu e din firma ta" }, { status: 403 });
    }
    const teamIds = agents.map((a) => a.agentId);
    const month = new Date().toISOString().slice(0, 7);

    const [visits] = await db<
      [{ total30: string; sapt: string; rezultate: unknown }]
    >`
      SELECT COUNT(*) FILTER (WHERE visited_at >= NOW() - INTERVAL '30 days')::text AS total30,
             COUNT(*) FILTER (WHERE visited_at >= date_trunc('week', NOW()))::text AS sapt,
             COALESCE(jsonb_object_agg(result, cnt) FILTER (WHERE result IS NOT NULL), '{}'::jsonb) AS rezultate
      FROM (
        SELECT result, visited_at, COUNT(*) OVER (PARTITION BY result) AS cnt
        FROM visits WHERE agent_id = ${agent.agentId}
          AND visited_at >= NOW() - INTERVAL '30 days'
      ) t
    `;
    const [team] = await db<[{ media30: string }]>`
      SELECT COALESCE(ROUND(COUNT(*)::numeric / NULLIF(${teamIds.length}, 0), 1), 0)::text AS media30
      FROM visits WHERE agent_id = ANY(${teamIds})
        AND visited_at >= NOW() - INTERVAL '30 days'
    `;
    const [clients] = await db<[{ clienti: string; adormiti: string }]>`
      SELECT COUNT(*) FILTER (WHERE status = 'client')::text AS clienti,
             COUNT(*) FILTER (WHERE status = 'client' AND NOT EXISTS (
               SELECT 1 FROM visits v WHERE v.cui = prospects.cui
                 AND v.visited_at >= NOW() - INTERVAL '7 days'
             ))::text AS adormiti
      FROM prospects WHERE assigned_agent = ${agent.name}
    `;
    const [orders] = await db<[{ n30: string; valoare: string }]>`
      SELECT COUNT(*)::text AS n30,
             COALESCE(SUM(total_value), 0)::text AS valoare
      FROM orders WHERE agent_id = ${agent.agentId}
        AND created_at >= NOW() - INTERVAL '30 days'
    `;
    const targetRows = await db<Array<{ target_value: number }>>`
      SELECT target_value FROM targets
      WHERE org_id = ${auth.session.orgId} AND agent_name = ${agent.name}
        AND month = ${month}
    `;
    const [sales] = await db<[{ value: string; volume: string }]>`
      SELECT COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE (r->>'date') LIKE ${month + "%"} AND r->>'agent' = ${agent.name}
    `;

    // Profilul de vânzări pe ultimele 3 luni: branduri, evoluție, top clienți
    // + comparația cu totalul echipei — miezul evaluării „din vânzări".
    const since3 = new Date();
    since3.setMonth(since3.getMonth() - 2);
    const since3Key = since3.toISOString().slice(0, 7) + "-01";
    const teamNames = agents.map((a) => a.name);
    const salesByBrand = await db<
      Array<{ brand: string; value: string; volume: string }>
    >`
      SELECT r->>'producer' AS brand,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE r->>'agent' = ${agent.name} AND (r->>'date') >= ${since3Key}
        AND COALESCE(r->>'producer', '') <> ''
      GROUP BY 1 ORDER BY 3 DESC LIMIT 10
    `;
    const salesByMonth = await db<
      Array<{ luna: string; value: string; volume: string; clienti: string }>
    >`
      SELECT substr(r->>'date', 1, 7) AS luna,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume,
             COUNT(DISTINCT r->>'client')::text AS clienti
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE r->>'agent' = ${agent.name} AND (r->>'date') >= ${since3Key}
      GROUP BY 1 ORDER BY 1
    `;
    const topClientsSales = await db<
      Array<{ client: string; value: string; volume: string }>
    >`
      SELECT r->>'client' AS client,
             COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE r->>'agent' = ${agent.name} AND (r->>'date') >= ${since3Key}
        AND COALESCE(r->>'client', '') <> ''
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 8
    `;
    const [teamSales] = await db<[{ value: string; volume: string }]>`
      SELECT COALESCE(SUM((r->>'value')::float), 0)::text AS value,
             COALESCE(SUM((r->>'volume')::float), 0)::text AS volume
      FROM batches b, jsonb_array_elements(b.rows) r
      WHERE r->>'agent' = ANY(${teamNames}) AND (r->>'date') >= ${since3Key}
    `;

    const context = {
      agent: agent.name,
      luna: month,
      concediu: agent.awayUntil ? `${agent.awayFrom} → ${agent.awayUntil}` : null,
      vizite: {
        ultimele30zile: parseInt(visits.total30, 10),
        saptamanaAsta: parseInt(visits.sapt, 10),
        mediaEchipei30zile: parseFloat(team.media30),
        rezultate: visits.rezultate,
      },
      clienti: {
        total: parseInt(clients.clienti, 10),
        nevizitatiDe7Zile: parseInt(clients.adormiti, 10),
      },
      comenzi30zile: {
        numar: parseInt(orders.n30, 10),
        valoareRON: Math.round(parseFloat(orders.valoare)),
      },
      lunaAsta: {
        target: targetRows[0]?.target_value ?? null,
        realizatValoare: Math.round(parseFloat(sales.value)),
        realizatVolum: Math.round(parseFloat(sales.volume)),
      },
      profilVanzari3Luni: {
        peBranduri: salesByBrand.map((r) => ({
          brand: r.brand,
          valoare: Math.round(parseFloat(r.value)),
          volum: Math.round(parseFloat(r.volume)),
        })),
        evolutieLunara: salesByMonth.map((r) => ({
          luna: r.luna,
          valoare: Math.round(parseFloat(r.value)),
          volum: Math.round(parseFloat(r.volume)),
          clientiUnici: parseInt(r.clienti, 10),
        })),
        topClientiiLui: topClientsSales.map((r) => ({
          client: r.client,
          valoare: Math.round(parseFloat(r.value)),
          volum: Math.round(parseFloat(r.volume)),
        })),
        totalEchipa: {
          valoare: Math.round(parseFloat(teamSales.value)),
          volum: Math.round(parseFloat(teamSales.volume)),
          numarAgenti: teamNames.length,
        },
      },
    };

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          await streamCompletion(
            {
              system: EVAL_SYSTEM,
              messages: [
                {
                  role: "user",
                  content: `Evaluează agentul pe baza datelor:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
                },
              ],
              maxTokens: 1500,
              onText: (t) => controller.enqueue(encoder.encode(t)),
            },
            "coach",
          );
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `\n\n[Eroare AI: ${e instanceof Error ? e.message : String(e)}]`,
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
    console.error("[agentie coach]", e);
    return Response.json({ error: "Eroare la evaluare" }, { status: 500 });
  }
}
