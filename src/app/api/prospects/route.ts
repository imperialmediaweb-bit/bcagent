import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/modules/prospects";

export const runtime = "nodejs";

async function authorize(req: Request, tokenFromBody?: string) {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) return { error: "Server not configured", status: 500 as const };
  const url = new URL(req.url);
  const token = tokenFromBody ?? url.searchParams.get("token");
  if (!token) return { error: "token lipsește", status: 400 as const };
  const payload = await verifyToken(token, tokenSecret);
  if (!payload) return { error: "Token invalid sau expirat", status: 401 as const };
  return { agentId: payload.agentId, agentName: payload.agentName };
}

interface ProspectRow {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  caen_desc: string;
  tva: boolean | null;
  activ: boolean | null;
  status: string;
  note: string;
  assigned_agent: string;
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
  const search = url.searchParams.get("search") ?? "";
  const agent = url.searchParams.get("agent") ?? "";
  const onlyActive = url.searchParams.get("onlyActive") === "1";
  const onlyTva = url.searchParams.get("onlyTva") === "1";
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

    // Filtrul e construit o singură dată și refolosit la listă + count.
    // caen/caenIn funcționează pe PREFIX: "47" prinde tot 47xx, "4711" exact.
    const caenPattern = caen ? `${caen}%` : "";
    const caenInPatterns = caenIn.map((c) => `${c}%`);
    // Fragment construit proaspăt la fiecare folosire (postgres.js nu
    // garantează reutilizarea aceluiași fragment în două interogări).
    const buildWhere = () => db`
      WHERE (${judet} = '' OR judet = ${judet})
        AND (${localitate} = '' OR localitate ILIKE ${"%" + localitate + "%"})
        AND (${caenPattern} = '' OR caen LIKE ${caenPattern})
        AND (${caenInPatterns.length === 0} OR caen LIKE ANY(${caenInPatterns}))
        AND (${status} = '' OR status = ${status})
        AND (${agent} = '' OR assigned_agent = ${agent})
        AND (${!onlyActive} OR activ IS TRUE)
        AND (${!onlyTva} OR tva IS TRUE)
        AND (${search} = '' OR denumire ILIKE ${"%" + search + "%"} OR cui LIKE ${search + "%"} OR adresa ILIKE ${"%" + search + "%"})
    `;

    const rows = await db<ProspectRow[]>`
      SELECT cui, denumire, adresa, localitate, judet, caen, caen_desc,
             tva, activ, status, note, assigned_agent, updated_at
      FROM prospects
      ${buildWhere()}
      ORDER BY denumire ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM prospects ${buildWhere()}
    `;
    const [funnel] = await db<
      [{ total: string; contactati: string; clienti: string }]
    >`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE status = 'contactat')::text AS contactati,
             COUNT(*) FILTER (WHERE status = 'client')::text AS clienti
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
        localitate: r.localitate,
        judet: r.judet,
        caen: r.caen,
        caenDesc: r.caen_desc,
        tva: r.tva,
        activ: r.activ,
        status: r.status,
        note: r.note,
        assignedAgent: r.assigned_agent,
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

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // Actualizează doar câmpurile trimise
    const updates: Record<string, string> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.note !== undefined) updates.note = String(body.note);
    if (body.assignedAgent !== undefined)
      updates.assigned_agent = String(body.assignedAgent);
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
