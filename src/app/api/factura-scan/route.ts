import { verifyToken } from "@/lib/signed-token";
import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { isVisionEnabled, visionCompletion } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POZĂ LA FACTURĂ: agentul fotografiază factura/bonul scris de mână sau
 * tipărit, AI-ul o citește și întoarce liniile gata de pus în comandă —
 * agentul doar verifică și salvează. Zero tastat în magazin.
 */

const SYSTEM = `Ești un operator de facturare pentru o firmă de distribuție din România.
Primești POZA unei facturi / aviz / bon (tipărit sau scris de mână, în română).
Extrage EXACT ce scrie, fără să inventezi nimic.

Răspunde DOAR cu un obiect JSON valid, fără alt text, în formatul:
{
  "client": "numele clientului de pe document sau null",
  "lines": [
    {"produs": "...", "cantitate": 5, "um": "buc|bax|cartus|pachet|naveta|cutie|kg|l", "pret": 12.5}
  ],
  "total": 62.5,
  "scris_de_mana": false,
  "observatii": "ce nu ai putut citi sau e neclar, altfel null"
}

Reguli:
- "pret" e prețul UNITAR (dacă documentul are doar valoarea totală pe linie, împarte la cantitate).
- Numerele românești: virgula e zecimală (12,50 = 12.5).
- Dacă UM nu se vede, pune "buc".
- Dacă o linie e ilizibilă, sari peste ea și noteaz-o la "observatii".
- Nu adăuga produse care nu apar pe document.

SCRIS DE MÂNĂ — atenție dublă:
- Pune "scris_de_mana": true dacă documentul e completat de mână (măcar parțial).
- La scris de mână, recitește FIECARE cifră a doua oară înainte să răspunzi:
  1 se confundă cu 7, 4 cu 9, 0 cu 6, iar virgula zecimală se pierde ușor.
- Verifică-te singur cu totalul: cantitate × preț adunat pe linii trebuie să
  dea totalul de pe document; dacă nu iese, recitește liniile, nu ajusta cifrele.
- Orice cifră sau cuvânt de care NU ești sigur → spune-o explicit la
  "observatii" (ex: "cantitatea de la Kent poate fi 4 sau 9"). NU ghici în tăcere.`;

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`factura:${clientIP(req)}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });

  let body: { token?: string; image?: { data?: string; mime?: string } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body.token ? await verifyToken(body.token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const imageData = String(body.image?.data ?? "");
  const imageMime = String(body.image?.mime ?? "image/jpeg");
  if (!imageData) {
    return Response.json({ error: "Poza lipsește" }, { status: 400 });
  }
  if (imageData.length > 6_000_000) {
    return Response.json({ error: "Poza e prea mare (max ~4MB)" }, { status: 400 });
  }
  if (!isVisionEnabled()) {
    return Response.json(
      { error: "Niciun provider AI cu suport de imagini configurat" },
      { status: 503 },
    );
  }
  const { agentAIFeatures } = await import("@/modules/platform");
  const feats = await agentAIFeatures(payload.agentId);
  if (!feats.aiVision) {
    return Response.json(
      { error: "Planul firmei tale nu include citirea pozelor cu AI" },
      { status: 402 },
    );
  }

  try {
    const text = await visionCompletion({
      system: SYSTEM,
      prompt: "Citește documentul din poză și întoarce JSON-ul.",
      imageBase64: imageData,
      mimeType: imageMime,
      maxTokens: 1500,
    });
    // Modelul poate împacheta JSON-ul în ```json ... ``` — îl dezgropăm.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return Response.json(
        { error: "Nu am putut citi factura din poză — încearcă o poză mai clară, de sus, cu tot documentul în cadru." },
        { status: 422 },
      );
    }
    const parsed = JSON.parse(match[0]) as {
      client?: string | null;
      lines?: Array<{
        produs?: string;
        cantitate?: number;
        um?: string;
        pret?: number;
      }>;
      total?: number;
      scris_de_mana?: boolean;
      observatii?: string | null;
    };
    const UMS = new Set(["buc", "bax", "cartus", "pachet", "naveta", "cutie", "kg", "l"]);
    const lines = (parsed.lines ?? [])
      .map((l) => ({
        produs: String(l.produs ?? "").trim().slice(0, 120),
        cantitate: Math.max(0, Number(l.cantitate) || 0),
        um: UMS.has(String(l.um ?? "")) ? String(l.um) : "buc",
        pret: l.pret === undefined || l.pret === null ? null : Math.max(0, Number(l.pret) || 0),
      }))
      .filter((l) => l.produs !== "" && l.cantitate > 0)
      .slice(0, 60);
    if (lines.length === 0) {
      return Response.json(
        { error: "N-am găsit niciun produs lizibil pe document — încearcă o poză mai clară." },
        { status: 422 },
      );
    }
    // Verificare aritmetică pe server (nu ne bazăm doar pe AI): dacă suma
    // liniilor citite nu bate cu totalul de pe document, agentul e anunțat.
    const docTotal = typeof parsed.total === "number" ? parsed.total : null;
    let totalMismatch: string | null = null;
    if (
      docTotal !== null &&
      docTotal > 0 &&
      lines.every((l) => l.pret !== null)
    ) {
      const sum = lines.reduce((s, l) => s + l.cantitate * (l.pret ?? 0), 0);
      if (Math.abs(sum - docTotal) > Math.max(1, docTotal * 0.02)) {
        totalMismatch = `Suma produselor citite (${sum.toFixed(2)} RON) nu bate cu totalul de pe document (${docTotal.toFixed(2)} RON) — compară linie cu linie cu factura.`;
      }
    }
    return Response.json({
      ok: true,
      client: parsed.client ?? null,
      lines,
      total: docTotal,
      scrisDeMana: parsed.scris_de_mana === true,
      totalMismatch,
      observatii: parsed.observatii ?? null,
    });
  } catch (e) {
    console.error("[factura-scan]", e);
    return Response.json({ error: "Eroare la citirea pozei" }, { status: 500 });
  }
}
