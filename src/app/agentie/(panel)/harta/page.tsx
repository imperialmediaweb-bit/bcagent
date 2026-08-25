"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Sparkles } from "lucide-react";
import AiMarkdown from "@/components/AiMarkdown";
import { paginaRaport } from "@/lib/md-print";
import { Alert, Button, Card, EmptyState, api, formatNumber } from "@/app/platform/ui";

/**
 * HARTA FIRMEI — situația centralizată, dintr-o privire.
 *
 * Cererea lui Bogdan (25.08): „mă interesează să creez harta cu situația
 * centralizată". Agentul își vede harta lui; managerul are nevoie de a
 * TUTUROR pe același ecran: unde sunt clienții firmei, ai cui sunt, pe
 * unde s-a trecut și unde nu calcă nimeni de mult.
 *
 * Fiecare agent are culoarea lui; clienții restanți (nevizitați de mai
 * mult de pragul ales) au cerc roșu în jur — se văd de la depărtare.
 */

interface Client {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  agent: string;
  telefon: string;
  soldCents: number | null;
  lat: number | null;
  lng: number | null;
  aprox: boolean;
  ultimaVizita: string | null;
  restant: boolean;
}
interface AgentLinie {
  nume: string;
  clienti: number;
  restanti: number;
  vizitatiRecent: number;
}
interface Raspuns {
  clienti: Client[];
  agenti: AgentLinie[];
  rezumat: {
    total: number;
    cuPozitie: number;
    vizitatiRecent: number;
    restanti: number;
    localitati: number;
    zile?: number;
  };
}

/** Culori distincte, citibile pe hartă, una per agent. */
const CULORI = [
  "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777",
  "#0891b2", "#65a30d", "#dc2626", "#4f46e5", "#0f766e",
];

