"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, UserPlus } from "lucide-react";

interface MatchedClient {
  client: string;
  cui: string;
  denumire: string;
  localitate: string;
  judet: string;
  agent: string;
  wasClient: boolean;
}

/**
 * „Importă clienții din vânzări": numele clienților din XLS-uri se potrivesc
 * cu firmele oficiale MF și trec pe status „client", alocate agentului care
 * le vinde cel mai mult. Un buton — toată baza de clienți populată.
 */
export default function ImportClients({
  token,
  clientAgents,
  agentName,
}: {
  token: string;
  /** Fiecare client din vânzări + agentul care îi vinde cel mai mult. */
  clientAgents: Array<{ name: string; agent: string }>;
  /** Numele agentului logat — fișierul propriu se alocă lui. */
  agentName?: string;
}) {
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function runFile(f: File) {
    setLoading(true);
    setError(null);
    try {
      const { parseClientsFile } = await import("@/lib/parse-xls");
      const parsed = await parseClientsFile(await f.arrayBuffer());
      if (parsed.clients.length === 0) {
        setError(
          "N-am găsit clienți în fișier — trebuie o coloană cu denumirea firmei.",
        );
        return;
      }
      const res = await fetch("/api/prospects/import-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          clients: parsed.clients.map((c) => ({
            name: c.name,
            cui: c.cui,
            agent: c.agent || agentName || "",
          })),
        }),
      });
      const data = (await res.json()) as
        | { matched: MatchedClient[]; unmatched: string[]; updated: number }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Eroare ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  const [result, setResult] = useState<{
    matched: MatchedClient[];
    unmatched: string[];
    updated: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prospects/import-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, clients: clientAgents }),
      });
      const data = (await res.json()) as
        | { matched: MatchedClient[]; unmatched: string[]; updated: number }
        | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Eroare ${res.status}`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (clientAgents.length === 0 && !agentName) return null;

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <UserPlus className="h-4 w-4 text-emerald-600" />
            Importă clienții existenți din vânzări
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {clientAgents.length} clienți din XLS-uri se potrivesc automat cu
            firmele oficiale (CUI, adresă, telefon) și trec pe status „client",
            alocați agentului care le vinde.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clientAgents.length > 0 && (
            <button
              type="button"
              onClick={run}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {loading ? "Se potrivesc..." : "Importă clienții"}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <FileUp className="h-4 w-4" />
            Sau fișierul tău de clienți
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx,.ods,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {result.matched.length} potriviți → clienți
            </span>
            {result.unmatched.length > 0 && (
              <span className="rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                {result.unmatched.length} nepotriviți (nume neoficiale)
              </span>
            )}
          </div>

          {result.matched.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {(showAll ? result.matched : result.matched.slice(0, 6)).map(
                (m) => (
                  <li
                    key={m.cui}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">
                        {m.client}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          → {m.denumire}
                        </span>
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        CUI {m.cui} · {m.localitate} ({m.judet})
                        {m.agent ? ` · agent: ${m.agent}` : ""}
                      </p>
                    </div>
                    {m.wasClient && (
                      <span className="shrink-0 text-xs text-slate-400">
                        era deja
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
          {result.matched.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              {showAll
                ? "Arată mai puțini"
                : `Arată toți ${result.matched.length}`}
            </button>
          )}
          {result.unmatched.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium">
                Nepotriviți — îi cauți manual în Prospecți după nume
              </summary>
              <p className="mt-1">{result.unmatched.join(" · ")}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
