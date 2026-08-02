import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Potrivește numele clienților din XLS-urile de vânzări cu firmele din baza
 * de prospecți (denumirea oficială MF). Pe potrivire aflăm localitatea și
 * județul clientului — combustibilul hărții cu „pete albe".
 *
 * Normalizare identică pe ambele părți (JS aici, expresie indexată în SQL):
 * orice non-alfanumeric devine spațiu, uppercase, trim. În plus generăm
 * variante cu/fără forma juridică (SC/SRL/S.R.L./PFA...).
 */

const LEGAL_TOKENS = new Set([
  "SC",
  "SRL",
  "S",
  "R",
  "L",
  "SA",
  "PFA",
  "II",
  "IF",
  "SNC",
  "SCS",
  "SRL-D",
  "SRLD",
]);

function normalizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toUpperCase()
    .trim();
}

/** Miezul numelui, fără forma juridică de la capete. */
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
    set.add(`${core} PFA`);
  }
  return Array.from(set);
}

interface MatchRow {
  cui: string;
  denumire: string;
  localitate: string;
  judet: string;
  norm: string;
}

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false }, { status: 503 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`prospects-match:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }

  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }

  let body: { token?: string; clients?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.token || !(await verifyFieldToken(body.token, tokenSecret))) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  if (!Array.isArray(body.clients)) {
    return Response.json({ error: "clients trebuie să fie listă" }, { status: 400 });
  }

  const clients = Array.from(
    new Set(
      body.clients
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim())
        .filter((c) => c.length >= 4),
    ),
  ).slice(0, 800);

  // variantă normalizată → numele original din XLS
  const variantToClient = new Map<string, string>();
  for (const client of clients) {
    for (const v of variantsFor(client)) {
      if (!variantToClient.has(v)) variantToClient.set(v, client);
    }
  }
  if (variantToClient.size === 0) {
    return Response.json({ matches: [] });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    const variants = Array.from(variantToClient.keys());
    const rows = await db<MatchRow[]>`
      SELECT cui, denumire, localitate, judet,
             btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g'))) AS norm
      FROM prospects
      WHERE btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
            = ANY(${variants})
      LIMIT 2000
    `;

    // Un client → o singură potrivire (prima cu localitate completată).
    const byClient = new Map<
      string,
      { cui: string; denumire: string; localitate: string; judet: string }
    >();
    for (const r of rows) {
      const client = variantToClient.get(r.norm);
      if (!client) continue;
      const existing = byClient.get(client);
      if (!existing || (!existing.localitate && r.localitate)) {
        byClient.set(client, {
          cui: r.cui,
          denumire: r.denumire,
          localitate: r.localitate,
          judet: r.judet,
        });
      }
    }

    return Response.json({
      matches: Array.from(byClient.entries()).map(([client, m]) => ({
        client,
        ...m,
      })),
      totalClients: clients.length,
    });
  } catch (e) {
    console.error("[prospects match]", e);
    return Response.json({ error: "Eroare la potrivire" }, { status: 500 });
  }
}
