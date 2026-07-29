"use client";

import { useState } from "react";
import {
  normalizeCaen,
  streamImportFirms,
  type RawFirmRow,
  type StreamDiagnostic,
} from "@/modules/prospects";

interface ImportStats {
  totalLines: number;
  matched: number;
  imported: number;
}

export default function ProspectsImport({
  adminSecret,
}: {
  adminSecret: string;
}) {
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<StreamDiagnostic | null>(null);

  async function handleFile(file: File) {
    if (!adminSecret) {
      setError("Completează ADMIN_SECRET mai sus înainte de import.");
      return;
    }
    setImporting(true);
    setError(null);
    setStats(null);
    setProgressPct(0);
    setProgress("Se procesează fișierul...");

    let imported = 0;
    let uploadError: string | null = null;

    try {
      const result = await streamImportFirms(file, {
        onProgress: (bytesRead, total, processed, matched) => {
          const pct = total > 0 ? Math.round((bytesRead / total) * 100) : 0;
          setProgressPct(pct);
          setProgress(
            `Procesare: ${pct}% · ${processed.toLocaleString("ro-RO")} firme citite · ${matched.toLocaleString("ro-RO")} potriviri SV+BT`,
          );
        },
        onBatch: async (rows: RawFirmRow[]) => {
          const res = await fetch("/api/prospects/import", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-secret": adminSecret,
            },
            body: JSON.stringify({
              prospects: rows.map((r) => ({
                cui: r.cui,
                denumire: r.denumire,
                adresa: r.adresa,
                localitate: r.localitate,
                judet: r.judet,
                caen: normalizeCaen(r.caen),
              })),
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            uploadError = json.error ?? `Eroare ${res.status} la salvare`;
            throw new Error(uploadError ?? "eroare");
          }
          imported += json.inserted ?? 0;
        },
      });

      if (result.error) {
        setError(result.error);
        setDiagnostic(result.diagnostic ?? null);
        return;
      }
      if (result.matched === 0) {
        setError(
          `Fișier procesat (${result.processed.toLocaleString("ro-RO")} firme citite) dar nicio firmă din SV/BT cu profil alimentar/bar/tutun nu a fost găsită. Mai jos e ce vede sistemul în fișier — fă screenshot și trimite-l.`,
        );
        setDiagnostic(result.diagnostic ?? null);
        return;
      }
      setDiagnostic(null);
      setStats({
        totalLines: result.processed,
        matched: result.matched,
        imported,
      });
      setProgress("");
    } catch (e) {
      setError(
        uploadError ?? (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setImporting(false);
      setProgressPct(null);
    }
  }

  async function runEnrich() {
    if (!adminSecret) {
      setError("Completează ADMIN_SECRET mai sus.");
      return;
    }
    setEnriching(true);
    setEnrichStatus("Se verifică la ANAF...");
    try {
      let totalProcessed = 0;
      let totalInactive = 0;
      for (let i = 0; i < 30; i++) {
        const res = await fetch("/api/prospects/enrich", {
          method: "POST",
          headers: { "x-admin-secret": adminSecret },
        });
        const json = await res.json();
        if (!res.ok) {
          setEnrichStatus(`Eroare: ${json.error ?? res.status}`);
          return;
        }
        totalProcessed += json.processed ?? 0;
        totalInactive += json.inactive ?? 0;
        if ((json.remaining ?? 0) === 0) {
          setEnrichStatus(
            `Gata: ${totalProcessed} verificate, ${totalInactive} inactive marcate. Toate firmele sunt verificate ANAF.`,
          );
          return;
        }
        setEnrichStatus(
          `${totalProcessed} verificate până acum, ${json.remaining} rămase...`,
        );
      }
      setEnrichStatus(
        `${totalProcessed} verificate — mai apasă o dată pentru restul.`,
      );
    } catch (e) {
      setEnrichStatus(
        `Eroare: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">
        Import prospecți (firme din SV + BT)
      </h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>
          Descarcă fișierul de pe{" "}
          <a
            href="https://data.gov.ro/dataset?q=date+de+identificare+platitori"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline"
          >
            data.gov.ro — „Date de identificare plătitori"
          </a>{" "}
          (merge și fișierul mare pe toată țara, ~400 MB)
        </li>
        <li>
          Încarcă-l mai jos — se procesează direct în browser, nu pleacă
          nicăieri; doar firmele din SV+BT ajung în baza ta
        </li>
        <li>Apasă „Verifică ANAF" ca să elimini firmele radiate/inactive</li>
      </ol>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30">
        <span className="text-sm font-medium text-slate-700">
          {importing
            ? progress || "Se procesează..."
            : "Încarcă fișierul MF (CSV / TXT — orice mărime)"}
        </span>
        {!importing && (
          <span className="text-xs text-slate-500">
            Filtrare automată: alimentare, baruri, tutungerii · doar SV + BT
          </span>
        )}
        {importing && progressPct !== null && (
          <div className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
        <input
          type="file"
          accept=".txt,.csv,.xls,.xlsx"
          className="hidden"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {error && (
        <div className="mt-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {diagnostic && (
        <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="text-sm font-semibold">
            🔍 Ce vede sistemul în fișier (screenshot la asta):
          </p>
          <div>
            <p className="font-medium">Delimitator: <code className="rounded bg-white px-1">{diagnostic.delimiter === "\t" ? "TAB" : diagnostic.delimiter}</code></p>
            <p className="font-medium">
              Coloane mapate:{" "}
              <code className="rounded bg-white px-1">
                {Object.entries(diagnostic.columnMap)
                  .map(([k, v]) => `${k}→col${v + 1}`)
                  .join(", ") || "(niciuna)"}
              </code>
            </p>
          </div>
          {diagnostic.firstLines.length > 0 && (
            <div>
              <p className="font-medium">Primele linii din fișier:</p>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[10px] leading-relaxed">
                {diagnostic.firstLines.join("\n")}
              </pre>
            </div>
          )}
          {diagnostic.countyTop.length > 0 && (
            <div>
              <p className="font-medium">Top valori „județ" văzute (după normalizare):</p>
              <p className="mt-0.5 font-mono text-[11px]">
                {diagnostic.countyTop
                  .map(([v, n]) => `${v}: ${n.toLocaleString("ro-RO")}`)
                  .join(" · ")}
              </p>
            </div>
          )}
          {diagnostic.caenTop.length > 0 && (
            <div>
              <p className="font-medium">Top valori CAEN văzute:</p>
              <p className="mt-0.5 font-mono text-[11px]">
                {diagnostic.caenTop
                  .map(([v, n]) => `${v}: ${n.toLocaleString("ro-RO")}`)
                  .join(" · ")}
              </p>
            </div>
          )}
          {diagnostic.sampleRows.length > 0 && (
            <div>
              <p className="font-medium">Primele rânduri cum le-a înțeles sistemul:</p>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[10px] leading-relaxed">
                {diagnostic.sampleRows
                  .map(
                    (r) =>
                      `CUI=${r.cui} | denumire=${r.denumire.slice(0, 30)} | judet=${r.judet || "(gol)"} | caen=${r.caen || "(gol)"} | localitate=${r.localitate.slice(0, 20) || "(gol)"}`,
                  )
                  .join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}

      {stats && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Import reușit</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{stats.totalLines.toLocaleString("ro-RO")} firme citite din fișier</li>
            <li>
              {stats.matched.toLocaleString("ro-RO")} firme SV+BT cu profil
              alimentar/bar/tutun → {stats.imported.toLocaleString("ro-RO")} salvate
            </li>
          </ul>
          <p className="mt-2 text-xs">
            Următorul pas: apasă „Verifică ANAF" mai jos.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runEnrich}
          disabled={enriching}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {enriching ? "Se verifică la ANAF..." : "Verifică ANAF (activ + TVA)"}
        </button>
        {enrichStatus && (
          <p className="text-xs text-slate-600">{enrichStatus}</p>
        )}
      </div>
    </div>
  );
}
