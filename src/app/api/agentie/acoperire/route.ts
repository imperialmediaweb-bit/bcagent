import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { listOrgAgents, requireOrgUser } from "@/modules/platform";
import { acoperireTeren } from "@/modules/crm/acoperire";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * RAPORTUL DE ACOPERIRE: vizitele fiecărui agent vs. universul lui de pe
 * hartă. Cerut de Bogdan (28.08). `?format=csv` dă fișierul pentru
 * Excel — cu BOM, ca diacriticele să nu iasă hieroglife.
 */
export async function GET(req: Request) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  const db = getDB();
  if (!db) return Response.json({ enabled: false }, { status: 503 });

  const url = new URL(req.url);
  const zile = Math.min(
    365,
    Math.max(1, parseInt(url.searchParams.get("zile") ?? "30", 10) || 30),
  );
  const format = url.searchParams.get("format") ?? "";

  try {
    await ensureSchema();
    const agenti = (await listOrgAgents(auth.session.orgId))
      .filter((a) => a.active !== false)
      .map((a) => ({ name: a.name, agentId: a.agentId }));
    const raport = await acoperireTeren(db, auth.session.orgId, agenti, zile);

    if (format === "csv") {
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const linii = [
        [
          "Agent",
          "Opriri de vizitat (universul lui)",
          "Vizitate în perioadă",
          "Acoperire %",
          "Vizite totale",
          "Magazine de prospectat în zonele lui",
          "Prospectate",
        ].map(esc).join(";"),
        ...raport.agenti.map((r) =>
          [
            r.agent,
            r.universClienti,
            r.vizitate,
            r.procent,
            r.vizite,
            r.areZone ? r.universProspectare : "fără zone puse",
            r.areZone ? r.prospectate : "-",
          ].map(esc).join(";"),
        ),
        [
          "TOTAL",
          raport.total.universClienti,
          raport.total.vizitate,
          raport.total.procent,
          raport.total.vizite,
          raport.total.universProspectare,
          raport.total.prospectate,
        ].map(esc).join(";"),
      ];
      // BOM-ul e obligatoriu: fără el, Excel-ul românesc face „Hăneşti"
      // varză la deschidere.
      const azi = new Date().toISOString().slice(0, 10);
      return new Response("﻿" + linii.join("\n"), {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="acoperire-teren-${zile}zile-${azi}.csv"`,
        },
      });
    }

    return Response.json(raport);
  } catch (e) {
    console.error("[agentie acoperire]", e);
    return Response.json({ error: "Eroare la calculul acoperirii" }, { status: 500 });
  }
}
