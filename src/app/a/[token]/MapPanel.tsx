"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  BedDouble,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Route as RouteIcon,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  COUNTY_LIST,
  DOMAIN_PRESETS,
  countyName,
} from "@/modules/prospects";
import OrderModal from "./OrderModal";
import PinFirma from "./PinFirma";
import MicButton from "./MicButton";
import { navAddress, planRoute } from "@/lib/route-nav";

const fmt = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);

interface Locality {
  localitate: string;
  count: number;
  cuTelefon: number;
  /** Clienții MEI din localitate (numărați de server, sigur, nu ghicit). */
  clienti?: number;
  lat: number | null;
  lng: number | null;
}

interface MatchInfo {
  client: string;
  cui: string;
  denumire: string;
  localitate: string;
  judet: string;
}

export interface Firm {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  status: string;
  /** Agentul care are firma în portofoliu — ca „clienții MEI" să nu-i
   *  includă pe ai colegului din aceeași firmă. */
  assignedAgent?: string;
  telefon: string;
  soldCents: number | null;
  /** Firma are locul ei exact pe hartă (pus de agent sau învățat la vizită)? */
  pinExact?: boolean;
  pinLat?: number | null;
  pinLng?: number | null;
  /** Am voie să-i mut locul? La firmele altei agenții — nu. */
  potPin?: boolean;
}

interface Stop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  /** Județul firmei — călătorește cu oprirea, ca navigarea să nu
   *  nimerească satul cu același nume din alt județ. */
  judet?: string;
  telefon: string;
  /** Poziția exactă, dacă o știm — ruta navighează pe coordonate, nu pe
   *  adresă, ca Google să nu mai refuze traseul la adrese de sat. */
  lat?: number | null;
  lng?: number | null;
}

interface SavedRoute {
  id: string;
  name: string;
  day: string;
  stops: Stop[];
}

interface DueClient {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  telefon: string;
  lastVisit: string | null;
}

const VISIT_RESULTS: Array<{ id: string; label: string; emoji: string }> = [
  { id: "gandeste", label: "Se mai gândește", emoji: "🤔" },
  { id: "ne_suna", label: "Ne sună el", emoji: "📞" },
  { id: "client", label: "A devenit client", emoji: "🤝" },
  { id: "nu_vrea", label: "Nu vrea", emoji: "❌" },
  { id: "inchis", label: "Închis / nu era nimeni", emoji: "🚪" },
];

/** Ziua curentă în cheile noastre de rută — „azi e luni → Ruta Rădăuți". */
const TODAY_KEY = [
  "duminica",
  "luni",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sambata",
][new Date().getDay()];

const DAY_LABELS: Record<string, string> = {
  luni: "Luni",
  marti: "Marți",
  miercuri: "Miercuri",
  joi: "Joi",
  vineri: "Vineri",
  sambata: "Sâmbătă",
  duminica: "Duminică",
  "": "Fără zi",
};

