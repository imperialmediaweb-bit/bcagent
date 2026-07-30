"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, PackageCheck, ShoppingCart } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatDateTime,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface OrderLine {
  produs: string;
  cantitate: number;
  um: string;
  pret: number | null;
}

interface Order {
  id: string;
  agentId: string;
  agentName: string;
  cui: string;
  denumire: string;
  localitate: string;
  lines: OrderLine[];
  note: string;
  status: string;
  totalValue: number | null;
  createdAt: string;
  tip: string;
  plata: string;
}

interface VanInfo {
  agentId: string;
  agentName: string;
  stock: Array<{ produs: string; um: string; cantitate: number }>;
  salesToday: number;
  totalToday: number;
  numerarToday: number;
}

const STATUS_META: Record<
  string,
  { label: string; cls: string; next?: { to: string; label: string } }
> = {
  noua: {
    label: "🆕 nouă",
    cls: "bg-sky-50 text-sky-700 ring-sky-200",
    next: { to: "pregatita", label: "→ Pregătită" },
  },
  pregatita: {
    label: "📦 pregătită",
    cls: "bg-amber-50 text-amber-700 ring-amber-200",
    next: { to: "livrata", label: "→ Livrată" },
  },
  livrata: { label: "✅ livrată", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  anulata: { label: "✖ anulată", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

export default function ComenziPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("");
  const [tip, setTip] = useState("");
  const [days, setDays] = useState(30);
  const [vans, setVans] = useState<VanInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ orders: Order[]; counts: Record<string, number> }>(
        `/api/agentie/orders?status=${status}&tip=${tip}&days=${days}`,
      );
      setOrders(d.orders);
      setCounts(d.counts);
      const v = await api<{ vans: VanInfo[] }>("/api/agentie/van");
      setVans(v.vans);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, tip, days]);

  useEffect(() => {
    load();
    // Depozitul ține pagina deschisă — comenzile noi apar singure.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function advance(id: string, to: string) {
    try {
      await api("/api/agentie/orders", { method: "PATCH", json: { id, status: to } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const totalPeriod = orders.reduce((s, o) => s + (o.totalValue ?? 0), 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Comenzi din teren
          </h1>
          <p className="text-sm text-slate-500">
            Ce bat agenții pe telefon la clienți ajunge aici instant.
            {totalPeriod > 0 &&
              ` Valoare afișată: ${formatNumber(Math.round(totalPeriod))} RON.`}
          </p>
        </div>
        <a
          href={`/api/agentie/orders?export=csv&status=${status}&days=${days}`}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
        >
          <Download className="h-4 w-4" /> Export CSV (SAGA/Excel)
        </a>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatus("")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
            status === ""
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          Toate ({Object.values(counts).reduce((s, n) => s + n, 0)})
        </button>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(status === key ? "" : key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              status === key
                ? "bg-slate-900 text-white ring-slate-900"
                : `${meta.cls} hover:opacity-80`
            }`}
          >
            {meta.label} ({counts[key] ?? 0})
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTip(tip === "van" ? "" : "van")}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
            tip === "van"
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-violet-50 text-violet-700 ring-violet-200 hover:opacity-80"
          }`}
        >
          🚐 doar van
        </button>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className={`${inputClass} mt-0 ml-auto w-44`}
        >
          <option value={1}>Azi</option>
          <option value={7}>Ultimele 7 zile</option>
          <option value={30}>Ultimele 30 zile</option>
          <option value={90}>Ultimele 90 zile</option>
        </select>
      </div>

      {error && <Alert>{error}</Alert>}

      {vans.some((v) => v.salesToday > 0 || v.stock.length > 0) && (
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            🚐 Dubele azi — van sales
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vans.map((v) => (
              <details
                key={v.agentId}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <summary className="cursor-pointer list-none">
                  <p className="text-sm font-semibold text-slate-900">
                    {v.agentName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {v.salesToday} vânzări pe loc ·{" "}
                    {formatNumber(Math.round(v.totalToday))} RON
                    {v.numerarToday > 0 && (
                      <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                        💵 {formatNumber(Math.round(v.numerarToday))} RON de predat
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {v.stock.length > 0
                      ? `${v.stock.length} produse în dubă — apasă pentru stoc`
                      : "duba goală"}
                  </p>
                </summary>
                {v.stock.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-xs">
                    {v.stock.map((s) => (
                      <li key={s.produs} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate text-slate-600">
                          {s.produs}
                        </span>
                        <span className="shrink-0 font-medium text-slate-800">
                          {s.cantitate} {s.um}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            ))}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : orders.length === 0 ? (
        <EmptyState text="Nicio comandă în perioada asta. Agenții le trimit din hartă, cu butonul 🛒 de pe fiecare firmă." />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const meta = STATUS_META[o.status] ?? STATUS_META.noua;
            return (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="truncate">{o.denumire}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                      {o.tip === "van" && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                          🚐 pe loc{o.plata ? ` · ${o.plata}` : ""}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {o.agentName} · {o.localitate || "—"} ·{" "}
                      {formatDateTime(o.createdAt)}
                      {o.note ? ` · „${o.note}"` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.totalValue !== null && (
                      <span className="text-sm font-semibold text-slate-800">
                        {formatNumber(Math.round(o.totalValue))} RON
                      </span>
                    )}
                    {meta.next && (
                      <button
                        type="button"
                        onClick={() => advance(o.id, meta.next!.to)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        <PackageCheck className="h-3.5 w-3.5" />
                        {meta.next.label}
                      </button>
                    )}
                    {o.status === "noua" && (
                      <button
                        type="button"
                        onClick={() => advance(o.id, "anulata")}
                        className="text-xs text-slate-400 hover:text-rose-600"
                      >
                        Anulează
                      </button>
                    )}
                  </div>
                </div>
                <ul className="mt-2 grid gap-1 rounded-lg bg-slate-50 p-2 text-sm sm:grid-cols-2">
                  {o.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2 px-1">
                      <span className="min-w-0 truncate text-slate-700">
                        {l.produs}
                      </span>
                      <span className="shrink-0 font-medium text-slate-800">
                        {l.cantitate} {l.um}
                        {l.pret !== null &&
                          ` · ${(l.cantitate * l.pret).toFixed(0)} RON`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
