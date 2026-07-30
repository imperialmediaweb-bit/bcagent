import { verifyToken } from "@/lib/signed-token";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Comenzile agentului din teren: le creează la client, în 30 de secunde,
 * și ajung instant în panoul agenției (depozit + contabilitate).
 */

export interface OrderLine {
  produs: string;
  cantitate: number;
  um: string;
  pret: number | null;
}

const UMS = new Set(["buc", "bax", "cartus", "pachet", "kg", "l"]);

function sanitizeLines(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      produs: String(l.produs ?? "").trim().slice(0, 120),
      cantitate: Math.min(1_000_000, Math.max(0, Number(l.cantitate) || 0)),
      um: UMS.has(String(l.um ?? "")) ? String(l.um) : "buc",
      pret:
        l.pret === null || l.pret === undefined || l.pret === ""
          ? null
          : Math.min(1_000_000, Math.max(0, Number(l.pret) || 0)),
    }))
    .filter((l) => l.produs !== "" && l.cantitate > 0)
    .slice(0, 60);
}

async function authorize(req: Request, tokenFromBody?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenFromBody ?? new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return null;
  return verifyToken(token, secret);
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`orders:${clientIP(req)}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  let body: {
    token?: string;
    cui?: string;
    denumire?: string;
    localitate?: string;
    lines?: unknown;
    note?: string;
    tip?: string;
    plata?: string;
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

  const lines = sanitizeLines(body.lines);
  if (lines.length === 0) {
    return Response.json(
      { error: "Comanda nu are niciun produs valid" },
      { status: 400 },
    );
  }
  const denumire = String(body.denumire ?? "").trim().slice(0, 200);
  if (!denumire) {
    return Response.json({ error: "Numele clientului lipsește" }, { status: 400 });
  }

  // VAN SALES: vânzare pe loc, din mașină — marfa se predă și se
  // încasează la client, deci comanda intră direct „livrata" și scade
  // stocul din dubă.
  const isVan = body.tip === "van";
  const plata = ["numerar", "card", "termen"].includes(String(body.plata))
    ? String(body.plata)
    : "";
  if (isVan && !plata) {
    return Response.json(
      { error: "Alege cum s-a încasat: numerar, card sau termen" },
      { status: 400 },
    );
  }
  const hasPrices = lines.every((l) => l.pret !== null);
  if (isVan && !hasPrices) {
    return Response.json(
      { error: "La vânzarea din mașină pune prețul pe fiecare produs" },
      { status: 400 },
    );
  }
  const total = hasPrices
    ? lines.reduce((s, l) => s + l.cantitate * (l.pret ?? 0), 0)
    : null;

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const id = `ord_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await db`
      INSERT INTO orders (id, agent_id, agent_name, cui, denumire, localitate,
                          lines, note, total_value, tip, plata, status)
      VALUES (${id}, ${payload.agentId}, ${payload.agentName},
              ${String(body.cui ?? "").replace(/\D/g, "").slice(0, 12)},
              ${denumire}, ${String(body.localitate ?? "").slice(0, 120)},
              ${db.json(lines as unknown as Parameters<typeof db.json>[0])},
              ${String(body.note ?? "").slice(0, 1000)}, ${total},
              ${isVan ? "van" : "comanda"}, ${plata},
              ${isVan ? "livrata" : "noua"})
    `;
    if (isVan) {
      // Scădem stocul din mașină (potrivire pe nume, indiferent de
      // majuscule/spații). Dacă produsul nu e în stoc, vânzarea NU se
      // blochează — agentul știe mai bine ce are în dubă decât aplicația.
      for (const l of lines) {
        await db`
          UPDATE van_stock
          SET cantitate = GREATEST(0, cantitate - ${l.cantitate}),
              updated_at = NOW()
          WHERE agent_id = ${payload.agentId}
            AND lower(btrim(produs)) = ${l.produs.toLowerCase().trim()}
        `;
      }
    }
    return Response.json({ ok: true, id, total });
  } catch (e) {
    console.error("[orders POST]", e);
    return Response.json({ error: "Eroare la trimiterea comenzii" }, { status: 500 });
  }
}

/** Comenzile recente ale agentului (confirmare + istoric pe telefon). */
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
    const rows = await db<
      Array<{
        id: string;
        cui: string;
        denumire: string;
        lines: OrderLine[];
        note: string;
        status: string;
        total_value: number | null;
        created_at: Date;
        tip: string;
        plata: string;
      }>
    >`
      SELECT id, cui, denumire, lines, note, status, total_value, created_at,
             tip, plata
      FROM orders WHERE agent_id = ${payload.agentId}
      ORDER BY created_at DESC LIMIT 50
    `;
    const [today] = await db<[{ n: string }]>`
      SELECT COUNT(*)::text AS n FROM orders
      WHERE agent_id = ${payload.agentId}
        AND created_at >= date_trunc('day', NOW())
    `;
    return Response.json({
      today: parseInt(today.n, 10),
      orders: rows.map((r) => ({
        id: r.id,
        cui: r.cui,
        denumire: r.denumire,
        lines: r.lines ?? [],
        note: r.note,
        status: r.status,
        totalValue: r.total_value,
        createdAt: r.created_at.toISOString(),
        tip: r.tip,
        plata: r.plata,
      })),
    });
  } catch (e) {
    console.error("[orders GET]", e);
    return Response.json({ error: "Eroare la citirea comenzilor" }, { status: 500 });
  }
}
