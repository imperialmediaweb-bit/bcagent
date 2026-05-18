import { verifyToken } from "@/lib/signed-token";
import { getAnthropicClient, MODEL, SYSTEM_PROMPT } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "AI dezactivat — ANTHROPIC_API_KEY lipsește." },
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

  let client;
  try {
    client = getAnthropicClient();
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "AI client error" },
      { status: 500 },
    );
  }

  const dataContext = `## Context date curente (agent: ${payload.agentName})

\`\`\`json
${JSON.stringify(body.summary, null, 2)}
\`\`\``;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1536,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: dataContext },
    ],
    messages: cleanMessages,
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
