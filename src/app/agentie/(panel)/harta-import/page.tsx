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
interface Automat {
  automat: true;
  scrise: number;
  totalPuncte: number;
  totalClienti: number;
  totalDinRegistru?: number;
  clientiCuLoc?: number;
  magazineSalvate?: number;
  /** Câte pinuri aveau CUI scris în ele — cifra care spune dacă harta
      e „cu tabel" (potrivire exactă) sau doar cu nume (ghicit). */
  pinuriCuCui?: number;
  adreseCuNumar?: number;
  adreseScrise?: number;
  sarite?: { faraLocPeHarta: number; inafara: number; liniiSiZone: number };
  nepotrivite: Rand[];
}
/** O treabă din coada OpenStreetMap: un județ. */
interface Treaba {
  judet: string;
  stare: string;
  motiv: string;
  magazine: number;
  locuri: number;
  noi: number;
  eroare: string;
}
interface RaspunsOSM {
  facut: {
    judet: string;
    magazine: number;
    locuriPuse: number;
    magazineNoi: number;
    deja: number;
    eroare?: string;
  } | null;
  ramase: number;
  plan: Treaba[];
}
interface Verificare {
  totalPuncte: number;
  totalClienti: number;
  sarite?: { faraLocPeHarta: number; inafara: number; liniiSiZone: number };
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

  const [gata, setGata] = useState<Automat | null>(null);
  const [osm, setOsm] = useState<RaspunsOSM | null>(null);
  /** Ce face acum, cu vorbele lui: „citesc harta", „caut în Suceava"… */
  const [pas, setPas] = useState("");

  /**
   * „Fă tot singur": aduce harta, leagă ce e sigur și SCRIE. Nimeni nu se
   * uită la 2450 de rânduri — deci nu-l punem. Ce rămâne nesigur i se
   * arată după, scurt, iar totul se poate da înapoi dintr-un buton.
   *
   * Tot aici, FĂRĂ alt buton, aduce și magazinele de pe OpenStreetMap:
   * alea la care n-a ajuns nimeni. Vin în cereri separate doar pentru că
   * serviciul lor e lent — omul tot o apăsare face.
   */
  async function automat() {
    setLucreaza(true);
    setEroare(null);
    setMesaj(null);
    setV(null);
    setGata(null);
    setOsm(null);
    try {
      // 1) Harta firmei, dacă are una. Fără link, sărim direct la OSM.
      if (link.trim() !== "" || kml.trim() !== "") {
        setPas("Citesc harta ta…");
        const d = await api<Automat>("/api/agentie/harta-import", {
          method: "POST",
          body: JSON.stringify({ link, kml, automat: true }),
        });
        setGata(d);
      }

      // 2) Magazinele de pe OpenStreetMap, câte un județ pe cerere. Un
      // județ întreg se ia în zeci de secunde de la un serviciu public;
      // fiecare primește ceasul lui, altfel primul îl mănâncă pe restul.
      // Cine n-apucă acum se ia noaptea, de cron, din aceeași coadă.
      setPas("Caut magazine pe OpenStreetMap…");
      for (let tura = 0; tura < 20; tura++) {
        const r = await api<{ osm: RaspunsOSM }>("/api/agentie/harta-import", {
          method: "POST",
          body: JSON.stringify({ osm: true }),
        });
        setOsm(r.osm);
        if (!r.osm.facut || r.osm.ramase === 0) break;
        setPas(
          `Am terminat ${r.osm.facut.judet}. Mai caut în ${r.osm.ramase} ${
            r.osm.ramase === 1 ? "județ" : "județe"
          }…`,
        );
      }
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setPas("");
      setLucreaza(false);
    }
  }

  async function anuleaza() {
    if (!confirm("Șterg locurile aduse din hartă. Cele puse de agenți din teren rămân. Continui?")) return;
    setLucreaza(true);
    setEroare(null);
    try {
      const d = await api<{ sterse: number }>("/api/agentie/harta-import", {
        method: "POST",
        body: JSON.stringify({ anuleaza: true }),
      });
      setGata(null);
      setOsm(null);
      setV(null);
      setMesaj(`Am șters ${d.sterse} locuri aduse din hartă. Ce au pus agenții pe teren n-am atins.`);
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setLucreaza(false);
    }
  }

