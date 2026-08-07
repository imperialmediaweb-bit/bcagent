"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  ClipboardList,
  Navigation,
  Route as RouteIcon,
  ShoppingCart,
  Target,
} from "lucide-react";
import { planRoute } from "@/lib/route-nav";

/**
 * „Ziua mea" — cockpitul agentului: deschide telefonul dimineața și vede
 * totul dintr-o privire: ruta de azi, scadenții, ce a făcut deja azi și
 * unde e cu targetul. Fiecare card sare direct la secțiunea de acțiune.
 */

const TODAY_KEY = [
  "duminica",
  "luni",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sambata",
][new Date().getDay()];

const fmt = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);

interface Stop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  telefon: string;
}

export default function DayPanel({ token }: { token: string }) {
  const [visitsToday, setVisitsToday] = useState<number | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [ordersToday, setOrdersToday] = useState<number | null>(null);
  const [route, setRoute] = useState<{ name: string; stops: Stop[] } | null>(null);
  // Ce ai bifat azi: ruta continuă de unde ai rămas, nu de la capăt.
  const [doneToday, setDoneToday] = useState<string[]>([]);
  const [target, setTarget] = useState<{
    pct: number | null;
    elapsed: number;
  } | null>(null);

  useEffect(() => {
    const q = (p: string) => `${p}token=${encodeURIComponent(token)}`;
    // Ce am bifat azi — reîncărcat și la revenirea pe „Ziua mea”, ca ruta
    // să scoată clienții vizitați între timp pe hartă.
    const reloadVizite = () => {
      fetch(`/api/visits?${q("")}&limit=100`)
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            d: {
              today?: number;
              visits?: Array<{ cui: string; visitedAt: string }>;
            } | null,
          ) => {
            if (!d) return;
            if (d.today !== undefined) setVisitsToday(d.today);
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            setDoneToday(
              (d.visits ?? [])
                .filter((v) => new Date(v.visitedAt) >= startOfDay)
                .map((v) => v.cui),
            );
          },
        )
        .catch(() => {});
    };
    reloadVizite();
    // Doar la REVENIRE în tab/aplicație — nu și când o ascunzi.
    const onVizibil = () => {
      if (!document.hidden) reloadVizite();
    };
    window.addEventListener("focus", onVizibil);
    document.addEventListener("visibilitychange", onVizibil);
    fetch(`/api/visits?${q("")}&due=1&limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { due?: unknown[] } | null) => {
        if (d?.due) setDue(d.due.length);
      })
      .catch(() => {});
    fetch(`/api/orders?${q("")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { today?: number } | null) => {
        if (d?.today !== undefined) setOrdersToday(d.today);
      })
      .catch(() => {});
    fetch(`/api/routes?${q("")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { routes?: Array<{ name: string; day: string; stops: Stop[] }> } | null) => {
          const today = d?.routes?.find((x) => x.day === TODAY_KEY);
          if (today) setRoute({ name: today.name, stops: today.stops });
        },
      )
      .catch(() => {});
    fetch(`/api/targets?${q("")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          inOrg?: boolean;
          monthElapsedPct?: number;
          leaderboard?: Array<{ me: boolean; pct: number | null }>;
        } | null) => {
          const me = d?.leaderboard?.find((l) => l.me);
          if (d?.inOrg && me && me.pct !== null) {
            setTarget({ pct: me.pct, elapsed: d.monthElapsedPct ?? 0 });
          }
        },
      )
      .catch(() => {});
    return () => {
      window.removeEventListener("focus", onVizibil);
      document.removeEventListener("visibilitychange", onVizibil);
    };
  }, [token]);

  // Fără DB / fără nimic de arătat → nu ocupăm ecranul degeaba.
  const anything =
    visitsToday !== null || due !== null || route !== null || target !== null;
  if (!anything) return null;

  // Ruta de azi: doar ce a rămas, în etape de 10 (limita Google Maps).
  const plan = planRoute(route?.stops ?? [], doneToday, "");

  const dayLabel = new Date().toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className="fade-in">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-emerald-50/50 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold capitalize text-slate-900">
            ☀️ {dayLabel}
          </h2>
          {target && (
            <span
              className={`text-sm font-semibold ${
                target.pct! >= 100
                  ? "text-emerald-600"
                  : target.pct! >= target.elapsed
                    ? "text-slate-700"
                    : "text-rose-600"
              }`}
            >
              <Target className="mr-1 inline h-4 w-4" />
              Target: {target.pct}%
              {target.pct! < target.elapsed && " — în urmă!"}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a
            href="#harta"
            className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100 transition hover:ring-indigo-200"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <RouteIcon className="h-3.5 w-3.5" /> Ruta de azi
            </p>
            <p className="mt-1 truncate text-lg font-semibold text-slate-900">
              {route ? `${route.stops.length} opriri` : "—"}
            </p>
            {route && (
              <p className="truncate text-xs text-slate-500">{route.name}</p>
            )}
          </a>
          <a
            href="#harta"
            className={`rounded-xl bg-white p-3 shadow-sm ring-1 transition ${
              (due ?? 0) > 0
                ? "ring-rose-200 hover:ring-rose-300"
                : "ring-slate-100 hover:ring-indigo-200"
            }`}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" /> De vizitat (7z)
            </p>
            <p
              className={`mt-1 text-lg font-semibold ${
                (due ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {due ?? 0} clienți
            </p>
          </a>
          <a
            href="#harta"
            className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100 transition hover:ring-indigo-200"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <ClipboardList className="h-3.5 w-3.5" /> Vizite azi
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {fmt(visitsToday ?? 0)}
            </p>
          </a>
          <a
            href="#harta"
            className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100 transition hover:ring-indigo-200"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <ShoppingCart className="h-3.5 w-3.5" /> Comenzi azi
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {fmt(ordersToday ?? 0)}
            </p>
          </a>
        </div>

        {route && route.stops.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {plan.finished ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                ✓ Ruta de azi e făcută toată ({plan.total} opriri)
              </span>
            ) : (
              plan.urls.map((u, i, all) => (
                <a
                  key={i}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                >
                  <Navigation className="h-4 w-4" />
                  {all.length > 1
                    ? `Etapa ${i + 1} (${plan.legs[i].length} opriri)`
                    : plan.done > 0
                      ? `Continuă ruta (${plan.remaining.length} rămase)`
                      : "Pornește ruta de azi"}
                </a>
              ))
            )}
            <p className="text-xs text-slate-500">
              {plan.done > 0 && !plan.finished && (
                <span className="font-semibold text-emerald-700">
                  {plan.done} din {plan.total} făcute ·{" "}
                </span>
              )}
              {plan.remaining
                .slice(0, 3)
                .map((s) => s.denumire)
                .join(" → ")}
              {plan.remaining.length > 3
                ? ` → +${plan.remaining.length - 3}`
                : ""}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
