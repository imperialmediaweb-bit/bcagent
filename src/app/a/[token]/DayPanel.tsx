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
  const [target, setTarget] = useState<{
    pct: number | null;
    elapsed: number;
  } | null>(null);

  useEffect(() => {
    const q = (p: string) => `${p}token=${encodeURIComponent(token)}`;
    fetch(`/api/visits?${q("")}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { today?: number } | null) => {
        if (d?.today !== undefined) setVisitsToday(d.today);
      })
      .catch(() => {});
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
  }, [token]);

  // Fără DB / fără nimic de arătat → nu ocupăm ecranul degeaba.
  const anything =
    visitsToday !== null || due !== null || route !== null || target !== null;
  if (!anything) return null;

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
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                `${route.stops[route.stops.length - 1].adresa}, ${route.stops[route.stops.length - 1].localitate}, Romania`,
              )}${
                route.stops.length > 1
                  ? `&waypoints=${encodeURIComponent(
                      route.stops
                        .slice(0, -1)
                        .slice(0, 9)
                        .map((s) => `${s.adresa}, ${s.localitate}, Romania`)
                        .join("|"),
                    )}`
                  : ""
              }&travelmode=driving`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              <Navigation className="h-4 w-4" />
              Pornește ruta de azi
            </a>
            <p className="text-xs text-slate-500">
              {route.stops
                .slice(0, 3)
                .map((s) => s.denumire)
                .join(" → ")}
              {route.stops.length > 3 ? ` → +${route.stops.length - 3}` : ""}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
