"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, Upload, Wallet } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  api,
  formatDate,
  formatNumber,
} from "@/app/platform/ui";

interface DebtClient {
  cui: string;
  denumire: string;
  localitate: string;
  telefon: string;
  agent: string;
  soldCents: number;
  updatedAt: string | null;
}

/**
 * Solduri/restanțe clienți: dai paste din raportul SAGA „Solduri clienți"
 * (sau orice listă Nume/CUI/Sold), platforma potrivește firmele și pune
 * restanța pe client — agentul o vede pe hartă și la comandă.
 */
export default function SolduriPage() {
  const [clients, setClients] = useState<DebtClient[]>([]);
  const [totalCents, setTotalCents] = useState(0);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    matched: number;
    unmatched: string[];
    updated: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<{ clients: DebtClient[]; totalCents: number }>(
        "/api/agentie/balances",
      );
      setClients(d.clients);
      setTotalCents(d.totalCents);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Parsează liniile lipite: separatoare ; TAB sau , — Nume[;CUI];Sold. */
  function parseRows(): Array<{ name: string; cui: string; sold: number }> {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;\t]|,(?=\s*["A-Za-z0-9])/).map((p) =>
          p.trim().replace(/^"|"$/g, ""),
        );
        if (parts.length < 2) return null;
        // Ultima coloană numerică = soldul; caută CUI printre celelalte.
        const soldStr = parts[parts.length - 1]
          .replace(/\./g, "")
          .replace(",", ".");
        const sold = parseFloat(soldStr);
        if (!Number.isFinite(sold)) return null;
        const rest = parts.slice(0, -1);
        const cui =
          rest.find((p) => /^(RO)?\d{2,10}$/i.test(p.replace(/\s/g, "")))
            ?.replace(/\D/g, "") ?? "";
        const name = rest.find((p) => p !== "" && !/^(RO)?\d{2,10}$/i.test(p)) ?? "";
        return { name, cui, sold };
      })
      .filter((r): r is { name: string; cui: string; sold: number } => r !== null)
      .slice(0, 2000);
  }

  async function importBalances() {
    const rows = parseRows();
    if (rows.length === 0) {
      setError("Nu am găsit linii valide. Format: Nume;CUI;Sold sau Nume;Sold.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ matched: number; unmatched: string[]; updated: number }>(
        "/api/agentie/balances",
        { method: "POST", json: { rows } },
      );
      setResult(res);
      setRaw("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Solduri și restanțe clienți
        </h1>
        <p className="text-sm text-slate-500">
          Total restanțe: {formatNumber(Math.round(totalCents / 100))} RON ·{" "}
          {clients.length} clienți. Restanța apare la agent pe hartă și la
          luarea comenzii.
        </p>
      </header>

      <Card>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Upload className="h-4 w-4 text-emerald-600" />
          Importă soldurile din SAGA
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Deschide raportul „Solduri clienți", copiază liniile și dă paste aici
          — o linie per client, cu numele (și opțional CUI-ul) și soldul.
          Potrivirea se face pe CUI sau pe denumirea oficială.
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={5}
          placeholder={"MARA COM SRL;1234567;2450,50\nBAR LA COLT SRL;890,00"}
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs focus:border-emerald-400 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400">
            {parseRows().length} linii valide detectate
          </p>
          <Button onClick={importBalances} disabled={busy || raw.trim() === ""}>
            {busy ? "Se potrivesc..." : "Importă soldurile"}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {result && (
          <div className="mt-3 space-y-2">
            <Alert kind="success">
              {result.updated} firme actualizate ({result.matched} potrivite).
            </Alert>
            {result.unmatched.length > 0 && (
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-medium">
                  {result.unmatched.length} nepotrivite
                </summary>
                <p className="mt-1">{result.unmatched.join(" · ")}</p>
              </details>
            )}
          </div>
        )}
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : clients.length === 0 ? (
        <EmptyState text="Nicio restanță înregistrată — fie totul e încasat, fie n-ai importat încă soldurile." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Restanță</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Actualizat</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.cui} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{c.denumire}</p>
                    <p className="text-xs text-slate-500">
                      {c.localitate} · CUI {c.cui}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                      <Wallet className="h-3.5 w-3.5" />
                      {formatNumber(Math.round(c.soldCents / 100))} RON
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.agent || "—"}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(c.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    {c.telefon ? (
                      <a
                        href={`tel:${c.telefon}`}
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {c.telefon}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
