import Anthropic from "@anthropic-ai/sdk";
import type { StreamOptions } from "./llm";

export async function streamWithAnthropic(opts: StreamOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY lipsește");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

  const stream = client.messages.stream({
    model,
    max_tokens: opts.maxTokens,
    system: [
      {
        type: "text",
        text: opts.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: opts.messages,
  });

  stream.on("text", (text) => {
    opts.onText(text);
  });
  await stream.finalMessage();
}
