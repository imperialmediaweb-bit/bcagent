import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * VAN SALES — marfa din mașina agentului. Dimineața se încarcă
 * (kind=incarcare), fiecare vânzare van o scade automat (/api/orders),
 * seara se dă retur ce n-a mers (kind=retur). Managerul vede stocul
 * fiecărei dube în panoul agenției.
 */

const UMS = new Set(["buc", "bax", "cartus", "pachet", "naveta", "cutie", "kg", "l"]);

interface StockLine {
  produs: string;
  um: string;
  cantitate: number;
}

function sanitize(raw: unknown): StockLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      produs: String(l.produs ?? "").trim().slice(0, 120),
      um: UMS.has(String(l.um ?? "")) ? String(l.um) : "buc",
      cantitate: Math.min(1_000_000, Math.max(0, Number(l.cantitate) || 0)),
    }))
    .filter((l) => l.produs !== "" && l.cantitate > 0)
    .slice(0, 100);
}

async function authorize(req: Request, tokenFromBody?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenFromBody ?? new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return null;
  return verifyFieldToken(token, secret);
}

/** Stocul curent din dubă + vânzările van de azi (total și numerar). */
export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const payload = await authorize(req);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const stock = await db<
      Array<{ produs: string; um: string; cantitate: number }>
    >`
      SELECT produs, um, cantitate FROM van_stock
      WHERE agent_id = ${payload.agentId} AND cantitate > 0
      ORDER BY produs
    `;
    const [today] = await db<
      [{ n: string; total: string | null; numerar: string | null }]
    >`
      SELECT COUNT(*)::text AS n,
             COALESCE(SUM(total_value), 0)::text AS total,
             COALESCE(SUM(total_value) FILTER (WHERE plata = 'numerar'), 0)::text AS numerar
      FROM orders
      WHERE agent_id = ${payload.agentId} AND tip = 'van'
        AND created_at >= date_trunc('day', NOW())
    `;
    return Response.json({
      stock,
      today: {
        sales: parseInt(today.n, 10),
        total: parseFloat(today.total ?? "0"),
        numerar: parseFloat(today.numerar ?? "0"),
      },
    });
  } catch (e) {
    console.error("[van GET]", e);
    return Response.json({ error: "Eroare la citirea stocului" }, { status: 500 });
  }
}

/** Încărcare marfă în dubă sau retur la depozit. */
export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`van:${clientIP(req)}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  let body: { token?: string; kind?: string; lines?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = await authorize(req, body.token);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const kind = body.kind === "retur" ? "retur" : "incarcare";
  const lines = sanitize(body.lines);
  if (lines.length === 0) {
    return Response.json({ error: "Niciun produs valid" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // Produsele de retur care nu s-au găsit în dubă.
    const neatinse: string[] = [];
    for (const l of lines) {
      if (kind === "incarcare") {
        await db`
          INSERT INTO van_stock (agent_id, produs, um, cantitate, updated_at)
          VALUES (${payload.agentId}, ${l.produs}, ${l.um}, ${l.cantitate}, NOW())
          ON CONFLICT (agent_id, produs)
          DO UPDATE SET cantitate = van_stock.cantitate + EXCLUDED.cantitate,
                        um = EXCLUDED.um, updated_at = NOW()
        `;
      } else {
        // RETURUL TREBUIE SĂ NIMEREASCĂ PRODUSUL.
        // În bază se compară cu btrim(produs), dar aici lipsea .trim():
        // un nume cu un spațiu la coadă („Kent 4 ") nu se potrivea cu
        // nimic. Agentul apăsa „Dă retur", primea „gata", iar în dubă
        // marfa rămânea scrisă ca fiind la el. Managerul îi cerea a doua
        // zi socoteala pentru marfă pe care o predase.
        const r = await db`
          UPDATE van_stock
          SET cantitate = GREATEST(0, cantitate - ${l.cantitate}), updated_at = NOW()
          WHERE agent_id = ${payload.agentId}
            AND lower(btrim(produs)) = ${l.produs.toLowerCase().trim()}
        `;
        // Ce n-a nimerit nimic i se SPUNE. Un „gata" pe o treabă care nu
        // s-a făcut e mai rău decât o eroare.
        if (r.count === 0) neatinse.push(l.produs);
      }
    }
    // Rândurile pe zero nu mai încarcă lista.
    await db`
      DELETE FROM van_stock
      WHERE agent_id = ${payload.agentId} AND cantitate <= 0
    `;
    return Response.json({
      ok: true,
      // Gol = totul s-a scăzut. Altfel, exact ce n-a fost în dubă.
      neatinse,
    });
  } catch (e) {
    console.error("[van POST]", e);
    return Response.json({ error: "Eroare la actualizarea stocului" }, { status: 500 });
  }
}
