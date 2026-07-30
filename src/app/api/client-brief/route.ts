import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * FIȘA CLIENTULUI, scrisă de AI din tot ce a strâns platforma despre firma
 * aia: datele oficiale, notele agentului (inclusiv cele dictate), istoricul
 * vizitelor cu rezultate, comenzile și restanțele. Agentul o citește în 30
 * de secunde înainte să intre pe ușă.
 */

const BRIEF_SYSTEM = `Ești asistentul agenților de teren dintr-o firmă de distribuție FMCG/tutun din România. Primești TOT ce știe platforma despre o firmă-client și scrii FIȘA CLIENTULUI — scurtă, ca s-o citească agentul în mașină, înainte să intre. Markdown, română:

## Pe scurt
2 fraze: cine e, în ce relație suntem (client fidel / se gândește / a refuzat / nou), cifra-cheie.

## Ce știm despre el
Din NOTELE agentului și istoricul vizitelor — ce a zis, ce-l doare, ce s-a promis. Citează notele relevante. Astea sunt aur — nu le rata.

## Ce cumpără
Din comenzi: produse, cadență, valoare. Dacă nu există comenzi, spune.

## ⚠ Atenție
Restanțe de plată, refuzuri anterioare, perioade lungi fără vizită — orice poate strica discuția.

## Următoarea mișcare
O acțiune concretă + prima frază cu care agentul deschide discuția, legată de istoricul real.

Fără invenții: doar ce e în date. Dacă datele sunt subțiri, fișa e scurtă și onestă.`;

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`brief:${clientIP(req)}`, { max: 15, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Server not configured" }, { status: 500 });
  if (!isAIEnabled()) {
    return Response.json({ error: "AI neconfigurat" }, { status: 503 });
  }

  let body: { token?: string; cui?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body.token ? await verifyToken(body.token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const cui = String(body.cui ?? "").replace(/\D/g, "");
  if (!cui) return Response.json({ error: "cui lipsește" }, { status: 400 });

  try {
    const { agentAIFeatures } = await import("@/modules/platform");
    const feats = await agentAIFeatures(payload.agentId);
    if (!feats.aiCoach) {
      return Response.json(
        {
          error:
            "Fișele de client AI sunt incluse de la planul Pro. Cere patronului un upgrade.",
          upsell: true,
        },
        { status: 403 },
      );
    }
  } catch {
    // fără verificare de plan nu blocăm
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const firmRows = await db<
      Array<{
        denumire: string;
        adresa: string;
        localitate: string;
        judet: string;
        caen_desc: string;
        status: string;
        note: string;
        assigned_agent: string;
        telefon: string;
        contact: string;
        sold_cents: string | null;
      }>
    >`
      SELECT denumire, COALESCE(adresa,'') AS adresa, COALESCE(localitate,'') AS localitate,
             COALESCE(judet,'') AS judet, COALESCE(caen_desc,'') AS caen_desc,
             status, COALESCE(note,'') AS note, assigned_agent,
             COALESCE(telefon,'') AS telefon, COALESCE(contact,'') AS contact,
             sold_cents::text AS sold_cents
      FROM prospects WHERE cui = ${cui} LIMIT 1
    `;
    if (firmRows.length === 0) {
      return Response.json({ error: "Firma nu există în bază" }, { status: 404 });
    }
    const firm = firmRows[0];

    const visits = await db<
      Array<{ agent_name: string; result: string; note: string; visited_at: Date }>
    >`
      SELECT agent_name, result, note, visited_at FROM visits
      WHERE cui = ${cui} ORDER BY visited_at DESC LIMIT 20
    `;
    const orders = await db<
      Array<{ lines: unknown; status: string; total_value: number | null; created_at: Date }>
    >`
      SELECT lines, status, total_value, created_at FROM orders
      WHERE cui = ${cui} ORDER BY created_at DESC LIMIT 10
    `;

    const context = {
      firma: {
        denumire: firm.denumire,
        adresa: `${firm.adresa}, ${firm.localitate} (${firm.judet})`,
        activitate: firm.caen_desc,
        statusRelatie: firm.status,
        agentResponsabil: firm.assigned_agent,
        telefon: firm.telefon,
        persoanaContact: firm.contact,
        restantaRON: firm.sold_cents ? Math.round(parseInt(firm.sold_cents, 10) / 100) : 0,
        noteleAgentului: firm.note,
      },
      vizite: visits.map((v) => ({
        data: v.visited_at.toISOString().slice(0, 10),
        agent: v.agent_name,
        rezultat: v.result,
        nota: v.note,
      })),
      comenzi: orders.map((o) => ({
        data: o.created_at.toISOString().slice(0, 10),
        status: o.status,
        valoareRON: o.total_value,
        produse: o.lines,
      })),
      azi: new Date().toISOString().slice(0, 10),
      agentCurent: payload.agentName,
    };

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          await streamCompletion(
            {
              system: BRIEF_SYSTEM,
              messages: [
                {
                  role: "user",
                  content: `Fă fișa clientului:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
                },
              ],
              maxTokens: 1000,
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
    console.error("[client-brief]", e);
    return Response.json({ error: "Eroare la fișa clientului" }, { status: 500 });
  }
}
