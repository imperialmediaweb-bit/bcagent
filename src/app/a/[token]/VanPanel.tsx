"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";

/**
 * VAN SALES — marfa din mașină. Agentul o încarcă dimineața, vânzările
 * „pe loc" o scad singure, seara dă retur ce n-a mers. Tot aici vede cât
 * a încasat azi și cât numerar are de predat la firmă.
 */

interface StockRow {
  produs: string;
  um: string;
  cantitate: number;
}

interface Line {
  produs: string;
  cantitate: string;
  um: string;
}

const UMS = ["buc", "bax", "cartus", "pachet", "naveta", "cutie", "kg", "l"];
const EMPTY: Line = { produs: "", cantitate: "", um: "bax" };

export default function VanPanel({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [today, setToday] = useState({ sales: 0, total: 0, numerar: 0 });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [kind, setKind] = useState<"incarcare" | "retur">("incarcare");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/van?token=${encodeURIComponent(token)}`);
      if (!res.ok) return;
      const d = (await res.json()) as {
        stock: StockRow[];
        today: { sales: number; total: number; numerar: number };
      };
      setStock(d.stock ?? []);
      setToday(d.today ?? { sales: 0, total: 0, numerar: 0 });
      setLoaded(true);
    } catch {
      // fără semnal — reîncercăm la următoarea deschidere
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const valid = lines.filter(
    (l) => l.produs.trim() !== "" && parseFloat(l.cantitate) > 0,
  );

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/van", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          kind,
          lines: valid.map((l) => ({
            produs: l.produs.trim(),
            cantitate: parseFloat(l.cantitate),
            um: l.um,
          })),
        }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg(d.error ?? `Eroare ${res.status}`);
        return;
      }
      setLines([{ ...EMPTY }]);
      setMsg(kind === "incarcare" ? "Marfă încărcată în dubă ✓" : "Retur salvat ✓");
      await load();
    } catch {
      setMsg("Fără semnal — reîncearcă.");
    } finally {
      setBusy(false);
    }
  }

  function set(i: number, k: keyof Line, v: string) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  }

  const showBadge = loaded && (stock.length > 0 || today.sales > 0);

  return (
    <section className="card fade-in p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Truck className="h-4 w-4 text-emerald-600" />
          Marfa din mașină (van)
          {showBadge && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {stock.length} produse
              {today.sales > 0 &&
                ` · azi ${today.total.toLocaleString("ro-RO", { maximumFractionDigits: 0 })} RON`}
            </span>
          )}
        </h2>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {today.sales > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-lg font-bold text-slate-900">{today.sales}</p>
                <p className="text-xs text-slate-500">vânzări azi</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-lg font-bold text-slate-900">
                  {today.total.toLocaleString("ro-RO", { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-slate-500">RON încasați</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-2">
                <p className="text-lg font-bold text-emerald-700">
                  {today.numerar.toLocaleString("ro-RO", { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-emerald-700">numerar de predat</p>
              </div>
            </div>
          )}

          {stock.length > 0 ? (
            <ul className="grid gap-1 rounded-lg bg-slate-50 p-2 text-sm sm:grid-cols-2">
              {stock.map((s) => (
                <li key={s.produs} className="flex justify-between gap-2 px-1">
                  <span className="min-w-0 truncate text-slate-700">{s.produs}</span>
                  <span className="shrink-0 font-medium text-slate-800">
                    {s.cantitate} {s.um}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              Duba e goală. Încarcă marfa de dimineață mai jos — fiecare
              vânzare „pe loc" o scade automat.
            </p>
          )}

          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setKind("incarcare")}
              className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
                kind === "incarcare"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              ⬆ Încarc marfă
            </button>
            <button
              type="button"
              onClick={() => setKind("retur")}
              className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
                kind === "retur"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              ⬇ Retur la depozit
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={l.produs}
                  onChange={(e) => set(i, "produs", e.target.value)}
                  placeholder="Produs (ex: Apă plată 0,5L)"
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={l.cantitate}
                  onChange={(e) => set(i, "cantitate", e.target.value)}
                  placeholder="Cant."
                  className="w-16 rounded-md border border-slate-200 px-2 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                />
                <select
                  value={l.um}
                  onChange={(e) => set(i, "um", e.target.value)}
                  className="rounded-md border border-slate-200 px-1.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                >
                  {UMS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, { ...EMPTY }])}
              className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-4 w-4" /> Mai adaugă
            </button>
            <button
              type="button"
              disabled={busy || valid.length === 0}
              onClick={submit}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy
                ? "Se salvează..."
                : kind === "incarcare"
                  ? "Încarcă în dubă"
                  : "Dă retur"}
            </button>
          </div>

          {msg && (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {msg}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