  async function verifica() {
    setLucreaza(true);
    setEroare(null);
    setMesaj(null);
    setV(null);
    setOsm(null);
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
          Adu locațiile magazinelor
        </h1>
        <p className="mt-1 max-w-2xl break-words text-sm leading-snug text-slate-600">
          O apăsare aduce tot ce se poate: harta ta cu magazinele puse de mână
          (dacă ai una) <b>și</b> magazinele pe care le-au pus alți oameni pe
          OpenStreetMap — alea la care n-a ajuns încă niciun agent de-al tău.
          De atunci, agenții navighează pe coordonate exacte, nu pe adresa din
          registru: îi duce la ușă, nu în centrul satului.
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={automat}
            disabled={lucreaza}
            className="min-h-11 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {/* Butonul își ține mărimea: dacă i-am pune textul de progres
                înăuntru, s-ar lăți la fiecare județ și ar sări tot rândul
                de butoane sub degetul omului. Progresul stă dedesubt. */}
            {lucreaza ? "Lucrez..." : "Adu locațiile (fă tot singur)"}
          </button>
          <Button onClick={verifica} disabled={lucreaza || (!link.trim() && !kml.trim())}>
            Vreau să văd întâi lista
          </Button>
          <button
            type="button"
            onClick={anuleaza}
            disabled={lucreaza}
            className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Anulează ce am adus
          </button>
        </div>
        {lucreaza && pas && (
          <p className="mt-2 flex items-center gap-2 break-words text-sm font-medium leading-snug text-emerald-800">
            <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
            {pas}
          </p>
        )}
        <p className="mt-2 break-words text-xs leading-snug text-slate-500">
          „Fă tot singur" pune locurile unde numele se potrivește exact —
          restul ți le arată, scurt. Merge și fără link: atunci aduce doar
          magazinele de pe OpenStreetMap. Ce au pus agenții din teren nu se
          atinge, iar tot ce aduce se poate șterge cu „Anulează".
        </p>
      </Card>

      {eroare && <Alert kind="error">{eroare}</Alert>}
      {mesaj && <Alert kind="success">{mesaj}</Alert>}

