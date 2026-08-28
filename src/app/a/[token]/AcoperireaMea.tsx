"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, MapPinned, Printer } from "lucide-react";
import { downloadCSV } from "@/lib/csv-export";
import { paginaRaport } from "@/lib/md-print";

/**
 * ACOPERIREA MEA — agentul își vede singur terenul, pe telefonul lui:
 * câte din opririle LUI a călcat în perioadă, cu descărcare Excel/PDF.
 *
 * Aceeași socoteală ca pe raportul lui Bogdan (un magazin = o oprire) —
 * dinadins: dacă agentul și șeful ar vedea cifre calculate diferit,
 * discuția dintre ei n-ar avea sfârșit. Vede DOAR cifrele lui; ale
 * colegilor sunt treaba șefului.
 */

interface Eu {
  agent: string;
  universClienti: number;
  vizitate: number;
  procent: number;
  vizite: number;
  universProspectare: number;
  prospectate: number;
  areZone: boolean;
}

export default function AcoperireaMea({ token }: { token: string }) {
  const [zile, setZile] = useState(30);
  const [eu, setEu] = useState<Eu | null>(null);
  const [inOrg, setInOrg] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/acoperire?token=${encodeURIComponent(token)}&zile=${zile}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { inOrg?: boolean; eu?: Eu } | null) => {
        if (!d) return;
        setInOrg(d.inOrg !== false);
        if (d.eu) setEu(d.eu);
      })
      .catch(() => {});
  }, [token, zile]);

  useEffect(() => {
    load();
  }, [load]);

  // Link vechi fără firmă, sau încă n-a venit nimic: nu arătăm un card gol.
  if (!inOrg || !eu) return null;

  const culoare =
    eu.procent >= 80
      ? "text-emerald-600"
      : eu.procent >= 50
        ? "text-amber-600"
        : "text-rose-600";
  const bara =
    eu.procent >= 80
      ? "bg-emerald-500"
      : eu.procent >= 50
        ? "bg-amber-500"
        : "bg-rose-500";

  function excel() {
    if (!eu) return;
    downloadCSV(
      `acoperirea-mea-${zile}zile.csv`,
      [
        "Agent",
        "Opriri de vizitat",
        "Vizitate",
        "Acoperire %",
        "Vizite totale",
        "De prospectat în zonele mele",
        "Prospectate",
      ],
      [
        [
          eu.agent,
          eu.universClienti,
          eu.vizitate,
          eu.procent,
          eu.vizite,
          eu.areZone ? eu.universProspectare : "fără zone puse",
          eu.areZone ? String(eu.prospectate) : "-",
        ],
      ],
    );
  }

  function pdf() {
    if (!eu) return;
    const f = window.open("", "_blank");
    if (!f) return;
    f.document.write(
      paginaRaport({
        titlu: "Acoperirea terenului — raportul meu",
        subtitlu: `${eu.agent} · ultimele ${zile} de zile · generat ${new Date().toLocaleDateString("ro-RO")}`,
        corpMd: [
          `## Acoperire: ${eu.procent}%`,
          "",
          `| Ce | Cifra |`,
          `|---|---|`,
          `| Opriri de vizitat (clienții mei, magazin cu magazin) | ${eu.universClienti} |`,
          `| Vizitate în perioadă | ${eu.vizitate} |`,
          `| Vizite totale (cu reveniri) | ${eu.vizite} |`,
          `| Magazine de prospectat în zonele mele | ${eu.areZone ? eu.universProspectare : "fără zone puse"} |`,
          `| Prospectate | ${eu.areZone ? eu.prospectate : "-"} |`,
          "",
          `O oprire = un magazin (o firmă cu 6 magazine = 6 opriri). Aceleași cifre le vede și firma.`,
        ].join("\n"),
      }),
    );
    f.document.close();
  }

  return (
    <div className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MapPinned className="h-4 w-4 text-indigo-500" />
          Acoperirea mea
        </h4>
        <select
          value={zile}
          onChange={(e) => setZile(parseInt(e.target.value, 10))}
          className="min-h-9 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
        >
          <option value={7}>7 zile</option>
          <option value={30}>30 de zile</option>
          <option value={90}>90 de zile</option>
        </select>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className={`text-2xl font-bold tabular-nums ${culoare}`}>
          {eu.procent}%
        </span>
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${bara}`}
            style={{ width: `${Math.min(100, eu.procent)}%` }}
          />
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-600">
        Ai călcat {eu.vizitate} din {eu.universClienti} opriri ale tale
        (fiecare magazin numărat separat) · {eu.vizite} vizite în total
        {eu.areZone
          ? ` · prospectare: ${eu.prospectate}/${eu.universProspectare}`
          : ""}
        .
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={excel}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          Descarcă Excel
        </button>
        <button
          type="button"
          onClick={pdf}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Printer className="h-3.5 w-3.5" />
          Descarcă PDF
        </button>
      </div>
    </div>
  );
}
