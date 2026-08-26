import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * LOCUL EXACT AL MAGAZINULUI, pus de om.
 *
 * Registrul MF dă sediul social, iar geocodarea dă centrul satului — de
 * aceea pinul apare „undeva prin Cătămărești", nu la ușa magazinului
 * („avem șanse ca locația să fie mai exactă?" — Costin Vlad, 26.08).
 *
 * Agentul are acum trei feluri de a-l pune, toate prin ruta asta:
 *   · „Am fost" cu GPS bun  → scris automat (vezi /api/visits)
 *   · „Sunt aici acum"      → sursa „gps", din poziția telefonului
 *   · „Mută pinul"          → sursa „deget", tras cu degetul pe hartă
 * Și îl poate șterge, dacă a greșit: firma se întoarce în centrul satului.
 *
 * Regula de aur: nu atingem poziția firmelor altei agenții.
 */

/** Colțurile României — orice în afară e greșeală, nu locație. */
const IN_ROMANIA = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= 43.3 &&
  lat <= 48.4 &&
  lng >= 20.1 &&
  lng <= 30.0;

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`pin:${clientIP(req)}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) return Response.json({ error: "Config lipsă" }, { status: 503 });

  let body: {
    token?: string;
    cui?: string;
    lat?: number;
    lng?: number;
    /** „deget" = tras pe hartă, „gps" = poziția telefonului. */
    sursa?: string;
    /** Precizia GPS în metri (doar la sursa „gps"). */
    acc?: number;
    /** true = șterge pinul pus de om, firma revine în centrul satului. */
    sterge?: boolean;
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
  const cui = String(body.cui ?? "").replace(/\D/g, "");
  if (!cui) return Response.json({ error: "Firma lipsește" }, { status: 400 });

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // IZOLARE: pot pune pin doar pe firmele mele, ale colegilor din firma
    // mea, sau pe cele nealocate. Pe ale altei agenții — niciodată.
    const { orgAgentNamesForAgent } = await import("@/lib/org-scope");
    const mine = await orgAgentNamesForAgent(payload.agentId);
    const aiMei = mine.length ? mine : [payload.agentName];

    if (body.sterge === true) {
      const sters = await db`
        DELETE FROM geo_firme
        WHERE cui = ${cui}
          AND EXISTS (
            SELECT 1 FROM prospects p
            WHERE p.cui = ${cui}
              AND (COALESCE(p.assigned_agent, '') = ''
                   OR p.assigned_agent = ${payload.agentName}
                   OR p.assigned_agent = ANY(${aiMei}))
          )
      `;
      return Response.json({ ok: true, sters: sters.count > 0 });
    }

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!IN_ROMANIA(lat, lng)) {
      return Response.json(
        { error: "Locul ăsta nu e în România — mai încearcă o dată." },
        { status: 400 },
      );
    }
    const sursa = body.sursa === "gps" ? "gps" : "deget";
    if (sursa === "gps") {
      // De la GPS acceptăm doar un fix bun: altfel „exact" ar fi o minciună
      // și agentul s-ar duce data viitoare unde l-a dus telefonul aiurea.
      const acc = Number(body.acc ?? 9999);
      if (!Number.isFinite(acc) || acc <= 0 || acc > 250) {
        return Response.json(
          {
            error:
              "Telefonul nu știe încă exact unde ești (semnal slab). Ieși din magazin, așteaptă câteva secunde și încearcă din nou — sau pune pinul cu degetul pe hartă.",
          },
          { status: 422 },
        );
      }
    }

    const scris = await db`
      INSERT INTO geo_firme (cui, lat, lng, aprox, failed, sursa)
      SELECT p.cui, ${lat}, ${lng}, FALSE, FALSE, ${sursa}
      FROM prospects p
      WHERE p.cui = ${cui}
        AND (COALESCE(p.assigned_agent, '') = ''
             OR p.assigned_agent = ${payload.agentName}
             OR p.assigned_agent = ANY(${aiMei}))
      ON CONFLICT (cui) DO UPDATE
        SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
            aprox = FALSE, failed = FALSE, updated_at = NOW()
    `;
    if (scris.count === 0) {
      return Response.json(
        { error: "Firma asta nu e a firmei tale — nu-i poți muta locul." },
        { status: 403 },
      );
    }
    return Response.json({ ok: true, lat, lng, sursa });
  } catch (e) {
    console.error("[pin firma]", e);
    return Response.json({ error: "Eroare la salvarea locului" }, { status: 500 });
  }
}
