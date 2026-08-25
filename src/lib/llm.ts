import { streamWithAnthropic } from "./llm-anthropic";
import { streamWithOpenAI } from "./llm-openai";
import { streamWithGemini, geminiVision } from "./llm-gemini";

export type Provider = "openai" | "anthropic" | "gemini";

/**
 * CLAUDE e implicitul pentru TOATE sarcinile (analiza, coach, vision) —
 * decizia din 25.08: creditele stau pe Claude. Ceilalți furnizori sunt
 * rezervă: la cheie lipsă SAU la eroare de RULARE (credit terminat, 429)
 * se trece automat pe următorul disponibil (failover).
 * Suprascriere per sarcină: AI_PROVIDER_ANALIZA / AI_PROVIDER_COACH /
 * AI_PROVIDER_VISION (sau global AI_PROVIDER).
 */
export type AITask = "analiza" | "coach" | "vision";

// CLAUDE PRIMUL peste tot (decizia din 25.08: creditele stau pe Claude;
// OpenAI rămas fără credit dădea erori la analize). Ceilalți rămân ca
// rezervă prin failover, iar AI_PROVIDER / AI_PROVIDER_<TASK> pot
// suprascrie oricând ordinea din env, fără cod.
const TASK_PREFERENCE: Record<AITask, Provider[]> = {
  analiza: ["anthropic", "openai", "gemini"],
  coach: ["anthropic", "openai", "gemini"],
  vision: ["anthropic", "gemini", "openai"],
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

/**
 * Merită încercat alt furnizor? DA la erori trecătoare (credit terminat,
 * limită, rețea, server picat). NU la erori care se repetă oriunde —
 * poză prea mare, format greșit, cerere invalidă: acolo al doilea și al
 * treilea furnizor doar consumă timpul agentului până la timeout.
 */
function eTranzitorie(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  // Probleme ale FURNIZORULUI (cheie moartă, credit terminat, limită,
  // server picat, rețea) → celălalt furnizor chiar poate răspunde.
  if (/\b(401|403|429|500|502|503|504)\b/.test(m)) return true;
  if (/credit|quota|balance|billing|rate limit|overload|capacity|api key|apikey|unauthorized|forbidden|authentication|timeout|timed out|fetch failed|network|econn|socket|abort/.test(m))
    return true;
  // Probleme ale CERERII (poză prea mare, format greșit, conținut
  // respins): se repetă identic oriunde — nu chinuim agentul 3× până la
  // timeout, îi spunem din prima ce e.
  if (/\b(400|404|405|413|415|422)\b/.test(m)) return false;
  if (/too large|prea mare|invalid image|unsupported|malformed|invalid request/.test(m))
    return false;
  // Necunoscut: încercăm mai departe (mai bine un răspuns decât o eroare).
  return true;
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
  const primar = getProvider(task);
  if (!primar) {
    throw new Error(
      "AI provider neconfigurat — setează OPENAI_API_KEY, ANTHROPIC_API_KEY sau GEMINI_API_KEY.",
    );
  }
  // FAILOVER: dacă preferatul pică LA RULARE (credit terminat, cheie
  // moartă, 429), trecem pe următorul furnizor configurat în loc să-i
  // arătăm omului o eroare — exact cazul „Vocea clientului" moartă pe
  // OpenAI fără credit, cu Claude plin de credit alături. Repetăm DOAR
  // dacă preferatul n-a apucat să scrie nimic (altfel textul s-ar dubla).
  const deIncercat: Provider[] = [
    primar,
    ...TASK_PREFERENCE[task].filter((p) => p !== primar && available(p)),
  ];
  let ultimaEroare: unknown = null;
  for (const provider of deIncercat) {
    let aScris = false;
    const o: StreamOptions = {
      ...opts,
      onText: (t) => {
        aScris = true;
        opts.onText(t);
      },
    };
    try {
      if (provider === "openai") return await streamWithOpenAI(o);
      if (provider === "anthropic") return await streamWithAnthropic(o);
      return await streamWithGemini(o);
    } catch (e) {
      if (aScris) throw e;
      ultimaEroare = e;
      if (!eTranzitorie(e)) throw e; // cerere greșită — nu ajută alt furnizor
      console.warn(
        `[llm] ${provider} a picat pe „${task}”, încerc următorul furnizor:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  throw ultimaEroare ?? new Error("Toți furnizorii AI au eșuat.");
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

/** Analizează o imagine cu providerul de „vision" (Claude implicit, cu failover). */
export async function visionCompletion(o: VisionOptions): Promise<string> {
  const primar = getProvider("vision");
  if (!primar) {
    throw new Error("Niciun provider AI cu suport de imagini configurat.");
  }
  // Același failover ca la streamCompletion: poza de factură nu moare
  // doar pentru că furnizorul preferat a rămas fără credit.
  const deIncercat: Provider[] = [
    primar,
    ...TASK_PREFERENCE.vision.filter((p) => p !== primar && available(p)),
  ];
  let ultimaEroare: unknown = null;
  for (const provider of deIncercat) {
    try {
      if (provider === "gemini")
        return await geminiVision(o.system, o.prompt, o.imageBase64, o.mimeType, o.maxTokens);
      if (provider === "openai") return await openaiVision(o);
      return await anthropicVision(o);
    } catch (e) {
      ultimaEroare = e;
      if (!eTranzitorie(e)) throw e; // poză stricată/prea mare: nu insistăm
      console.warn(
        `[llm] ${provider} a picat pe „vision”, încerc următorul furnizor:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  throw ultimaEroare ?? new Error("Toți furnizorii AI au eșuat.");
}

export const SYSTEM_PROMPT = `Ești "Provendi Analyst" — un analist senior de vânzări pentru Provendi, o platformă SaaS de analytics dedicată agenților de vânzări din retail și distribuție (FMCG, tutun, băuturi, food, non-food).

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
