import { mesajEroareAI } from "@/lib/ai-error";
import { verifyFieldToken } from "@/lib/agent-guard";
import {
  isAIEnabled,
  streamCompletion,
  visionCompletion,
  type LLMMessage,
} from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Antrenorul AI al agentului — trei moduri:
 *   chat     — sfaturi la obiecții și tipuri de clienți („mi-a zis că e scump")
 *   plan     — analiza MEGA: punctele lui slabe din DATE + ce să învețe
 *   simulare — AI-ul joacă un client dificil, agentul exersează
 * Primește rezumatul de vânzări al agentului (cu analiza smart) —
 * sfaturile sunt pe cifrele LUI, nu generice.
 */

const COACH_BASE = `Ești „Antrenorul" — un coach de vânzări de elită pentru agenți de teren din distribuția FMCG/tutun din România. Ai 20 de ani de teren: cunoști magazinele sătești, barurile, chioșcurile, patronii care se plâng de bani și concurența care taie prețul.

Reguli:
- Limba română, tonul unui coleg senior: cald, direct, fără teorie academică.
- Răspunsuri SCURTE și CONCRETE: dă REPLICI cuvânt-cu-cuvânt pe care agentul le poate spune clientului, nu principii abstracte.
- Când primești datele agentului (scoruri, branduri slabe, clienți adormiți, cross-sell), leagă sfatul de cifrele LUI reale — numește clienții și brandurile din date.
- Structura ideală la obiecții: 1) ce înseamnă de fapt obiecția, 2) replica exactă (citat), 3) următorul pas concret.
- Maxim 150 de cuvinte per răspuns de chat.`;

const COACH_PLAN = `${COACH_BASE}

Sarcina: fă PLANUL DE DEZVOLTARE al agentului pe baza datelor lui (markdown):

## Unde ești bun
2-3 puncte forte REALE din cifre (numește branduri/clienți/scoruri).

## Unde pierzi bani
2-3 slăbiciuni concrete din date: componenta slabă din scor (regularitate? diversitate? clienți?), branduri pe care nu le vinzi deși colegii le vând, clienți adormiți valoroși, oportunități de coș ignorate. Cu cifre.

## Ce ai de învățat
2-3 abilități de antrenat, alese LOGIC din slăbiciuni (ex: scor mic la diversitate → învață să deschizi discuția despre al doilea brand; mulți adormiți → învață reactivarea).

## Săptămâna asta faci asta
Exact 3 acțiuni cu nume de client/brand din date și replica cu care începi discuția. Măsurabile.`;

const COACH_SIM = `${COACH_BASE}

MOD SIMULARE: joci rolul unui PATRON DE MAGAZIN dificil dintr-un sat din România (alege un profil: zgârcit / grăbit / fidel concurenței / negociator dur). Rămâi ÎN ROL, răspunzi scurt și realist cum ar vorbi patronul, cu obiecții autentice. NU dai sfaturi cât ești în rol.
Când agentul scrie „STOP", ieși din rol și dă feedback: ce a făcut bine, ce a ratat, ce replică ar fi funcționat mai bine, notă de la 1 la 10.
Începe prima replică direct în rol, salutând sec agentul care intră în magazin.`;

export async function POST(req: Request) {
  const ip = clientIP(req);
  const rl = rateLimit(`coach:${ip}`, { max: 15, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe cereri AI. Reîncearcă într-un minut." },
      { status: 429 },
    );
  }
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  if (!isAIEnabled()) {
    return Response.json(
      { error: "AI dezactivat — setează OPENAI_API_KEY sau ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  let body: {
    token?: string;
    mode?: string;
    messages?: LLMMessage[];
    summary?: unknown;
    /** Poză de la raft/stand — base64 fără prefixul data:. */
    image?: { data?: string; mime?: string };
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body.token ? await verifyFieldToken(body.token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }

  // Limitele planului firmei: Antrenorul e de la Pro, pozele de la Business.
  try {
    const { agentAIFeatures } = await import("@/modules/platform");
    const feats = await agentAIFeatures(payload.agentId);
    if (!feats.aiCoach) {
      return Response.json(
        {
          error:
            "Antrenorul AI e inclus de la planul Pro. Cere patronului un upgrade.",
          upsell: true,
        },
        { status: 403 },
      );
    }
    if (body.image?.data && !feats.aiVision) {
      return Response.json(
        {
          error:
            "Analiza pozelor de la stand e inclusă în planul Business. Cere patronului un upgrade.",
          upsell: true,
        },
        { status: 403 },
      );
    }
  } catch {
    // fără DB nu putem verifica planul — nu blocăm (linkurile proprietarului)
  }

  const mode =
    body.mode === "plan" ? "plan" : body.mode === "simulare" ? "simulare" : "chat";
  const system =
    mode === "plan" ? COACH_PLAN : mode === "simulare" ? COACH_SIM : COACH_BASE;

  const dataContext = body.summary
    ? `\n\nDatele agentului ${payload.agentName} (rezumat agregat, include analiza smart):\n\`\`\`json\n${JSON.stringify(body.summary).slice(0, 30_000)}\n\`\`\``
    : "";

  const messages: LLMMessage[] =
    Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages
          .filter(
            (m): m is LLMMessage =>
              !!m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string",
          )
          .slice(-20)
      : [{ role: "user", content: mode === "plan" ? "Fă-mi planul de dezvoltare." : "Salut!" }];

  // Poză la raft → analiza vizuală (Gemini/GPT-4o), în același chat.
  const imageData = body.image?.data
    ? String(body.image.data).replace(/^data:[^,]+,/, "")
    : null;
  const imageMime = ["image/jpeg", "image/png", "image/webp"].includes(
    String(body.image?.mime),
  )
    ? String(body.image?.mime)
    : "image/jpeg";
  if (imageData && imageData.length > 6_000_000) {
    return Response.json({ error: "Poza e prea mare (max ~4MB)" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        if (imageData) {
          void (await import("@/modules/platform")).recordAiUsage({ kind: "coach", agentId: payload.agentId });
          const transcript = messages
            .slice(0, -1)
            .slice(-6)
            .map((m) => `${m.role === "user" ? "Agent" : "Antrenor"}: ${m.content}`)
            .join("\n");
          const lastMsg = messages[messages.length - 1]?.content ?? "";
          const text = await visionCompletion({
            system:
              system +
              dataContext +
              `\n\nAgentul ți-a trimis o POZĂ de la raft/stand din magazin. Analizeaz-o ca un merchandiser de elită:
1) ce branduri/produse se văd și cum sunt așezate,
2) ce lipsește sau e greșit (nivelul ochilor, grupare, stoc gol, etichete),
3) ce tip de stand/expunere ar ajuta aici,
4) observații de preț dacă se văd etichete,
5) exact 3 acțiuni pe care agentul le face ACUM, pe loc.
Scurt, concret, în română.`,
            prompt:
              (transcript ? `Conversația de până acum:\n${transcript}\n\n` : "") +
              (lastMsg || "Analizează poza de la stand."),
            imageBase64: imageData,
            mimeType: imageMime,
            maxTokens: 1200,
          });
          controller.enqueue(encoder.encode(text || "Nu am putut citi poza."));
        } else {
          void (await import("@/modules/platform")).recordAiUsage({ kind: "coach", agentId: payload.agentId });
          await streamCompletion(
            {
              system: system + dataContext,
              messages,
              maxTokens: 1500,
              onText: (t) => controller.enqueue(encoder.encode(t)),
            },
            "coach",
          );
        }
        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            mesajEroareAI(e),
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
