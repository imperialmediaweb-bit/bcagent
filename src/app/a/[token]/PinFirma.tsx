"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { Crosshair, MapPin, X } from "lucide-react";

/**
 * LOCUL EXACT AL MAGAZINULUI, pus de agent.
 *
 * Registrul dă sediul social, geocodarea dă centrul satului — pinul cade
 * „undeva prin sat", nu la ușă („avem șanse ca locația să fie mai
 * exactă?" — Costin Vlad, din teren). Aici agentul îl pune el:
 *
 *   · trage pinul cu degetul pe hartă, până e fix pe magazin;
 *   · sau apasă „Sunt aici acum" și ia poziția telefonului;
 *   · sau șterge ce a pus, dacă a greșit — firma revine în centrul satului.
 *
 * Harta se încarcă abia când se deschide fereastra: pe teren, fiecare
 * megabyte descărcat degeaba e din abonamentul agentului.
 */

export interface FirmaPin {
  cui: string;
  denumire: string;
  adresa?: string;
  localitate?: string;
  lat?: number | null;
  lng?: number | null;
  /** Firma are DEJA un loc pus de om — doar atunci se poate șterge ceva. */
  arePinPropriu?: boolean;
}

/** Centrul județelor în care lucrăm, dacă n-avem absolut nimic. */
const CENTRU_IMPLICIT: [number, number] = [47.65, 26.25];

