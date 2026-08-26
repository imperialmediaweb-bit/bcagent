import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import {
  normalizePhone,
  PROSPECT_STATUSES,
  type ProspectStatus,
} from "@/modules/prospects";

export const runtime = "nodejs";

async function authorize(req: Request, tokenFromBody?: string) {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) return { error: "Server not configured", status: 500 as const };
  const url = new URL(req.url);
  const token = tokenFromBody ?? url.searchParams.get("token");
  if (!token) return { error: "token lipsește", status: 400 as const };
  const payload = await verifyFieldToken(token, tokenSecret);
  if (!payload) return { error: "Token invalid sau expirat", status: 401 as const };
  return { agentId: payload.agentId, agentName: payload.agentName };
}

interface ProspectRow {
  cui: string;
  denumire: string;
  adresa: string;
  /** Adresa vine din livrare (cea adevărată), nu din sediul social? */
  din_livrare?: boolean;
  localitate: string;
  judet: string;
  caen: string;
  caen_desc: string;
  tva: boolean | null;
  activ: boolean | null;
  /** Firma are locul ei exact pe hartă, pus de om sau învățat de la GPS. */
  pin_exact: boolean | null;
  /** Agentul are voie să-i mute locul (izolarea între agenții). */
  pot_pin: boolean | null;
  pin_lat: number | null;
  pin_lng: number | null;
  status: string;
  note: string;
  assigned_agent: string;
  telefon: string;
  email: string;
  contact: string;
  sold_cents: string | null;
  updated_at: Date;
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json(
      { enabled: false, error: "Baza de date nu e configurată (DATABASE_URL)" },
      { status: 503 },
    );
  }
  const auth = await authorize(req);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const judet = url.searchParams.get("judet") ?? "";
  const localitate = url.searchParams.get("localitate") ?? "";
  // `caen` = prefix (47 → tot comerțul cu amănuntul; 4711 → exact)
  const caen = (url.searchParams.get("caen") ?? "").replace(/\D/g, "").slice(0, 4);
  // `caenIn` = listă de coduri/prefixe separate prin virgulă (presetări domeniu)
  const caenIn = (url.searchParams.get("caenIn") ?? "")
    .split(",")
    .map((s) => s.replace(/\D/g, "").slice(0, 4))
    .filter((s) => s.length >= 2)
    .slice(0, 40);
  const status = url.searchParams.get("status") ?? "";
  const search = (url.searchParams.get("search") ?? "").trim();
  const agent = url.searchParams.get("agent") ?? "";
  const onlyActive = url.searchParams.get("onlyActive") === "1";
  const onlyTva = url.searchParams.get("onlyTva") === "1";
  const withPhone = url.searchParams.get("withPhone") === "1";
  // `aiMei=1`: CLIENȚII apelantului apar MEREU (în județul/localitatea
  // cerută), chiar dacă nu se potrivesc pe domeniu/CAEN sau îs marcați
  // inactivi în registrul MF. Altfel, agentul deschide satul lui pe hartă
  // și întreabă „unde sunt restul de clienți?" — clienții lui reali au
  // adesea alt cod CAEN decât presetarea aleasă.
  const aiMei = url.searchParams.get("aiMei") === "1";
  // „usor=1": doar lista, fără numărătoarea totală și fără pâlnie.
  // Căutarea de pe prima pagină cere 8 rânduri la fiecare literă — n-are
  // rost să numere de fiecare dată tot registrul de 1,3M de firme.
  const usor = url.searchParams.get("usor") === "1";
  // Căutarea fără diacritice: pe telefon nimeni nu scrie „MĂGĂZINUL",
  // scrie „magazinul". Îndoim ambele părți la aceleași litere simple.
  // ATENȚIE la ordine: lower() ÎNAINTE de translate (altfel majusculele
  // cu diacritice — „MĂGĂZIN" — scapă neîndoite).
  const cautNeted = search
    .toLowerCase()
    .replace(/[ăâ]/g, "a")
    .replace(/î/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .trim();
  const limit = Math.min(
    500,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100),
  );
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
  );

  try {
    await ensureSchema();

    // IZOLARE ÎNTRE FIRME: starea de lucru (status/notă/agent/sold) se vede
    // doar pe rândurile firmei apelantului; ale altora apar ca firme simple.
    const { orgAgentNamesForAgent, orgIdForAgent } = await import("@/lib/org-scope");
    const mine = await orgAgentNamesForAgent(auth.agentId);
    const orgId = await orgIdForAgent(auth.agentId);
    const masked = mine.length > 0;
    const mineArr = masked ? mine : [""];

    // Pentru „ai mei": registrul pune firma pe satul de ÎNREGISTRARE, nu
    // unde e magazinul în realitate. Ca clientul să apară în satul lui
    // adevărat, îl potrivim și după ADRESĂ (textul conține numele satului)
    // și după PINUL GPS lăsat de agent la vizită (±~3km de centrul
    // localității cerute).
    let centruLat: number | null = null;
    let centruLng: number | null = null;
    if (aiMei && localitate !== "" && judet !== "") {
      const [centru] = await db<Array<{ lat: number | null; lng: number | null }>>`
        SELECT lat, lng FROM geo_localitati
        WHERE judet = ${judet} AND localitate ILIKE ${"%" + localitate + "%"}
          AND lat IS NOT NULL
        -- Potrivirea EXACTĂ întâi, apoi cea mai scurtă — altfel „MOARA"
        -- putea nimeri aleator centrul din „MOARA NICA".
        ORDER BY (localitate = ${localitate}) DESC, length(localitate) ASC
        LIMIT 1
      `;
      if (centru && centru.lat !== null && centru.lng !== null) {
        centruLat = centru.lat;
        centruLng = centru.lng;
      }
    }
    const areCentru = centruLat !== null && centruLng !== null;

    // Filtrul e construit o singură dată și refolosit la listă + count.
    // caen/caenIn funcționează pe PREFIX: "47" prinde tot 47xx, "4711" exact.
    const caenPattern = caen ? `${caen}%` : "";
    const caenInPatterns = caenIn.map((c) => `${c}%`);
    // „E AL MEU?" — într-un singur loc, ca să nu se despartă în zece
    // variante care se bat cap în cap.
    //
    // Numele agentului NU ajunge. „Popescu Ion" poate fi și la firma de
    // alături; până acum, orice condiție de forma „alocat unuia de-ai
    // mei" prindea și clienții ei — cu stare, notă și sold cu tot.
    // Firma scrisă pe alocare hotărăște. Gol = alocare veche, dinainte
    // de coloană: aia se judecă după nume, ca înainte, ca să nu rămână
    // nimeni fără clienți peste noapte.
    //
    // Fragment construit proaspăt la fiecare folosire (postgres.js nu
    // garantează reutilizarea aceluiași fragment în două interogări).
    const alMeu = () => db`(assigned_agent = ANY(${mineArr})
        AND (assigned_org = '' OR assigned_org = ${orgId || "-"}))`;
    const buildWhere = () => db`
      WHERE NOT EXISTS (
          -- Firmele pe care AGENȚII NOȘTRI le-au găsit închise pe teren
          -- (prospecți din registrul comun) nu ne mai apar nouă; pe harta
          -- altor agenții rămân neatinse.
          SELECT 1 FROM prospect_inchis pi
          WHERE pi.cui = prospects.cui AND pi.org_id = ${orgId || "-"}
        )
        AND (
        ((${judet} = '' OR judet = ${judet})
        AND (${localitate} = '' OR localitate ILIKE ${"%" + localitate + "%"})
        -- FIRMELE ADUSE DIN HARTA NOASTRĂ N-AU CAEN, fiindcă la Finanțe
        -- n-au fost găsite. Un filtru pe domeniu le ascundea pe toate —
        -- 1073 de magazine adevărate, cu locul pus de mână, dispăreau din
        -- liste fără ca nimeni să afle de ce.
        -- Nu pretindem că sunt alimentare: pretindem doar că sunt
        -- magazinele de pe harta ACESTEI firme, ceea ce e un fapt. Ale
        -- altor agenții rămân ascunse, ca până acum.
        AND (${caenPattern} = '' OR caen LIKE ${caenPattern}
             OR (COALESCE(caen,'') = '' AND adus_de_org = ${orgId || "-"}))
        AND (${caenInPatterns.length === 0} OR caen LIKE ANY(${caenInPatterns})
             OR (COALESCE(caen,'') = '' AND adus_de_org = ${orgId || "-"}))
        AND (${status} = ''
             -- Ramura asta folosește indexul pe status (1,3M firme).
             OR (status = ${status}
                 AND (${!masked} OR COALESCE(assigned_agent,'') = ''
                      OR ${alMeu()}))
             -- Firmele altei agenții ne apar ca „nou".
             OR (${masked} AND ${status} = 'nou'
                 AND COALESCE(assigned_agent,'') <> ''
                 AND NOT (${alMeu()})))
        AND (${agent} = '' OR
             (CASE WHEN ${!masked} OR ${alMeu()}
                   THEN assigned_agent ELSE '' END) = ${agent})
        AND (${!onlyActive} OR activ IS DISTINCT FROM FALSE)
        AND (${!onlyTva} OR tva IS TRUE)
        AND (${!withPhone} OR (telefon IS NOT NULL AND telefon <> ''))
        AND (${search} = ''
             OR denumire ILIKE ${"%" + search + "%"}
             OR translate(lower(denumire), 'ăâîșțşţ', 'aaistst') LIKE ${"%" + cautNeted + "%"}
             OR cui LIKE ${search + "%"}
             OR adresa ILIKE ${"%" + search + "%"}))
        -- CLIENȚII MEI: mereu vizibili în zona cerută, peste orice filtru
        -- de domeniu/stare — doar județ/localitate/căutare se respectă.
        OR (${aiMei}
            AND status = 'client'
            AND assigned_agent = ${auth.agentName}
            AND (${judet} = '' OR judet = ${judet})
            AND (${localitate} = ''
                 -- satul de înregistrare din registru...
                 OR localitate ILIKE ${"%" + localitate + "%"}
                 -- ...sau adresa pomenește satul cerut (sediu pe comună)...
                 OR adresa ILIKE ${"%" + localitate + "%"}
                 -- ...sau pinul GPS lăsat de agent cade lângă satul cerut.
                 OR (${areCentru} AND EXISTS (
                       SELECT 1 FROM geo_firme g
                       WHERE g.cui = prospects.cui AND g.aprox = FALSE
                         AND g.lat BETWEEN ${(centruLat ?? 0) - 0.03} AND ${(centruLat ?? 0) + 0.03}
                         AND g.lng BETWEEN ${(centruLng ?? 0) - 0.045} AND ${(centruLng ?? 0) + 0.045}
                     )))
            -- Pe clienții MEI (listă mică) ne permitem potrivirea fără
            -- diacritice: „magazinul" găsește „MĂGĂZINUL".
            AND (${search} = ''
                 OR translate(lower(denumire), 'ăâîșțşţ', 'aaistst') LIKE ${"%" + cautNeted + "%"}
                 OR cui LIKE ${search + "%"}
                 OR translate(lower(adresa), 'ăâîșțşţ', 'aaistst') LIKE ${"%" + cautNeted + "%"}
                 OR translate(lower(localitate), 'ăâîșțşţ', 'aaistst') LIKE ${"%" + cautNeted + "%"}))
      )
    `;

    const rows = await db<ProspectRow[]>`
      SELECT cui, denumire,
             -- ADRESA DE LIVRARE BATE SEDIUL SOCIAL.
             -- Sediul e de la Finanțe: la un PFA, casa omului — de-aia
             -- „Navighează" îl lăsa rece pe Costin la Andronache. Adresa de
             -- livrare e scrisă de firmă și verificată de fiecare mașină
             -- care a dus marfă acolo. Când o avem, ea e adevărul.
             CASE WHEN COALESCE(adresa_livrare, '') <> ''
                  THEN adresa_livrare ELSE adresa END AS adresa,
             CASE WHEN COALESCE(localitate_livrare, '') <> ''
                  THEN localitate_livrare ELSE localitate END AS localitate,
             (COALESCE(adresa_livrare, '') <> '') AS din_livrare,
             judet, caen, caen_desc,
             tva, activ,
             -- Firma are LOCUL EI pe hartă (pus de agent sau învățat de la
             -- GPS)? Fără asta, „șterge locul pus" apărea și la firmele
             -- care stau, de fapt, în centrul satului.
             EXISTS (SELECT 1 FROM geo_firme g WHERE g.cui = prospects.cui) AS pin_exact,
             -- Am voie să-i mut locul? Aceeași regulă ca la scriere: firmele
             -- mele, ale colegilor din firma mea, sau nealocate. Fără asta,
             -- agentul apăsa butonul și primea un refuz în plin teren.
             (${!masked} OR COALESCE(assigned_agent,'') = ''
              OR ${alMeu()}) AS pot_pin,
             (SELECT g.lat FROM geo_firme g WHERE g.cui = prospects.cui) AS pin_lat,
             (SELECT g.lng FROM geo_firme g WHERE g.cui = prospects.cui) AS pin_lng,
             (CASE WHEN ${!masked} OR assigned_agent = '' OR ${alMeu()}
                   THEN status ELSE 'nou' END) AS status,
             (CASE WHEN ${!masked} OR assigned_agent = '' OR ${alMeu()}
                   THEN note ELSE '' END) AS note,
             (CASE WHEN ${!masked} OR ${alMeu()}
                   THEN assigned_agent ELSE '' END) AS assigned_agent,
             COALESCE(telefon, '') AS telefon,
             COALESCE(email, '') AS email,
             COALESCE(contact, '') AS contact,
             (CASE WHEN ${!masked} OR assigned_agent = '' OR ${alMeu()}
                   THEN sold_cents ELSE NULL END)::text AS sold_cents,
             updated_at
      FROM prospects
      ${buildWhere()}
      -- Clienții MEI primii: altfel, într-o localitate cu mai multe firme
      -- decât limita cerută, LIMIT i-ar tăia exact pe ei (alfabetic).
      -- 1) clienții MEI, 2) potrivirile pe NUME (nu doar pe localitate),
      -- 3) alfabetic. Altfel, căutând „rad" primeai 8 clienți din
      -- Rădăuți și tocmai firma căutată rămânea pe dinafară.
      ORDER BY (${aiMei} AND status = 'client' AND assigned_agent = ${auth.agentName}) DESC,
               (${search} <> '' AND translate(lower(denumire), 'ăâîșțşţ', 'aaistst')
                  LIKE ${"%" + cautNeted + "%"}) DESC,
               denumire ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [{ count }] = usor
      ? [{ count: String(rows.length) }]
      : await db<[{ count: string }]>`
          SELECT COUNT(*)::text AS count FROM prospects ${buildWhere()}
        `;
    const [funnel] = usor
      ? [{ total: "0", contactati: "0", clienti: "0" }]
      : await db<
      [{ total: string; contactati: string; clienti: string }]
    >`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE status = 'contactat'
               AND (${!masked} OR assigned_agent = '' OR ${alMeu()}))::text AS contactati,
             COUNT(*) FILTER (WHERE status = 'client'
               AND (${!masked} OR assigned_agent = '' OR ${alMeu()}))::text AS clienti
      FROM prospects
    `;
    return Response.json({
      enabled: true,
      total: parseInt(count, 10),
      funnel: {
        total: parseInt(funnel.total, 10),
        contactati: parseInt(funnel.contactati, 10),
        clienti: parseInt(funnel.clienti, 10),
      },
      prospects: rows.map((r) => ({
        cui: r.cui,
        denumire: r.denumire,
        adresa: r.adresa,
        // Ca agentul să știe pe ce se bizuie când apasă „Navighează".
        adresaExacta: r.din_livrare === true,
        localitate: r.localitate,
        judet: r.judet,
        caen: r.caen,
        caenDesc: r.caen_desc,
        tva: r.tva,
        activ: r.activ,
        pinExact: r.pin_exact === true,
        potPin: r.pot_pin === true,
        pinLat: r.pin_lat,
        pinLng: r.pin_lng,
        status: r.status,
        note: r.note,
        assignedAgent: r.assigned_agent,
        telefon: r.telefon,
        email: r.email,
        contact: r.contact,
        soldCents: r.sold_cents ? parseInt(r.sold_cents, 10) : null,
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[prospects GET]", e);
    return Response.json({ error: "Eroare la citirea prospecților" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false }, { status: 503 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`prospects-patch:${ip}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }

  let body: {
    token?: string;
    cui?: string;
    status?: string;
    note?: string;
    assignedAgent?: string;
    telefon?: string;
    email?: string;
    contact?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const auth = await authorize(req, body.token);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const cui = String(body.cui ?? "").replace(/\D/g, "");
  if (!cui) return Response.json({ error: "cui lipsește" }, { status: 400 });

  if (
    body.status !== undefined &&
    !PROSPECT_STATUSES.includes(body.status as ProspectStatus)
  ) {
    return Response.json({ error: "status invalid" }, { status: 400 });
  }
  if (body.note !== undefined && String(body.note).length > 2000) {
    return Response.json({ error: "notă prea lungă" }, { status: 400 });
  }
  if (
    body.assignedAgent !== undefined &&
    String(body.assignedAgent).length > 128
  ) {
    return Response.json({ error: "agent invalid" }, { status: 400 });
  }
  if (body.telefon !== undefined && String(body.telefon).length > 40) {
    return Response.json({ error: "telefon invalid" }, { status: 400 });
  }
  if (body.email !== undefined) {
    const em = String(body.email).trim();
    if (em.length > 160 || (em !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em))) {
      return Response.json({ error: "email invalid" }, { status: 400 });
    }
  }
  if (body.contact !== undefined && String(body.contact).length > 160) {
    return Response.json({ error: "contact invalid" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // IZOLARE: nu poți modifica o firmă aflată în lucru la ALTĂ agenție.
    const { orgAgentNamesForAgent, orgIdForAgent } = await import(
      "@/lib/org-scope"
    );
    const mine = await orgAgentNamesForAgent(auth.agentId);
    const firmaMea = await orgIdForAgent(auth.agentId);
    if (mine.length > 0) {
      const [cur] = await db<Array<{ assigned_agent: string; assigned_org: string }>>`
        SELECT COALESCE(assigned_agent, '') AS assigned_agent,
               COALESCE(assigned_org, '') AS assigned_org
        FROM prospects WHERE cui = ${cui}
      `;
      // NUMELE NU AJUNGE. Dacă firma e alocată unui „Popescu Ion" care e
      // al altei agenții, numele se potrivește și poarta s-ar deschide.
      // Firma scrisă pe alocare e cea care hotărăște; gol = alocare
      // veche, și atunci rămâne judecata după nume, ca înainte.
      const alAltora =
        cur &&
        cur.assigned_agent !== "" &&
        (!mine.includes(cur.assigned_agent) ||
          (cur.assigned_org !== "" && cur.assigned_org !== firmaMea));
      if (alAltora) {
        return Response.json(
          { error: "Firma asta e gestionată de altă agenție." },
          { status: 403 },
        );
      }
    }

    // Actualizează doar câmpurile trimise
    const updates: Record<string, string> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.note !== undefined) updates.note = String(body.note);
    if (body.assignedAgent !== undefined) {
      updates.assigned_agent = String(body.assignedAgent);
      // Alocarea își poartă firma cu ea, ca să se știe mereu a cui e.
      updates.assigned_org = firmaMea;
    }
    if (body.telefon !== undefined)
      updates.telefon = normalizePhone(String(body.telefon)) || String(body.telefon).trim().slice(0, 40);
    if (body.email !== undefined) updates.email = String(body.email).trim();
    if (body.contact !== undefined) updates.contact = String(body.contact).trim();
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "nimic de actualizat" }, { status: 400 });
    }
    await db`
      UPDATE prospects
      SET ${db(updates)}, updated_at = NOW()
      WHERE cui = ${cui}
    `;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[prospects PATCH]", e);
    return Response.json({ error: "Eroare la actualizare" }, { status: 500 });
  }
}
