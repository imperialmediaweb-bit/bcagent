import { clientIP, rateLimit, timingSafeEqual } from "@/lib/rate-limit";
import { isR2Enabled, presignPut, MF_DATASET_KEY } from "@/lib/storage";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Returnează un presigned PUT URL pentru upload direct browser → R2.
 * Resetează sync_state pentru cheia respectivă (upload nou = procesare de la 0).
 */
export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`upload-url:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isR2Enabled()) {
    return Response.json(
      {
        error:
          "R2 nu e configurat. Setează R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET în Railway → Variables.",
      },
      { status: 503 },
    );
  }

  try {
    const url = await presignPut(MF_DATASET_KEY, "text/plain");
    // Reset progres procesare — fișier nou
    if (isDBEnabled()) {
      const db = getDB();
      if (db) {
        await ensureSchema();
        await db`DELETE FROM sync_state WHERE key = ${MF_DATASET_KEY}`;
      }
    }
    return Response.json({ url, key: MF_DATASET_KEY });
  } catch (e) {
    console.error("[upload-url]", e);
    return Response.json(
      { error: "Eroare la generarea URL-ului de upload" },
      { status: 500 },
    );
  }
}
