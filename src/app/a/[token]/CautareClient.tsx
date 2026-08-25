"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { navAddress } from "@/lib/route-nav";
import OrderModal from "./OrderModal";
import { VisitButtons, gmapsDir, type Firm } from "./MapPanel";

/**
 * CĂUTAREA DE CLIENȚI DE PE PRIMA PAGINĂ — cerută de agenți pe grup:
 * „nu găsesc clienții pe care îi cunosc și pe la care trec mereu".
 *
 * Scrii două litere din numele clientului (sau satul) și apar imediat —
 * CLIENȚII TĂI primii — cu exact aceleași butoane ca pe hartă: Am fost
 * (cu dictare), Comandă, Navighează, Sună. Fără să mai cauți prin sate.
 */

export default function CautareClient({
  token,
  onVisitSaved,
}: {
  token: string;
  /** Bifarea unei vizite de AICI trebuie să reîmprospăteze restul
   *  panoului (ziua, scadenții, ruta) — altfel „Continuă ruta" l-ar
   *  trimite pe agent înapoi la clientul pe care tocmai l-a bifat. */
  onVisitSaved?: () => void;
}) {
  const [q, setQ] = useState("");
  const [rezultate, setRezultate] = useState<Firm[]>([]);
  const [cautand, setCautand] = useState(false);
  const [eroare, setEroare] = useState<string | null>(null);
  // Numărul cererii: dacă un răspuns vechi ajunge după unul nou, îl
  // ignorăm (altfel lista ar sări înapoi la ce s-a scris înainte).
  const cerereRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [visitFor, setVisitFor] = useState<Firm | null>(null);
  const [orderFor, setOrderFor] = useState<Firm | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  // Căutare „pe măsură ce scrii", cu pauză de 350ms ca să nu bombardăm
  // serverul la fiecare literă.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const text = q.trim();
    if (text.length < 2) {
      cerereRef.current++;
      abortRef.current?.abort();
      setRezultate([]);
      setEroare(null);
      setCautand(false);
      return;
    }
    setCautand(true);
    setEroare(null);
    timerRef.current = setTimeout(async () => {
      const alMeu = ++cerereRef.current;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const params = new URLSearchParams({
          token,
          search: text,
          limit: "8",
          onlyActive: "1",
          // Clienții MEI primii și mereu vizibili, peste orice filtru.
          aiMei: "1",
        });
        const res = await fetch(`/api/prospects?${params}`, { signal: ctrl.signal });
        if (alMeu !== cerereRef.current) return; // a venit deja un răspuns mai nou
        if (!res.ok) {
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          setRezultate([]);
          setEroare(
            res.status === 401
              ? "Linkul tău a expirat — cere-i managerului unul nou."
              : (d?.error ?? "Nu am putut căuta acum. Încearcă din nou."),
          );
          return;
        }
        const data = (await res.json()) as { prospects?: Firm[] };
        if (alMeu !== cerereRef.current) return;
        setRezultate(data.prospects ?? []);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (alMeu !== cerereRef.current) return;
        setRezultate([]);
        setEroare("Fără internet acum — încearcă din nou când ai semnal.");
      } finally {
        if (alMeu === cerereRef.current) setCautand(false);
      }
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, token]);

  async function saveVisit(f: Firm, result: string, note: string) {
    try {
      // Poziția GPS din momentul vizitei — pinul firmei devine exact.
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
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(data?.error ?? "Eroare la salvare");
        return;
      }
      setVisitFor(null);
      showToast("Vizită salvată ✓");
      onVisitSaved?.();
      setRezultate((rs) =>
        result === "inchis"
          ? rs.filter((x) => x.cui !== f.cui)
          : rs.map((x) =>
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
    <div className="card relative p-4">
      <div className="flex items-center gap-2">
        <Search className="h-5 w-5 shrink-0 text-indigo-500" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Caută un client: nume sau localitate..."
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:border-indigo-400 focus:outline-none"
          autoComplete="off"
        />
        {cautand && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      {eroare && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {eroare}
        </p>
      )}

      {!eroare && q.trim().length >= 2 && !cautand && rezultate.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Nimic găsit pentru „{q.trim()}". Încearcă doar o parte din nume
          (ex. „oliver" în loc de „Oliver Market SRL").
        </p>
      )}

      {rezultate.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {rezultate.map((f) => (
            <li key={f.cui} className="min-w-0 py-2.5">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                <span className="min-w-0 break-words">{f.denumire}</span>
                {f.status === "client" && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    client
                  </span>
                )}
                {f.soldCents !== null && f.soldCents > 0 && (
                  <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    restanță
                  </span>
                )}
              </p>
              <p className="break-words text-xs text-slate-500">
                {[f.adresa, f.localitate].filter(Boolean).join(", ") || "fără adresă"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setVisitFor(visitFor?.cui === f.cui ? null : f)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  🎤 Am fost
                </button>
                <button
                  type="button"
                  onClick={() => setOrderFor(f)}
                  className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
                >
                  🛒 Comandă
                </button>
                <a
                  href={gmapsDir(navAddress(f))}
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  🧭 Navighează
                </a>
                {f.telefon && (
                  <a
                    href={`tel:${f.telefon}`}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    📞 Sună
                  </a>
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

      <OrderModal
        token={token}
        firm={orderFor}
        onClose={() => setOrderFor(null)}
        onSent={(msg) => {
          setOrderFor(null);
          showToast(msg);
        }}
      />

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-2 z-10 flex justify-center">
          <span className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
            {toast}
          </span>
        </div>
      )}
    </div>
  );
}
