import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit, timingSafeEqual } from "@/lib/rate-limit";
import { ANAF_BATCH_SIZE, caenLabel, queryAnafBatch } from "@/modules/prospects";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Enrichment ANAF: verifică activ/TVA pentru prospecții neverificați.
 * Procesează maxim 2 batch-uri (1000 CUI) per apel — UI-ul apelează
 * repetat până când `remaining` ajunge 0 (progres incremental, fără
 * job-uri lungi pe server).
 * Rulează pe Railway (egress liber către ANAF).
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
  // 1 batch ANAF per apel → UI face ~10-17 apeluri/min la enrich complet
  const rl = rateLimit(`prospects-enrich:${ip}`, { max: 40, windowMs: 60_000 });
  if (!rl.ok) {
    return Response.json({ error: "Prea multe cereri" }, { status: 429 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  try {
    await ensureSchema();
    // UN singur batch ANAF per cerere HTTP — ține cererea sub ~10s
    // (Railway proxy taie cererile lungi cu "upstream error").
    const pending = await db<Array<{ cui: string }>>`
      SELECT cui FROM prospects
      WHERE activ IS NULL
      ORDER BY cui
      LIMIT ${ANAF_BATCH_SIZE}
    `;
    if (pending.length === 0) {
      const [{ remaining }] = await db<[{ remaining: string }]>`
        SELECT COUNT(*)::text AS remaining FROM prospects WHERE activ IS NULL
      `;
      return Response.json({
        ok: true,
        processed: 0,
        remaining: parseInt(remaining, 10),
      });
    }

    let processed = 0;
    let inactiveRemoved = 0;
    for (let i = 0; i < pending.length; i += ANAF_BATCH_SIZE) {
      const batch = pending.slice(i, i + ANAF_BATCH_SIZE).map((p) => p.cui);
      const info = await queryAnafBatch(batch);

      // Grupăm rezultatele → 2 operații bulk (nu 500 de query-uri individuale)
      const notFound: string[] = [];
      const updates: Array<{
        cui: string;
        activ: boolean;
        tva: boolean;
        adresa: string;
        caen: string;
        caen_desc: string;
      }> = [];

      for (const cui of batch) {
        const firm = info.get(cui);
        if (!firm) {
          // Negăsit la ANAF → probabil radiat de mult
          notFound.push(cui);
          inactiveRemoved++;
        } else {
          // NU ștergem nimic pe criteriu de domeniu: platforma servește
          // agenți din TOATE domeniile, filtrarea se face în UI.
          const caen = firm.caen ?? "";
          updates.push({
            cui,
            activ: firm.activ,
            tva: firm.tva,
            adresa: firm.adresa ?? "",
            caen,
            caen_desc: caen ? caenLabel(caen) : "",
          });
          if (!firm.activ) inactiveRemoved++;
        }
        processed++;
      }

      if (notFound.length > 0) {
        await db`
          UPDATE prospects SET activ = FALSE, updated_at = NOW()
          WHERE cui = ANY(${notFound})
        `;
      }
      if (updates.length > 0) {
        await db`
          UPDATE prospects p SET
            activ = u.activ,
            tva = u.tva,
            adresa = CASE WHEN u.adresa <> '' THEN u.adresa ELSE p.adresa END,
            caen = CASE WHEN u.caen <> '' THEN u.caen ELSE p.caen END,
            caen_desc = CASE WHEN u.caen_desc <> '' THEN u.caen_desc ELSE p.caen_desc END,
            updated_at = NOW()
          FROM jsonb_to_recordset(${db.json(updates)})
            AS u(cui text, activ boolean, tva boolean, adresa text, caen text, caen_desc text)
          WHERE p.cui = u.cui
        `;
      }

      // Respectăm limita ANAF de 1 req/sec
      if (i + ANAF_BATCH_SIZE < pending.length) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    const [{ remaining }] = await db<[{ remaining: string }]>`
      SELECT COUNT(*)::text AS remaining FROM prospects WHERE activ IS NULL
    `;
    return Response.json({
      ok: true,
      processed,
      inactive: inactiveRemoved,
      remaining: parseInt(remaining, 10),
    });
  } catch (e) {
    console.error("[prospects enrich]", e);
    return Response.json(
      { error: "Eroare la verificarea ANAF — reîncearcă" },
      { status: 502 },
    );
  }
}

/** Șterge prospecții inactivi (după enrichment) — curățenie opțională. */
export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false }, { status: 503 });
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  const provided = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(provided, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const res = await db`DELETE FROM prospects WHERE activ = FALSE`;
    return Response.json({ ok: true, deleted: res.count });
  } catch (e) {
    console.error("[prospects cleanup]", e);
    return Response.json({ error: "Eroare la curățenie" }, { status: 500 });
  }
}
