"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Receipt, X } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface Expense {
  id: string;
  agentName: string;
  date: string;
  category: string;
  amountCents: number;
  note: string;
  status: string;
}

const CAT_LABELS: Record<string, string> = {
  combustibil: "⛽ Combustibil",
  diurna: "🍽 Diurnă",
  cazare: "🛏 Cazare",
  service: "🔧 Service auto",
  alte: "📎 Altele",
};

const STATUS_CLS: Record<string, string> = {
  in_asteptare: "bg-amber-50 text-amber-700 ring-amber-200",
  aprobat: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  respins: "bg-rose-50 text-rose-600 ring-rose-200",
};

export default function DecontPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<
    Array<{ agent: string; totalCents: number; approvedCents: number }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{
        expenses: Expense[];
        totals: Array<{ agent: string; totalCents: number; approvedCents: number }>;
      }>(`/api/agentie/expenses?month=${month}&status=${status}`);
      setExpenses(d.expenses);
      setTotals(d.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, to: "aprobat" | "respins") {
    try {
      await api("/api/agentie/expenses", { method: "PATCH", json: { id, status: to } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const grandTotal = totals.reduce((s, t) => s + t.totalCents, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Decont cheltuieli
          </h1>
          <p className="text-sm text-slate-500">
            Ce trimit agenții din teren: motorină, diurnă, service. Total lună:{" "}
            {formatNumber(Math.round(grandTotal / 100))} RON.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={`${inputClass} mt-0 w-44`}
          />
          <a
            href={`/api/agentie/expenses?month=${month}&export=csv`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> CSV
          </a>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {["", "in_asteptare", "aprobat", "respins"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              status === s
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {s === "" ? "Toate" : s === "in_asteptare" ? "În așteptare" : s}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {totals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((t) => (
            <Card key={t.agent} className="p-4">
              <p className="truncate text-sm font-medium text-slate-800">
                {t.agent}
              </p>
              <p className="text-lg font-semibold text-slate-900">
                {formatNumber(Math.round(t.totalCents / 100))} RON
              </p>
              <p className="text-xs text-slate-500">
                {formatNumber(Math.round(t.approvedCents / 100))} RON aprobat
              </p>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : expenses.length === 0 ? (
        <EmptyState text="Niciun decont în luna asta. Agenții le trimit din panoul lor, secțiunea Decont." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {expenses.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Receipt className="h-4 w-4 shrink-0 text-slate-400" />
                    {CAT_LABELS[e.category] ?? e.category} ·{" "}
                    {(e.amountCents / 100).toLocaleString("ro-RO")} RON
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {e.agentName} · {new Date(e.date).toLocaleDateString("ro-RO")}
                    {e.note ? ` · „${e.note}"` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLS[e.status]}`}
                  >
                    {e.status === "in_asteptare" ? "în așteptare" : e.status}
                  </span>
                  {e.status === "in_asteptare" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decide(e.id, "aprobat")}
                        className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700"
                        title="Aprobă"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(e.id, "respins")}
                        className="rounded-lg bg-rose-600 p-1.5 text-white hover:bg-rose-700"
                        title="Respinge"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
