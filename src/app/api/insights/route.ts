import { verifyToken } from "@/lib/signed-token";
import { getAnthropicClient, MODEL, SYSTEM_PROMPT } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json(
      { error: "Server not configured (TOKEN_SECRET lipsește)" },
      { status: 500 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "AI dezactivat — ANTHROPIC_API_KEY nu e configurat pe server." },
      { status: 503 },
    );
  }

  let body: { token?: string; summary?: unknown };
  try {
    body = (await req.json()) as { token?: string; summary?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token || !body.summary) {
    return Response.json(
      { error: "token și summary sunt obligatorii" },
      { status: 400 },
    );
  }

  const payload = await verifyToken(body.token, tokenSecret);
  if (!payload) {
    return Response.json(
      { error: "Token invalid sau expirat" },
      { status: 401 },
    );
  }

  let client;
  try {
    client = getAnthropicClient();
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "AI client error" },
      { status: 500 },
    );
  }

  const userPrompt = `Date agregate pentru agentul **${payload.agentName}** (ID: ${payload.agentId}):

\`\`\`json
${JSON.stringify(body.summary, null, 2)}
\`\`\`

Generează o analiză concisă în format markdown (## Privire generală / ## Observații / ## Recomandări), maxim 200 cuvinte total. Mergi direct la concluzii, fără preambul.`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        stream.on("text", (text) => {
          controller.enqueue(encoder.encode(text));
        });
        await stream.finalMessage();
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
