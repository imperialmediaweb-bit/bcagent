"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Receipt, Send, Trophy } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);

/* ─────────────── Targetul meu + clasamentul echipei ─────────────── */

interface LeaderRow {
  name: string;
  me: boolean;
  realized: number;
  target: number;
  pct: number | null;
}

export function TargetPanel({ token }: { token: string }) {
  const [data, setData] = useState<{
    month: string;
    inOrg: boolean;
    monthElapsedPct?: number;
    leaderboard: LeaderRow[];
  } | null>(null);

  useEffect(() => {
    fetch(`/api/targets?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [token]);

  if (!data || !data.inOrg || data.leaderboard.length === 0) return null;
  const me = data.leaderboard.find((l) => l.me);
  const elapsed = data.monthElapsedPct ?? 0;

  return (
    <div className="card p-5">
      {me && me.target > 0 && (
        <div className="mb-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold text-slate-800">
              Targetul meu pe luna asta
            </p>
            <p
              className={`text-lg font-bold ${
                (me.pct ?? 0) >= 100
                  ? "text-emerald-600"
                  : (me.pct ?? 0) >= elapsed
                    ? "text-slate-800"
                    : "text-rose-600"
              }`}
            >
              {me.pct}%
            </p>
          </div>
          <div className="relative mt-2 h-3 rounded-full bg-slate-100">
            <div
              className={`h-3 rounded-full ${
                (me.pct ?? 0) >= 100
                  ? "bg-emerald-500"
                  : (me.pct ?? 0) >= elapsed
                    ? "bg-indigo-500"
                    : "bg-rose-500"
              }`}
              style={{ width: `${Math.min(100, me.pct ?? 0)}%` }}
            />
            {/* Reperul lunii: unde AR TREBUI să fii azi */}
            <div
              className="absolute top-[-3px] h-[18px] w-0.5 bg-slate-400"
              style={{ left: `${elapsed}%` }}
              title={`Azi e ${elapsed}% din lună`}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {fmt(me.realized)} din {fmt(me.target)} · linia gri = unde ar
            trebui să fii azi ({elapsed}% din lună)
          </p>
        </div>
      )}

      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Trophy className="h-4 w-4 text-amber-500" />
        Clasamentul echipei
      </h3>
      <ul className="mt-2 space-y-1">
        {data.leaderboard.map((l, i) => (
          <li
            key={l.name}
            className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
              l.me ? "bg-indigo-50 font-semibold text-indigo-800" : "text-slate-700"
            }`}
          >
            <span>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}{" "}
              {l.name}
              {l.me ? " (eu)" : ""}
            </span>
            <span>
              {l.pct !== null ? `${l.pct}%` : fmt(l.realized)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── Decontul meu ─────────────────────────── */

interface Expense {
  id: string;
  date: string;
  category: string;
  amountCents: number;
  note: string;
  status: string;
}

const CATS = [
  ["combustibil", "⛽ Combustibil"],
  ["diurna", "🍽 Diurnă"],
  ["cazare", "🛏 Cazare"],
  ["service", "🔧 Service"],
  ["alte", "📎 Altele"],
] as const;

export function ExpensesPanel({ token }: { token: string }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [monthTotal, setMonthTotal] = useState(0);
  const [category, setCategory] = useState("combustibil");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/expenses?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { expenses?: Expense[]; monthTotalCents?: number } | null) => {
        if (d?.expenses) setExpenses(d.expenses);
        if (d?.monthTotalCents !== undefined) setMonthTotal(d.monthTotalCents);
      })
      .catch(() => {});
  }, [token]);

  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          category,
          amount: parseFloat(amount),
          note,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(data.error ?? "Eroare");
        return;
      }
      setAmount("");
      setNote("");
      setMsg("Trimis la aprobare ✓");
      load();
    } catch {
      setMsg("Eroare de rețea");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Receipt className="h-4 w-4 text-emerald-600" />
          Decontul meu
        </h3>
        <p className="text-xs text-slate-500">
          Luna asta: <strong>{fmt(monthTotal / 100)} RON</strong>
        </p>
      </div>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
        >
          {CATS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          min={0.01}
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Suma (RON)"
          className="w-28 rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notă (bon OMV...)"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !amount}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Trimite
        </button>
      </form>
      {msg && <p className="mt-2 text-xs text-slate-600">{msg}</p>}

      {expenses.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {expenses.slice(0, 6).map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-2 py-1.5 text-sm"
            >
              <span className="min-w-0 truncate text-slate-700">
                {new Date(e.date).toLocaleDateString("ro-RO")} ·{" "}
                {CATS.find(([v]) => v === e.category)?.[1] ?? e.category} ·{" "}
                {(e.amountCents / 100).toLocaleString("ro-RO")} RON
              </span>
              <span
                className={`shrink-0 text-xs font-medium ${
                  e.status === "aprobat"
                    ? "text-emerald-600"
                    : e.status === "respins"
                      ? "text-rose-600"
                      : "text-amber-600"
                }`}
              >
                {e.status === "in_asteptare" ? "în așteptare" : e.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
