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

/** Fișierele sub acest prag se parsează local (fără R2). */
const LOCAL_PARSE_LIMIT = 20 * 1024 * 1024; // 20 MB

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
  const [progressPct, setProgressPct] = useState<number | null>(null);
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
    setProgressPct(null);
    try {
      if (file.size > LOCAL_PARSE_LIMIT) {
        await importViaR2(file);
      } else {
        await importLocal(file);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setProgressPct(null);
    }
  }

  /** Fișier mare (dataset MF complet): upload direct R2 + procesare server. */
  async function importViaR2(file: File) {
    // 1. Cere presigned URL
    setProgress("Se pregătește upload-ul...");
    const urlRes = await fetch("/api/prospects/upload-url", {
      method: "POST",
      headers: { "x-admin-secret": adminSecret },
    });
    const urlJson = await urlRes.json();
    if (!urlRes.ok) {
      setError(urlJson.error ?? `Eroare ${urlRes.status}`);
      return;
    }

    // 2. Upload direct browser → R2 cu progres (XHR pentru progress events)
    setProgress("Se urcă fișierul în Cloudflare R2...");
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", urlJson.url);
      xhr.setRequestHeader("Content-Type", "text/plain");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgressPct(pct);
          setProgress(`Upload în R2: ${pct}%`);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload R2 eșuat (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload R2 eșuat (rețea)"));
      xhr.send(file);
    });

    // 3. Procesare server-side în buclă
    setProgressPct(0);
    setProgress("Serverul procesează fișierul...");
    let lastMatched = 0;
    let lastProcessed = 0;
    for (let i = 0; i < 200; i++) {
      const res = await fetch("/api/prospects/sync", {
        method: "POST",
        headers: { "x-admin-secret": adminSecret },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Eroare ${res.status} la procesare`);
        return;
      }
      lastMatched = json.matched ?? 0;
      lastProcessed = json.processed ?? 0;
      const pct =
        json.size > 0 ? Math.round((json.offset / json.size) * 100) : 0;
      setProgressPct(pct);
      setProgress(
        `Procesare: ${pct}% · ${lastProcessed.toLocaleString("ro-RO")} firme citite · ${lastMatched.toLocaleString("ro-RO")} potriviri`,
      );
      if (json.done) {
        setStats({
          totalLines: lastProcessed,
          matched: lastMatched,
          imported: lastMatched,
          skippedInactive: 0,
          skippedCaen: 0,
          skippedCounty: 0,
        });
        setProgress("");
        return;
      }
    }
    setError("Procesarea durează neobișnuit de mult — apasă din nou pe fișier pentru a continua (progresul e salvat).");
  }

  /** Fișier mic (județ / test): parsare locală în browser, ca înainte. */
  async function importLocal(file: File) {
    setProgress("Se citește fișierul...");
    const text = await file.text();
    setProgress("Se parsează...");
    const parsed = parseFirmsFile(text);
    if (parsed.rows.length === 0) {
      setError(
        `Nu am putut extrage firme din fișier. Delimitator detectat: "${parsed.delimiter}". Primele headere: ${parsed.headers.slice(0, 8).join(", ") || "(fără header)"}. Trimite-mi un fragment din fișier ca să ajustez parserul.`,
      );
      return;
    }

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
          Încarcă-l mai jos — fișierele mari se urcă în Cloudflare R2 și le
          procesează serverul; cele mici se procesează direct în browser
        </li>
        <li>Apasă „Verifică ANAF" ca să elimini firmele radiate/inactive</li>
      </ol>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/30">
        <span className="text-sm font-medium text-slate-700">
          {importing
            ? progress || "Se importă..."
            : "Încarcă fișierul MF (TXT / CSV — orice mărime)"}
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
        Doar județele Suceava și Botoșani (se aplică la fișierele mici; cele
        mari sunt filtrate mereu pe SV+BT de server)
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
            <li>{stats.totalLines.toLocaleString("ro-RO")} firme citite</li>
            <li>
              {stats.matched.toLocaleString("ro-RO")} au trecut filtrele →{" "}
              {stats.imported.toLocaleString("ro-RO")} salvate
            </li>
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
