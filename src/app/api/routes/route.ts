import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Rutele agentului: șabloane cu nume, zi din săptămână și opriri ordonate.
 * O oprire = firma cu datele minime pentru navigare (cui, denumire, adresă).
 */

interface Stop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  telefon: string;
  /** Poziția exactă a magazinului, dacă o știm — ruta salvată navighează
   *  pe COORDONATE, nu pe adresa de sat (altfel Google refuză traseul). */
  lat?: number | null;
  lng?: number | null;
}

const DAYS = ["", "luni", "marti", "miercuri", "joi", "vineri", "sambata", "duminica"];

function sanitizeStops(raw: unknown): Stop[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      // Coordonatele se păstrează DOAR dacă-s numere plauzibile (România) —
      // altfel ruta salvată ar duce omul aiurea.
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      const bune =
        Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= 43.3 && lat <= 48.4 && lng >= 20.1 && lng <= 30.0;
      return {
        cui: String(s.cui ?? "").replace(/\D/g, "").slice(0, 12),
        denumire: String(s.denumire ?? "").slice(0, 200),
        adresa: String(s.adresa ?? "").slice(0, 300),
        localitate: String(s.localitate ?? "").slice(0, 120),
        telefon: String(s.telefon ?? "").slice(0, 40),
        lat: bune ? lat : null,
        lng: bune ? lng : null,
      };
    })
    .filter((s) => s.cui !== "")
    .slice(0, 40);
}

async function authorize(req: Request, tokenFromBody?: string) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  const token =
    tokenFromBody ?? new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return null;
  return verifyFieldToken(token, secret);
}

interface RouteRow {
  id: string;
  name: string;
  day: string;
  stops: Stop[];
  updated_at: Date;
}

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
    const rows = await db<RouteRow[]>`
      SELECT id, name, day, stops, updated_at
      FROM routes WHERE agent_id = ${payload.agentId}
      ORDER BY CASE day
        WHEN 'luni' THEN 1 WHEN 'marti' THEN 2 WHEN 'miercuri' THEN 3
        WHEN 'joi' THEN 4 WHEN 'vineri' THEN 5 WHEN 'sambata' THEN 6
        WHEN 'duminica' THEN 7 ELSE 8 END, name
    `;
    return Response.json({
      routes: rows.map((r) => ({
        id: r.id,
        name: r.name,
        day: r.day,
        stops: r.stops ?? [],
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[routes GET]", e);
    return Response.json({ error: "Eroare la citirea rutelor" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const rl = rateLimit(`routes:${clientIP(req)}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Prea multe cereri" }, { status: 429 });

  let body: {
    token?: string;
    id?: string;
    name?: string;
    day?: string;
    stops?: unknown;
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
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "Numele rutei lipsește" }, { status: 400 });
  const day = DAYS.includes(String(body.day ?? "")) ? String(body.day ?? "") : "";
  const stops = sanitizeStops(body.stops);
  if (stops.length === 0) {
    return Response.json({ error: "Ruta nu are nicio oprire" }, { status: 400 });
  }
  const id =
    String(body.id ?? "").slice(0, 40) ||
    `rt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // Upsert doar peste rutele proprii — id-ul altcuiva nu poate fi suprascris.
    const rows = await db<Array<{ id: string }>>`
      INSERT INTO routes (id, agent_id, name, day, stops)
      VALUES (${id}, ${payload.agentId}, ${name}, ${day}, ${db.json(
        stops as unknown as Parameters<typeof db.json>[0],
      )})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, day = EXCLUDED.day,
        stops = EXCLUDED.stops, updated_at = NOW()
      WHERE routes.agent_id = ${payload.agentId}
      RETURNING id
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Ruta nu îți aparține" }, { status: 403 });
    }
    return Response.json({ ok: true, id });
  } catch (e) {
    console.error("[routes POST]", e);
    return Response.json({ error: "Eroare la salvarea rutei" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const payload = await authorize(req);
  if (!payload) {
    return Response.json({ error: "Token invalid sau expirat" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id lipsește" }, { status: 400 });
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    await db`
      DELETE FROM routes WHERE id = ${id} AND agent_id = ${payload.agentId}
    `;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[routes DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
