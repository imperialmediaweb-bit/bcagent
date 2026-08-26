import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { isAIEnabled, streamCompletion } from "@/lib/llm";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { getOrgSession } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Raportarea problemelor din platformă: oricine (agent cu link sau
 * manager/patron logat) apasă „Raportează o problemă", scrie ce nu merge,
 * iar AI-ul face TRIAJUL pe loc: diagnostic + soluție/ocoliș pentru
 * utilizator + notă tehnică pentru admin. Totul ajunge în
 * /platform/probleme.
 */

import { CE_ARE_APLICATIA } from "@/modules/platform/ce-are-aplicatia";

/**
 * TRIAJUL: întrebare sau problemă?
 *
 * Costin a scris „sc ancavit tonic srl, nu găsesc pe hartă" și a primit
 * instrucțiuni cu butoane care NU EXISTĂ („Salvează locația curentă",
 * „Setează GPS aici"). AI-ul nu știa aplicația, așa că a inventat-o —
 * iar omul le-a căutat pe telefon, în mașină, degeaba.
 *
 * Două schimbări:
 *   1. primește ce ARE aplicația, cu numele exacte ale butoanelor, și i
 *      se interzice limpede să inventeze altele;
 *   2. spune dacă e ÎNTREBARE (îi arăt cum se face, gata) sau PROBLEMĂ
 *      (ceva chiar nu merge — ajunge la echipa platformei). Altfel ne
 *      înecăm în „nu știu unde e butonul" și pierdem bugul adevărat.
 */
