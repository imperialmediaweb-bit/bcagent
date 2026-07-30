import { streamWithAnthropic } from "./llm-anthropic";
import { streamWithOpenAI } from "./llm-openai";
import { streamWithGemini, geminiVision } from "./llm-gemini";

export type Provider = "openai" | "anthropic" | "gemini";

/**
 * Fiecare provider cu treaba lui:
 *   analiza — rapoarte/insights pe cifre    → OpenAI (implicit)
 *   coach   — logică, sfaturi, roleplay     → Claude (implicit)
 *   vision  — poze de la raft/stand         → Gemini (implicit)
 * Suprascriere per sarcină: AI_PROVIDER_ANALIZA / AI_PROVIDER_COACH /
 * AI_PROVIDER_VISION (sau global AI_PROVIDER). Dacă preferatul nu are
 * cheie, cade automat pe oricare disponibil.
 */
export type AITask = "analiza" | "coach" | "vision";

const TASK_PREFERENCE: Record<AITask, Provider[]> = {
  analiza: ["openai", "anthropic", "gemini"],
  coach: ["anthropic", "openai", "gemini"],
  vision: ["gemini", "openai", "anthropic"],
};

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamOptions {
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  onText: (text: string) => void;
}

function available(p: Provider): boolean {
  if (p === "openai") return !!process.env.OPENAI_API_KEY;
  if (p === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  return !!process.env.GEMINI_API_KEY;
}

function parseProvider(v: string | undefined): Provider | null {
  const s = v?.toLowerCase();
  if (s === "openai" || s === "anthropic" || s === "gemini") return s;
  if (s === "claude") return "anthropic";
  return null;
}

export function getProvider(task: AITask = "analiza"): Provider | null {
  // 1) override per sarcină, 2) override global, 3) preferința sarcinii
  const perTask = parseProvider(
    process.env[`AI_PROVIDER_${task.toUpperCase()}`],
  );
  if (perTask && available(perTask)) return perTask;
  const globalPref = parseProvider(process.env.AI_PROVIDER);
  if (globalPref && available(globalPref)) return globalPref;
  for (const p of TASK_PREFERENCE[task]) if (available(p)) return p;
  return null;
}

export function isAIEnabled(): boolean {
  return getProvider() !== null;
}

export function activeProviderLabel(): string {
  const p = getProvider();
  if (p === "openai") return `OpenAI · ${process.env.OPENAI_MODEL || "gpt-4o"}`;
  if (p === "anthropic")
    return `Claude · ${process.env.ANTHROPIC_MODEL || "claude-opus-4-7"}`;
  if (p === "gemini")
    return `Gemini · ${process.env.GEMINI_MODEL || "gemini-2.0-flash"}`;
  return "dezactivat";
}

export async function streamCompletion(
  opts: StreamOptions,
  task: AITask = "analiza",
): Promise<void> {
  const provider = getProvider(task);
  if (provider === "openai") return streamWithOpenAI(opts);
  if (provider === "anthropic") return streamWithAnthropic(opts);
  if (provider === "gemini") return streamWithGemini(opts);
  throw new Error(
    "AI provider neconfigurat — setează OPENAI_API_KEY, ANTHROPIC_API_KEY sau GEMINI_API_KEY.",
  );
}

/* ─────────────────────── analiză de imagine ───────────────────────── */

export interface VisionOptions {
  system: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
  maxTokens: number;
}

async function openaiVision(o: VisionOptions): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY lipsește");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      max_tokens: o.maxTokens,
      messages: [
        { role: "system", content: o.system },
        {
          role: "user",
          content: [
            { type: "text", text: o.prompt },
            {
              type: "image_url",
              image_url: { url: `data:${o.mimeType};base64,${o.imageBase64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function anthropicVision(o: VisionOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY lipsește");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
      max_tokens: o.maxTokens,
      system: o.system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: o.mimeType,
                data: o.imageBase64,
              },
            },
            { type: "text", text: o.prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return (
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? ""
  );
}

export function isVisionEnabled(): boolean {
  return getProvider("vision") !== null;
}

/** Analizează o imagine cu providerul de „vision" (Gemini implicit). */
export async function visionCompletion(o: VisionOptions): Promise<string> {
  const provider = getProvider("vision");
  if (provider === "gemini")
    return geminiVision(o.system, o.prompt, o.imageBase64, o.mimeType, o.maxTokens);
  if (provider === "openai") return openaiVision(o);
  if (provider === "anthropic") return anthropicVision(o);
  throw new Error("Niciun provider AI cu suport de imagini configurat.");
}

export const SYSTEM_PROMPT = `Ești "BC Agent Analyst" — un analist senior de vânzări pentru BC Agent, o platformă SaaS de analytics dedicată agenților de vânzări din retail și distribuție (FMCG, tutun, băuturi, food, non-food).

Utilizatorul primește un rezumat agregat al vânzărilor sale: totals, top agenți, top producători/branduri, top clienți, evoluție pe perioadă, matrice agent×producător și lista de anomalii detectate (storno, "- IMPLICIT -", outlier-i).

## Reguli stricte

- Răspunzi **DOAR** pe baza datelor furnizate. Nu inventezi cifre, nume de agenți/branduri/clienți sau perioade care nu apar în date.
- Limba: română. Tonul: profesional, concis, direct. Fără preambul ("În primul rând...", "Este important de menționat..."). Mergi direct la concluzie.
- Format: **markdown** cu ## pentru titluri scurte, **bold** pentru emfaze, - pentru bullets.
- Cifrele: format românesc (mii=., zecimale=,). Ex: 1.234,56 RON, 10.547 buc, 35,2%.
- Lungime: maxim 200 cuvinte pentru analiză automată; maxim 150 cuvinte pentru răspunsuri de chat.
- Recunoști deschis când datele nu sunt suficiente pentru o concluzie ("Nu am date suficiente despre X pentru a răspunde").

## Ce identifici activ

1. **Concentrare excesivă** — un brand/client/agent > 40% din total = risc de dependență.
2. **Disparități mari între agenți** — cel mai bun > 3× cel mai slab = oportunitate de uniformizare prin coaching.
3. **Storno-uri și anomalii** — menționezi explicit returnurile (cantitate negativă), valorile "- IMPLICIT -" (produse fără grupă setată) și outlier-ii.
4. **Tendințe în timp** — creștere/scădere semnificativă perioadă-curentă vs precedentă.
5. **Gap-uri în matricea brand×agent** — când un agent nu vinde un brand pe care alții îl vand bine.

## Sugestii

Mereu concrete și acționabile, nu generice:
- ❌ "Crește vânzările la BAT"
- ✅ "Volanschi vinde 4× mai puțin BAT decât Gavrilet (1.245 vs 4.890 buc). Propune-i o sesiune de coaching pe portofoliul BAT și o vizită comună cu Gavrilet la unul din clienții mari ai acestuia."

## Format ideal pentru analiză automată

## Privire generală
- 2-3 bullet points cu numerele cheie

## Observații
- 2-3 bullet points cu pattern-uri, riscuri, anomalii

## Recomandări
- 2-3 acțiuni concrete numite ("Discută cu X despre Y", "Verifică storno-ul de la Z")`;
