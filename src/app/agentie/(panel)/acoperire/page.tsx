"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Printer, MapPinned } from "lucide-react";
import { Card, EmptyState, api } from "@/app/platform/ui";
import { downloadCSV } from "@/lib/csv-export";

/**
 * ACOPERIREA TERENULUI — raportul cerut de Bogdan (28.08): „vizitele
 * efectuate vs. universul posibil de pe hartă, al agenților", cu
 * descărcare Excel sau PDF.
 *
 * Cifra de aici nu e „câte vizite a bătut omul" — e CÂT DIN TERENUL LUI
 * a călcat. 40 de vizite pot fi de 40 de ori același magazin; acoperirea
 * spune câte din opririle lui distincte au văzut un agent în perioadă.
 */

interface Rand {
  agent: string;
  universClienti: number;
  vizitate: number;
  procent: number;
  vizite: number;
  universProspectare: number;
  prospectate: number;
  areZone: boolean;
}

interface Raport {
  zile: number;
  agenti: Rand[];
  harta: { prospecteTotal: number; inZonele: number; faraStapan: number };
  total: {
    universClienti: number;
    vizitate: number;
    procent: number;
    vizite: number;
    universProspectare: number;
    prospectate: number;
  };
}

/** Bara de procent: verde peste 80, galben peste 50, roșu sub. */
function Bara({ procent }: { procent: number }) {
  const culoare =
    procent >= 80 ? "bg-emerald-500" : procent >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 print:border print:border-slate-300">
        <div
          className={`h-full rounded-full ${culoare}`}
          style={{ width: `${Math.min(100, procent)}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums text-slate-800">
        {procent}%
      </span>
    </div>
  );
}

export default function AcoperirePage() {
  const [zile, setZile] = useState(30);
  const [raport, setRaport] = useState<Raport | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setEroare(null);
    try {
      const d = await api<Raport>(`/api/agentie/acoperire?zile=${zile}`);
      setRaport(d);
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [zile]);

  useEffect(() => {
    void load();
  }, [load]);

  function excel() {
    if (!raport) return;
    downloadCSV(
      `acoperire-teren-${zile}zile.csv`,
      [
        "Agent",
        "Opriri de vizitat",
        "Vizitate",
        "Acoperire %",
        "Vizite totale",
        "De prospectat în zonele lui",
        "Prospectate",
      ],
      [
        ...raport.agenti.map((r) => [
          r.agent,
          r.universClienti,
          r.vizitate,
          r.procent,
          r.vizite,
          r.areZone ? r.universProspectare : "fără zone puse",
          r.areZone ? String(r.prospectate) : "-",
        ]),
        [
          "TOTAL",
          raport.total.universClienti,
          raport.total.vizitate,
          raport.total.procent,
          raport.total.vizite,
          raport.total.universProspectare,
          raport.total.prospectate,
        ],
      ],
    );
  }

  return (
    <div className="space-y-5 print:text-black">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <MapPinned className="h-6 w-6 text-indigo-500 print:hidden" />
            Acoperirea terenului
          </h1>
          <p className="text-sm text-slate-500">
            Cât din terenul LUI a călcat fiecare agent: opririle vizitate
            din tot ce are de vizitat pe hartă (o firmă cu 6 magazine = 6
            opriri), în ultimele {zile} de zile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select
            value={zile}
            onChange={(e) => setZile(parseInt(e.target.value, 10))}
            className="min-h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value={7}>Ultimele 7 zile</option>
            <option value={30}>Ultimele 30 de zile</option>
            <option value={90}>Ultimele 90 de zile</option>
          </select>
          <button
            type="button"
            onClick={excel}
            disabled={!raport}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Descarcă Excel
          </button>
          <button
            type="button"
            // PDF-ul iese din tipărire: aceeași cale ca la Raportul săpt.
            // — browserul are „Salvează ca PDF" gata făcut, fără nicio
            // bibliotecă în plus.
            onClick={() => window.print()}
            disabled={!raport}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Descarcă PDF
          </button>
        </div>
      </header>

      {eroare && (
        <Card className="border-rose-200 p-4 text-sm text-rose-700">{eroare}</Card>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-slate-500">Calculez acoperirea…</Card>
      ) : !raport || raport.agenti.length === 0 ? (
        <EmptyState text="Niciun agent activ încă." />
      ) : (
        <>
          {/* Totalul firmei, dintr-o privire */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Acoperire totală
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {raport.total.procent}%
              </p>
              <p className="text-xs text-slate-500">
                {raport.total.vizitate} din {raport.total.universClienti} opriri
                vizitate
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Vizite în perioadă
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {raport.total.vizite}
              </p>
              <p className="text-xs text-slate-500">cu tot cu revenirile</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Prospectare
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {raport.total.prospectate}
                <span className="text-base font-normal text-slate-400">
                  {" "}
                  / {raport.total.universProspectare}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                magazine noi atinse din zonele lor · pe toată harta:{" "}
                {raport.harta.prospecteTotal}
              </p>
            </Card>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Acoperire</th>
                  <th className="px-4 py-3 text-right">Vizitate</th>
                  <th className="px-4 py-3 text-right">De vizitat</th>
                  <th className="px-4 py-3 text-right">Vizite totale</th>
                  <th className="px-4 py-3 text-right">Prospectare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {raport.agenti.map((r) => (
                  <tr key={r.agent}>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {r.agent}
                    </td>
                    <td className="px-4 py-3">
                      <Bara procent={r.procent} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.vizitate}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.universClienti}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.vizite}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {r.areZone ? (
                        `${r.prospectate} / ${r.universProspectare}`
                      ) : (
                        <span
                          className="text-xs text-amber-600"
                          title="Fără zonele pe zile, magazinele de prospectat nu se pot lega de agent"
                        >
                          fără zone puse
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs leading-snug text-slate-400 print:text-slate-600">
            „De vizitat" = clienții lui + magazinele lor de pe hartă (fără
            cele tăiate pe teren și fără SIS-uri). „Prospectare" = magazinele
            mov din satele zonelor lui, atinse prin vizită sau confirmare.
            <br />
            <b>Universul total al hărții:</b> {raport.harta.prospecteTotal}{" "}
            magazine de prospectat pe toată harta firmei — {raport.harta.inZonele}{" "}
            sunt în zonele agenților
            {raport.harta.faraStapan > 0 && (
              <>
                , iar <b>{raport.harta.faraStapan} nu-s încă în zona nimănui</b>
                {" "}(intră în raport când un agent își ia satele alea în zone)
              </>
            )}
            . Generat {new Date().toLocaleDateString("ro-RO")}, pe ultimele{" "}
            {raport.zile} de zile.
          </p>
        </>
      )}
    </div>
  );
}