const TRIAGE_SYSTEM = `Ești omul de la suportul platformei Provendi și
CUNOȘTI aplicația pe de rost. Mai jos e ce are ea, cu numele EXACTE ale
butoanelor.

${CE_ARE_APLICATIA}

REGULI, fără excepție:
1. NU INVENTA butoane, meniuri sau pași care nu sunt în lista de mai sus.
   Dacă ce cere omul nu se poate face în aplicație, SPUNE ASTA pe față —
   nu-l trimite să caute ceva ce nu există. E mai bine să audă „nu se
   poate încă" decât să umble un sfert de oră după un buton inventat.
2. Vorbește ca unui om obosit, în mașină, pe telefon. Scurt, pași
   numerotați, fără vorbe tehnice.
3. Dacă e o firmă pe care n-o găsește: spune-i să caute după 3-4 litere
   din nume, nu după numele întreg, și explică-i de unde vin clienții.
4. Dacă îți lipsește o informație ca să răspunzi, SPUNE ce-ți lipsește.

Răspunde în română, STRICT în formatul:

FEL: intrebare SAU problema
(„intrebare" = nu știe unde e ceva sau cum se face, dar aplicația poate;
 „problema" = ceva chiar nu merge, lipsesc date, sau nu se poate face.)
DIAGNOSTIC: (1-2 fraze — care e cauza cea mai probabilă)
SOLUȚIE PENTRU UTILIZATOR: (pași concreți, cu butoanele care EXISTĂ)
PENTRU ADMIN: (1-2 fraze tehnice — unde să se uite, dacă e problemă;
scrie „-" dacă e doar o întrebare și omul s-a lămurit)`;

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`issues:${clientIP(req)}`, { max: 6, windowMs: 300_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe raportări — mai încearcă în câteva minute." },
      { status: 429 },
    );
  }

  let body: {
    token?: string;
    message?: string;
    page?: string;
    context?: Record<string, unknown>;
    /**
     * Poza ecranului, ca `data:image/...;base64,...`.
     * „Nu-mi apare cum trebuie" e greu de scris în mașină; o poză spune
     * tot. Se criptează la fel ca pozele de facturi — poate prinde nume
     * de clienți și cifre.
     */
    foto?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Cine raportează: sesiune de agenție SAU link de agent. Reținem și
  // FIRMA raportorului — administratorul firmei vede raportul în panoul
  // lui („Volanschi a trimis un raport și nu-l văd nicăieri").
  let reporter = "";
  let role = "";
  let orgId = "";
  const orgSession = await getOrgSession();
  if (orgSession) {
    reporter = orgSession.email;
    role = orgSession.role;
    orgId = orgSession.orgId;
  } else if (body.token && process.env.TOKEN_SECRET) {
    const p = await verifyFieldToken(body.token, process.env.TOKEN_SECRET);
    if (p) {
      reporter = p.agentName;
      role = "agent";
      try {
        const dbOrg = getDB();
        if (dbOrg) {
          const [rand] = await dbOrg<Array<{ org_id: string }>>`
            SELECT org_id FROM org_agents WHERE agent_id = ${p.agentId} LIMIT 1
          `;
          orgId = rand?.org_id ?? "";
        }
      } catch {
        // fără firmă găsită — raportul tot ajunge la platformă
      }
    }
  }
  if (!reporter) {
    return Response.json({ error: "Neautentificat" }, { status: 401 });
  }

  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (message.length < 5) {
    return Response.json({ error: "Descrie problema în câteva cuvinte" }, { status: 400 });
  }
  const page = String(body.page ?? "").slice(0, 200);

  // ── FAPTELE LUI, ÎNAINTE DE ORICE ──
  // Un om de la suport care merită plătit nu dă un scenariu general: se
  // uită în baza LUI. Costin a scris „nu găsesc ANCAVIT TONIC" și a
  // primit pași cu butoane inexistente. Cu faptele în față, răspunsul
  // devine: „o ai, la Broscăuți, CUI …, dar n-are loc pus".
  let fapte = "";
  {
    const dbF = getDB();
    if (dbF && orgId !== "") {
      try {
        await ensureSchema();
        const { listOrgAgents } = await import("@/modules/platform");
        const { fapteDinDate } = await import(
          "@/modules/platform/fapte-pentru-suport"
        );
        const numeAg = (await listOrgAgents(orgId)).map((a) => a.name);
        fapte = (await fapteDinDate(dbF, orgId, numeAg, message)).text;
      } catch (e) {
        // Fără fapte, tot răspundem — dar spunem că n-am putut căuta.
        console.warn("[issues] n-am putut aduna faptele", e);
      }
    }
  }

  // Triaj AI (dacă e configurat) — diagnostic instant, dar raportarea
  // reușește și fără AI.
  let aiDiagnosis = "";
  if (isAIEnabled()) {
    try {
      let acc = "";
      await streamCompletion(
        {
          system: TRIAGE_SYSTEM,
          messages: [
            {
              role: "user",
              content:
                `Rol utilizator: ${role}\nPagina: ${page}\n` +
                `Problema: ${message}\n` +
                `Context: ${JSON.stringify(body.context ?? {}).slice(0, 1200)}\n\n` +
                (fapte
                  ? `CE SCRIE ÎN BAZA LOR, ACUM (date reale, verificate — ` +
                    `folosește-le, nu presupune nimic peste ele):\n${fapte}`
                  : `Nu am putut citi datele lor acum. Spune-i asta pe față ` +
                    `și dă-i pașii generali, fără să inventezi cifre.`),
            },
          ],
          maxTokens: 500,
          onText: (t) => {
            acc += t;
          },
        },
        "coach",
      );
      aiDiagnosis = acc.slice(0, 4000);
    } catch (e) {
      console.warn("[issues] triaj AI eșuat", e);
    }
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const id = `iss_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const fel = /FEL:\s*problem/i.test(aiDiagnosis) ? "problema" : "intrebare";

    // POZA, criptată — poate prinde nume de clienți și cifre de pe ecran.
    let foto: string | null = null;
    const brutFoto = String(body.foto ?? "");
    if (brutFoto.startsWith("data:image/") && brutFoto.length < 8_000_000) {
      try {
        const { encryptData } = await import("@/lib/crypto-data");
        foto = await encryptData(brutFoto);
      } catch (e) {
        // Fără poză, raportul tot pleacă — nu-l pierdem pentru atât.
        console.warn("[issues] n-am putut salva poza", e);
      }
    }

    await db`
      INSERT INTO issues (id, source, reporter, role, page, message, context,
                          ai_diagnosis, org_id, fel, foto)
      VALUES (${id}, 'user', ${reporter}, ${role}, ${page}, ${message},
              ${db.json((body.context ?? {}) as Record<string, string>)},
              ${aiDiagnosis}, ${orgId}, ${fel}, ${foto})
    `;

    // Soluția pentru utilizator, extrasă din triaj — o vede pe loc.
    const solutionMatch = aiDiagnosis.match(
      /SOLU[ȚT]IE PENTRU UTILIZATOR:\s*([\s\S]*?)(?=PENTRU ADMIN:|$)/i,
    );
    return Response.json({
      ok: true,
      id,
      suggestion: solutionMatch ? solutionMatch[1].trim() : null,
      // ÎNTREBARE sau PROBLEMĂ. Fără asta, „nu știu unde e butonul" și un
      // bug adevărat ajung amestecate în aceeași listă, iar bugul se
      // pierde între ele.
      fel,
    });
  } catch (e) {
    console.error("[issues POST]", e);
    return Response.json({ error: "Eroare la raportare" }, { status: 500 });
  }
}
