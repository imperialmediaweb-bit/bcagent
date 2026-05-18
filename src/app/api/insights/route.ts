import { verifyToken } from "@/lib/signed-token";
import { isAIEnabled, streamCompletion, SYSTEM_PROMPT } from "@/lib/llm";

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
  if (!isAIEnabled()) {
    return Response.json(
      {
        error:
          "AI dezactivat — niciun provider configurat. Setează OPENAI_API_KEY sau ANTHROPIC_API_KEY.",
      },
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

  const userPrompt = `Date agregate pentru agentul **${payload.agentName}** (ID: ${payload.agentId}):

\`\`\`json
${JSON.stringify(body.summary, null, 2)}
\`\`\`

Generează o analiză concisă în format markdown (## Privire generală / ## Observații / ## Recomandări), maxim 200 cuvinte total. Mergi direct la concluzii, fără preambul.`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
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
