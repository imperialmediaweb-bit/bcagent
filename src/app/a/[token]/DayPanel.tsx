"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ClipboardList,
  MapPinned,
  Navigation,
  Route as RouteIcon,
  ShoppingCart,
  Target,
} from "lucide-react";
import { cheieOprire, navAddress, planRoute } from "@/lib/route-nav";
import AcoperireaMea from "./AcoperireaMea";
import OrderModal from "./OrderModal";
import { VisitButtons, gmapsDir } from "./MapPanel";
import { salveazaVizita } from "./salveaza-vizita";

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
  lat?: number | null;
  lng?: number | null;
}

/** CUI-ul adus la forma din cheile de vizită — doar cifrele. */
const doarCifre = (cui: string) => String(cui).replace(/\D/g, "");

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
  // LISTA CLIENȚILOR ZILEI, bifabilă — cerută de Răzvan: „să fie deja
  // clienții pe prima pagină și eu să bifez ce am făcut la ele". Bifa e
  // pe FIRMĂ (CUI), ca o vizită dată din popupul unui magazin pe hartă
  // să bifeze tot rândul firmei de aici.
  const [cuiVizitateAzi, setCuiVizitateAzi] = useState<Set<string>>(new Set());
  const [visitFor, setVisitFor] = useState<string | null>(null);
  const [orderFor, setOrderFor] = useState<Stop | null>(null);
  const [listaDeschisa, setListaDeschisa] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

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
            const deAzi = (d.visits ?? []).filter(
              (v) => new Date(v.visitedAt) >= startOfDay,
            );
            setDoneToday(
              deAzi.map((v) => cheieOprire({ cui: v.cui, magazinId: v.magazinId })),
            );
            // Pentru LISTA zilei (care e pe firme, nu pe magazine): orice
            // vizită de azi la firma X — inclusiv la un magazin al ei —
            // bifează rândul firmei.
            setCuiVizitateAzi(
              new Set(deAzi.map((v) => doarCifre(v.cui)).filter((c) => c !== "")),
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

  /**
   * Bifarea unui client din lista zilei — ACELAȘI flux ca „Am fost" de pe
   * hartă și din căutare (GPS + POST /api/visits), doar pornit de aici.
   */
  async function bifeaza(stop: Stop, result: string, note: string) {
    // Singurul rezultat care șterge ceva pentru toată firma — se întreabă
    // o dată, cu aceleași vorbe ca pe hartă.
    if (
      result === "nu_mai_exista" &&
      !confirm(
        `Scoți „${stop.denumire}” din listele firmei — nu mai apare pe hartă ` +
          `nici ție, nici colegilor. Alege asta doar dacă firma chiar s-a ` +
          `desființat. Dacă azi era doar închis, apasă „Închis azi”. Continui?`,
      )
    ) {
      return;
    }
    const r = await salveazaVizita(token, stop, result, note);
    if (!r.ok) {
      showToast(r.error);
      return;
    }
    setVisitFor(null);
    showToast("Vizită salvată ✓");
    // Optimist, ca bifa să apară pe loc; cifrele reale se reîncarcă
    // oricum la revenirea în tab (listenerul de mai sus).
    setCuiVizitateAzi((s) => new Set(s).add(doarCifre(stop.cui)));
    setDoneToday((d) => [...d, cheieOprire(stop)]);
    setVisitsToday((n) => (n ?? 0) + 1);
    if (result === "nu_mai_exista") {
      // Firma desființată nu mai are ce căuta în lista zilei.
      setZona((z) =>
        z ? { ...z, stops: z.stops.filter((s) => s.cui !== stop.cui) } : z,
      );
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

  // Lista zilei, grupată pe sate în ordinea scrisă de manager (așa vin
  // din API); Map-ul păstrează ordinea primei apariții, deci și firmele
  // prinse doar pe adresă rămân sub satul lor, nu împrăștiate.
  const grupuri = new Map<string, Stop[]>();
  for (const s of zona?.stops ?? []) {
    const sat = s.localitate || "fără sat în registru";
    const ale = grupuri.get(sat);
    if (ale) ale.push(s);
    else grupuri.set(sat, [s]);
  }
  const bifate = (zona?.stops ?? []).filter((s) =>
    cuiVizitateAzi.has(doarCifre(s.cui)),
  ).length;

  const dayLabel = new Date().toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <section className="fade-in">
      <div className="relative rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-emerald-50/50 p-5">
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

        {/* ZONA DE AZI — ce mi-a dat șeful pe ziua asta, cu CLIENȚII gata
            listați, de bifat pe măsură ce-i faci (cererea lui Răzvan:
            „să fie deja clienții pe prima pagină și eu să bifez"). Cardul
            rămâne toată ziua — și după ce ruta e făcută, lista de bifat
            e alta decât linkurile de navigare. */}
        {zona && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <MapPinned className="h-3.5 w-3.5" /> Zona ta de azi
            </p>
            <p className="mt-1 break-words text-sm font-semibold leading-snug text-slate-900">
              {zona.localitati.join(" · ")}
            </p>
            {zona.stops.length > 0 ? (
              <>
                {/* Butonul de rută are rost doar cât timp NU există rută
                    pe azi — exact ca înainte. */}
                {!route && (
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
                )}
                {zona.alteFirme > 0 && (
                  <p className="mt-1.5 break-words text-xs leading-snug text-slate-500">
                    Mai sunt {zona.alteFirme} firme nevizitate în satele de azi —
                    le vezi pe hartă, dacă termini devreme.
                  </p>
                )}

                {/* LISTA ZILEI: sat cu sat, client cu client, cu aceleași
                    butoane ca la căutare — bifezi fără să cauți nimic. */}
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => setListaDeschisa((d) => !d)}
                    className="flex min-h-10 w-full items-center justify-between gap-2 py-1 text-left"
                  >
                    <span className="text-xs font-semibold text-slate-700">
                      Clienții tăi de azi — {bifate} din {zona.stops.length} bifați
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                        listaDeschisa ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {listaDeschisa &&
                    [...grupuri.entries()].map(([sat, ai]) => (
                      <div key={sat}>
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
                          📍 {sat}
                        </p>
                        <ul className="divide-y divide-slate-100">
                          {ai.map((f) => {
                            const cheie = cheieOprire(f);
                            const bifat = cuiVizitateAzi.has(doarCifre(f.cui));
                            return (
                              <li
                                key={cheie}
                                className={`min-w-0 py-2.5 ${bifat ? "opacity-60" : ""}`}
                              >
                                <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                                  <span className="min-w-0 break-words">
                                    {f.denumire}
                                  </span>
                                  {bifat && (
                                    <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                      ✓ azi
                                    </span>
                                  )}
                                </p>
                                <p className="break-words text-xs text-slate-500">
                                  {[f.adresa, f.localitate]
                                    .filter(Boolean)
                                    .join(", ") || "fără adresă"}
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setVisitFor(visitFor === cheie ? null : cheie)
                                    }
                                    className="inline-flex min-h-10 items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                                  >
                                    🎤 Am fost
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setOrderFor(f)}
                                    className="inline-flex min-h-10 items-center rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                                  >
                                    🛒 Comandă
                                  </button>
                                  <a
                                    href={gmapsDir(
                                      f.lat != null && f.lng != null
                                        ? `${f.lat},${f.lng}`
                                        : navAddress(f),
                                    )}
                                    target="_blank"
                                    rel="noopener"
                                    className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                                  >
                                    🧭 Navighează
                                  </a>
                                  {f.telefon && (
                                    <a
                                      href={`tel:${f.telefon}`}
                                      className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                                    >
                                      📞 Sună
                                    </a>
                                  )}
                                </div>
                                {visitFor === cheie && (
                                  <VisitButtons
                                    onPick={(result, note) => bifeaza(f, result, note)}
                                    onCancel={() => setVisitFor(null)}
                                  />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                </div>
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

        {toast && (
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 z-10 flex justify-center">
            <span className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
              {toast}
            </span>
          </div>
        )}
      </div>

      <OrderModal
        token={token}
        firm={orderFor}
        onClose={() => setOrderFor(null)}
        onSent={(msg) => {
          setOrderFor(null);
          showToast(msg);
          setOrdersToday((n) => (n ?? 0) + 1);
        }}
      />

      {/* Acoperirea LUI: aceeași socoteală ca raportul șefului, doar
          cifrele lui — să nu aștepte vineri ca să afle că-i în urmă. */}
      <AcoperireaMea token={token} />
    </section>
  );
}
