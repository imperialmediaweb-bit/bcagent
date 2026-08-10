import { verifyFieldToken } from "@/lib/agent-guard";
import { isAIEnabled, streamCompletion, SYSTEM_PROMPT } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Rate limit pe IP (anti-DOS, protejează cheia OpenAI)
  const ip = clientIP(req);
  const rl = rateLimit(`insights:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe cereri AI. Reîncearcă într-un minut." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json(
      { error: "Server not configured (TOKEN_SECRET lipsește)" },
      { status: 500 },
    );
  }
  if (!isAIEnabled()) {
    return Response.json(
      {
        error:
          "AI dezactivat — niciun provider configurat. Setează OPENAI_API_KEY sau ANTHROPIC_API_KEY.",
      },
      { status: 503 },
    );
  }

  let body: { token?: string; summary?: unknown; mode?: string };
  try {
    body = (await req.json()) as {
      token?: string;
      summary?: unknown;
      mode?: string;
    };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token || !body.summary) {
    return Response.json(
      { error: "token și summary sunt obligatorii" },
      { status: 400 },
    );
  }

  const payload = await verifyFieldToken(body.token, tokenSecret);
  if (!payload) {
    return Response.json(
      { error: "Token invalid sau expirat" },
      { status: 401 },
    );
  }

  try {
    const { agentAIFeatures } = await import("@/modules/platform");
    const feats = await agentAIFeatures(payload.agentId);
    if (!feats.aiInsights) {
      return Response.json(
        {
          error:
            "Analizele AI sunt incluse de la planul Pro. Cere patronului un upgrade.",
          upsell: true,
        },
        { status: 403 },
      );
    }
  } catch {
    // fără verificare de plan nu blocăm
  }

  const instructions =
    body.mode === "briefing"
      ? `Scrie BRIEFINGUL SĂPTĂMÂNAL pentru șeful firmei de distribuție, în markdown:

## Briefing
Exact 5 fraze scurte: ce a mers, ce a scăzut, vedeta perioadei, cel mai mare risc, cea mai mare oportunitate. Folosește cifre concrete din date (mai ales din secțiunea "smart": scoruri, alerte, clienți adormiți, oportunități de coș).

## 3 acțiuni pentru săptămâna asta
Exact 3 acțiuni concrete, fiecare cu numele agentului responsabil și clientul/brandul vizat. Fără generalități — doar lucruri care se pot face luni dimineața.`
      : `Generează o analiză concisă în format markdown (## Privire generală / ## Observații / ## Recomandări), maxim 200 cuvinte total. Dacă există secțiunea "smart" în date (scoruri, alerte, clienți adormiți, cross-sell), folosește-o — acolo e miezul. Mergi direct la concluzii, fără preambul.`;

  const userPrompt = `Date agregate pentru agentul **${payload.agentName}** (ID: ${payload.agentId}):

\`\`\`json
${JSON.stringify(body.summary, null, 2)}
\`\`\`

${instructions}`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        void (await import("@/modules/platform")).recordAiUsage({ kind: "analiza", agentId: payload.agentId });
        await streamCompletion({
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          maxTokens: 2048,
          onText: (text) => {
            controller.enqueue(encoder.encode(text));
          },
        });
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
}
