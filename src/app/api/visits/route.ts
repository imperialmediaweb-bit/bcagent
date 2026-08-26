import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Jurnalul vizitelor din teren. Fiecare rezultat face două lucruri:
 * scrie vizita în jurnal ȘI actualizează statusul prospectului, ca listele
 * („de vizitat", pete albe) să rămână curate fără muncă suplimentară.
 */

const RESULTS = ["gandeste", "ne_suna", "nu_vrea", "client", "inchis"] as const;
type VisitResult = (typeof RESULTS)[number];

/** Rezultatul vizitei → statusul prospectului (inchis nu schimbă nimic). */
const STATUS_FOR_RESULT: Record<VisitResult, string | null> = {
  gandeste: "contactat",
  ne_suna: "contactat",
  nu_vrea: "respins",
  client: "client",
  inchis: null,
};

async function authorize(req: Request, tokenFromBody?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenFromBody ?? new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return null;
  return verifyFieldToken(token, secret);
}

interface VisitRow {
  id: string;
  agent_id: string;
  agent_name: string;
  cui: string;
  denumire: string;
  result: string;
  note: string;
  visited_at: Date;
}

export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const payload = await authorize(req);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const url = new URL(req.url);
  const cui = (url.searchParams.get("cui") ?? "").replace(/\D/g, "");
  const due = url.searchParams.get("due") === "1";
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();

    // ?due=1 → clienții „scadenți": în distribuția de țigări vizita
    // săptămânală e obligatorie — cine n-a fost vizitat în ultimele 7 zile
    // apare aici, cel mai vechi primul.
    if (due) {
      const dueRows = await db<
        Array<{
          cui: string;
          denumire: string;
          adresa: string;
          localitate: string;
          judet: string;
          telefon: string;
          last_visit: Date | null;
        }>
      >`
        SELECT p.cui, p.denumire, COALESCE(p.adresa,'') AS adresa,
               COALESCE(p.localitate,'') AS localitate, COALESCE(p.judet,'') AS judet,
               COALESCE(p.telefon,'') AS telefon,
               MAX(v.visited_at) AS last_visit
        FROM prospects p
        LEFT JOIN visits v ON v.cui = p.cui
        WHERE p.status = 'client'
          AND (p.assigned_agent = ${payload.agentName} OR p.assigned_agent = '')
        GROUP BY p.cui, p.denumire, p.adresa, p.localitate, p.judet, p.telefon
        HAVING MAX(v.visited_at) IS NULL
            OR MAX(v.visited_at) < NOW() - INTERVAL '7 days'
        ORDER BY MAX(v.visited_at) ASC NULLS FIRST
        LIMIT ${limit}
      `;
      return Response.json({
        due: dueRows.map((r) => ({
          cui: r.cui,
          denumire: r.denumire,
          adresa: r.adresa,
          localitate: r.localitate,
          judet: r.judet,
          telefon: r.telefon,
          lastVisit: r.last_visit ? r.last_visit.toISOString() : null,
        })),
      });
    }
    // Vizitele agentului curent; cu ?cui= vezi istoricul unei firme anume
    // (indiferent de agent — util la preluarea portofoliului).
    const rows = await db<VisitRow[]>`
      SELECT id::text, agent_id, agent_name, cui, denumire, result, note, visited_at
      FROM visits
      WHERE (${cui} = '' AND agent_id = ${payload.agentId})
         OR (${cui} <> '' AND cui = ${cui})
      ORDER BY visited_at DESC
      LIMIT ${limit}
    `;
    const [today] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM visits
      WHERE agent_id = ${payload.agentId}
        AND visited_at >= date_trunc('day', NOW())
    `;
    return Response.json({
      visits: rows.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        cui: r.cui,
        denumire: r.denumire,
        result: r.result,
        note: r.note,
        visitedAt: r.visited_at.toISOString(),
      })),
      today: parseInt(today.count, 10),
    });
  } catch (e) {
    console.error("[visits GET]", e);
    return Response.json({ error: "Eroare la citirea vizitelor" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const ip = clientIP(req);
  const rl = rateLimit(`visits:${ip}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }

  let body: {
    token?: string;
    cui?: string;
    denumire?: string;
    result?: string;
    note?: string;
    /** Poziția GPS a telefonului ÎN MOMENTUL vizitei (opțional) — cu ea
     *  pinul firmei devine EXACT, nu „undeva în sat". */
    lat?: number;
    lng?: number;
    /** Precizia raportată de GPS, în metri. */
    acc?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = await authorize(req, body.token);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const cui = String(body.cui ?? "").replace(/\D/g, "");
  if (!cui) return Response.json({ error: "cui lipsește" }, { status: 400 });
  const result = String(body.result ?? "") as VisitResult;
  if (!RESULTS.includes(result)) {
    return Response.json({ error: "rezultat invalid" }, { status: 400 });
  }
  const note = String(body.note ?? "").slice(0, 1000);

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // O SINGURĂ VIZITĂ, chiar dacă apasă de două ori.
    // Din teren, 26.08: COLER COM S.R.L. apare de două ori la 13:26, cu
    // aceeași notă. Agentul n-a intrat de două ori în magazin — a apăsat
    // a doua oară fiindcă telefonul mergea greu și nu s-a întâmplat nimic
    // pe ecran. Aceeași vizită, la același client, cu aceeași notă, în
    // aceeași clipă, e o singură vizită. Două minute e larg: nimeni nu
    // intră de două ori în același magazin în două minute, dar orice
    // apăsare nervoasă și orice retrimitere din rețea încap acolo.
    await db`
      INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note)
      SELECT ${payload.agentId}, ${payload.agentName}, ${cui},
             ${String(body.denumire ?? "").slice(0, 200)}, ${result}, ${note}
      WHERE NOT EXISTS (
        SELECT 1 FROM visits v
        WHERE v.agent_id = ${payload.agentId}
          AND v.cui = ${cui}
          AND v.result = ${result}
          AND v.note = ${note}
          AND v.visited_at > NOW() - INTERVAL '2 minutes'
      )
    `;
    // IZOLARE (o singură dată, pentru toate scrierile de mai jos): pe
    // firmele altei agenții nu se atinge nimic. „Ai mei" = numele din
    // firma mea SAU chiar numele meu (linkurile vechi, fără organizație).
    // La orice eroare de citire, orgAgentNamesForAgent întoarce [] —
    // atunci rămâne doar numele meu, adică FAIL-ÎNCHIS, nu bypass.
    const { orgAgentNamesForAgent } = await import("@/lib/org-scope");
    const mine = await orgAgentNamesForAgent(payload.agentId);
    const aiMei = mine.length ? mine : [payload.agentName];

    // „ÎNCHIS" din teren: agentul a văzut cu ochii lui că firma nu mai
    // există (pensiuni moarte de 10 ani, PFA-uri uitate în registru) —
    // o scoatem de pe hartă și din liste pentru toată lumea. Registrul
    // MF nu le radiază; terenul da.
    if (result === "inchis") {
      // CLIENTUL NOSTRU închis pe teren → se stinge global: îl cunoaștem,
      // știm sigur că magazinul nu mai există. `inchis_teren` oprește și
      // verificarea ANAF lunară să-l reînvie (legal poate fi activ).
      const stins = await db`
        UPDATE prospects
        SET activ = FALSE, inchis_teren = TRUE, updated_at = NOW()
        WHERE cui = ${cui}
          AND COALESCE(assigned_agent, '') <> ''
          AND (assigned_agent = ${payload.agentName}
               OR assigned_agent = ANY(${aiMei}))
      `;
      if (stins.count === 0) {
        // Firmă NEALOCATĂ (prospect din registrul comun): o ascundem DOAR
        // de firma noastră. Registrul e al tuturor agențiilor — un apăsat
        // greșit n-are voie să șteargă prospectul altcuiva de pe hartă.
        const { orgIdForAgent } = await import("@/lib/org-scope");
        const orgId = await orgIdForAgent(payload.agentId);
        if (orgId) {
          await db`
            INSERT INTO prospect_inchis (cui, org_id, agent_name)
            VALUES (${cui}, ${orgId}, ${payload.agentName})
            ON CONFLICT (cui, org_id) DO NOTHING
          `;
        }
      }
    }
    const status = STATUS_FOR_RESULT[result];
    if (status) {
      // Vizita alocă firma agentului care a fost la ea (dacă nu era a
      // altcuiva) — și NU modifică starea/nota clientului altei agenții.
      await db`
        UPDATE prospects
        SET status = ${status},
            assigned_agent = CASE
              WHEN assigned_agent = '' THEN ${payload.agentName}
              ELSE assigned_agent
            END,
            note = CASE
              WHEN ${note} = '' THEN note
              WHEN note = '' THEN ${note}
              ELSE note || E'\n' || ${note}
            END,
            updated_at = NOW()
        WHERE cui = ${cui}
          AND (COALESCE(assigned_agent, '') = ''
               OR assigned_agent = ${payload.agentName}
               OR assigned_agent = ANY(${aiMei}))
      `;
    }
    // PINUL ÎNVAȚĂ DE LA OM: agentul stă chiar în fața magazinului când
    // apasă „Am fost" — dacă telefonul dă un fix bun (≤250m, în România),
    // firma primește coordonatele EXACTE și pinul nu mai e „prin sat".
    // Tot cu izolare: poziția firmelor altei agenții nu se atinge.
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const acc = Number(body.acc ?? 9999);
    const fixBun =
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= 43.3 && lat <= 48.4 && lng >= 20.1 && lng <= 30.0 &&
      Number.isFinite(acc) && acc > 0 && acc <= 250;
    let pinScris = false;
    if (fixBun) {
      const scris = await db`
        INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
        SELECT p.cui, ${lat}, ${lng}, FALSE, FALSE, 'gps'
        FROM prospects p
        WHERE p.cui = ${cui}
          AND (COALESCE(p.assigned_agent, '') = ''
               OR p.assigned_agent = ${payload.agentName}
               OR p.assigned_agent = ANY(${aiMei}))
        ON CONFLICT (cui) DO UPDATE
          SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
              aprox = FALSE, failed = FALSE, sursa = 'gps',
              updated_at = NOW()
      `;
      pinScris = scris.count > 0;
    }
    return Response.json({ ok: true, pinExact: pinScris });
  } catch (e) {
    console.error("[visits POST]", e);
    return Response.json({ error: "Eroare la salvarea vizitei" }, { status: 500 });
  }
}
