import { getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Telemetria de erori: browserul trimite AUTOMAT aici orice crash JS și
 * orice cerere API care a eșuat (status >= 400) — adminul le vede în
 * /platform/activitate fără ca utilizatorul să raporteze nimic.
 * Public (nu cere sesiune — eroarea poate apărea și înainte de login),
 * dar strict limitat și igienizat.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ ok: false }, { status: 503 });
  const ip = clientIP(req);
  const rl = rateLimit(`telemetry:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ ok: false }, { status: 429 });

  let body: {
    kind?: string;
    page?: string;
    message?: string;
    status?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const kind = body.kind === "api_error" ? "api_error" : "js_error";
  const message = String(body.message ?? "").slice(0, 500);
  if (message.length < 3) return Response.json({ ok: false }, { status: 400 });
  // Aceeași plasă și pe server (browserele vechi pot avea codul vechi):
  // sesiune expirată, plan fără funcția aia, prea multe cereri — sunt
  // răspunsuri normale, nu erori. Nu umplem lista adminului cu ele.
  const ASTEPTATE = [401, 402, 403, 409, 423, 429];
  if (typeof body.status === "number" && ASTEPTATE.includes(body.status)) {
    return Response.json({ ok: true, ignored: true });
  }

  const db = getDB();
  if (!db) return Response.json({ ok: false }, { status: 503 });
  try {
    const { ensurePlatformSchema } = await import("@/modules/platform");
    await ensurePlatformSchema();
    await db`
      INSERT INTO app_events (kind, page, message, status, ua, ip)
      VALUES (${kind}, ${String(body.page ?? "").slice(0, 200)}, ${message},
              ${typeof body.status === "number" ? Math.floor(body.status) : null},
              ${(req.headers.get("user-agent") ?? "").slice(0, 200)}, ${ip.slice(0, 64)})
    `;
    // Igienă: păstrăm doar ultimele ~5000 de evenimente.
    await db`
      DELETE FROM app_events
      WHERE id < (SELECT COALESCE(MAX(id), 0) - 5000 FROM app_events)
    `;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[telemetry]", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