export default function PinFirma({
  token,
  firma,
  onClose,
  onSalvat,
}: {
  token: string;
  firma: FirmaPin | null;
  onClose: () => void;
  /** Coordonatele noi (sau null la ștergere) — harta din spate se redesenează. */
  onSalvat: (cui: string, lat: number | null, lng: number | null) => void;
}) {
  const cutie = useRef<HTMLDivElement | null>(null);
  const harta = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [pozitie, setPozitie] = useState<[number, number] | null>(null);
  const [ocupat, setOcupat] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);
  const [caut, setCaut] = useState(false);

  // Părintele construiește obiectul `firma` la fiecare randare, deci
  // depinderea de EL ar distruge și ar reface harta din te miri ce (un
  // toast, un buton apăsat) — chiar sub degetul care trage pinul. Ne legăm
  // de valori simple, care nu se schimbă degeaba.
  const cui = firma?.cui ?? "";
  const latStart = firma?.lat ?? null;
  const lngStart = firma?.lng ?? null;

  useEffect(() => {
    if (!cui || !cutie.current) return;
    let viu = true;
    const stiuSatul = latStart != null && lngStart != null;
    const start: [number, number] = stiuSatul
      ? [latStart, lngStart]
      : CENTRU_IMPLICIT;

    (async () => {
      const L = (await import("leaflet")).default;
      if (!viu || !cutie.current) return;
      const m = L.map(cutie.current, {
        center: start,
        // Zoom mare: la nivelul ăsta se văd casele, deci se poate nimeri ușa.
        zoom: stiuSatul ? 17 : 12,
        zoomControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(m);

      const icoana = L.divIcon({
        className: "",
        html: `<div style="font-size:34px;line-height:34px;transform:translate(-50%,-100%)">📍</div>`,
        iconSize: [0, 0],
      });
      const p = L.marker(start, { draggable: true, icon: icoana }).addTo(m);
      p.on("dragend", () => {
        const ll = p.getLatLng();
        setPozitie([ll.lat, ll.lng]);
        setMesaj(null);
      });
      // Se poate și fără să tragi: apeși pe hartă și pinul sare acolo.
      m.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        p.setLatLng(e.latlng);
        setPozitie([e.latlng.lat, e.latlng.lng]);
        setMesaj(null);
      });

      harta.current = m;
      pin.current = p;
      setPozitie(start);
      if (!stiuSatul) {
        setMesaj(null);
        setEroare(
          "Nu știu încă unde e satul ăsta pe hartă. Caută magazinul cu degetul (trage harta) și pune pinul pe el.",
        );
      }
      // Chenarul are dimensiune abia după ce fereastra s-a deschis.
      setTimeout(() => m.invalidateSize(), 200);
    })();

    return () => {
      viu = false;
      harta.current?.remove();
      harta.current = null;
      pin.current = null;
      setPozitie(null);
      setMesaj(null);
      setEroare(null);
    };
  }, [cui, latStart, lngStart]);

  if (!firma) return null;

  /** „Sunt aici acum": ia poziția telefonului și mută pinul acolo. */
  function suntAici() {
    if (!navigator.geolocation) {
      setEroare("Telefonul ăsta nu-mi dă poziția. Trage pinul cu degetul.");
      return;
    }
    setCaut(true);
    setEroare(null);
    setMesaj(null);
    navigator.geolocation.getCurrentPosition(
      (poz) => {
        setCaut(false);
        const { latitude, longitude, accuracy } = poz.coords;
        if (accuracy > 250) {
          setEroare(
            `Telefonul știe unde ești doar cu aproximație (${Math.round(accuracy)} m). Ieși din magazin, așteaptă puțin — sau pune pinul cu degetul.`,
          );
          return;
        }
        pin.current?.setLatLng([latitude, longitude]);
        harta.current?.setView([latitude, longitude], 18);
        setPozitie([latitude, longitude]);
        setMesaj(`Te-am găsit (±${Math.round(accuracy)} m). Verifică pinul și salvează.`);
      },
      () => {
        setCaut(false);
        setEroare(
          "Nu-mi dai voie la locație. Dă-i voie din setările telefonului sau trage pinul cu degetul.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  async function salveaza() {
    if (!pozitie) return;
    setOcupat(true);
    setEroare(null);
    try {
      const r = await fetch("/api/prospects/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cui: firma!.cui,
          lat: pozitie[0],
          lng: pozitie[1],
          sursa: "deget",
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setEroare(d.error ?? `Eroare ${r.status}`);
        return;
      }
      onSalvat(firma!.cui, pozitie[0], pozitie[1]);
      onClose();
    } catch {
      setEroare("Fără semnal — încearcă din nou când prinzi rețea.");
    } finally {
      setOcupat(false);
    }
  }

  async function sterge() {
    setOcupat(true);
    setEroare(null);
    try {
      const r = await fetch("/api/prospects/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, cui: firma!.cui, sterge: true }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) {
        setEroare(d.error ?? `Eroare ${r.status}`);
        return;
      }
      onSalvat(firma!.cui, null, null);
      onClose();
    } catch {
      setEroare("Fără semnal — încearcă din nou când prinzi rețea.");
    } finally {
      setOcupat(false);
    }
  }

  // ATENȚIE: nu „are coordonate de pornire" (alea pot fi centrul satului),
  // ci „are un loc pus de om" — altfel butonul de ștergere apărea la orice
  // firmă dintr-un sat geocodat și promitea ceva ce n-avea ce șterge.
  const arePin = firma.arePinPropriu === true;

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 break-words text-sm font-semibold leading-snug text-slate-900">
              <MapPin className="h-4 w-4 shrink-0 text-rose-600" />
              Unde e magazinul?
            </h3>
            <p className="mt-0.5 break-words text-xs leading-snug text-slate-500">
              {firma.denumire}
              {firma.localitate ? ` · ${firma.localitate}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="break-words px-4 pt-3 text-xs leading-snug text-slate-600">
            Trage pinul 📍 cu degetul până e fix pe magazin (sau apasă pe
            hartă unde trebuie). De data viitoare, navigația te duce exact
            acolo, nu în centrul satului.
          </p>
          <div
            ref={cutie}
            className="mt-2 h-[46vh] min-h-[240px] w-full bg-slate-100"
          />

          <div className="space-y-2 px-4 py-3">
            <button
              type="button"
              onClick={suntAici}
              disabled={caut || ocupat}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Crosshair className="h-4 w-4 shrink-0" />
              {caut ? "Te caut…" : "Sunt aici acum (ia poziția telefonului)"}
            </button>
            {mesaj && (
              <p className="break-words text-xs font-medium leading-snug text-emerald-700">
                {mesaj}
              </p>
            )}
            {eroare && (
              <p className="break-words rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium leading-snug text-rose-700">
                {eroare}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={salveaza}
            disabled={ocupat || !pozitie}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {ocupat ? "Salvez…" : "Salvează locul"}
          </button>
          {arePin && (
            <button
              type="button"
              onClick={sterge}
              disabled={ocupat}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Șterge locul pus
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
