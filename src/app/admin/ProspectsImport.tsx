"use client";

import { useState } from "react";
import {
  isActiveByState,
  isTargetCaen,
  normalizeCaen,
  parseFirmsFile,
  TARGET_COUNTIES,
  type RawFirmRow,
} from "@/modules/prospects";

interface ImportStats {
  totalLines: number;
  matched: number;
  imported: number;
  skippedInactive: number;
  skippedCaen: number;
  skippedCounty: number;
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
  const [onlyTargetCounties, setOnlyTargetCounties] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!adminSecret) {
      setError("Completează ADMIN_SECRET mai sus înainte de import.");
      return;
    }
    setImporting(true);
    setError(null);
    setStats(null);
    setProgress("Se citește fișierul...");
    try {
      const text = await file.text();
      setProgress("Se parsează...");
      const parsed = parseFirmsFile(text);
      if (parsed.rows.length === 0) {
        setError(
          `Nu am putut extrage firme din fișier. Delimitator detectat: "${parsed.delimiter}". Primele headere: ${parsed.headers.slice(0, 8).join(", ") || "(fără header)"}. Trimite-mi un fragment din fișier ca să ajustez parserul.`,
        );
        return;
      }

      // Filtrare: CAEN țintă + firmă activă + județ (opțional)
      let skippedInactive = 0;
      let skippedCaen = 0;
      let skippedCounty = 0;
      const matched: RawFirmRow[] = [];
      for (const row of parsed.rows) {
        if (!isActiveByState(row.stare)) {
          skippedInactive++;
          continue;
        }
        if (row.caen && !isTargetCaen(row.caen)) {
          skippedCaen++;
          continue;
        }
        if (
          onlyTargetCounties &&
          row.judet &&
          !TARGET_COUNTIES.includes(row.judet)
        ) {
          skippedCounty++;
          continue;
        }
        matched.push(row);
      }

      if (matched.length === 0) {
        setError(
          `Fișier parsat (${parsed.rows.length} firme) dar niciuna nu trece filtrele (CAEN alimentar/bar/tutun${onlyTargetCounties ? " + județ SV/BT" : ""}). Dacă fișierul nu are coloană CAEN, debifează filtrarea strictă și reîncearcă.`,
        );
        return;
      }

      // POST în chunks
      let imported = 0;
      for (let i = 0; i < matched.length; i += 1500) {
        const chunk = matched.slice(i, i + 1500);
        setProgress(
          `Se importă ${Math.min(i + 1500, matched.length)}/${matched.length}...`,
        );
        const res = await fetch("/api/prospects/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-secret": adminSecret,
          },
          body: JSON.stringify({
            prospects: chunk.map((r) => ({
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
          setError(json.error ?? `Eroare ${res.status} la import`);
          return;
        }
        imported += json.inserted ?? 0;
      }

      setStats({
        totalLines: parsed.rows.length,
        matched: matched.length,
        imported,
        skippedInactive,
        skippedCaen,
        skippedCounty,
      });
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
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
      // Apelăm repetat până nu mai rămâne nimic (max 30 iterații de siguranță)
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
          Descarcă fișierul județului de pe{" "}
          <a
            href="https://data.gov.ro/dataset?q=date+de+identificare+platitori"
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline"
          >
            data.gov.ro — „Date de identificare plătitori"
          </a>{" "}
          (fișierele SV / BT, format TXT sau CSV)
        </li>
        <li>Încarcă-l mai jos — filtrez automat alimentare/baruri/tutungerii</li>
        <li>Apasă „Verifică ANAF" ca să elimini firmele radiate/inactive</li>
      </ol>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30">
        <span className="text-sm font-medium text-slate-700">
          {importing ? progress || "Se importă..." : "Încarcă fișierul MF (TXT / CSV)"}
        </span>
        <span className="text-xs text-slate-500">
          Parsare locală în browser, doar firmele filtrate ajung pe server
        </span>
        <input
          type="file"
          accept=".txt,.csv"
          className="hidden"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </label>

      <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={onlyTargetCounties}
          onChange={(e) => setOnlyTargetCounties(e.target.checked)}
          className="rounded border-slate-300"
        />
        Doar județele Suceava și Botoșani (debifează dacă fișierul e deja doar un județ)
      </label>

      {error && (
        <div className="mt-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {stats && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Import reușit</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{stats.totalLines} firme în fișier</li>
            <li>{stats.matched} au trecut filtrele → {stats.imported} salvate</li>
            {stats.skippedCaen > 0 && (
              <li>{stats.skippedCaen} sărite (alt profil CAEN)</li>
            )}
            {stats.skippedInactive > 0 && (
              <li>{stats.skippedInactive} sărite (radiate/inactive din fișier)</li>
            )}
            {stats.skippedCounty > 0 && (
              <li>{stats.skippedCounty} sărite (alt județ)</li>
            )}
          </ul>
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
