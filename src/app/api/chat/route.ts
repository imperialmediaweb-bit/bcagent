import { verifyToken } from "@/lib/signed-token";
import { isAIEnabled, streamCompletion, SYSTEM_PROMPT } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  // Rate limit pe IP
  const ip = clientIP(req);
  const rl = rateLimit(`chat:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe mesaje AI. Reîncearcă într-un minut." },
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
      { error: "Server not configured" },
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

  let body: { token?: string; summary?: unknown; messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.token || !body.summary || !Array.isArray(body.messages)) {
    return Response.json(
      { error: "token, summary și messages sunt obligatorii" },
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

  const cleanMessages: ChatMessage[] = body.messages
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-20);

  if (cleanMessages.length === 0 || cleanMessages[0].role !== "user") {
    return Response.json(
      { error: "Conversația trebuie să înceapă cu un mesaj user" },
      { status: 400 },
    );
  }

  const dataContext = `## Context date curente (agent: ${payload.agentName})

\`\`\`json
${JSON.stringify(body.summary, null, 2)}
\`\`\``;

  const fullSystem = `${SYSTEM_PROMPT}\n\n${dataContext}`;

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        await streamCompletion({
          system: fullSystem,
          messages: cleanMessages,
          maxTokens: 1536,
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
