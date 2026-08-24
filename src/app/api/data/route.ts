import { verifyFieldToken } from "@/lib/agent-guard";
import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";

export const runtime = "nodejs";

async function authorize(req: Request) {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) return { error: "Server not configured", status: 500 };
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return { error: "token lipsește", status: 400 };
  const payload = await verifyFieldToken(token, tokenSecret);
  if (!payload) return { error: "Token invalid sau expirat", status: 401 };
  return { agentId: payload.agentId };
}

export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false, batches: [], rows: [], settings: null });
  }
  const auth = await authorize(req);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false });

  try {
    await ensureSchema();

    // FIȘIERUL FIRMEI: raportul de vânzări îl urcă managerul, o dată,
    // pentru toată echipa. Agentul trebuie să-și vadă cifrele din el —
    // dar DOAR felia lui, nu ale colegilor. Aflăm firma agentului și
    // numele sub care apare în rapoarte.
    let orgOwner = "";
    let numeleMeu = "";
    try {
      const [m] = await db<Array<{ org_id: string; name: string }>>`
        SELECT org_id, name FROM org_agents
        WHERE agent_id = ${auth.agentId} AND active
        LIMIT 1
      `;
      if (m) {
        orgOwner = `org:${m.org_id}`;
        numeleMeu = m.name;
      }
    } catch {
      // instalare fără tabelele platformei — mergem doar pe fișierele lui
    }

    const batchRows = await db<
      Array<{
        id: string;
        file_name: string;
        uploaded_at: Date;
        row_count: number;
        date_min: Date;
        date_max: Date;
        rows: Array<{
          date: string;
          agent: string;
          producer: string;
          client: string;
          volume: number;
          value: number;
        }>;
      }>
    >`
      SELECT id, file_name, uploaded_at, date_min, date_max,
             jsonb_array_length(felia) AS row_count,
             felia AS rows
      FROM (
        SELECT id, file_name, uploaded_at, date_min, date_max,
               CASE
                 -- Fișierele urcate chiar de el: integral.
                 WHEN agent_id = ${auth.agentId} THEN rows
                 -- Fișierul firmei: DOAR rândurile lui. Potrivirea pe nume
                 -- iartă diacriticele, majusculele și spațiile în plus.
                 ELSE COALESCE((
                   SELECT jsonb_agg(r)
                   FROM jsonb_array_elements(rows) r
                   -- lower() ÎNAINTE de translate: altfel diacriticele
                   -- MARI (GAVRILEȚ) nu se pliază și agentul rămâne fără
                   -- nicio cifră, deși e chiar numele lui în raport.
                   WHERE btrim(translate(lower(r->>'agent'), 'ăâîșțşţ', 'aaistst'))
                       = btrim(translate(lower(${numeleMeu}), 'ăâîșțşţ', 'aaistst'))
                 ), '[]'::jsonb)
               END AS felia
        FROM batches
        WHERE agent_id = ${auth.agentId}
           OR (${orgOwner} <> '' AND agent_id = ${orgOwner})
      ) t
      WHERE jsonb_array_length(felia) > 0
      ORDER BY uploaded_at ASC
    `;

    const settings = await db<
      Array<{
        default_rate: number;
        avg_price: number;
        agent_rates: Record<string, number>;
      }>
    >`
      SELECT default_rate, avg_price, agent_rates
      FROM agent_settings
      WHERE agent_id = ${auth.agentId}
    `;

    // ANTI-DUBLARE — dar corect: un rând se taie DOAR dacă același rând a
    // apărut deja într-un ALT fișier (agentul a urcat chiar el raportul pe
    // care l-a urcat și firma). Două vânzări identice din ACELAȘI fișier
    // sunt două livrări reale — rămân amândouă, altfel am subnumăra
    // comisioanele. Numărătoarea fiecărui fișier se recalculează după
    // curățare (panoul o folosește ca să știe care rânduri sunt ale cui);
    // fișierele rămase complet goale dispar din listă.
    const amprenta = (r: (typeof batchRows)[number]["rows"][number]) =>
      [
        String(r.date ?? "").slice(0, 10),
        String(r.client ?? "").trim().toLowerCase(),
        String(r.producer ?? "").trim().toLowerCase(),
        String(r.agent ?? "").trim().toLowerCase(),
        r.volume,
        r.value,
      ].join("|");
    // câte apariții din fiecare amprentă au venit din fișierele ANTERIOARE
    const dinAlteFisiere = new Map<string, number>();
    const allRows: (typeof batchRows)[number]["rows"] = [];
    const batchesCurate: Array<(typeof batchRows)[number]> = [];
    let dublate = 0;
    for (const b of batchRows) {
      const pastrate: typeof b.rows = [];
      const dinFisierulAsta = new Map<string, number>();
      for (const r of b.rows) {
        const a = amprenta(r);
        const ramase = dinAlteFisiere.get(a) ?? 0;
        if (ramase > 0) {
          dinAlteFisiere.set(a, ramase - 1);
          dublate++;
          continue;
        }
        pastrate.push(r);
        dinFisierulAsta.set(a, (dinFisierulAsta.get(a) ?? 0) + 1);
      }
      for (const [a, n] of dinFisierulAsta) {
        dinAlteFisiere.set(a, (dinAlteFisiere.get(a) ?? 0) + n);
      }
      if (pastrate.length > 0) {
        batchesCurate.push({ ...b, rows: pastrate, row_count: pastrate.length });
        allRows.push(...pastrate);
      }
    }
    if (dublate > 0) {
      console.warn(
        `[data] ${dublate} rânduri identice venite din două fișiere (propriu + al firmei) — numărate o singură dată`,
      );
    }

    return Response.json({
      enabled: true,
      batches: batchesCurate.map((b) => ({
        id: b.id,
        fileName: b.file_name,
        uploadedAt: b.uploaded_at.toISOString(),
        rowCount: b.row_count,
        dateRange: {
          min: b.date_min.toISOString().slice(0, 10),
          max: b.date_max.toISOString().slice(0, 10),
        },
      })),
      rows: allRows,
      settings:
        settings.length > 0
          ? {
              defaultRate: settings[0].default_rate,
              avgPrice: settings[0].avg_price,
              agentRates: settings[0].agent_rates ?? {},
            }
          : null,
    });
  } catch (e) {
    return Response.json(
      { error: `DB error: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ enabled: false });
  }
  const auth = await authorize(req);
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const db = getDB();
  if (!db) return Response.json({ enabled: false });
  try {
    await ensureSchema();
    // ISTORICUL NU SE ȘTERGE DIN TEREN. Butonul ăsta golea din baza de
    // date TOATE vânzările agentului — o apăsare greșită pe telefon, sau
    // un agent care pleacă din firmă, și istoricul firmei dispărea.
    // Datele rămân ale firmei; ștergerea se face doar din panoul firmei.
    // (Panoul agentului își curăță doar afișarea, local.)
    await db`DELETE FROM agent_settings WHERE agent_id = ${auth.agentId}`;
    return Response.json({
      ok: true,
      pastrat: true,
      mesaj: "Setările au fost resetate. Vânzările rămân la firmă.",
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
