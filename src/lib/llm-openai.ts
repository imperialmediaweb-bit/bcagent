import OpenAI from "openai";
import type { StreamOptions } from "./llm";

export async function streamWithOpenAI(opts: StreamOptions): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY lipsește");
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const stream = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    stream: true,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) opts.onText(text);
  }
}
