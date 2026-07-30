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

const fmt = (n: number) =>
  new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 0 }).format(n);

interface Locality {
  localitate: string;
  count: number;
  cuTelefon: number;
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

interface Firm {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  caen: string;
  status: string;
  telefon: string;
}

interface Stop {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  telefon: string;
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

/** Adresa completă pentru navigare — telefonul geocodează la moment. */
function navAddress(f: { adresa: string; localitate: string; judet?: string }): string {
  const parts = [f.adresa, f.localitate, f.judet ? countyName(f.judet) : "", "Romania"]
    .filter(Boolean)
    .join(", ");
  return parts;
}

function gmapsDir(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

/** Link Google Maps cu toate opririle rutei (max ~10 waypoints suportate). */
function gmapsRoute(stops: Stop[], judet: string): string {
  const addrs = stops.map((s) =>
    navAddress({ adresa: s.adresa, localitate: s.localitate, judet }),
  );
  const destination = addrs[addrs.length - 1];
  const waypoints = addrs.slice(0, -1).slice(0, 9).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${
    waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""
  }&travelmode=driving`;
}

export default function MapPanel({
  token,
  clients,
}: {
  token: string;
  clients: string[];
}) {
  const [judet, setJudet] = useState("SV");
  const [preset, setPreset] = useState("fmcg");
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);

  // Coșul de rută + rutele salvate.
  const [basket, setBasket] = useState<Stop[]>([]);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [visitsToday, setVisitsToday] = useState(0);
  const [dueClients, setDueClients] = useState<DueClient[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{
    L: typeof LType;
    map: LType.Map;
    layer: LType.LayerGroup;
  } | null>(null);
  const geocodeRound = useRef(0);

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

  useEffect(() => {
    loadRoutes();
    loadDue();
    fetch(`/api/visits?token=${encodeURIComponent(token)}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { today?: number } | null) => {
        if (d?.today !== undefined) setVisitsToday(d.today);
      })
      .catch(() => {});
  }, [token, loadRoutes, loadDue]);

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
      }

      const { map, layer } = leafletRef.current;
      layer.clearLayers();

      const bounds: Array<[number, number]> = [];
      for (const loc of localities) {
        if (loc.lat === null || loc.lng === null) continue;
        const key = normLoc(loc.localitate);
        const clientCount = clientLocalities.get(key) ?? 0;
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
          `${loc.localitate} — ${fmt(loc.count)} firme` +
            (isCovered ? ` · ${clientCount} clienți` : " · pată albă"),
        );
        marker.on("click", () => setSelectedLoc(loc.localitate));
        marker.addTo(layer);
        bounds.push([loc.lat, loc.lng]);
      }
      if (bounds.length > 0 && !selectedLoc) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [localities, clientLocalities, selectedLoc]);

  useEffect(
    () => () => {
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    },
    [],
  );

  /* ── coșul de rută ── */
  const inBasket = useMemo(() => new Set(basket.map((s) => s.cui)), [basket]);

  function toggleStop(f: Firm) {
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
              telefon: f.telefon,
            },
          ].slice(0, 40),
    );
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
      <div className="card overflow-hidden">
        {/* Controale */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <select
            value={judet}
            onChange={(e) => setJudet(e.target.value)}
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
              pete albe
            </span>
          </div>
        </div>

        {error && (
          <p className="m-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {/* Hartă + panoul localității */}
        <div className="grid lg:grid-cols-5">
          <div className="relative lg:col-span-3">
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
          <div className="border-t border-slate-100 lg:col-span-2 lg:border-l lg:border-t-0">
            {selectedLoc ? (
              <LocalityFirms
                key={`${judet}-${selectedLoc}-${preset}`}
                token={token}
                judet={judet}
                localitate={selectedLoc}
                caenParam={caenParam}
                inBasket={inBasket}
                onToggleStop={toggleStop}
                onClose={() => setSelectedLoc(null)}
                onVisitSaved={() => {
                  setVisitsToday((v) => v + 1);
                  loadDue();
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
                <a
                  href={gmapsRoute(basket, judet)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  Pornește ruta
                </a>
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
                  dueClients.slice(0, 40).map((d) => ({
                    cui: d.cui,
                    denumire: d.denumire,
                    adresa: d.adresa,
                    localitate: d.localitate,
                    telefon: d.telefon,
                  })),
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
              .map((r) => (
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
                    </p>
                  </button>
                  <a
                    href={gmapsRoute(r.stops, judet)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md p-1.5 text-indigo-600 hover:bg-indigo-50"
                    title="Pornește"
                  >
                    <Navigation className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteRoute(r.id)}
                    className="rounded-md p-1.5 text-slate-400 hover:text-rose-500"
                    title="Șterge"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pete albe */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BedDouble className="h-4 w-4 text-amber-500" />
            Cele mai mari pete albe din{" "}
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
                onClick={() => setSelectedLoc(l.localitate)}
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
  caenParam,
  inBasket,
  onToggleStop,
  onClose,
  onVisitSaved,
  showToast,
}: {
  token: string;
  judet: string;
  localitate: string;
  caenParam: string;
  inBasket: Set<string>;
  onToggleStop: (f: Firm) => void;
  onClose: () => void;
  onVisitSaved: () => void;
  showToast: (msg: string) => void;
}) {
  const [firms, setFirms] = useState<Firm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [visitFor, setVisitFor] = useState<Firm | null>(null);
  const [orderFor, setOrderFor] = useState<Firm | null>(null);

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
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cui: f.cui,
          denumire: f.denumire,
          result,
          note,
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
      // Reflectăm local noul status.
      setFirms((fs) =>
        fs.map((x) =>
          x.cui === f.cui
            ? {
                ...x,
                status:
                  result === "client"
                    ? "client"
                    : result === "nu_vrea"
                      ? "respins"
                      : result === "inchis"
                        ? x.status
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
    <div className="flex h-[420px] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">
            {localitate}
          </p>
          <p className="text-xs text-slate-500">
            {loading ? "se încarcă..." : `${fmt(total)} firme active`}
          </p>
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
          <ul className="divide-y divide-slate-100">
            {firms.map((f) => (
              <li key={f.cui} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                      <span className="truncate">{f.denumire}</span>
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
                    </p>
                    <p className="truncate text-xs text-slate-500">
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
                  <button
                    type="button"
                    onClick={() => setOrderFor(f)}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    🛒 Comandă
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisitFor(visitFor?.cui === f.cui ? null : f)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                  >
                    <ClipboardList className="h-3 w-3" />
                    Am fost
                  </button>
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
    </div>
  );
}

function VisitButtons({
  onPick,
  onCancel,
}: {
  onPick: (result: string, note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2">
      <div className="grid grid-cols-1 gap-1.5">
        {VISIT_RESULTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onPick(v.id, note)}
            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300"
          >
            <span>{v.emoji}</span>
            {v.label}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notă (opțional): revin marți, cere ofertă..."
        className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={onCancel}
        className="mt-1 text-xs text-slate-500 hover:text-slate-700"
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
