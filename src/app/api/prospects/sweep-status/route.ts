import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { timingSafeEqual } from "@/lib/rate-limit";
import { RECHECK_DAYS, sweepJudete } from "@/modules/prospects/anaf-sweep";

export const runtime = "nodejs";

/**
 * STAREA MĂTURĂRII ANAF — verificare REALĂ, cu cifre din baza de date:
 *   curl -H "x-admin-secret: <ADMIN_SECRET>" .../api/prospects/sweep-status
 * Arată cât s-a verificat de fapt (nu ce „ar trebui"): câte firme din
 * județele lucrate au fost văzute la ANAF, câte-s la rând, câte au ieșit
 * inactive și când a fost ultima verificare.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return Response.json({ error: "Server not configured" }, { status: 500 });
  }
  // Cheia vine din ANTET, ca la toate celelalte rute de admin: în adresă
  // ar ajunge în logurile serverului, în istoricul telefonului și în
  // Referer. Verificare:
  //   curl -H "x-admin-secret: <cheia>" https://provendi.ro/api/prospects/sweep-status
  const key = req.headers.get("x-admin-secret") ?? "";
  if (!timingSafeEqual(key, adminSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const judete = sweepJudete();
    const [s] = await db<
      [
        {
          total: string;
          verificate: string;
          la_rand: string;
          inactive: string;
          inchise_teren: string;
          verificate_24h: string;
          ultima: Date | null;
        },
      ]
    >`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE anaf_checked_at IS NOT NULL)::text AS verificate,
             COUNT(*) FILTER (WHERE anaf_checked_at IS NULL
                              OR anaf_checked_at < NOW() - (${RECHECK_DAYS} || ' days')::interval)::text AS la_rand,
             COUNT(*) FILTER (WHERE activ IS FALSE)::text AS inactive,
             COUNT(*) FILTER (WHERE inchis_teren)::text AS inchise_teren,
             COUNT(*) FILTER (WHERE anaf_checked_at > NOW() - INTERVAL '24 hours')::text AS verificate_24h,
             MAX(anaf_checked_at) AS ultima
      FROM prospects
      WHERE judet = ANY(${judete})
    `;
    return Response.json({
      judete,
      reverificareLaZile: RECHECK_DAYS,
      firmeInJudete: parseInt(s.total, 10),
      verificateLaAnaf: parseInt(s.verificate, 10),
      verificateUltimele24h: parseInt(s.verificate_24h, 10),
      laRand: parseInt(s.la_rand, 10),
      inactive: parseInt(s.inactive, 10),
      inchiseDinTeren: parseInt(s.inchise_teren, 10),
      ultimaVerificare: s.ultima ? s.ultima.toISOString() : null,
    });
  } catch (e) {
    console.error("[sweep-status]", e);
    return Response.json({ error: "Eroare la citirea stării" }, { status: 500 });
  }
}