      {gata && (
        <Card>
          <p className="break-words text-sm leading-snug text-slate-800">
            ✅ Gata. Am pus locul exact la <b>{gata.scrise}</b> magazine, din{" "}
            <b>{gata.totalPuncte}</b> câte are harta.
          </p>
          {gata.clientiCuLoc !== undefined && (
            <p className="mt-1 break-words text-sm font-medium leading-snug text-emerald-800">
              Dintre clienții tăi, <b>{gata.clientiCuLoc}</b> au acum locul
              exact pe hartă.
            </p>
          )}
          {/* CE ERA ÎN PINURI. Fără rândul ăsta nu se poate ști de ce a
              ieșit cât a ieșit — dacă harta are CUI-uri, potrivirea e
              exactă; dacă nu, se ghicește după nume, ca înainte. */}
          <p className="mt-2 break-words rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-700">
            Ce era scris în pinuri:{" "}
            {gata.pinuriCuCui === undefined ? (
              <span className="text-slate-500">(harta veche, fără tabel)</span>
            ) : gata.pinuriCuCui > 0 ? (
              <>
                <b className="text-emerald-700">{gata.pinuriCuCui}</b> pinuri au
                CUI-ul scris în ele — pe alea nu le-am ghicit după nume, le-am
                legat exact.
              </>
            ) : (
              <>
                <b>niciun pin n-are CUI</b>. Harta asta are doar nume pe pinuri,
                deci potrivirea se face după nume, cum se poate.
              </>
            )}
            {(gata.adreseCuNumar ?? 0) > 0 && (
              <>
                {" "}
                Și <b className="text-emerald-700">{gata.adreseCuNumar}</b> pinuri
                aveau adresa cu număr de casă
                {(gata.adreseScrise ?? 0) > 0 && (
                  <> — am pus-o la {gata.adreseScrise} firme, de acolo navighează agenții</>
                )}
                .
              </>
            )}
          </p>
          <p className="mt-1 break-words text-xs leading-snug text-slate-500">
            Agenții le văd la următoarea deschidere a hărții. „Navighează" îi
            duce acum la ușă, nu în centrul satului.
            {gata.sarite && gata.sarite.faraLocPeHarta > 0 && (
              <>
                {" "}
                Din hartă, <b>{gata.sarite.faraLocPeHarta}</b> firme erau
                trecute în listă dar niciodată puse pe ea — alea n-au
                coordonate de adus.
              </>
            )}
          </p>
          {(gata.magazineSalvate ?? 0) > 0 && (
            <p className="mt-2 break-words rounded-lg bg-violet-50 p-3 text-sm leading-snug text-violet-900">
              🟣 Am păstrat și <b>{gata.magazineSalvate}</b> magazine din hartă
              care nu sunt în listele tale. Nu-s pierdute: sunt magazine
              adevărate, cu locul pus de mână. Agenții le văd pe hartă cu
              butonul „Magazine de prospectat" și au drumul gata știut —
              bune de prospectat. Când ajung acolo, spun dacă magazinul mai
              există sau nu.
            </p>
          )}
          {gata.nepotrivite.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer break-words text-sm font-medium leading-snug text-amber-700">
                {gata.nepotrivite.length} n-am putut lega de o firmă din
                listele tale — apasă dacă vrei să te uiți (nu e obligatoriu)
              </summary>
              <ul className="mt-2 divide-y divide-slate-100">
                {gata.nepotrivite.slice(0, 200).map((n) => (
                  <li key={n.nume + n.lat} className="py-2">
                    <p className="break-words text-sm leading-snug text-slate-900">
                      <b>{n.nume}</b>
                    </p>
                    <p className="break-words text-xs leading-snug text-amber-700">
                      {n.motiv}
                    </p>
                  </li>
                ))}
              </ul>
              {gata.nepotrivite.length > 200 && (
                <p className="mt-2 text-xs text-slate-500">
                  …și încă {gata.nepotrivite.length - 200}.
                </p>
              )}
            </details>
          )}
        </Card>
      )}

      {osm && (
        <Card>
          <p className="break-words text-sm leading-snug text-slate-800">
            🗺️ Caut și pe <b>OpenStreetMap</b> — magazinele puse acolo de
            oameni care au trecut pe drum. Merg județ cu județ: întâi unde ai
            clienți, apoi vecinii din Moldova.
          </p>
          {(() => {
            const gata = osm.plan.filter((t) => t.stare === "gata");
            const noi = gata.reduce((s, t) => s + t.noi, 0);
            const locuri = gata.reduce((s, t) => s + t.locuri, 0);
            return (
              <>
                {noi > 0 && (
                  <p className="mt-2 break-words rounded-lg bg-cyan-50 p-3 text-sm leading-snug text-cyan-900">
                    🔵 <b>{noi}</b> magazine de prospectat, cu locul exact.
                    Agenții le văd pe hartă la „Magazine de prospectat". Când
                    ajung acolo, spun dacă magazinul mai există.
                  </p>
                )}
                {locuri > 0 && (
                  <p className="mt-1 break-words text-sm font-medium leading-snug text-emerald-800">
                    Și <b>{locuri}</b> firme din listele tale au primit locul
                    exact de acolo.
                  </p>
                )}
              </>
            );
          })()}
          {osm.ramase > 0 && (
            <p className="mt-2 break-words rounded-lg bg-amber-50 p-3 text-xs leading-snug text-amber-900">
              Mai sunt <b>{osm.ramase}</b>{" "}
              {osm.ramase === 1 ? "județ" : "județe"} de căutat. Nu trebuie să
              stai după ele: se aduc singure peste noapte. Sau apeși din nou,
              oricând — continuă de unde a rămas, nu ia totul de la capăt.
            </p>
          )}
          <ul className="mt-3 space-y-1">
            {osm.plan.map((t) => (
              <li
                key={t.judet}
                className="flex flex-wrap items-baseline gap-x-2 break-words text-xs leading-snug"
              >
                <b className="text-slate-800">{t.judet}</b>
                {t.motiv === "clienti" ? (
                  <span className="text-slate-500">ai clienți aici</span>
                ) : (
                  <span className="text-slate-400">vecin</span>
                )}
                {t.stare === "gata" && (
                  <span className="text-emerald-700">
                    ✓ {t.magazine} citite
                    {t.noi > 0 && ` · ${t.noi} noi de prospectat`}
                    {t.locuri > 0 && ` · ${t.locuri} firme cu loc`}
                  </span>
                )}
                {t.stare === "picat" && (
                  <span className="text-amber-700">
                    n-a mers ({t.eroare || "serverul e ocupat"}) — se mai
                    încearcă singur
                  </span>
                )}
                {t.stare === "de_facut" && (
                  <span className="text-slate-400">la rând</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

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
            {v.sarite &&
              (v.sarite.faraLocPeHarta > 0 || v.sarite.inafara > 0) && (
                <p className="mt-2 break-words text-xs leading-snug text-slate-500">
                  Din hartă n-am putut lua:{" "}
                  {v.sarite.faraLocPeHarta > 0 && (
                    <>
                      <b>{v.sarite.faraLocPeHarta}</b> firme trecute în listă
                      dar niciodată puse pe hartă
                    </>
                  )}
                  {v.sarite.faraLocPeHarta > 0 && v.sarite.inafara > 0 && ", "}
                  {v.sarite.inafara > 0 && (
                    <>
                      <b>{v.sarite.inafara}</b> cu locul greșit (0,0 sau în
                      afara țării)
                    </>
                  )}
                  . Alea n-au coordonate de adus — le pun agenții din teren, cu
                  „Sunt aici".
                </p>
              )}
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