function normLoc(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// Navigarea folosește navAddress din lib/route-nav — UN singur loc care
// știe regula „fără număr în adresă → caută pe NUME + sat" (altfel Google
// duce în centrul satului). Aceeași regulă pe listă, pe pin și pe rute.

/** Text din baza de date pus în HTML — orice caracter periculos devine
 *  inofensiv (numele firmelor vin din surse externe). */
function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function gmapsDir(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

export default function MapPanel({
  token,
  clients,
  agentName = "",
}: {
  token: string;
  clients: string[];
  /** Numele agentului conectat — „clienții mei" înseamnă ai LUI. */
  agentName?: string;
}) {
  const [judet, setJudet] = useState("SV");
  const [preset, setPreset] = useState("fmcg");
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
  // PINII CLIENȚILOR: fiecare client, un punct pe hartă la adresa lui —
  // ca agentul să vadă cine e vecin cu cine și să nu umble aiurea pe drum.
  interface PinClient {
    cui: string;
    denumire: string;
    adresa: string;
    localitate: string;
    telefon: string;
    lat: number;
    lng: number;
    aprox: boolean;
  }
  const [pins, setPins] = useState<PinClient[]>([]);
  const [aratPins, setAratPins] = useState(false);
  // UNDE SUNT EU (cererea lui Costin, 25.08): punct albastru pe hartă, ca
  // reper când cauți un magazin — vezi pe loc ce clienți ai lângă tine.
  const [euSunt, setEuSunt] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [cautPozitia, setCautPozitia] = useState(false);
  // Când desenarea e pornită DOAR de „Unde sunt eu", harta NU se
  // reîncadrează pe județ — altfel butonul ar depărta în loc să apropie.
  const doarPozitiaMea = useRef(false);
  const [eroarePozitie, setEroarePozitie] = useState<string | null>(null);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsDeGeocodat, setPinsDeGeocodat] = useState(0);

  // Coșul de rută + rutele salvate.
  const [basket, setBasket] = useState<Stop[]>([]);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [visitsToday, setVisitsToday] = useState(0);
  const [dueClients, setDueClients] = useState<DueClient[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // CUI-urile bifate azi („Am fost") — o rută lungă se continuă a doua zi
  // exact de unde a rămas, fără opririle deja făcute.
  const [doneToday, setDoneToday] = useState<string[]>([]);

  const mapRef = useRef<HTMLDivElement | null>(null);
  // Cardul hărții: când alegi o localitate din listele de jos, ecranul
  // urcă la hartă — altfel pare că butonul „nu face nimic".
  const mapCardRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{
    L: typeof LType;
    map: LType.Map;
    layer: LType.LayerGroup;
  } | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  // Câte opriri avea ruta ultima dată când am centrat harta pe ea.
  const ruteFit = useRef(-1);
  // Ultimul cadru pe care s-a potrivit harta. Când harta află (sau își
  // schimbă) dimensiunea — chenar redimensionat, rotirea telefonului —
  // proiecția se schimbă și bulele pot ieși din cadru; atunci refacem
  // potrivirea pe același cadru, ca să rămână toate vizibile și apăsabile.
  const ultimulCadru = useRef<Array<[number, number]> | null>(null);
  const geocodeRound = useRef(0);

  // JUDEȚUL AGENTULUI: harta nu se mai deschide pentru toți pe Suceava —
  // se deschide singură pe județul unde are OMUL clienții lui, iar dacă
  // și-a ales vreodată alt județ din listă, i-l ținem minte pe telefon.
  const judetAlesDeOm = useRef(false);
  useEffect(() => {
    try {
      const salvat = localStorage.getItem("harta-judet");
      if (salvat && COUNTY_LIST.some((c) => c.code === salvat)) {
        judetAlesDeOm.current = true;
        setJudet(salvat);
      }
    } catch {
      // stocare blocată — rămâne implicitul
    }
  }, []);
  useEffect(() => {
    if (judetAlesDeOm.current || matches.length === 0) return;
    const numar = new Map<string, number>();
    for (const m of matches) {
      if (m.judet) numar.set(m.judet, (numar.get(m.judet) ?? 0) + 1);
    }
    let alJui = "";
    let maxim = 0;
    for (const [j, n] of numar) {
      if (n > maxim && COUNTY_LIST.some((c) => c.code === j)) {
        alJui = j;
        maxim = n;
      }
    }
    if (alJui) setJudet(alJui);
  }, [matches]);

  const caenParam = useMemo(() => {
    const p = DOMAIN_PRESETS.find((x) => x.id === preset);
    return p ? p.caens.join(",") : "";
  }, [preset]);

  const clientLocalities = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of matches) {
      if (m.judet !== judet || !m.localitate) continue;
      const key = normLoc(m.localitate);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [matches, judet]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  /* ── potrivire clienți ↔ firme MF ── */
  useEffect(() => {
    if (clients.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/prospects/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, clients }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { matches?: MatchInfo[] };
        if (!cancelled && data.matches) setMatches(data.matches);
      } catch {
        // fără potriviri — harta merge doar cu prospecți
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, clients]);

  /* ── rutele salvate + vizitele de azi ── */
  const loadRoutes = useCallback(async () => {
    try {
      const res = await fetch(`/api/routes?token=${encodeURIComponent(token)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { routes?: SavedRoute[] };
      if (data.routes) setRoutes(data.routes);
    } catch {
      // fără DB — rutele rămân doar în sesiune
    }
  }, [token]);

  const loadDue = useCallback(() => {
    fetch(`/api/visits?token=${encodeURIComponent(token)}&due=1&limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { due?: DueClient[] } | null) => {
        if (d?.due) setDueClients(d.due);
      })
      .catch(() => {});
  }, [token]);

  // Ce am bifat AZI — ca „Continuă ruta" să sară peste ce e deja făcut.
  const loadDoneToday = useCallback(() => {
    fetch(`/api/visits?token=${encodeURIComponent(token)}&limit=100`)
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
  }, [token]);

  useEffect(() => {
    loadRoutes();
    loadDue();
    loadDoneToday();
  }, [token, loadRoutes, loadDue, loadDoneToday]);

  /** Deschide localitatea în panoul hărții și urcă ecranul la hartă. */
  const openLocality = useCallback((loc: string) => {
    setSelectedLoc(loc);
    // lăsăm React să randeze panoul, apoi urcăm la hartă
    setTimeout(() => {
      mapCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  /* ── datele hărții + geocodare progresivă ── */
  const loadGeo = useCallback(
    async (withGeocode: boolean) => {
      const params = new URLSearchParams({
        token,
        judet,
        geocode: withGeocode ? "1" : "0",
      });
      if (caenParam) params.set("caenIn", caenParam);
      const res = await fetch(`/api/prospects/geo?${params}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Eroare ${res.status}`);
      }
      return (await res.json()) as {
        localities: Locality[];
        pendingGeocode: number;
      };
    },
    [token, judet, caenParam],
  );

  // Aducem punctele clienților; geocodarea adreselor noi se face în valuri
  // (Nominatim cere 1 pe secundă), iar rezultatul rămâne salvat — a doua
  // oară harta se umple instant.
  const incarcaPins = useCallback(
    async (cuGeocodare: boolean) => {
      const params = new URLSearchParams({ token, judet, geocode: cuGeocodare ? "1" : "0" });
      if (selectedLoc) params.set("localitate", selectedLoc);
      const res = await fetch(`/api/prospects/pins?${params}`);
      if (!res.ok) throw new Error(`Eroare ${res.status}`);
      return (await res.json()) as {
        pins: PinClient[];
        deGeocodat: number;
        geocodate: number;
      };
    },
    [token, judet, selectedLoc],
  );

  useEffect(() => {
    if (!aratPins) {
      // ATENȚIE: fără garda asta, un array NOU la fiecare rulare cerea
      // redesenarea hărții și întrerupea încărcarea listei de firme
      // (clientul apăsa pe bulă și nu i se mai deschidea nimic).
      setPins((p) => (p.length === 0 ? p : []));
      setPinsDeGeocodat(0);
      return;
    }
    let anulat = false;
    (async () => {
      setPinsLoading(true);
      try {
        let d = await incarcaPins(false);
        if (anulat) return;
        setPins(d.pins);
        setPinsDeGeocodat(d.deGeocodat);
        setPinsLoading(false);
        // valuri de geocodare până se termină (max 10 runde)
        let runde = 0;
        while (d.deGeocodat > 0 && runde < 10) {
          runde++;
          const inainte = d.deGeocodat;
          d = await incarcaPins(true);
          if (anulat) return;
          setPins(d.pins);
          setPinsDeGeocodat(d.deGeocodat);
          if (d.deGeocodat >= inainte) break; // nu mai avansează — ne oprim
        }
      } catch {
        if (!anulat) setPinsLoading(false);
      }
    })();
    return () => {
      anulat = true;
    };
    // Dependențe SIMPLE: funcția se recrea la fiecare render și ar fi
    // repornit efectul în buclă.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aratPins, token, judet, selectedLoc]);

  useEffect(() => {
    let cancelled = false;
    geocodeRound.current = 0;
    setLoading(true);
    setError(null);
    setSelectedLoc(null);

    (async () => {
      try {
        let data = await loadGeo(false);
        if (cancelled) return;
        setLocalities(data.localities);
        setLoading(false);
        setGeocoding(data.pendingGeocode);

        let prevPending = data.pendingGeocode;
        while (data.pendingGeocode > 0 && geocodeRound.current < 12) {
          geocodeRound.current++;
          data = await loadGeo(true);
          if (cancelled) return;
          setLocalities(data.localities);
          setGeocoding(data.pendingGeocode);
          if (data.pendingGeocode >= prevPending) break;
          prevPending = data.pendingGeocode;
        }
        if (!cancelled) setGeocoding(0);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadGeo]);

  /* ── harta Leaflet ── */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapRef.current) return;

      if (!leafletRef.current) {
        const map = L.map(mapRef.current, {
          center: [47.65, 26.25],
          zoom: 9,
          scrollWheelZoom: false,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        leafletRef.current = { L, map, layer: L.layerGroup().addTo(map) };

        // Harta se construiește uneori cât timp secțiunea e ascunsă (agentul
        // e pe alt meniu) sau într-un chenar care abia apoi capătă lățime.
        // Leaflet rămâne cu dimensiunea veche și încarcă doar câteva pătrate
        // de hartă — restul rămâne gri. Urmărim mărimea chenarului și îi
        // spunem hărții să se recalculeze de fiecare dată când se schimbă.
        const el = mapRef.current;
        // Repotrivirea pe cadru se face DOAR când harta iese dintr-o stare
        // stricată (era minusculă/ascunsă când s-a potrivit prima dată și
        // bulele au rămas în afara ecranului). La orice altă redimensionare
        // — rotire, tastatură, tras de fereastră — zoomul și poziția puse
        // de agent rămân neatinse: harta nu sare de sub deget.
        const marimeVeche = { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
        const reaseaza = () => {
          if (!el) return;
          const w = el.clientWidth;
          const h = el.clientHeight;
          const eraStricata = marimeVeche.w < 100 || marimeVeche.h < 100;
          marimeVeche.w = w;
          marimeVeche.h = h;
          map.invalidateSize();
          if (eraStricata && w >= 100 && h >= 100 && ultimulCadru.current?.length) {
            map.fitBounds(ultimulCadru.current, { padding: [30, 30], maxZoom: 11 });
          }
        };
        if (el && typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => {
            if (el.offsetParent === null) return; // ascunsă — nu are rost
            reaseaza();
          });
          ro.observe(el);
          resizeObsRef.current = ro;
        }
        // Și o dată la început, după ce se așază chenarul.
        setTimeout(reaseaza, 250);
      }

      const { map, layer } = leafletRef.current;
      layer.clearLayers();

      const bounds: Array<[number, number]> = [];
      for (const loc of localities) {
        if (loc.lat === null || loc.lng === null) continue;
        const key = normLoc(loc.localitate);
        // Verde dacă am clienți acolo — după numărătoarea SERVERULUI
        // (clienții alocați mie) sau după potrivirea fișierului meu.
        const clientCount = Math.max(loc.clienti ?? 0, clientLocalities.get(key) ?? 0);
        const isCovered = clientCount > 0;
        const isSelected = selectedLoc === loc.localitate;
        const radius = Math.max(6, Math.min(26, 4 + Math.sqrt(loc.count) * 1.6));
        const marker = L.circleMarker([loc.lat, loc.lng], {
          radius,
          color: isSelected ? "#4338ca" : isCovered ? "#059669" : "#d97706",
          fillColor: isSelected ? "#6366f1" : isCovered ? "#10b981" : "#f59e0b",
          fillOpacity: isSelected ? 0.8 : 0.55,
          weight: isSelected ? 3 : 1.5,
        });
        marker.bindTooltip(
          // Numele localității vine din datele MF — dezarmat, ca orice text extern.
          `${escHtml(loc.localitate)} — ${fmt(loc.count)} firme` +
            (isCovered ? ` · ${clientCount} clienți` : " · pată albă"),
        );
        marker.on("click", () => setSelectedLoc(loc.localitate));  // deja pe hartă
        marker.addTo(layer);
        bounds.push([loc.lat, loc.lng]);
      }
      // PINII CLIENȚILOR: fiecare client, un punct. Apeși pe punct și-i
      // vezi numele — așa se vede pe hartă cine e vecin cu cine, iar ruta
      // se face pe vecinătate, nu la nimereală.
      if (aratPins && pins.length > 0) {
        for (const p of pins) {
          const punct = L.circleMarker([p.lat, p.lng], {
            radius: 7,
            color: "#7c3aed",
            fillColor: p.aprox ? "#c4b5fd" : "#8b5cf6",
            fillOpacity: 0.95,
            weight: 2,
          });
          punct.bindTooltip(escHtml(p.denumire), { direction: "top" });
          const inRuta = basket.some((b) => b.cui === p.cui);
          punct.bindPopup(
            `<div style="min-width:190px">
              <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escHtml(p.denumire)}</div>
              <div style="font-size:11px;color:#64748b">${escHtml(p.adresa || p.localitate)}${p.aprox ? " · ≈ poziție aproximativă (adresa n-are stradă/nr.)" : ""}</div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                ${p.telefon ? `<a href="tel:${escHtml(p.telefon)}" style="font-size:12px;font-weight:600;color:#0f766e;text-decoration:none">📞 Sună</a>` : ""}
                <a href="${escHtml(
                  // Pin EXACT (adresă geocodată sau GPS de la vizită) →
                  // navigăm fix pe coordonate; aproximativ → navAddress
                  // (nume + sat + județ), ca Google să găsească magazinul.
                  p.aprox
                    ? gmapsDir(navAddress({ ...p, judet }))
                    : gmapsDir(`${p.lat},${p.lng}`),
                )}" target="_blank" rel="noopener" style="font-size:12px;font-weight:600;color:#1d4ed8;text-decoration:none">🧭 Navighează</a>
                <button data-pin-ruta="${escHtml(p.cui)}" style="font-size:12px;font-weight:700;color:${inRuta ? "#b91c1c" : "#4f46e5"};background:none;border:none;padding:0;cursor:pointer">${inRuta ? "− Scoate din rută" : "+ Pune în rută"}</button>
              </div>
            </div>`,
          );
          punct.on("popupopen", () => {
            const btn = document.querySelector<HTMLButtonElement>(
              `[data-pin-ruta="${CSS.escape(p.cui)}"]`,
            );
            btn?.addEventListener(
              "click",
              () => {
                toggleStop({
                  cui: p.cui,
                  denumire: p.denumire,
                  adresa: p.adresa,
                  localitate: p.localitate,
                  telefon: p.telefon,
                } as Firm, p.aprox ? undefined : { lat: p.lat, lng: p.lng });
                map.closePopup();
              },
              { once: true },
            );
          });
          punct.addTo(layer);
          bounds.push([p.lat, p.lng]);
        }
      }

      // RUTA, DESENATĂ PE HARTĂ. Opririle din coș primesc pini numerotați,
      // în ordinea de mers, legați cu o linie — agentul vede drumul înainte
      // să pornească navigarea, nu doar o listă de nume dedesubt.
      if (basket.length > 0) {
        const coordLoc = new Map<string, [number, number]>();
        for (const l of localities) {
          if (l.lat === null || l.lng === null) continue;
          coordLoc.set(normLoc(l.localitate), [l.lat, l.lng]);
        }
        // Coordonatele le avem pe LOCALITATE, nu pe fiecare firmă. Deci
        // grupăm opririle pe localitate și punem un singur pin, cu numerele
        // opririlor de acolo („1-3”, „2, 5”). Nimic inventat pe hartă.
        const grupuri = new Map<
          string,
          { punct: [number, number]; nr: number[]; nume: string[]; primul: number }
        >();
        basket.forEach((s, i) => {
          const key = normLoc(s.localitate);
          const c = coordLoc.get(key);
          if (!c) return;
          const g = grupuri.get(key);
          if (g) {
            g.nr.push(i + 1);
            g.nume.push(`${i + 1}. ${s.denumire}`);
          } else {
            grupuri.set(key, {
              punct: c,
              nr: [i + 1],
              nume: [`${i + 1}. ${s.denumire}`],
              primul: i,
            });
          }
        });
        const ordonate = [...grupuri.values()].sort((a, b) => a.primul - b.primul);
        const puncte = ordonate.map((g) => g.punct);
        for (const g of ordonate) {
          // „1-3” dacă numerele sunt consecutive, altfel „1, 4, 7”
          const consecutive = g.nr.every((n, k) => k === 0 || n === g.nr[k - 1] + 1);
          const eticheta =
            g.nr.length === 1
              ? String(g.nr[0])
              : consecutive
                ? `${g.nr[0]}-${g.nr[g.nr.length - 1]}`
                : g.nr.join(",");
          const lat = g.nr.length > 2 ? 34 : g.nr.length > 1 ? 32 : 28;
          L.marker(g.punct, {
            zIndexOffset: 1000,
            icon: L.divIcon({
              className: "",
              html:
                `<div style="min-width:${lat}px;height:28px;padding:0 6px;` +
                `border-radius:14px;background:#4338ca;color:#fff;` +
                `font:700 13px/28px system-ui;text-align:center;` +
                `border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)">` +
                `${eticheta}</div>`,
              iconSize: [lat, 28],
              iconAnchor: [lat / 2, 14],
            }),
          })
            .bindTooltip(g.nume.map((n: string) => escHtml(n)).join("<br>"))
            .addTo(layer);
        }
        if (puncte.length > 1) {
          L.polyline(puncte, {
            color: "#4338ca",
            weight: 3,
            opacity: 0.85,
            dashArray: "7 7",
          }).addTo(layer);
        }
        // Harta se așază pe rută DOAR când o încarci gata făcută (din
        // „Programul meu” sau din scadenți). Cât timp răsfoiești firmele
        // unei localități și adaugi opriri, harta stă pe loc — altfel ar
        // sări de sub deget și n-ai mai nimeri bula următoare.
      // EU, AICI — desenat ULTIMUL, ca să stea deasupra pinilor și a
      // numerelor de rută. NU intră în încadrarea hărții: altfel apăsarea
      // butonului ar depărta harta la nivel de județ în loc să mă apropie.
      if (euSunt) {
        L.circle([euSunt.lat, euSunt.lng], {
          radius: Math.max(20, Math.min(300, euSunt.acc)),
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.12,
          weight: 1,
        }).addTo(layer);
        const eu = L.circleMarker([euSunt.lat, euSunt.lng], {
          radius: 8,
          color: "#ffffff",
          fillColor: "#2563eb",
          fillOpacity: 1,
          weight: 3,
        });
        eu.bindTooltip("Ești aici", { direction: "top" });
        eu.addTo(layer);
        eu.bringToFront();
      }
        if (
          puncte.length > 0 &&
          !selectedLoc &&
          !doarPozitiaMea.current &&
          ruteFit.current !== basket.length
        ) {
          ruteFit.current = basket.length;
          map.fitBounds(puncte, { padding: [60, 60], maxZoom: 13 });
        }
      } else if (bounds.length > 0 && !selectedLoc && !doarPozitiaMea.current) {
        ultimulCadru.current = bounds;
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
      }
      // Steagul se coboară AICI, la finalul desenării (nu după return —
      // acolo era cod mort și harta rămânea blocată fără reîncadrare).
      doarPozitiaMea.current = false;
    })();
    return () => {
      disposed = true;
    };
  }, [localities, clientLocalities, selectedLoc, basket, pins, aratPins, euSunt]);

  useEffect(
    () => () => {
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    },
    [],
  );

  // Când agentul comută pe meniul „Harta pieței”, chenarul trece din
  // ascuns în vizibil — momentul în care harta trebuie recalculată, altfel
  // rămâne gri. Prindem și revenirea în tab, și rotirea telefonului.
  useEffect(() => {
    let lastW = 0;
    let lastH = 0;
    const refresh = () => {
      const map = leafletRef.current?.map;
      const el = mapRef.current;
      if (!map || !el || el.offsetParent === null) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === lastW && h === lastH) return; // nimic nu s-a schimbat
      lastW = w;
      lastH = h;
      map.invalidateSize();
    };
    const t = setInterval(refresh, 1200);
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  /* ── coșul de rută ── */
  const inBasket = useMemo(() => new Set(basket.map((s) => s.cui)), [basket]);
  // Un singur calcul pentru coș (se folosea de 5 ori într-un singur
  // randare — la 40 de opriri însemna 20 de linkuri construite degeaba).
  const planCos = useMemo(() => planRoute(basket, [], judet), [basket, judet]);

  function toggleStop(f: Firm, pozitie?: { lat?: number; lng?: number }) {
    // Dacă firma are pin exact pe hartă, ducem coordonatele în oprire —
    // ruta se navighează pe ele, nu pe adresa de sat.
    // DOAR pinii exacți dau coordonate rutei — cei aproximativi sunt
    // centrul satului, iar pe adresă Google se descurcă mai bine.
    const gasit = pins.find((p) => p.cui === f.cui && !p.aprox);
    const pin = pozitie ?? gasit;
    setBasket((b) =>
      b.some((s) => s.cui === f.cui)
        ? b.filter((s) => s.cui !== f.cui)
        : [
            ...b,
            {
              cui: f.cui,
              denumire: f.denumire,
              adresa: f.adresa,
              localitate: f.localitate,
              judet: f.judet || judet,
              telefon: f.telefon,
              lat: pin?.lat ?? null,
              lng: pin?.lng ?? null,
            },
          ].slice(0, 40),
    );
    setActiveRouteId(null);
  }

  /** „ZONA PE ZI" dintr-un apas: bagă în rută TOȚI clienții dați (fără
   *  dubluri), ca agentul să-și facă ziua din 3-4 sate în 30 de secunde:
   *  sat → butonul „Clienții mei în rută" → următorul sat → Salvează pe zi. */
  function addStops(fs: Firm[]) {
    // Calculul se face PE starea curentă, în afara updater-ului — updater-ul
    // trebuie să rămână pur (StrictMode îl rulează de două ori).
    const existenteAcum = new Set(basket.map((s) => s.cui));
    const noi = fs
      .filter((f) => !existenteAcum.has(f.cui))
      .map((f) => {
        const pin = pins.find((p) => p.cui === f.cui && !p.aprox);
        return {
          cui: f.cui,
          denumire: f.denumire,
          adresa: f.adresa,
          localitate: f.localitate,
          judet: f.judet || judet,
          telefon: f.telefon,
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
        };
      });
    // Dedublarea se face ÎN updater, pe starea REALĂ: două apăsări
    // rapide (banale pe telefon) nu mai pot băga aceiași clienți de
    // două ori.
    setBasket((b) => {
      const existente = new Set(b.map((s) => s.cui));
      return [...b, ...noi.filter((n) => !existente.has(n.cui))].slice(0, 40);
    });
    if (basket.length + noi.length > 40) {
      showToast("Ruta ține maxim 40 de opriri — restul rămân pe altă zi.");
    } else if (noi.length > 0) {
      showToast(`${noi.length} clienți puși în rută ✓`);
    }
    setActiveRouteId(null);
  }

  async function saveRoute(name: string, day: string) {
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          id: activeRouteId ?? undefined,
          name,
          day,
          stops: basket,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok) {
        showToast(data.error ?? "Eroare la salvare");
        return;
      }
      setActiveRouteId(data.id ?? null);
      setShowSave(false);
      showToast("Rută salvată ✓");
      await loadRoutes();
    } catch {
      showToast("Eroare de rețea la salvare");
    }
  }

  async function deleteRoute(id: string) {
    if (!confirm("Ștergi ruta?")) return;
    await fetch(`/api/routes?token=${encodeURIComponent(token)}&id=${id}`, {
      method: "DELETE",
    }).catch(() => {});
    if (activeRouteId === id) {
      setActiveRouteId(null);
      setBasket([]);
    }
    await loadRoutes();
  }

  const whiteSpots = useMemo(
    () =>
      localities
        .filter((l) => !clientLocalities.has(normLoc(l.localitate)))
        .slice(0, 12),
    [localities, clientLocalities],
  );

  return (
    <div className="space-y-4">
      <div ref={mapCardRef} className="card overflow-hidden scroll-mt-4">
        {/* Controale */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <select
            value={judet}
            onChange={(e) => {
              // Alegerea OMULUI bate auto-alegerea și se ține minte pe telefon.
              judetAlesDeOm.current = true;
              setJudet(e.target.value);
              try {
                localStorage.setItem("harta-judet", e.target.value);
              } catch {
                // stocare blocată — merge și fără memorie
              }
            }}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            {COUNTY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            <option value="">Toate domeniile</option>
            {DOMAIN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            {visitsToday > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                <ClipboardList className="h-3.5 w-3.5" />
                {visitsToday} vizite azi
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-emerald-500/70 ring-1 ring-emerald-600" />
              cu clienți
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-amber-500/70 ring-1 ring-amber-600" />
              neacoperite (pete albe)
            </span>
          </div>
        </div>

        {/* CLIENȚII CA PUNCTE: fără asta agentul vede doar bula satului și
            nu știe care clienți sunt vecini — de aici pierdere de timp și
            motorină pe drum. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setAratPins((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              aratPins
                ? "bg-violet-600 text-white shadow-sm"
                : "bg-violet-50 text-violet-700 hover:bg-violet-100"
            }`}
          >
            📍 {aratPins ? "Ascunde clienții de pe hartă" : "Arată clienții pe hartă"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEroarePozitie(null);
              if (euSunt) {
                setEuSunt(null);
                return;
              }
              if (!navigator.geolocation) {
                setEroarePozitie("Telefonul nu-mi dă poziția.");
                return;
              }
              setCautPozitia(true);
              navigator.geolocation.getCurrentPosition(
                (poz) => {
                  setCautPozitia(false);
                  const p = {
                    lat: poz.coords.latitude,
                    lng: poz.coords.longitude,
                    acc: poz.coords.accuracy,
                  };
                  doarPozitiaMea.current = true;
                  setEuSunt(p);
                  // Ne mutăm pe poziția lui, ca să vadă ce are în jur.
                  // După desenare (redesenarea rulează imediat), ca să nu
                  // fie suprascris de încadrarea automată.
                  setTimeout(
                    () => leafletRef.current?.map.setView([p.lat, p.lng], 14),
                    60,
                  );
                },
                () => {
                  setCautPozitia(false);
                  setEroarePozitie(
                    "N-am voie la locație. Apasă lacătul din bara de adresă → Locație → Permite.",
                  );
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 15_000 },
              );
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              euSunt
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            {cautPozitia ? "🛰️ te caut..." : euSunt ? "🙋 Ascunde-mă" : "🙋 Unde sunt eu"}
          </button>
          {eroarePozitie && (
            <span className="text-xs font-medium text-rose-600">{eroarePozitie}</span>
          )}
          {aratPins && (
            <span className="text-xs text-slate-500">
              {pinsLoading && pins.length === 0
                ? "caut adresele..."
                : `${pins.length} clienți pe hartă`}
              {pinsDeGeocodat > 0 && ` · ${pinsDeGeocodat} adrese încă se caută`}
              {pins.length > 0 && " · apeși pe un punct și-i vezi numele"}
            </span>
          )}
        </div>

        {error && (
          <p className="m-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {/* Hartă + panoul localității */}
        <div className="grid min-w-0 lg:grid-cols-5">
          <div className="relative min-w-0 lg:col-span-3">
            <div ref={mapRef} className="h-[420px] w-full" />
            {(loading || geocoding > 0) && (
              <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {loading
                  ? "Se încarcă..."
                  : `Se pun pe hartă încă ${geocoding} localități...`}
              </div>
            )}
          </div>
          <div className="min-w-0 border-t border-slate-100 lg:col-span-2 lg:border-l lg:border-t-0">
            {selectedLoc ? (
              <LocalityFirms
                key={`${judet}-${selectedLoc}-${preset}`}
                token={token}
                judet={judet}
                localitate={selectedLoc}
                centru={
                  localities.find((l) => l.localitate === selectedLoc) ?? null
                }
                caenParam={caenParam}
                inBasket={inBasket}
                agentName={agentName}
                onToggleStop={toggleStop}
                onAddStops={addStops}
                onClose={() => setSelectedLoc(null)}
                onVisitSaved={() => {
                  setVisitsToday((v) => v + 1);
                  loadDue();
                  // Clientul tocmai bifat „Am fost” trebuie să iasă din
                  // rută pe loc — reîncărcăm ce e făcut azi.
                  loadDoneToday();
                }}
                showToast={showToast}
              />
            ) : (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
                <MapPin className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">
                  Apasă pe o bulă de pe hartă ca să vezi firmele din
                  localitatea aia — cu telefon, navigare și adăugare în rută.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Coșul de rută */}
        {basket.length > 0 && (
          <div className="border-t border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-800">
                <RouteIcon className="h-4 w-4" />
                Ruta: {basket.length} opriri
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                {/* Coșul e ce a ales agentul ACUM, cu mâna lui: pleacă TOATE
                    opririle, chiar dacă a fost azi pe la vreuna (se întoarce
                    cu marfă, a lipsit patronul etc.). Doar rutele salvate
                    sar peste ce e deja bifat. */}
                {planCos.etape.length === 0 && (
                  <span className="text-xs font-medium text-rose-600">
                    Firmele astea n-au încă adresă pe hartă — apasă „Am fost"
                    la prima, chiar în fața magazinului, și de atunci ruta
                    merge pe poziția exactă.
                  </span>
                )}
                {planCos.sarite > 0 && planCos.etape.length > 0 && (
                    <span className="text-xs font-medium text-amber-700">
                      {planCos.sarite} opriri n-au adresă
                      și nu intră în traseu — le vezi în listă mai jos.
                    </span>
                  )}
                {planCos.etape.map((e, i, all) => (
                  <a
                    key={i}
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    {all.length > 1
                      ? `Pornește etapa ${i + 1} (${e.stops.length})`
                      : "Pornește ruta"}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={() => setShowSave(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Salvează
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBasket([]);
                    setActiveRouteId(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:text-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                  Golește
                </button>
              </div>
            </div>
            <ol className="mt-2 flex flex-wrap gap-1.5">
              {basket.map((s, i) => (
                <li
                  key={s.cui}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-indigo-100"
                >
                  <span className="font-semibold text-indigo-600">{i + 1}.</span>
                  <span className="max-w-[140px] truncate">{s.denumire}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setBasket((b) => b.filter((x) => x.cui !== s.cui))
                    }
                    className="text-slate-400 hover:text-rose-500"
                    aria-label="Scoate din rută"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Clienții scadenți: vizita săptămânală e obligatorie în distribuție */}
      {dueClients.length > 0 && (
        <div className="card border-rose-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ClipboardList className="h-4 w-4 text-rose-500" />
              De vizitat săptămâna asta ({dueClients.length})
            </h4>
            <button
              type="button"
              onClick={() => {
                setBasket(
                  dueClients.slice(0, 40).map((d) => {
                    const pin = pins.find((p) => p.cui === d.cui && !p.aprox);
                    return {
                      cui: d.cui,
                      denumire: d.denumire,
                      adresa: d.adresa,
                      localitate: d.localitate,
                      judet: judet,
                      telefon: d.telefon,
                      lat: pin?.lat ?? null,
                      lng: pin?.lng ?? null,
                    };
                  }),
                );
                setActiveRouteId(null);
                showToast("Ruta săptămânii pregătită ✓");
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-rose-700"
            >
              <RouteIcon className="h-3.5 w-3.5" />
              Fă-mi ruta din ei
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Clienți fără nicio vizită înregistrată în ultimele 7 zile — cei mai
            vechi primii.
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {dueClients.slice(0, 9).map((d) => (
              <li
                key={d.cui}
                className="rounded-lg border border-rose-100 bg-rose-50/50 px-3 py-2"
              >
                <p className="truncate text-sm font-medium text-slate-800">
                  {d.denumire}
                </p>
                <p className="truncate text-xs text-slate-600">
                  {d.localitate}
                  {d.lastVisit
                    ? ` · ultima vizită ${new Date(d.lastVisit).toLocaleDateString("ro-RO")}`
                    : " · nicio vizită înregistrată"}
                </p>
              </li>
            ))}
          </ul>
          {dueClients.length > 9 && (
            <p className="mt-2 text-xs text-slate-400">
              ... și încă {dueClients.length - 9} — butonul de rută îi ia pe
              toți (max 40).
            </p>
          )}
        </div>
      )}

      {/* Rutele salvate = programul săptămânii; ruta de azi sare în față */}
      {routes.length > 0 && (
        <div className="card p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CalendarDays className="h-4 w-4 text-indigo-500" />
            Programul meu ({routes.length} rute)
          </h4>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...routes]
              .sort((a, b) => {
                const today = TODAY_KEY;
                return (b.day === today ? 1 : 0) - (a.day === today ? 1 : 0);
              })
              .map((r) => {
              // Ruta ține cont de ce ai bifat azi: pornește/continuă doar
              // cu ce a rămas, în etape de 10 (limita Google Maps).
              const plan = planRoute(r.stops, doneToday, judet);
              return (
              <li
                key={r.id}
                className={`rounded-lg border px-3 py-2 ${
                  activeRouteId === r.id
                    ? "border-indigo-300 bg-indigo-50"
                    : r.day === TODAY_KEY
                      ? "border-emerald-300 bg-emerald-50/50"
                      : "border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBasket(r.stops);
                      setActiveRouteId(r.id);
                      showToast(`Ruta „${r.name}" încărcată`);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                      <span className="truncate">{r.name}</span>
                      {r.day === TODAY_KEY && (
                        <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          AZI
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {DAY_LABELS[r.day] ?? r.day} · {r.stops.length} opriri
                      {plan.done > 0 && !plan.finished && (
                        <span className="font-semibold text-emerald-700">
                          {" "}
                          · {plan.done} făcute, {plan.remaining.length} rămase
                        </span>
                      )}
                      {plan.finished && (
                        <span className="font-semibold text-emerald-700">
                          {" "}
                          · gata ✓
                        </span>
                      )}
                    </p>
                  </button>
                  {!plan.finished && plan.etape[0] && (
                    <a
                      href={plan.etape[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50"
                      title={
                        plan.done > 0
                          ? "Continuă ruta cu opririle rămase"
                          : "Pornește ruta"
                      }
                    >
                      <Navigation className="h-4 w-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteRoute(r.id)}
                    className="rounded-md p-1.5 text-slate-400 hover:text-rose-500"
                    title="Șterge"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {plan.legs.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">
                      Nu încap într-un drum — {plan.legs.length} etape:
                    </span>
                    {plan.etape.map((e, i) => (
                      <a
                        key={i}
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-100"
                      >
                        {i + 1}: {e.stops.length} opriri
                      </a>
                    ))}
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pete albe */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BedDouble className="h-4 w-4 text-amber-500" />
            Cele mai mari zone neacoperite din{" "}
            {COUNTY_LIST.find((c) => c.code === judet)?.name ?? judet}
          </h4>
          <p className="text-xs text-slate-500">
            tap pe una → vezi firmele și fă-ți ruta
          </p>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {whiteSpots.map((l) => (
            <li key={l.localitate}>
              <button
                type="button"
                onClick={() => openLocality(l.localitate)}
                className="w-full rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-left transition hover:bg-amber-100/70"
              >
                <p className="flex items-center justify-between gap-1 truncate text-sm font-medium text-slate-800">
                  {l.localitate}
                  <ChevronRight className="h-4 w-4 shrink-0 text-amber-500" />
                </p>
                <p className="text-xs text-slate-600">
                  {fmt(l.count)} firme active · {fmt(l.cuTelefon)} cu telefon
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {showSave && (
        <SaveRouteModal
          defaultName={
            activeRouteId
              ? routes.find((r) => r.id === activeRouteId)?.name ?? ""
              : selectedLoc
                ? `Ruta ${selectedLoc}`
                : "Ruta mea"
          }
          defaultDay={
            activeRouteId
              ? routes.find((r) => r.id === activeRouteId)?.day ?? ""
              : ""
          }
          onSave={saveRoute}
          onClose={() => setShowSave(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ─────────────────── firmele dintr-o localitate ─────────────────── */

function LocalityFirms({
  token,
  judet,
  localitate,
  centru,
  caenParam,
  inBasket,
  agentName,
  onToggleStop,
  onAddStops,
  onClose,
  onVisitSaved,
  showToast,
}: {
  token: string;
  judet: string;
  localitate: string;
  /** Centrul satului: fereastra de „pune locul" pornește de acolo, nu din
   *  mijlocul județului — altfel agentul caută satul cu degetul. */
  centru: { lat: number | null; lng: number | null } | null;
  caenParam: string;
  inBasket: Set<string>;
  agentName: string;
  onToggleStop: (f: Firm) => void;
  onAddStops: (fs: Firm[]) => void;
  onClose: () => void;
  onVisitSaved: () => void;
  showToast: (msg: string) => void;
}) {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [visitFor, setVisitFor] = useState<Firm | null>(null);
  const [orderFor, setOrderFor] = useState<Firm | null>(null);
  const [briefFor, setBriefFor] = useState<Firm | null>(null);
  // Firma căreia îi punem locul exact pe hartă (pin tras cu degetul).
  const [pinFor, setPinFor] = useState<Firm | null>(null);
  // Pinurile puse ACUM, cu tot cu coordonate. Nu doar „da/nu": fără
  // coordonate, redeschizând fereastra imediat după salvare, harta pornea
  // tot din centrul satului și butonul de ștergere lipsea, deși pinul era
  // deja scris în baza de date.
  const [pinuriNoi, setPinuriNoi] = useState<
    Record<string, { lat: number; lng: number } | null>
  >({});
  // Firma pentru care tocmai cerem poziția telefonului („Sunt aici").
  const [ceruta, setCeruta] = useState<string | null>(null);

  /**
   * „SUNT AICI" — cel mai scurt drum către un pin exact: agentul e în fața
   * magazinului, apasă o dată, gata. Fără hartă, fără tras cu degetul.
   * Dacă telefonul nu știe destul de bine unde e, îi spunem pe românește
   * și-l trimitem la varianta cu degetul — nu salvăm o poziție proastă.
   */
  function suntAici(f: Firm) {
    if (!navigator.geolocation) {
      showToast(
        "Telefonul nu-mi dă poziția. Apasă „Pune locul” și trage pinul cu degetul.",
      );
      return;
    }
    setCeruta(f.cui);
    navigator.geolocation.getCurrentPosition(
      async (poz) => {
        const { latitude, longitude, accuracy } = poz.coords;
        try {
          const r = await fetch("/api/prospects/pin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              cui: f.cui,
              lat: latitude,
              lng: longitude,
              sursa: "gps",
              acc: accuracy,
            }),
          });
          const d = (await r.json()) as { error?: string };
          if (!r.ok) {
            showToast(d.error ?? "N-am putut salva locul.");
            return;
          }
          setPinuriNoi((p) => ({ ...p, [f.cui]: { lat: latitude, lng: longitude } }));
          showToast(`Loc salvat (±${Math.round(accuracy)} m) — navigația te duce fix aici.`);
        } catch {
          showToast("Fără semnal — încearcă din nou când prinzi rețea.");
        } finally {
          setCeruta(null);
        }
      },
      () => {
        setCeruta(null);
        showToast("Nu-mi dai voie la locație. Dă-i voie din setările telefonului.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          token,
          judet,
          localitate,
          limit: "100",
          onlyActive: "1",
          // Clienții MEI apar mereu, chiar dacă au alt CAEN decât domeniul
          // ales — altfel agentul își caută degeaba clienții în sat.
          aiMei: "1",
        });
        if (caenParam) params.set("caenIn", caenParam);
        const res = await fetch(`/api/prospects?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          prospects?: Firm[];
          total?: number;
        };
        if (cancelled) return;
        // Clienții primii, apoi cu telefon, apoi restul.
        const sorted = (data.prospects ?? []).slice().sort((a, b) => {
          const rank = (f: Firm) =>
            f.status === "client" ? 0 : f.telefon ? 1 : 2;
          return rank(a) - rank(b) || a.denumire.localeCompare(b.denumire);
        });
        setFirms(sorted);
        setTotal(data.total ?? sorted.length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, judet, localitate, caenParam]);

  async function saveVisit(f: Firm, result: string, note: string) {
    try {
      // Agentul e CHIAR LA FIRMĂ acum — dacă telefonul dă poziția în ≤3s,
      // pinul firmei devine exact (nu „undeva în sat"). Fără permisiune
      // sau fără semnal GPS, vizita se salvează normal, fără poziție.
      const pozitie = await new Promise<{ lat: number; lng: number; acc: number } | null>(
        (resolve) => {
          if (!navigator.geolocation) return resolve(null);
          const ceas = setTimeout(() => resolve(null), 3000);
          navigator.geolocation.getCurrentPosition(
            (p) => {
              clearTimeout(ceas);
              resolve({
                lat: p.coords.latitude,
                lng: p.coords.longitude,
                acc: p.coords.accuracy,
              });
            },
            () => {
              clearTimeout(ceas);
              resolve(null);
            },
            // maximumAge 0: DOAR fix proaspăt — un fix „ținut minte” de la
            // clientul anterior ar deveni pinul greșit al firmei curente.
            { enableHighAccuracy: true, timeout: 2800, maximumAge: 0 },
          );
        },
      );
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cui: f.cui,
          denumire: f.denumire,
          result,
          note,
          ...(pozitie ?? {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        showToast(data?.error ?? "Eroare la salvare");
        return;
      }
      setVisitFor(null);
      onVisitSaved();
      const label = VISIT_RESULTS.find((v) => v.id === result)?.label ?? result;
      showToast(`${label} ✓`);
      // Reflectăm local noul status. „Închis" = firma nu mai există în
      // realitate — dispare din listă pe loc (serverul a scos-o de pe hartă).
      setFirms((fs) =>
        result === "inchis"
          ? fs.filter((x) => x.cui !== f.cui)
          : fs.map((x) =>
              x.cui === f.cui
                ? {
                    ...x,
                    status:
                      result === "client"
                        ? "client"
                        : result === "nu_vrea"
                          ? "respins"
                          : "contactat",
                  }
                : x,
            ),
      );
    } catch {
      showToast("Eroare de rețea");
    }
  }

  return (
    <div className="flex h-[420px] min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">
            {localitate}
          </p>
          <p className="text-xs text-slate-500">
            {loading ? "se încarcă..." : `${fmt(total)} firme active`}
          </p>
          {/* „Zona pe zi" dintr-un apas: toți clienții MEI din sat, în rută.
              Deschizi satele zilei pe rând, apeși, apoi Salvează pe ziua ta. */}
          {(() => {
            const aiMeiDeAdaugat = firms.filter(
              (f) =>
                f.status === "client" &&
                // DOAR ai mei: clienții colegului din aceeași firmă vin
                // tot cu status „client", dar n-au ce căuta în ruta mea.
                (agentName === "" || f.assignedAgent === agentName) &&
                !inBasket.has(f.cui),
            );
            if (loading || aiMeiDeAdaugat.length === 0) return null;
            return (
              <button
                type="button"
                onClick={() => onAddStops(aiMeiDeAdaugat)}
                className="mt-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                ➕ Clienții mei de aici în rută ({aiMeiDeAdaugat.length})
              </button>
            );
          })()}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
          aria-label="Închide"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : firms.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            Nicio firmă pe filtrul curent.
          </p>
        ) : (
          <ul className="max-w-full divide-y divide-slate-100 overflow-x-hidden">
            {firms.map((f) => (
              <li key={f.cui} className="min-w-0 max-w-full px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* Numele și adresa se văd ÎNTREGI (se rup pe rânduri) —
                        la sate strada și numărul erau tăiate cu „…" și
                        agenții nu vedeau unde e firma. */}
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                      <span className="min-w-0 break-words">{f.denumire}</span>
                      {f.status === "client" && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          client
                        </span>
                      )}
                      {f.status === "respins" && (
                        <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 ring-1 ring-inset ring-rose-200">
                          nu vrea
                        </span>
                      )}
                      {f.soldCents !== null && f.soldCents > 0 && (
                        <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          restanță {fmt(f.soldCents / 100)} RON
                        </span>
                      )}
                    </p>
                    <p className="break-words text-xs text-slate-500">
                      {f.adresa || "fără adresă"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleStop(f)}
                    className={`shrink-0 rounded-md p-1.5 ${
                      inBasket.has(f.cui)
                        ? "bg-indigo-100 text-indigo-700"
                        : "text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                    }`}
                    title={inBasket.has(f.cui) ? "Scoate din rută" : "Adaugă în rută"}
                  >
                    {inBasket.has(f.cui) ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {f.telefon && (
                    <a
                      href={`tel:${f.telefon}`}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                    >
                      <Phone className="h-3 w-3" />
                      {f.telefon}
                    </a>
                  )}
                  <a
                    href={gmapsDir(navAddress(f))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    <Navigation className="h-3 w-3" />
                    Navighează
                  </a>
                  {/* ACȚIUNEA PRINCIPALĂ a agentului la fiecare client:
                      bifează vizita și DICTEAZĂ ce a zis clientul. Stătea
                      ultima, mică, între alte patru butoane la fel — și
                      agenții n-o găseau. Acum e prima și mare. */}
                  <button
                    type="button"
                    onClick={() => setVisitFor(visitFor?.cui === f.cui ? null : f)}
                    className="inline-flex w-full max-w-full items-center justify-center gap-1.5 whitespace-normal break-words rounded-md bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                  >
                    🎤 Am fost — spune ce a zis
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderFor(f)}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    🛒 Comandă
                  </button>
                  <button
                    type="button"
                    onClick={() => setBriefFor(f)}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    title="Fișa clientului, făcută de AI din tot istoricul"
                  >
                    📋 Fișă
                  </button>
                  {/* LOCUL EXACT: registrul dă sediul social, geocodarea dă
                      centrul satului. Agentul trage pinul pe magazin o
                      singură dată și navigația îl duce la ușă de-atunci.
                      Butoanele apar DOAR unde chiar are voie — altfel
                      apăsa și primea un refuz sec, în plin teren. */}
                  {f.potPin !== false && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPinFor(f)}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        title="Pune locul exact al magazinului pe hartă"
                      >
                        📍{" "}
                        {(f.cui in pinuriNoi ? pinuriNoi[f.cui] !== null : f.pinExact)
                          ? "Loc pus"
                          : "Pune locul"}
                      </button>
                      {/* Cel mai scurt drum: agentul e CHIAR în fața
                          magazinului și apasă o dată. Un pin exact, fără
                          hartă, fără tras cu degetul. */}
                      <button
                        type="button"
                        onClick={() => suntAici(f)}
                        disabled={ceruta === f.cui}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                        title="Salvează locul magazinului din poziția telefonului"
                      >
                        🎯 {ceruta === f.cui ? "Te caut…" : "Sunt aici"}
                      </button>
                    </>
                  )}
                </div>
                {visitFor?.cui === f.cui && (
                  <VisitButtons
                    onPick={(result, note) => saveVisit(f, result, note)}
                    onCancel={() => setVisitFor(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <OrderModal
        token={token}
        firm={orderFor}
        onClose={() => setOrderFor(null)}
        onSent={showToast}
      />
      <BriefModal token={token} firm={briefFor} onClose={() => setBriefFor(null)} />
      <PinFirma
        token={token}
        firma={
          pinFor
            ? {
                cui: pinFor.cui,
                denumire: pinFor.denumire,
                adresa: pinFor.adresa,
                localitate: pinFor.localitate,
                // Are loc pus? Deschidem harta FIX pe el, ca agentul să-l
                // corecteze, nu să-l caute. N-are? Pornim din centrul satului.
                lat:
                  pinuriNoi[pinFor.cui]?.lat ??
                  (pinFor.cui in pinuriNoi ? null : pinFor.pinLat) ??
                  centru?.lat ??
                  null,
                lng:
                  pinuriNoi[pinFor.cui]?.lng ??
                  (pinFor.cui in pinuriNoi ? null : pinFor.pinLng) ??
                  centru?.lng ??
                  null,
                arePinPropriu:
                  pinFor.cui in pinuriNoi
                    ? pinuriNoi[pinFor.cui] !== null
                    : pinFor.pinExact === true,
              }
            : null
        }
        onClose={() => setPinFor(null)}
        onSalvat={(cui, lat, lng) => {
          setPinuriNoi((p) => ({
            ...p,
            [cui]: lat !== null && lng !== null ? { lat, lng } : null,
          }));
          showToast(
            lat !== null
              ? "Locul magazinului e salvat — de acum navigația te duce fix acolo."
              : "Am șters locul pus. Firma revine în centrul satului.",
          );
        }}
      />
    </div>
  );
}

/** Fișa clientului: AI-ul rezumă notele, vizitele și comenzile firmei. */
function BriefModal({
  token,
  firm,
  onClose,
}: {
  token: string;
  firm: { cui: string; denumire: string } | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!firm) return;
    setText("");
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/client-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ token, cui: firm.cui }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(data?.error ?? `Eroare ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [firm, token]);

  if (!firm) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-base font-semibold text-slate-900">
            📋 {firm.denumire}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Închide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        {busy && !text && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Citesc notele, vizitele și comenzile...
          </p>
        )}
        {text && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {text}
          </div>
        )}
      </div>
    </div>
  );
}

export function VisitButtons({
  onPick,
  onCancel,
}: {
  onPick: (result: string, note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  // Text provizoriu, cât timp agentul încă vorbește (nu-l salvăm încă).
  const [interim, setInterim] = useState("");
  const [dicteaza, setDicteaza] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5">
      {/* DICTARE RAPIDĂ: agentul apasă, spune tot ce a zis clientul, se
          scrie live; apasă din nou și se oprește. Tot ce zice rămâne. */}
      <div className="min-w-0 max-w-full rounded-lg border-2 border-indigo-200 bg-white p-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Microfonul PRIMUL, în stânga: orice s-ar îngusta (font mărit,
              browsere ciudate), se taie din text — NICIODATĂ din buton. */}
          <MicButton
            live
            size={4}
            onListening={setDicteaza}
            onInterim={(t) => setInterim(t)}
            onText={(t) => {
              setNote((n) => (n ? `${n} ${t}` : t));
              setInterim("");
            }}
          />
          <span className="min-w-0 flex-1 break-words text-xs font-semibold text-indigo-800">
            {dicteaza
              ? "🔴 Te ascult — spune ce a zis clientul..."
              : "Apasă microfonul și spune ce a zis clientul"}
          </span>
        </div>
        <textarea
          value={note + (interim ? (note ? " " : "") + interim : "")}
          onChange={(e) => {
            setInterim("");
            setNote(e.target.value);
          }}
          onFocus={() => setDicteaza(false)}
          rows={3}
          placeholder="Aici se scrie ce dictezi — sau scrii tu cu mâna."
          className="mt-1.5 block w-full min-w-0 max-w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
      </div>

      <p className="mt-2 text-[11px] font-medium text-slate-500">
        Alege ce s-a întâmplat (nota se salvează cu el):
      </p>
      <div className="mt-1 grid grid-cols-1 gap-1.5">
        {VISIT_RESULTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onPick(v.id, (note + " " + interim).trim())}
            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300"
          >
            <span>{v.emoji}</span>
            {v.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-1.5 text-xs text-slate-500 hover:text-slate-700"
      >
        Renunță
      </button>
    </div>
  );
}

function SaveRouteModal({
  defaultName,
  defaultDay,
  onSave,
  onClose,
}: {
  defaultName: string;
  defaultDay: string;
  onSave: (name: string, day: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [day, setDay] = useState(defaultDay);
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-sm sm:rounded-2xl">
        <h3 className="text-base font-semibold text-slate-900">Salvează ruta</h3>
        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Nume
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            placeholder="Ruta Rădăuți"
          />
        </label>
        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Ziua din săptămână
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          >
            {Object.entries(DAY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Renunță
          </button>
          <button
            type="button"
            onClick={() => name.trim() && onSave(name.trim(), day)}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Salvează
          </button>
        </div>
      </div>
    </div>
  );
}
