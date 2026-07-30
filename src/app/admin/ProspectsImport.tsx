"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COUNTY_LIST,
  CORE_CAEN,
  normalizeCaen,
  streamImportFirms,
  TARGET_COUNTIES,
  type RawFirmRow,
  type StreamDiagnostic,
} from "@/modules/prospects";

interface ImportStats {
  totalLines: number;
  matched: number;
  imported: number;
}

interface StatsResponse {
  total: number;
  verified: number;
  pending: number;
  byCounty: Array<{ judet: string; count: number }>;
}

type ImportScope = "all" | "target" | "custom";

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
  const [scope, setScope] = useState<ImportScope>("all");
  const [customCounties, setCustomCounties] = useState<string[]>([]);
  const [onlyFmcg, setOnlyFmcg] = useState(false);
  const [dbStats, setDbStats] = useState<StatsResponse | null>(null);
  const [stopEnrich, setStopEnrich] = useState(false);

  const loadStats = useCallback(async () => {
    if (!adminSecret) return;
    try {
      const res = await fetch("/api/prospects/stats", {
        headers: { "x-admin-secret": adminSecret },
        cache: "no-store",
      });
      if (res.ok) setDbStats(await res.json());
    } catch {
      // statistici indisponibile — nu blochează nimic
    }
  }, [adminSecret]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  function resolveCounties(): string[] | undefined {
    if (scope === "all") return undefined;
    if (scope === "target") return TARGET_COUNTIES;
    return customCounties.length > 0 ? customCounties : undefined;
  }

  async function handleFile(file: File) {
    if (!adminSecret) {
      setError("Completează ADMIN_SECRET mai sus înainte de import.");
      return;
    }
    setImporting(true);
    setError(null);
    setStats(null);
    setDiagnostic(null);
    setProgressPct(0);
    setProgress("Se procesează fișierul...");

    let imported = 0;
    let uploadError: string | null = null;

    try {
      const result = await streamImportFirms(file, {
        batchSize: 4000,
        counties: resolveCounties(),
        caens: onlyFmcg ? CORE_CAEN : undefined,
        onProgress: (bytesRead, total, processed, matched) => {
          const pct = total > 0 ? Math.round((bytesRead / total) * 100) : 0;
          setProgressPct(pct);
          setProgress(
            `Procesare: ${pct}% · ${processed.toLocaleString("ro-RO")} firme citite · ${matched.toLocaleString("ro-RO")} de salvat`,
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
          `Fișier procesat (${result.processed.toLocaleString("ro-RO")} firme citite) dar nicio firmă nu a trecut filtrele. Mai jos e ce vede sistemul în fișier.`,
        );
        setDiagnostic(result.diagnostic ?? null);
        return;
      }
      setStats({
        totalLines: result.processed,
        matched: result.matched,
        imported,
      });
      setProgress("");
      loadStats();
    } catch (e) {
      setError(uploadError ?? (e instanceof Error ? e.message : String(e)));
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
    setStopEnrich(false);
    setEnrichStatus("Se verifică la ANAF...");
    try {
      let totalProcessed = 0;
      let totalInactive = 0;
      let consecutiveErrors = 0;
      // Rulează cât e nevoie; se poate opri manual, progresul e salvat
      for (let i = 0; i < 100000; i++) {
        if (stopEnrich) {
          setEnrichStatus(
            `Oprit manual: ${totalProcessed.toLocaleString("ro-RO")} verificate. Progresul e salvat — apasă din nou ca să continui.`,
          );
          return;
        }
        let json: {
          error?: string;
          processed?: number;
          inactive?: number;
          remaining?: number;
        } | null = null;
        try {
          const res = await fetch("/api/prospects/enrich", {
            method: "POST",
            headers: { "x-admin-secret": adminSecret },
          });
          const text = await res.text();
          try {
            json = JSON.parse(text);
          } catch {
            json = { error: `Server: ${text.slice(0, 80)} (${res.status})` };
          }
          if (!res.ok || json?.error) {
            throw new Error(json?.error ?? `Eroare ${res.status}`);
          }
        } catch (err) {
          consecutiveErrors++;
          if (consecutiveErrors >= 8) {
            setEnrichStatus(
              `Erori consecutive (${err instanceof Error ? err.message : "network"}). Progresul e salvat — apasă din nou ca să continui.`,
            );
            return;
          }
          setEnrichStatus(
            `Eroare temporară (${consecutiveErrors}/8) — reîncerc în 3s... (${totalProcessed.toLocaleString("ro-RO")} verificate)`,
          );
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        consecutiveErrors = 0;
        totalProcessed += json?.processed ?? 0;
        totalInactive += json?.inactive ?? 0;
        const remaining = json?.remaining ?? 0;
        if (remaining === 0) {
          setEnrichStatus(
            `Gata: ${totalProcessed.toLocaleString("ro-RO")} firme verificate la ANAF · ${totalInactive.toLocaleString("ro-RO")} inactive/radiate marcate. Toate firmele au acum cod CAEN și status.`,
          );
          loadStats();
          return;
        }
        const eta = Math.ceil((remaining / 500) * 7 / 60);
        setEnrichStatus(
          `${totalProcessed.toLocaleString("ro-RO")} verificate · ${remaining.toLocaleString("ro-RO")} rămase (~${eta} min)`,
        );
        if (i % 20 === 0) loadStats();
      }
    } catch (e) {
      setEnrichStatus(`Eroare: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnriching(false);
    }
  }

  function toggleCounty(code: string) {
    setCustomCounties((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">
        Import firme (baza de prospecți)
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Baza e comună platformei: importă toate firmele, apoi fiecare agent își
        pune filtrele lui (județ, domeniu, localitate) și salvează ce-l
        interesează.
      </p>

      {dbStats && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatBox
            label="Firme în bază"
            value={dbStats.total}
            accent="text-indigo-700 bg-indigo-50"
          />
          <StatBox
            label="Verificate ANAF"
            value={dbStats.verified}
            accent="text-emerald-700 bg-emerald-50"
          />
          <StatBox
            label="De verificat"
            value={dbStats.pending}
            accent="text-amber-700 bg-amber-50"
          />
        </div>
      )}

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>
          Descarcă fișierele de pe{" "}
          <a
            href="https://data.gov.ro/dataset?q=date+de+identificare+platitori"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline"
          >
            data.gov.ro — „Date de identificare plătitori"
          </a>{" "}
          (toate părțile: _a, _b, _c… — se adună în bază)
        </li>
        <li>Încarcă-le pe rând mai jos (se procesează local, în browser)</li>
        <li>
          Apasă „Verifică ANAF" — aduce codul CAEN + status pentru fiecare firmă
          (fișierul MF nu conține domeniul). Rulează în etape, progresul se
          salvează.
        </li>
      </ol>

      <fieldset className="mt-5 rounded-lg border border-slate-200 p-4">
        <legend className="px-2 text-xs font-semibold uppercase text-slate-500">
          Ce importăm
        </legend>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "all"}
              onChange={() => setScope("all")}
              className="mt-1"
            />
            <span>
              <strong>Toată țara</strong> — toate județele, toate domeniile
              (recomandat pentru platformă)
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "target"}
              onChange={() => setScope("target")}
              className="mt-1"
            />
            <span>
              <strong>Doar Suceava + Botoșani</strong> — piața curentă
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "custom"}
              onChange={() => setScope("custom")}
              className="mt-1"
            />
            <span>
              <strong>Județe alese</strong> ({customCounties.length} selectate)
            </span>
          </label>
          {scope === "custom" && (
            <div className="ml-6 flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded border border-slate-100 p-2">
              {COUNTY_LIST.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => toggleCounty(c.code)}
                  className={`rounded-full px-2 py-0.5 text-xs transition ${
                    customCounties.includes(c.code)
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={onlyFmcg}
              onChange={(e) => setOnlyFmcg(e.target.checked)}
              className="rounded border-slate-300"
            />
            Doar alimentare/baruri/tutungerii (are efect numai dacă fișierul
            conține coloană CAEN — cel de la MF nu o are)
          </label>
        </div>
      </fieldset>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30">
        <span className="text-sm font-medium text-slate-700">
          {importing
            ? progress || "Se procesează..."
            : "Încarcă fișier (CSV / TXT — orice mărime)"}
        </span>
        {!importing && (
          <span className="text-xs text-slate-500">
            Fișierul nu pleacă din calculator; doar firmele filtrate ajung în
            bază
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
            🔍 Ce vede sistemul în fișier:
          </p>
          <div>
            <p className="font-medium">
              Delimitator:{" "}
              <code className="rounded bg-white px-1">
                {diagnostic.delimiter === "\t" ? "TAB" : diagnostic.delimiter}
              </code>
            </p>
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
              <p className="font-medium">Top valori „județ":</p>
              <p className="mt-0.5 font-mono text-[11px]">
                {diagnostic.countyTop
                  .map(([v, n]) => `${v}: ${n.toLocaleString("ro-RO")}`)
                  .join(" · ")}
              </p>
            </div>
          )}
          {diagnostic.sampleRows.length > 0 && (
            <div>
              <p className="font-medium">Primele rânduri interpretate:</p>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-[10px] leading-relaxed">
                {diagnostic.sampleRows
                  .map(
                    (r) =>
                      `CUI=${r.cui} | ${r.denumire.slice(0, 30)} | judet=${r.judet || "(gol)"} | caen=${r.caen || "(gol)"} | loc=${r.localitate.slice(0, 20) || "(gol)"}`,
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
            <li>{stats.totalLines.toLocaleString("ro-RO")} firme citite</li>
            <li>
              {stats.matched.toLocaleString("ro-RO")} au trecut filtrele →{" "}
              {stats.imported.toLocaleString("ro-RO")} salvate în bază
            </li>
          </ul>
          <p className="mt-2 text-xs">
            Dacă mai ai fișiere (_b, _c…), încarcă-le acum. Apoi „Verifică
            ANAF".
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={runEnrich}
          disabled={enriching}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
        >
          {enriching ? "Se verifică la ANAF..." : "Verifică ANAF (CAEN + status)"}
        </button>
        {enriching && (
          <button
            type="button"
            onClick={() => setStopEnrich(true)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Oprește
          </button>
        )}
        {enrichStatus && (
          <p className="flex-1 text-xs text-slate-600">{enrichStatus}</p>
        )}
      </div>

      {dbStats && dbStats.byCounty.length > 0 && (
        <details className="mt-4 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">
            Distribuție pe județe ({dbStats.byCounty.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dbStats.byCounty.map((c) => (
              <span
                key={c.judet}
                className="rounded-full bg-slate-100 px-2 py-0.5"
              >
                {c.judet || "?"}: {c.count.toLocaleString("ro-RO")}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className={`rounded-lg px-3 py-2 ${accent}`}>
      <p className="text-lg font-semibold leading-tight">
        {value.toLocaleString("ro-RO")}
      </p>
      <p className="text-xs opacity-80">{label}</p>
    </div>
  );
}
