"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin } from "lucide-react";
import { COUNTY_LIST, TARGET_CAEN } from "@/modules/prospects";

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

function normLoc(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Harta „pete albe": bule per localitate cu firmele active din baza MF.
 *   verde  = ai deja clienți acolo (potriviți după numele din XLS)
 *   galben = piață neacoperită — prospecți există, clienți zero
 */
export default function MapPanel({
  token,
  clients,
}: {
  token: string;
  clients: string[];
}) {
  const [judet, setJudet] = useState("SV");
  const [onlyFmcg, setOnlyFmcg] = useState(true);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ L: typeof LType; map: LType.Map; layer: LType.LayerGroup } | null>(null);
  const geocodeRound = useRef(0);

  const caenParam = onlyFmcg ? Object.keys(TARGET_CAEN).join(",") : "";

  // Localitățile (normalizate) în care avem clienți potriviți, per județ.
  const clientLocalities = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of matches) {
      if (m.judet !== judet || !m.localitate) continue;
      const key = normLoc(m.localitate);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [matches, judet]);

  // 1) Potrivirea clienți ↔ firme MF — o singură dată per set de clienți.
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
        // fără potriviri — harta rămâne doar cu prospecți
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, clients]);

  // 2) Datele hărții + geocodare progresivă în fundal.
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
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
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

    (async () => {
      try {
        // Întâi instant din cache, apoi geocodare în valuri (8/cerere).
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
          // Dacă o rundă nu a avansat deloc (rețea căzută), ne oprim.
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

  // 3) Harta Leaflet — inițializată o dată, actualizată la fiecare schimbare.
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
        const radius = Math.max(6, Math.min(26, 4 + Math.sqrt(loc.count) * 1.6));
        const marker = L.circleMarker([loc.lat, loc.lng], {
          radius,
          color: isCovered ? "#059669" : "#d97706",
          fillColor: isCovered ? "#10b981" : "#f59e0b",
          fillOpacity: 0.55,
          weight: 1.5,
        });
        marker.bindPopup(
          `<strong>${loc.localitate}</strong><br/>` +
            `${fmt(loc.count)} firme active${onlyFmcg ? " (alimentare/tutun/baruri)" : ""}<br/>` +
            `${fmt(loc.cuTelefon)} cu telefon<br/>` +
            (isCovered
              ? `<span style="color:#059669">✓ ${clientCount} clienți ai tăi aici</span>`
              : `<span style="color:#d97706">⚠ Pată albă — zero clienți</span>`),
        );
        marker.addTo(layer);
        bounds.push([loc.lat, loc.lng]);
      }
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [localities, clientLocalities, onlyFmcg]);

  // Curățenie la demontare.
  useEffect(
    () => () => {
      leafletRef.current?.map.remove();
      leafletRef.current = null;
    },
    [],
  );

  const whiteSpots = useMemo(
    () =>
      localities
        .filter((l) => !clientLocalities.has(normLoc(l.localitate)))
        .slice(0, 12),
    [localities, clientLocalities],
  );
  const coveredCount = localities.length - whiteSpots.length;

  return (
    <div className="card overflow-hidden">
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
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyFmcg}
            onChange={(e) => setOnlyFmcg(e.target.checked)}
            className="rounded border-slate-300"
          />
          Doar alimentare, băuturi, tutun, baruri
        </label>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
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

      <div className="relative">
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

      <div className="border-t border-slate-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-amber-500" />
            Cele mai mari pete albe din{" "}
            {COUNTY_LIST.find((c) => c.code === judet)?.name ?? judet}
          </h4>
          <p className="text-xs text-slate-500">
            {coveredCount} localități acoperite · {whiteSpots.length}+ fără
            niciun client
          </p>
        </div>
        {matches.length === 0 && clients.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Niciun client din XLS potrivit încă cu baza de firme — potrivirea
            se face pe denumirea oficială (ex. „MARA COM SRL").
          </p>
        )}
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {whiteSpots.map((l) => (
            <li
              key={l.localitate}
              className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2"
            >
              <p className="truncate text-sm font-medium text-slate-800">
                {l.localitate}
              </p>
              <p className="text-xs text-slate-600">
                {fmt(l.count)} firme active · {fmt(l.cuTelefon)} cu telefon ·
                0 clienți
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Caută localitatea în secțiunea Prospecți ca să vezi lista completă de
          firme, cu telefon și adresă.
        </p>
      </div>
    </div>
  );
}
