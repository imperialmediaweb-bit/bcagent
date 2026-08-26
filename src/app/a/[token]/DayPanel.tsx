"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  ClipboardList,
  MapPinned,
  Navigation,
  Route as RouteIcon,
  ShoppingCart,
  Target,
} from "lucide-react";
import { cheieOprire, planRoute } from "@/lib/route-nav";

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
  judet?: string;
  cui: string;
  /** La care magazin al firmei — vezi cheieOprire din lib/route-nav. */
  magazinId?: string;
  denumire: string;
  adresa: string;
  localitate: string;
  telefon: string;
}

export default function DayPanel({
  token,
  refreshKey = 0,
}: {
  token: string;
  /** Crește când s-a bifat o vizită în altă parte a panoului (căutarea de
   *  pe prima pagină) — ziua, scadenții și ruta se reîncarcă imediat. */
  refreshKey?: number;
}) {
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
  // ZONA DE AZI, pusă de manager din panoul firmei. Dacă agentul n-are
  // rută salvată pe ziua asta, i-o facem noi dintr-un buton — asta era
  // veriga lipsă între „zonele agenților" ale lui Bogdan și traseul de
  // pe telefon.
  const [zona, setZona] = useState<{
    localitati: string[];
    stops: Stop[];
    alteFirme: number;
  } | null>(null);
  const [facZona, setFacZona] = useState(false);
  const [eroareZona, setEroareZona] = useState<string | null>(null);

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
              visits?: Array<{
              cui: string;
              magazinId?: string;
              visitedAt: string;
            }>;
            } | null,
          ) => {
            if (!d) return;
            if (d.today !== undefined) setVisitsToday(d.today);
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
          // CHEIA E MAGAZINUL, nu firma: o vizită la unul dintre cele
            // șase magazine ale lui Ovi Tacomax nu scoate din rută
            // celelalte cinci.
            setDoneToday(
              (d.visits ?? [])
                .filter((v) => new Date(v.visitedAt) >= startOfDay)
                .map((v) => cheieOprire({ cui: v.cui, magazinId: v.magazinId })),
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
    fetch(`/api/routes/zona?${q("")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            localitati?: string[];
            stops?: Stop[];
            alteFirme?: number;
          } | null,
        ) => {
          if (d?.localitati?.length) {
            setZona({
              localitati: d.localitati,
              stops: d.stops ?? [],
              alteFirme: d.alteFirme ?? 0,
            });
          }
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
  }, [token, refreshKey]);

  /**
   * „Fă-mi ruta de azi": ia clienții din satele pe care mi le-a dat șeful
   * pe ziua asta și-i salvează ca rută a zilei. De aici încolo merge tot
   * ce era deja: etapele de 10 opriri, „continuă de unde ai rămas",
   * bifatul pe măsură ce vizitezi.
   */
  async function faRutaDinZona() {
    if (!zona || zona.stops.length === 0) return;
    setFacZona(true);
    setEroareZona(null);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: `Zona de ${TODAY_KEY}`,
          day: TODAY_KEY,
          stops: zona.stops,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setEroareZona(d.error ?? "N-am putut salva ruta. Încearcă din nou.");
        return;
      }
      setRoute({ name: `Zona de ${TODAY_KEY}`, stops: zona.stops });
    } catch {
      setEroareZona("Fără semnal — încearcă din nou când prinzi rețea.");
    } finally {
      setFacZona(false);
    }
  }

  // Fără DB / fără nimic de arătat → nu ocupăm ecranul degeaba.
  const anything =
    visitsToday !== null ||
    due !== null ||
    route !== null ||
    target !== null ||
    zona !== null;
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
            <p className="mt-1 break-words text-base font-semibold leading-snug text-slate-900 sm:text-lg">
              {route ? `${route.stops.length} opriri` : "—"}
            </p>
            {route && (
              <p className="break-words text-xs leading-snug text-slate-500">{route.name}</p>
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
              className={`mt-1 break-words text-base font-semibold leading-snug sm:text-lg ${
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
            <p className="mt-1 break-words text-base font-semibold leading-snug text-slate-900 sm:text-lg">
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
            <p className="mt-1 break-words text-base font-semibold leading-snug text-slate-900 sm:text-lg">
              {fmt(ordersToday ?? 0)}
            </p>
          </a>
        </div>

        {/* ZONA DE AZI — ce mi-a dat șeful pe ziua asta. Apare cât timp
            n-am încă ruta făcută; după ce apăs butonul, locul ei îl ia
            traseul de mai jos. */}
        {zona && !route && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPinned className="h-3.5 w-3.5" /> Zona ta de azi
            </p>
            <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-900">
              {zona.localitati.join(" · ")}
            </p>
            {zona.stops.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={faRutaDinZona}
                  disabled={facZona}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                >
                  <RouteIcon className="h-4 w-4" />
                  {facZona
                    ? "Fac ruta…"
                    : `Fă-mi ruta de azi (${zona.stops.length} clienți)`}
                </button>
                {zona.alteFirme > 0 && (
                  <p className="mt-1.5 break-words text-xs leading-snug text-slate-500">
                    Mai sunt {zona.alteFirme} firme nevizitate în satele de azi —
                    le vezi pe hartă, dacă termini devreme.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1.5 break-words text-xs leading-snug text-slate-500">
                N-ai încă niciun client în satele astea. Deschide harta și
                bate la firmele de acolo — pe măsură ce devin clienți, intră
                singure în ruta zilei.
              </p>
            )}
            {eroareZona && (
              <p className="mt-1.5 break-words text-xs font-medium leading-snug text-rose-600">
                {eroareZona}
              </p>
            )}
          </div>
        )}

        {route && route.stops.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!plan.finished && plan.sarite > 0 && plan.etape.length > 0 && (
              <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                {plan.sarite} {plan.sarite === 1 ? "client n-are" : "clienți n-au"} adresă
                pe hartă și {plan.sarite === 1 ? "nu intră" : "nu intră"} în traseu — îi
                vezi mai jos în listă.
              </span>
            )}
            {!plan.finished && plan.etape.length === 0 && (
              <span className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                Clienții din ruta de azi n-au încă adresă pe hartă. Apasă
                „Am fost" la primul, chiar în fața magazinului — de atunci
                ruta merge pe poziția exactă.
              </span>
            )}
            {plan.finished ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                ✓ Ruta de azi e făcută toată ({plan.total} opriri)
              </span>
            ) : (
              plan.etape.map((e, i, all) => (
                <a
                  key={i}
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                >
                  <Navigation className="h-4 w-4" />
                  {all.length > 1
                    ? `Etapa ${i + 1} (${e.stops.length} opriri)`
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
