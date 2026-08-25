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

const TRIAGE_SYSTEM = `Ești inginerul de suport al platformei Provendi (SaaS pentru firme de distribuție: panou agent cu hartă/comenzi/vizite, panou agenție, import XLS/CSV de vânzări SAGA, AI). Primești o problemă raportată de un utilizator. Răspunde în română, STRICT în formatul:

DIAGNOSTIC: (1-2 fraze — care e cauza cea mai probabilă)
SOLUȚIE PENTRU UTILIZATOR: (pași concreți pe care îi poate face SINGUR acum — ex: verifică formatul coloanelor, salvează ca .xlsx, reîncarcă pagina)
PENTRU ADMIN: (1-2 fraze tehnice — unde să se uite în cod/date dacă problema persistă)

Cauzele frecvente la import: coloane nedenumite standard (Data/Agent/Client/Cantitate), CSV cu separator neobișnuit, date în format text, fișier protejat/gol, diacritice stricate (encoding). Fii concret, nu generic.`;

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
              content: `Rol utilizator: ${role}\nPagina: ${page}\nProblema: ${message}\nContext: ${JSON.stringify(body.context ?? {}).slice(0, 2000)}`,
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
    await db`
      INSERT INTO issues (id, source, reporter, role, page, message, context, ai_diagnosis, org_id)
      VALUES (${id}, 'user', ${reporter}, ${role}, ${page}, ${message},
              ${db.json((body.context ?? {}) as Record<string, string>)},
              ${aiDiagnosis}, ${orgId})
    `;

    // Soluția pentru utilizator, extrasă din triaj — o vede pe loc.
    const solutionMatch = aiDiagnosis.match(
      /SOLU[ȚT]IE PENTRU UTILIZATOR:\s*([\s\S]*?)(?=PENTRU ADMIN:|$)/i,
    );
    return Response.json({
      ok: true,
      id,
      suggestion: solutionMatch ? solutionMatch[1].trim() : null,
    });
  } catch (e) {
    console.error("[issues POST]", e);
    return Response.json({ error: "Eroare la raportare" }, { status: 500 });
  }
}
