"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Alert, Button, Card, api } from "@/app/platform/ui";

/**
 * IMPORTĂ LOCAȚIILE DIN GOOGLE MY MAPS.
 *
 * „Aveam linkul ăsta de la firma veche… cu locații mai actualizate. Poate
 * îl poți integra." (Bogdan, 26.08). Pe harta aia magazinele sunt puse de
 * mână, punct cu punct — cele mai bune coordonate care există.
 *
 * Aici le aducem, dar NICIODATĂ pe încredere: lipești linkul, vezi
 * negru pe alb ce pin a fost legat de ce firmă și DE CE, debifezi ce nu-ți
 * convine, și abia atunci se salvează. Un pin pus greșit trimite agentul
 * la altă adresă, iar el va crede aplicația, nu ochii.
 */

interface Rand {
  nume: string;
  strat: string;
  lat: number;
  lng: number;
  cui: string;
  denumire: string;
  localitate: string;
  scor: number;
  motiv: string;
  variante: Array<{ cui: string; denumire: string; localitate: string }>;
}
interface Verificare {
  totalPuncte: number;
  totalClienti: number;
  gasite: Rand[];
  nepotrivite: Rand[];
}

export default function HartaImportPage() {
  const [link, setLink] = useState("");
  /** Fișierul KML, când linkul nu merge (harta nepublică, Google mut). */
  const [kml, setKml] = useState("");
  const [lucreaza, setLucreaza] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [v, setV] = useState<Verificare | null>(null);
  /** Ce am debifat: pinurile alea nu se salvează. */
  const [scoase, setScoase] = useState<Set<string>>(new Set());
  /** Ce am ales manual pentru pinurile nepotrivite: nume pin → CUI. */
  const [alese, setAlese] = useState<Record<string, string>>({});

  async function verifica() {
    setLucreaza(true);
    setEroare(null);
    setMesaj(null);
    setV(null);
    setScoase(new Set());
    setAlese({});
    try {
      const d = await api<Verificare>("/api/agentie/harta-import", {
        method: "POST",
        body: JSON.stringify({ link, kml, verificaDoar: true }),
      });
      setV(d);
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setLucreaza(false);
    }
  }

  async function salveaza() {
    if (!v) return;
    const confirmate = [
      ...v.gasite
        .filter((g) => !scoase.has(g.nume))
        .map((g) => ({ cui: g.cui, lat: g.lat, lng: g.lng })),
      ...v.nepotrivite
        .filter((n) => alese[n.nume])
        .map((n) => ({ cui: alese[n.nume], lat: n.lat, lng: n.lng })),
    ];
    if (confirmate.length === 0) {
      setEroare("N-ai lăsat bifat niciun magazin — n-am ce salva.");
      return;
    }
    setLucreaza(true);
    setEroare(null);
    try {
      const d = await api<{ scrise: number; sarite: number }>(
        "/api/agentie/harta-import",
        { method: "POST", body: JSON.stringify({ confirmate }) },
      );
      setMesaj(
        `Gata — am pus locul exact la ${d.scrise} magazine.` +
          (d.sarite > 0 ? ` ${d.sarite} au fost sărite (nu sunt ale firmei tale).` : "") +
          " Agenții le văd la următoarea deschidere a hărții.",
      );
      setV(null);
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setLucreaza(false);
    }
  }

  const deSalvat = v
    ? v.gasite.filter((g) => !scoase.has(g.nume)).length +
      v.nepotrivite.filter((n) => alese[n.nume]).length
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <MapPin className="h-5 w-5 text-rose-600" />
          Adu locațiile din Google My Maps
        </h1>
        <p className="mt-1 max-w-2xl break-words text-sm leading-snug text-slate-600">
          Dacă ai o hartă cu magazinele puse de mână, o aducem aici. De atunci,
          agenții navighează pe coordonate exacte, nu pe adresa din registru —
          îi duce la ușă, nu în centrul satului.
        </p>
      </div>

      <Card>
        <label className="block text-xs font-medium text-slate-500">
          Linkul hărții (Google My Maps → Partajează)
        </label>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.google.com/maps/d/viewer?mid=..."
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <p className="mt-1 break-words text-xs leading-snug text-slate-500">
          Harta trebuie să fie pe „Oricine are linkul poate vedea". Nu se
          schimbă nimic pe harta ta — doar o citim.
        </p>
        {/* PLASA DE SIGURANȚĂ: dacă harta nu e publică sau Google nu
            răspunde, omul poate da direct fișierul. */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            Nu merge linkul? Dă-mi fișierul hărții
          </summary>
          <p className="mt-2 break-words text-xs leading-snug text-slate-500">
            În My Maps: cele trei puncte → Exportă în KML/KMZ → alege un{" "}
            <b>strat</b> (nu „Harta întreagă") și bifează exportul în KML.
            Deschide fișierul cu Notepad și lipește tot aici.
          </p>
          <textarea
            value={kml}
            onChange={(e) => setKml(e.target.value)}
            rows={4}
            placeholder="<?xml version=&quot;1.0&quot;?><kml ...>"
            className="mt-2 block w-full rounded-lg border border-slate-200 p-2 font-mono text-xs focus:border-indigo-400 focus:outline-none"
          />
          <input
            type="file"
            accept=".kml,.xml,text/xml,application/vnd.google-earth.kml+xml"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setEroare(null);
              try {
                setKml(await f.text());
              } catch {
                setEroare("N-am putut citi fișierul. Deschide-l cu Notepad și lipește textul.");
              }
            }}
            className="mt-2 block w-full text-xs"
          />
        </details>
        <div className="mt-3">
          <Button onClick={verifica} disabled={lucreaza || (!link.trim() && !kml.trim())}>
            {lucreaza ? "Citesc harta..." : "Vezi ce am înțeles"}
          </Button>
        </div>
      </Card>

      {eroare && <Alert kind="error">{eroare}</Alert>}
      {mesaj && <Alert kind="success">{mesaj}</Alert>}

      {v && (
        <>
          <Card>
            <p className="break-words text-sm leading-snug text-slate-700">
              Harta are <b>{v.totalPuncte}</b> magazine. Firma ta are{" "}
              <b>{v.totalClienti}</b> clienți. Am legat sigur{" "}
              <b className="text-emerald-700">{v.gasite.length}</b>, iar{" "}
              <b className="text-amber-700">{v.nepotrivite.length}</b> le las în
              seama ta.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={salveaza}
                disabled={lucreaza || deSalvat === 0}
                className="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {lucreaza ? "Salvez..." : `Salvează ${deSalvat} locații`}
              </button>
              <span className="break-words text-xs leading-snug text-slate-500">
                Se scrie doar ce e bifat mai jos. Nimic altceva nu se atinge.
              </span>
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-slate-800">
              Legate sigur ({v.gasite.length}) — debifează ce nu-ți convine
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {v.gasite.map((g) => (
                <li key={g.nume} className="flex items-start gap-2 py-2">
                  <input
                    type="checkbox"
                    checked={!scoase.has(g.nume)}
                    onChange={(e) =>
                      setScoase((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.delete(g.nume);
                        else n.add(g.nume);
                        return n;
                      })
                    }
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm leading-snug text-slate-900">
                      <b>{g.nume}</b>
                      {g.strat && (
                        <span className="text-slate-500"> · {g.strat}</span>
                      )}
                    </p>
                    <p className="break-words text-sm leading-snug text-emerald-800">
                      → {g.denumire}
                      {g.localitate && ` (${g.localitate})`}
                    </p>
                    <p className="break-words text-xs leading-snug text-slate-500">
                      {g.motiv}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {v.nepotrivite.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-slate-800">
                N-am fost sigur ({v.nepotrivite.length}) — alege tu, sau lasă-le
              </h2>
              <p className="mt-1 break-words text-xs leading-snug text-slate-500">
                Aici NU ghicesc: mai bine le pui tu pe câteva, decât să trimit un
                agent la adresa greșită.
              </p>
              <ul className="mt-2 divide-y divide-slate-100">
                {v.nepotrivite.map((n) => (
                  <li key={n.nume} className="py-2">
                    <p className="break-words text-sm leading-snug text-slate-900">
                      <b>{n.nume}</b>
                      {n.strat && <span className="text-slate-500"> · {n.strat}</span>}
                    </p>
                    <p className="break-words text-xs leading-snug text-amber-700">
                      {n.motiv}
                    </p>
                    {n.variante.length > 0 ? (
                      <select
                        value={alese[n.nume] ?? ""}
                        onChange={(e) =>
                          setAlese((a) => ({ ...a, [n.nume]: e.target.value }))
                        }
                        className="mt-1 block w-full min-w-0 rounded-lg border border-slate-200 px-2 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                      >
                        <option value="">— nu-l lega de nimic —</option>
                        {n.variante.map((va) => (
                          <option key={va.cui} value={va.cui}>
                            {va.denumire}
                            {va.localitate ? ` (${va.localitate})` : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="mt-1 break-words text-xs leading-snug text-slate-500">
                        N-am nicio firmă asemănătoare de propus.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
