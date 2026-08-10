import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { rateLimit } from "@/lib/rate-limit";
import { listOrgAgents, orgAIFeatures, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * VOCEA CLIENTULUI — analiză AI a notelor de vizită.
 *
 * Agentul dictează la fiecare client ce a zis acesta (voce → text). Notele
 * astea, adunate, ascund ce vrea de fapt piața. Endpointul citește notele
 * reale și scoate din ele: ce cer clienții, de ce se plâng, ce oportunități
 * și ce urgențe există — date valabile pentru toată firma (manager +
 * administrator văd la fel, filtrabil pe agent).
 */

const SYSTEM = `Ești analistul comercial al unei firme de distribuție din România. Primești NOTELE reale scrise/dictate de agenți la vizitele lor (ce a zis fiecare client). Sintetizează-le în markdown, română, doar pe baza a ce scrie în note — NU inventa. Dacă notele sunt puține sau goale, spune sincer că nu sunt destule date.

## Ce cer clienții
Cele mai frecvente cereri/produse pomenite (cu de câte ori apar și la ce clienți, dacă se poate).

## De ce se plâng / obiecții
Reclamațiile și obiecțiile repetate (preț, livrare, stoc, concurență). Concret.

## Oportunități
Clienți gata să cumpere mai mult, care cer ceva ce am putea aduce, sau semnale de creștere. Numește clientul.

## De sunat/vizitat repede
Clienți cu ceva urgent din note (nemulțumire, „ne sună", promisiune de comandă). Listă scurtă, cu numele.

Fii scurt și practic. Fără generalități — doar ce reiese din note.`;

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  // Limita pe FIRMĂ, nu pe IP: managerul și adminii dintr-un birou ies pe
  // același IP (NAT) — pe IP și-ar mânca bugetul unul altuia.
  const rl = rateLimit(`client-voice:${auth.session.orgId}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  if (!isAIEnabled()) {
    return Response.json(
      { error: "AI-ul nu e configurat pe platformă." },
      { status: 503 },
    );
  }
  const feats = await orgAIFeatures(auth.session.orgId);
  if (!feats.aiInsights) {
    return Response.json(
      { error: "Planul firmei tale nu include analizele AI." },
      { status: 402 },
    );
  }

  let body: { agent?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  // Aceleași opțiuni ca filtrul din pagină (până la 365 = „Ultimul an").
  const days = Math.min(365, Math.max(1, Number(body.days) || 30));

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const ids = agents.map((a) => a.agentId);
    const wanted = String(body.agent ?? "");
    const scoped = wanted && ids.includes(wanted) ? [wanted] : ids;

    // DOAR vizitele cu notă — alea au „ce a zis clientul".
    const rows = await db<
      Array<{ agent_name: string; denumire: string; result: string; note: string }>
    >`
      SELECT agent_name, denumire, result, note
      FROM visits
      WHERE agent_id = ANY(${scoped.length ? scoped : [""]})
        AND visited_at >= NOW() - (${days} || ' days')::interval
        AND btrim(coalesce(note, '')) <> ''
      ORDER BY visited_at DESC
      LIMIT 400
    `;

    if (rows.length < 3) {
      return Response.json({
        ok: true,
        enough: false,
        count: rows.length,
        text:
          "Încă nu sunt destule note de la agenți ca să scot ceva relevant. Pe măsură ce agenții dictează la vizite ce zic clienții, analiza asta se umple singură.",
      });
    }

    const REZ: Record<string, string> = {
      client: "a cumpărat",
      gandeste: "se mai gândește",
      ne_suna: "ne sună el",
      nu_vrea: "nu vrea",
      inchis: "închis",
    };
    const corpus = rows
      .map(
        (r) =>
          `- [${r.agent_name} @ ${r.denumire}] (${REZ[r.result] ?? r.result}): ${r.note.slice(0, 400)}`,
      )
      .join("\n")
      .slice(0, 14000);

    let out = "";
    await streamCompletion(
      {
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Notele de vizită din ultimele ${days} de zile (${rows.length} note):\n\n${corpus}`,
          },
        ],
        maxTokens: 1200,
        onText: (t) => {
          out += t;
        },
      },
      "analiza",
    );

    void (await import("@/modules/platform")).recordAiUsage({
      kind: "client_voice",
      orgId: auth.session.orgId,
    });
    const text = out.trim();
    if (!text) {
      // AI-ul a răspuns gol (rar) — nu lăsăm butonul „mort".
      return Response.json({
        ok: true,
        enough: true,
        count: rows.length,
        text: "Nu am putut scoate ceva clar din note de data asta. Încearcă din nou sau alege o perioadă mai mare.",
      });
    }
    return Response.json({ ok: true, enough: true, count: rows.length, text });
  } catch (e) {
    console.error("[client-voice]", e);
    return Response.json({ error: "Eroare la analiza notelor" }, { status: 500 });
  }
}
