import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Soldurile/restanțele clienților, importate din raportul SAGA
 * („Solduri clienți"): potrivire pe CUI (exactă) sau pe denumire
 * (normalizată — aceeași schemă ca la match). Restanța apare apoi pe
 * firmă peste tot: în hartă, la comandă, în lista de clienți.
 */

const LEGAL_TOKENS = new Set([
  "SC", "SRL", "S", "R", "L", "SA", "PFA", "II", "IF", "SNC", "SCS", "SRLD",
]);

function normalizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, " ").toUpperCase().trim();
}

function coreName(norm: string): string {
  const tokens = norm.split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_TOKENS.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && LEGAL_TOKENS.has(tokens[tokens.length - 1]))
    tokens.pop();
  return tokens.join(" ");
}

function variantsFor(name: string): string[] {
  const norm = normalizeName(name);
  if (norm.length < 4) return [];
  const core = coreName(norm);
  const set = new Set<string>([norm]);
  if (core.length >= 4) {
    set.add(core);
    set.add(`${core} SRL`);
    set.add(`${core} S R L`);
    set.add(`SC ${core} SRL`);
  }
  return Array.from(set);
}

/** Importă soldurile: [{cui?, name?, sold (RON)}]. */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: {
    rows?: Array<{ cui?: string; name?: string; sold?: number }>;
    dryRun?: boolean;
  };
  try {
    await ensureSchema();
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return Response.json({ error: "rows trebuie să fie listă" }, { status: 400 });
  }

  const rows = body.rows
    .map((r) => ({
      cui: String(r.cui ?? "").replace(/\D/g, "").slice(0, 12),
      name: String(r.name ?? "").trim().slice(0, 200),
      soldCents: Math.round((Number(r.sold) || 0) * 100),
    }))
    .filter((r) => (r.cui !== "" || r.name.length >= 4))
    .slice(0, 2000);

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // 1) Potrivire pe CUI (exactă).
    const byCui = rows.filter((r) => r.cui !== "");
    const cuis = byCui.map((r) => r.cui);
    const foundCui = new Set(
      cuis.length
        ? (
            await db<Array<{ cui: string }>>`
              SELECT cui FROM prospects WHERE cui = ANY(${cuis})
            `
          ).map((r) => r.cui)
        : [],
    );

    // 2) Restul, pe denumire normalizată.
    const byName = rows.filter((r) => r.cui === "" || !foundCui.has(r.cui));
    const variantToRow = new Map<string, (typeof rows)[number]>();
    for (const r of byName) {
      if (!r.name) continue;
      for (const v of variantsFor(r.name)) {
        if (!variantToRow.has(v)) variantToRow.set(v, r);
      }
    }
    const nameMatches = variantToRow.size
      ? await db<Array<{ cui: string; norm: string }>>`
          SELECT cui,
                 btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g'))) AS norm
          FROM prospects
          WHERE btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
                = ANY(${Array.from(variantToRow.keys())})
          LIMIT 3000
        `
      : [];

    // Consolidăm: cui → soldCents.
    const updates = new Map<string, number>();
    for (const r of byCui) {
      if (foundCui.has(r.cui)) updates.set(r.cui, r.soldCents);
    }
    const matchedNames = new Set<string>();
    for (const m of nameMatches) {
      const src = variantToRow.get(m.norm);
      if (src && !updates.has(m.cui)) {
        updates.set(m.cui, src.soldCents);
        matchedNames.add(src.name || src.cui);
      }
    }
    const matchedKeys = new Set([
      ...byCui.filter((r) => foundCui.has(r.cui)).map((r) => r.name || r.cui),
      ...matchedNames,
    ]);
    const unmatched = rows
      .map((r) => r.name || r.cui)
      .filter((k) => !matchedKeys.has(k));

    let updated = 0;
    if (!body.dryRun && updates.size > 0) {
      const payload = Array.from(updates.entries()).map(([cui, sold]) => ({
        cui,
        sold,
      }));
      const res = await db`
        UPDATE prospects p
        SET sold_cents = u.sold, sold_updated_at = NOW()
        FROM jsonb_to_recordset(${db.json(
          payload as unknown as Parameters<typeof db.json>[0],
        )}) AS u(cui TEXT, sold BIGINT)
        WHERE p.cui = u.cui
      `;
      updated = res.count;
      await audit(auth.session.email, "balances.import", auth.session.orgId, {
        updated,
      });
    }

    return Response.json({
      matched: updates.size,
      unmatched,
      updated,
      dryRun: !!body.dryRun,
    });
  } catch (e) {
    console.error("[balances POST]", e);
    return Response.json({ error: "Eroare la importul soldurilor" }, { status: 500 });
  }
}

/** Restanțele firmei: clienții cu sold > 0, cei mai datori primii. */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const agents = await listOrgAgents(auth.session.orgId);
    const names = agents.map((a) => a.name);
    const rows = await db<
      Array<{
        cui: string;
        denumire: string;
        localitate: string;
        telefon: string;
        assigned_agent: string;
        sold_cents: string;
        sold_updated_at: Date | null;
      }>
    >`
      SELECT cui, denumire, COALESCE(localitate,'') AS localitate,
             COALESCE(telefon,'') AS telefon, assigned_agent,
             sold_cents::text, sold_updated_at
      FROM prospects
      WHERE sold_cents IS NOT NULL AND sold_cents > 0
        AND (status = 'client' OR assigned_agent = ANY(${names.length ? names : [""]}))
      -- calificat: aliasul ::text din SELECT ar face sortarea lexicografică
      ORDER BY prospects.sold_cents DESC
      LIMIT ${Math.min(500, parseInt(new URL(req.url).searchParams.get("limit") ?? "200", 10) || 200)}
    `;
    const totalCents = rows.reduce((s, r) => s + parseInt(r.sold_cents, 10), 0);
    return Response.json({
      totalCents,
      clients: rows.map((r) => ({
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        telefon: r.telefon,
        agent: r.assigned_agent,
        soldCents: parseInt(r.sold_cents, 10),
        updatedAt: r.sold_updated_at ? r.sold_updated_at.toISOString() : null,
      })),
    });
  } catch (e) {
    console.error("[balances GET]", e);
    return Response.json({ error: "Eroare la citirea soldurilor" }, { status: 500 });
  }
}
