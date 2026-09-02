import { verifyFieldToken } from "@/lib/agent-guard";
import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { isVisionEnabled, visionCompletion } from "@/lib/llm";
import { cuiValid, curataCui } from "@/modules/prospects/cui";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POZĂ LA CERTIFICAT / FIRMA LUMINOASĂ → CUI-ul firmei.
 *
 * Copia noastră de registru nu e completă (1634 din cele 2450 de pinuri
 * ale hărții aveau CUI-uri necunoscute nouă), iar agentul din teren nu
 * are de unde să scoată un CUI dacă nu i-l dictează cineva. Dar CUI-ul e
 * scris pe certificatul de înregistrare atârnat în magazin, pe factură,
 * pe bon, adesea și pe firma de la intrare.
 *
 * Deci: face o poză, AI-ul citește codul, iar de acolo merge tot ce e
 * deja construit — firma intră în registru și magazinul se leagă de ea.
 *
 * NU inventăm: dacă nu se citește limpede un CUI cu cifră de control
 * bună, spunem că nu l-am găsit. Un CUI greșit intră în registrul COMUN
 * tuturor agențiilor și nu-l mai scoate nimeni.
 */

const SYSTEM = `Ești un operator care citește acte de firmă românești dintr-o poză.
Poza poate fi: certificatul de înregistrare (CUI) atârnat în magazin, o
factură, un bon fiscal, o ștampilă, sau firma luminoasă de la intrare.

Răspunde DOAR cu un obiect JSON valid, fără alt text:
{
  "cui": "codul fiscal, doar cifrele, fără RO — sau null dacă nu se vede",
  "denumire": "denumirea firmei exact cum scrie — sau null",
  "localitate": "localitatea, dacă apare — altfel null",
  "judet": "județul, dacă apare — altfel null",
  "sigur": true,
  "observatii": "ce n-ai putut citi, altfel null"
}

Reguli care nu se încalcă:
- NU inventa cifre. Dacă o cifră din CUI e neclară, pune "cui": null,
  "sigur": false și scrie la observații care cifră te încurcă.
- CUI-ul românesc are între 2 și 10 cifre. "RO" din față NU face parte din el.
- Nu confunda CUI-ul cu: numărul de la Registrul Comerțului (are forma
  J07/123/2015), CIF-ul de TVA scris cu RO, numărul de telefon, data,
  numărul bonului sau contul IBAN.
- Pe certificat, CUI-ul e scris mare, sub „COD UNIC DE ÎNREGISTRARE".
- Dacă în poză se văd mai multe firme, ia firma DOCUMENTULUI, nu pe cea
  care a tipărit formularul.
- Denumirea se scrie așa cum e în act (cu SRL / PFA / II / SA la coadă).`;

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`firma-scan:${clientIP(req)}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });

  let body: { token?: string; image?: { data?: string; mime?: string } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = body.token ? await verifyFieldToken(body.token, secret) : null;
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const imageData = String(body.image?.data ?? "");
  const imageMime = String(body.image?.mime ?? "image/jpeg");
  if (!imageData) return Response.json({ error: "Poza lipsește" }, { status: 400 });
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
      prompt: "Citește actul din poză și întoarce JSON-ul.",
      imageBase64: imageData,
      mimeType: imageMime,
      maxTokens: 600,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return Response.json(
        {
          error:
            "N-am putut citi actul din poză. Fotografiază certificatul de sus, drept, cu tot codul în cadru.",
        },
        { status: 422 },
      );
    }
    const parsed = JSON.parse(match[0]) as {
      cui?: string | null;
      denumire?: string | null;
      localitate?: string | null;
      judet?: string | null;
      sigur?: boolean;
      observatii?: string | null;
    };

    // CIFRA DE CONTROL DECIDE, nu încrederea modelului. Un CUI citit greșit
    // ar intra în registrul comun tuturor agențiilor și n-ar mai ieși.
    const cui = curataCui(String(parsed.cui ?? ""));
    const bun = cui !== "" && cuiValid(cui);
    return Response.json({
      cui: bun ? cui : "",
      denumire: String(parsed.denumire ?? "").trim().slice(0, 200),
      localitate: String(parsed.localitate ?? "").trim().slice(0, 120),
      judet: String(parsed.judet ?? "").trim().slice(0, 40),
      // Spunem pe față când n-am găsit un cod bun — agentul îl scrie de mână.
      mesaj: bun
        ? ""
        : cui === ""
          ? "N-am găsit niciun cod fiscal în poză. Scrie-l tu, sau fotografiază certificatul."
          : `Codul citit (${cui}) nu trece verificarea — probabil o cifră citită greșit. Scrie-l tu de pe act.`,
      observatii: String(parsed.observatii ?? "").trim().slice(0, 300),
    });
  } catch (e) {
    console.error("[firma-scan]", e);
    return Response.json(
      { error: "N-am putut citi poza acum. Încearcă din nou peste un minut." },
      { status: 502 },
    );
  }
}
