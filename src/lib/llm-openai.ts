import OpenAI from "openai";
import type { StreamOptions } from "./llm";

export async function streamWithOpenAI(opts: StreamOptions): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY lipsește");
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  // Reasoning / o* / GPT-5 models reject `max_tokens` and require
  // `max_completion_tokens`. Branch by model id.
  const isReasoning = /^(o\d|gpt-5)/i.test(model);
  const tokenParam = isReasoning
    ? { max_completion_tokens: opts.maxTokens }
    : { max_tokens: opts.maxTokens };

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    ...tokenParam,
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
