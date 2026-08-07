import { ensureSchema, isDBEnabled, getDB } from "@/lib/db";
import { audit, listOrgAgents, requireOrgUser } from "@/modules/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload de rapoarte de vânzări DIN PANOUL AGENȚIEI (owner sau manager).
 * Fișierul (XLS/XLSX/ODS/CSV) se parsează în browser cu detecția de coloane
 * existentă; aici ajung rândurile normalizate și intră în `batches` —
 * aceleași date pe care le citesc Vânzări, Targeturi și Briefingul AI.
 */

interface IncomingRow {
  date?: string;
  agent?: string;
  producer?: string;
  client?: string;
  volume?: number;
  value?: number;
}

const MAX_ROWS = 100_000;

export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;

  let body: { fileName?: string; rows?: IncomingRow[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return Response.json(
      { error: "Fișierul nu conține rânduri valide" },
      { status: 400 },
    );
  }
  if (body.rows.length > MAX_ROWS) {
    return Response.json(
      { error: `Maxim ${MAX_ROWS.toLocaleString("ro-RO")} rânduri per fișier` },
      { status: 400 },
    );
  }

  // Sanitizare rând cu rând — doar câmpurile așteptate, tipuri corecte.
  const rows = body.rows
    .map((r) => ({
      date: String(r.date ?? "").slice(0, 30),
      agent: String(r.agent ?? "").slice(0, 120),
      producer: String(r.producer ?? "").slice(0, 120),
      client: String(r.client ?? "").slice(0, 200),
      volume: Number.isFinite(Number(r.volume)) ? Number(r.volume) : 0,
      value: Number.isFinite(Number(r.value)) ? Number(r.value) : 0,
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}/.test(r.date));
  if (rows.length === 0) {
    return Response.json(
      { error: "Niciun rând cu dată validă — verifică coloana de dată" },
      { status: 400 },
    );
  }

  const dates = rows.map((r) => r.date.slice(0, 10)).sort();
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // Același raport încărcat de două ori ar dubla TOATE cifrele — îl
    // recunoaștem după conținut (nu după nume) și nu-l mai băgăm o dată.
    const { rowsFingerprint } = await import("@/lib/fingerprint");
    const fingerprint = rowsFingerprint(rows);
    const ownerId = "org:" + auth.session.orgId;
    const dup = await db<Array<{ id: string; file_name: string }>>`
      SELECT id, file_name FROM batches
      WHERE agent_id = ${ownerId} AND content_hash = ${fingerprint}
      LIMIT 1
    `;
    if (dup.length > 0) {
      return Response.json({
        ok: true,
        duplicate: true,
        id: dup[0].id,
        rows: rows.length,
        dateMin: dates[0],
        dateMax: dates[dates.length - 1],
        message: `Fișierul ăsta e deja încărcat (${dup[0].file_name}) — nu am dublat nimic.`,
      });
    }
    const id = `bo_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    // ON CONFLICT: dacă două încărcări simultane (două tab-uri, retrimitere)
    // trec amândouă de verificarea de mai sus, indexul unic prinde a doua
    // și nu inserează — nimic dublat. inserted ne spune care a fost.
    const inserted = await db<Array<{ id: string }>>`
      INSERT INTO batches (id, agent_id, file_name, row_count, date_min, date_max, rows, content_hash)
      VALUES (${id}, ${ownerId},
              ${String(body.fileName ?? "raport").slice(0, 200)},
              ${rows.length}, ${dates[0]}, ${dates[dates.length - 1]},
              ${db.json(rows as unknown as Parameters<typeof db.json>[0])},
              ${fingerprint})
      ON CONFLICT (agent_id, content_hash) WHERE content_hash IS NOT NULL
      DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      return Response.json({
        ok: true,
        duplicate: true,
        rows: rows.length,
        dateMin: dates[0],
        dateMax: dates[dates.length - 1],
        message: "Fișierul ăsta e deja încărcat — nu am dublat nimic.",
      });
    }
    await audit(auth.session.email, "upload.raport", id, {
      orgId: auth.session.orgId,
      rows: rows.length,
      fileName: body.fileName,
    });

    // Câți dintre agenții din fișier există în firmă — feedback imediat.
    const agents = await listOrgAgents(auth.session.orgId);
    const known = new Set(agents.map((a) => a.name));
    const fileAgents = Array.from(new Set(rows.map((r) => r.agent).filter(Boolean)));
    const unknown = fileAgents.filter((a) => !known.has(a));

    return Response.json({
      ok: true,
      id,
      rows: rows.length,
      dateMin: dates[0],
      dateMax: dates[dates.length - 1],
      agentsInFile: fileAgents,
      agentsUnknown: unknown,
    });
  } catch (e) {
    console.error("[agentie upload]", e);
    return Response.json({ error: "Eroare la salvarea raportului" }, { status: 500 });
  }
}

/** Rapoartele urcate de agenție (nu ating batch-urile agenților). */
export async function GET() {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    const rows = await db<
      Array<{
        id: string;
        file_name: string;
        row_count: number;
        date_min: Date;
        date_max: Date;
        uploaded_at: Date;
      }>
    >`
      SELECT id, file_name, row_count, date_min, date_max, uploaded_at
      FROM batches WHERE agent_id = ${"org:" + auth.session.orgId}
      ORDER BY uploaded_at DESC LIMIT 100
    `;
    return Response.json({
      batches: rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        rowCount: r.row_count,
        dateMin: r.date_min.toISOString().slice(0, 10),
        dateMax: r.date_max.toISOString().slice(0, 10),
        uploadedAt: r.uploaded_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[agentie upload GET]", e);
    return Response.json({ error: "Eroare la listare" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id lipsește" }, { status: 400 });
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });
  try {
    await ensureSchema();
    // Doar rapoartele urcate de PROPRIA organizație.
    const rows = await db<Array<{ id: string }>>`
      DELETE FROM batches
      WHERE id = ${id} AND agent_id = ${"org:" + auth.session.orgId}
      RETURNING id
    `;
    if (rows.length === 0) {
      return Response.json({ error: "Raportul nu e al firmei tale" }, { status: 403 });
    }
    await audit(auth.session.email, "upload.delete", id);
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[agentie upload DELETE]", e);
    return Response.json({ error: "Eroare la ștergere" }, { status: 500 });
  }
}
