import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { variantsFor } from "@/lib/name-match";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Importul clienților EXISTENȚI din XLS-urile de vânzări: numele clienților
 * se potrivesc cu firmele oficiale MF (aceeași normalizare ca la /match),
 * iar firmele găsite trec pe status „client" cu agentul care le vinde cel
 * mai mult. Rulează idempotent — a doua apăsare nu strică nimic.
 */


export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`import-clients:${clientIP(req)}`, {
    max: 5,
    windowMs: 60_000,
  });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: {
    token?: string;
    clients?: Array<{ name?: string; agent?: string; cui?: string }>;
    dryRun?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token || !(await verifyToken(body.token, secret))) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  if (!Array.isArray(body.clients)) {
    return Response.json({ error: "clients trebuie să fie listă" }, { status: 400 });
  }

  const clients = body.clients
    .filter(
      (c) =>
        (typeof c?.name === "string" && c.name.trim().length >= 4) ||
        String(c?.cui ?? "").replace(/\D/g, "").length >= 2,
    )
    .map((c) => ({
      name: String(c.name ?? "").trim().slice(0, 200),
      agent: String(c.agent ?? "").slice(0, 128),
      cui: String(c.cui ?? "").replace(/\D/g, "").slice(0, 12),
    }))
    .slice(0, 5000);

  const variantToClient = new Map<
    string,
    { name: string; agent: string; cui: string }
  >();
  for (const c of clients) {
    if (c.name.length < 4) continue;
    for (const v of variantsFor(c.name)) {
      if (!variantToClient.has(v)) variantToClient.set(v, c);
    }
  }
  const withCui = clients.filter((c) => c.cui.length >= 2);
  if (variantToClient.size === 0 && withCui.length === 0) {
    return Response.json({ matched: [], unmatched: clients.map((c) => c.name) });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();

    // Potrivirea pe CUI (dacă fișierul îl are) — exactă, prioritară.
    const cuiRows =
      withCui.length > 0
        ? await db<
            Array<{
              cui: string;
              denumire: string;
              localitate: string;
              judet: string;
              status: string;
            }>
          >`
            SELECT cui, denumire, localitate, judet, status FROM prospects
            WHERE cui = ANY(${withCui.map((c) => c.cui)})
          `
        : [];
    const cuiHits = new Map(cuiRows.map((r) => [r.cui, r]));
    const variants = Array.from(variantToClient.keys());
    const rows =
      variants.length > 0
        ? await db<
            Array<{
              cui: string;
              denumire: string;
              localitate: string;
              judet: string;
              status: string;
              norm: string;
            }>
          >`
            SELECT cui, denumire, localitate, judet, status,
                   btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g'))) AS norm
            FROM prospects
            WHERE btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
                  = ANY(${variants})
            LIMIT 10000
          `
        : [];

    // Un client din XLS → o singură firmă (prima cu localitate).
    const byClient = new Map<
      string,
      {
        agent: string;
        cui: string;
        denumire: string;
        localitate: string;
        judet: string;
        wasClient: boolean;
      }
    >();
    for (const c of withCui) {
      const r = cuiHits.get(c.cui);
      if (!r) continue;
      byClient.set(c.name || r.denumire, {
        agent: c.agent,
        cui: r.cui,
        denumire: r.denumire,
        localitate: r.localitate,
        judet: r.judet,
        wasClient: r.status === "client",
      });
    }
    for (const r of rows) {
      const c = variantToClient.get(r.norm);
      if (!c) continue;
      if (c.cui && cuiHits.has(c.cui)) continue;
      const existing = byClient.get(c.name);
      if (!existing || (!existing.localitate && r.localitate)) {
        byClient.set(c.name, {
          agent: c.agent,
          cui: r.cui,
          denumire: r.denumire,
          localitate: r.localitate,
          judet: r.judet,
          wasClient: r.status === "client",
        });
      }
    }

    const matched = Array.from(byClient.entries()).map(([name, m]) => ({
      client: name,
      ...m,
    }));
    const matchedNames = new Set(byClient.keys());
    const unmatched = clients
      .map((c) => c.name)
      .filter((n) => !matchedNames.has(n));

    let updated = 0;
    if (!body.dryRun && matched.length > 0) {
      const payload = matched.map((m) => ({ cui: m.cui, agent: m.agent }));
      const result = await db`
        UPDATE prospects p
        SET status = 'client',
            assigned_agent = CASE
              WHEN p.assigned_agent = '' THEN u.agent
              ELSE p.assigned_agent
            END,
            updated_at = NOW()
        FROM jsonb_to_recordset(${db.json(
          payload as unknown as Parameters<typeof db.json>[0],
        )}) AS u(cui TEXT, agent TEXT)
        WHERE p.cui = u.cui
      `;
      updated = result.count;
    }

    return Response.json({ matched, unmatched, updated, dryRun: !!body.dryRun });
  } catch (e) {
    console.error("[import-clients]", e);
    return Response.json({ error: "Eroare la import" }, { status: 500 });
  }
}