/** Text din baza de date pus în HTML — dezarmat (nume din surse externe). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function HartaFirmeiPage() {
  const [date, setDate] = useState<Raspuns | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);
  const [seIncarca, setSeIncarca] = useState(true);
  const [agentAles, setAgentAles] = useState("");
  const [zile, setZile] = useState(7);
  const [doarRestanti, setDoarRestanti] = useState(false);

  const cutieRef = useRef<HTMLDivElement | null>(null);
  const hartaRef = useRef<{ L: typeof LType; map: LType.Map; strat: LType.LayerGroup } | null>(
    null,
  );

  const incarca = useCallback(async () => {
    setSeIncarca(true);
    setEroare(null);
    try {
      const d = await api<Raspuns>(
        `/api/agentie/harta?agent=${encodeURIComponent(agentAles)}&zile=${zile}`,
      );
      setDate(d);
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setSeIncarca(false);
    }
  }, [agentAles, zile]);

  useEffect(() => {
    void incarca();
  }, [incarca]);

  // Culoarea fiecărui agent, stabilă între reîncărcări.
  const culoareAgent = useMemo(() => {
    const m = new Map<string, string>();
    (date?.agenti ?? [])
      .map((a) => a.nume)
      .sort()
      .forEach((n, i) => m.set(n, CULORI[i % CULORI.length]));
    return m;
  }, [date]);

  const deAratat = useMemo(
    () =>
      (date?.clienti ?? []).filter(
        (c) => c.lat !== null && c.lng !== null && (!doarRestanti || c.restant),
      ),
    [date, doarRestanti],
  );

  // Când se schimbă dimensiunea ferestrei (rotirea telefonului, altă
  // fereastră, tastatura), harta TREBUIE anunțată — altfel rămâne
  // desenată la mărimea veche și pătratele ei ies din pagină.
  useEffect(() => {
    const anunta = () => hartaRef.current?.map.invalidateSize();
    window.addEventListener("resize", anunta);
    window.addEventListener("orientationchange", anunta);
    const obs =
      typeof ResizeObserver !== "undefined" && cutieRef.current
        ? new ResizeObserver(() => anunta())
        : null;
    if (obs && cutieRef.current) obs.observe(cutieRef.current);
    return () => {
      window.removeEventListener("resize", anunta);
      window.removeEventListener("orientationchange", anunta);
      obs?.disconnect();
    };
  }, []);

  // Desenarea hărții.
  useEffect(() => {
    let anulat = false;
    (async () => {
      if (!cutieRef.current) return;
      if (!hartaRef.current) {
        const L = (await import("leaflet")).default;
        if (anulat || !cutieRef.current) return;
        const map = L.map(cutieRef.current, {
          center: [47.6, 26.2],
          zoom: 8,
          scrollWheelZoom: true,
        });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap",
          maxZoom: 19,
        }).addTo(map);
        hartaRef.current = { L, map, strat: L.layerGroup().addTo(map) };
      }
      const { L, map, strat } = hartaRef.current;
      strat.clearLayers();
      const cadru: Array<[number, number]> = [];
      for (const c of deAratat) {
        const culoare = culoareAgent.get(c.agent) ?? "#64748b";
        // Restanții: inel roșu în jur, se văd de la distanță.
        if (c.restant) {
          L.circleMarker([c.lat as number, c.lng as number], {
            radius: 11,
            color: "#dc2626",
            weight: 2,
            fill: false,
            opacity: 0.9,
          }).addTo(strat);
        }
        const punct = L.circleMarker([c.lat as number, c.lng as number], {
          radius: 6,
          color: "#ffffff",
          weight: 1.5,
          fillColor: culoare,
          fillOpacity: c.aprox ? 0.55 : 0.95,
        });
        const cand = c.ultimaVizita
          ? new Date(c.ultimaVizita).toLocaleDateString("ro-RO")
          : "niciodată";
        punct.bindTooltip(esc(c.denumire), { direction: "top" });
        punct.bindPopup(
          `<div style="min-width:200px">
            <div style="font-weight:700;font-size:13px">${esc(c.denumire)}</div>
            <div style="font-size:11px;color:#64748b">${esc(
              [c.adresa, c.localitate].filter(Boolean).join(", ") || "fără adresă",
            )}${c.aprox ? " · poziție aproximativă" : ""}</div>
            <div style="margin-top:6px;font-size:12px">
              <b>Agent:</b> ${esc(c.agent)}<br>
              <b>Ultima vizită:</b> ${esc(cand)}${c.restant ? " <span style=\"color:#dc2626;font-weight:700\">(restant)</span>" : ""}
              ${c.soldCents && c.soldCents > 0 ? `<br><b style="color:#dc2626">Restanță de plată</b>` : ""}
            </div>
            ${c.telefon ? `<div style="margin-top:6px"><a href="tel:${esc(c.telefon)}" style="font-size:12px;font-weight:600;color:#0f766e;text-decoration:none">📞 ${esc(c.telefon)}</a></div>` : ""}
          </div>`,
        );
        punct.addTo(strat);
        cadru.push([c.lat as number, c.lng as number]);
      }
      if (cadru.length > 0) {
        map.fitBounds(cadru, { padding: [30, 30], maxZoom: 12 });
      }
      setTimeout(() => map.invalidateSize(), 80);
    })();
    return () => {
      anulat = true;
    };
  }, [deAratat, culoareAgent]);

  const r = date?.rezumat;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Harta firmei
        </h1>
        <p className="text-sm text-slate-500">
          Toți clienții firmei pe o hartă: ai cui sunt, pe unde s-a trecut și
          cine a rămas nevizitat. Fiecare agent are culoarea lui.
        </p>
      </header>

      {eroare && <Alert>{eroare}</Alert>}

      {r && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { et: "Clienți pe hartă", v: r.cuPozitie, sub: `din ${formatNumber(r.total)}` },
            { et: "Vizitați recent", v: r.vizitatiRecent, sub: `în ultimele ${r.zile ?? zile} zile` },
            { et: "Restanți", v: r.restanti, sub: "n-a trecut nimeni", rosu: true },
            { et: "Localități", v: r.localitati, sub: "cu clienți" },
          ].map((k) => (
            <Card key={k.et} className="p-3">
              <p className="text-xs font-medium text-slate-500">{k.et}</p>
              <p
                className={`text-2xl font-bold ${k.rosu && k.v > 0 ? "text-rose-600" : "text-slate-900"}`}
              >
                {formatNumber(k.v)}
              </p>
              <p className="text-[11px] text-slate-400">{k.sub}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        {/* Rândul de filtre: `min-w-0` pe select e obligatoriu — fără el,
            caseta nu se poate micșora sub cel mai lung nume de agent și
            împinge pagina în lateral pe ecrane medii (tabletă). */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <select
            value={agentAles}
            onChange={(e) => setAgentAles(e.target.value)}
            className="mt-0 w-full min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
          >
            <option value="">Toți agenții</option>
            {(date?.agenti ?? []).map((a) => (
              <option key={a.nume} value={a.nume}>
                {/* Numele foarte lungi se scurtează în listă, ca să nu
                    lățească caseta pe telefon. */}
                {a.nume.length > 34 ? `${a.nume.slice(0, 32)}…` : a.nume} ({a.clienti})
              </option>
            ))}
          </select>
          <select
            value={zile}
            onChange={(e) => setZile(parseInt(e.target.value))}
            className="mt-0 w-full min-w-0 shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-52"
          >
            <option value={7}>Restant după 7 zile</option>
            <option value={14}>Restant după 2 săptămâni</option>
            <option value={30}>Restant după o lună</option>
          </select>
          {/* Zona de apăsat cât degetul (≥44px), nu doar pătrățelul. */}
          <label className="flex min-h-11 shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={doarRestanti}
              onChange={(e) => setDoarRestanti(e.target.checked)}
              className="h-5 w-5 accent-rose-600"
            />
            Doar restanții
          </label>
        </div>
      </Card>

      <AnalizaHarta agent={agentAles} zile={zile} />

      <Card className="overflow-hidden p-0">
        <div
          ref={cutieRef}
          className="h-[460px] w-full max-w-full overflow-hidden bg-slate-100"
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-xs">
          {(date?.agenti ?? []).map((a) => (
            <span key={a.nume} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: culoareAgent.get(a.nume) ?? "#64748b" }}
              />
              <span className="font-medium text-slate-700">{a.nume}</span>
              <span className="text-slate-400">
                {a.clienti} clienți{a.restanti > 0 ? ` · ${a.restanti} restanți` : ""}
              </span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-rose-600" />
            inel roșu = nevizitat de peste {zile} zile
          </span>
        </div>
      </Card>

      {seIncarca && !date && (
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200/60" />
      )}
      {!seIncarca && date && date.clienti.length === 0 && (
        <EmptyState text="Niciun client alocat agenților încă. Adu-i din Clienți → «Adu universul de clienți»." />
      )}
      {!seIncarca && r && r.total > 0 && r.cuPozitie < r.total && (
        <p className="text-xs text-slate-500">
          {formatNumber(r.total - r.cuPozitie)} clienți n-au încă poziție pe
          hartă — apar acolo pe măsură ce agenții apasă „Am fost" la ei, chiar
          în fața magazinului.
        </p>
      )}

      {(date?.agenti ?? []).length > 0 && (
        <Card className="p-0">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <MapPin className="h-4 w-4 text-indigo-500" />
              Acoperirea pe agenți
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {[...(date?.agenti ?? [])]
              .sort((a, b) => b.restanti - a.restanti)
              .map((a) => {
                const pct = a.clienti > 0 ? Math.round((a.vizitatiRecent / a.clienti) * 100) : 0;
                return (
                  <li key={a.nume} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ background: culoareAgent.get(a.nume) ?? "#64748b" }}
                        />
                        {a.nume}
                      </span>
                      <span className="text-xs text-slate-500">
                        {a.clienti} clienți · {a.vizitatiRecent} vizitați ·{" "}
                        <span className={a.restanti > 0 ? "font-semibold text-rose-600" : ""}>
                          {a.restanti} restanți
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * CE-MI SPUNE HARTA — sinteza AI peste situația centralizată: cine a
 * rămas în urmă, ce localități s-au răcit, cu ce începe săptămâna.
 * Se cere la apăsare (nu la fiecare deschidere) și se poate salva PDF,
 * ca managerul să-l dea mai departe patronului.
 */
function AnalizaHarta({ agent, zile }: { agent: string; zile: number }) {
  const [lucreaza, setLucreaza] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cati, setCati] = useState(0);

  async function ruleaza() {
    setLucreaza(true);
    setErr(null);
    setText(null);
    try {
      const d = await api<{ text: string; count?: number }>(
        "/api/agentie/harta/analiza",
        { method: "POST", json: { agent, zile } },
      );
      setText(d.text);
      setCati(d.count ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLucreaza(false);
    }
  }

  return (
    <Card className="border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Ce-mi spune harta
          </h2>
          <p className="mt-0.5 text-xs text-indigo-800/70">
            AI-ul citește situația de pe hartă și-ți spune cine a rămas în
            urmă, ce sate s-au răcit și cu ce începi săptămâna.
          </p>
        </div>
        <Button onClick={ruleaza} disabled={lucreaza}>
          {lucreaza ? "Mă uit pe hartă..." : text ? "Reanalizează" : "Analizează harta"}
        </Button>
      </div>
      {err && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>
      )}
      {text && (
        <div className="voice-md mt-3 rounded-lg border border-indigo-100 bg-white p-4 text-sm leading-relaxed text-slate-800">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {cati > 0 && (
              <p className="text-xs font-medium text-indigo-600">
                Din situația a {formatNumber(cati)} clienți.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const f = window.open("", "_blank");
                if (!f) return;
                f.document.write(
                  paginaRaport({
                    titlu: "Harta firmei — ce spun cifrele",
                    subtitlu: `${agent ? `Agent: ${agent} · ` : "Toți agenții · "}restant după ${zile} zile · ${formatNumber(cati)} clienți · generat ${new Date().toLocaleDateString("ro-RO")}`,
                    corpMd: text,
                  }),
                );
                f.document.close();
              }}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              ⬇️ Descarcă PDF
            </button>
          </div>
          <AiMarkdown text={text} />
        </div>
      )}
    </Card>
  );
}
