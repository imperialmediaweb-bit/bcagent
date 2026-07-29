import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit, timingSafeEqual } from "@/lib/rate-limit";
import {
  caenDescription,
  isTargetCaen,
  normalizeCaen,
} from "@/modules/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ImportProspect {
  cui: string;
  denumire: string;
  adresa?: string;
  localitate?: string;
  judet?: string;
  caen?: string;
}

/**
 * Import prospecți în chunks — apelat din /admin după parsarea client-side
 * a fișierului MF. Gated pe ADMIN_SECRET (importul e operație de admin).
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json(
      { error: "Baza de date nu e configurată (DATABASE_URL)" },
      { status: 503 },
    );
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const ip = clientIP(req);
  const rl = rateLimit(`prospects-import:${ip}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { prospects?: ImportProspect[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.prospects)) {
    return Response.json({ error: "prospects[] lipsește" }, { status: 400 });
  }
  if (body.prospects.length > 5000) {
    return Response.json(
      { error: "Maxim 5000 prospecți per chunk" },
      { status: 400 },
    );
  }

  // Validare + normalizare
  const clean = body.prospects
    .map((p) => ({
      cui: String(p.cui ?? "").replace(/\D/g, ""),
      denumire: String(p.denumire ?? "").trim().slice(0, 256),
      adresa: String(p.adresa ?? "").trim().slice(0, 512),
      localitate: String(p.localitate ?? "").trim().slice(0, 128),
      judet: String(p.judet ?? "").trim().toUpperCase().slice(0, 2),
      caen: normalizeCaen(String(p.caen ?? "")),
    }))
    .filter((p) => p.cui && p.denumire);

  if (clean.length === 0) {
    return Response.json({ ok: true, inserted: 0, skipped: body.prospects.length });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    let inserted = 0;
    // Insert în tranșe de 200 (postgres.js suportă bulk insert prin json)
    for (let i = 0; i < clean.length; i += 200) {
      const chunk = clean.slice(i, i + 200).map((p) => ({
        cui: p.cui,
        denumire: p.denumire,
        adresa: p.adresa,
        localitate: p.localitate,
        judet: p.judet,
        caen: p.caen,
        caen_desc: isTargetCaen(p.caen) ? caenDescription(p.caen) : "",
      }));
      const res = await db`
        INSERT INTO prospects ${db(chunk)}
        ON CONFLICT (cui) DO UPDATE SET
          denumire = EXCLUDED.denumire,
          adresa = CASE WHEN EXCLUDED.adresa <> '' THEN EXCLUDED.adresa ELSE prospects.adresa END,
          localitate = CASE WHEN EXCLUDED.localitate <> '' THEN EXCLUDED.localitate ELSE prospects.localitate END,
          judet = CASE WHEN EXCLUDED.judet <> '' THEN EXCLUDED.judet ELSE prospects.judet END,
          caen = CASE WHEN EXCLUDED.caen <> '' THEN EXCLUDED.caen ELSE prospects.caen END,
          caen_desc = CASE WHEN EXCLUDED.caen_desc <> '' THEN EXCLUDED.caen_desc ELSE prospects.caen_desc END,
          updated_at = NOW()
      `;
      inserted += res.count;
    }
    return Response.json({
      ok: true,
      inserted,
      skipped: body.prospects.length - clean.length,
    });
  } catch (e) {
    console.error("[prospects import]", e);
    return Response.json({ error: "Eroare la import" }, { status: 500 });
  }
}
