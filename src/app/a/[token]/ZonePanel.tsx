"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, MapPinned, TriangleAlert } from "lucide-react";

/**
 * ZONELE MELE PE ZILE — scrise de agent, de pe telefon.
 *
 * „Agenții să treacă rutele pe zone acolo — ei știu exact ce zone au, pe
 * zile" (Bogdan, 26.08). Agentul lipește textul exact cum îl are în cap
 * sau pe WhatsApp, aplicația îi arată NEGRU PE ALB ce a înțeles, pe zile,
 * și abia apoi salvează. Ce n-a găsit i-o spune, cu sugestii — nu ghicește
 * în tăcere, că din zona greșită iese ruta greșită.
 */

const ZILE_FRUMOS: Record<string, string> = {
  luni: "Luni",
  marti: "Marți",
  miercuri: "Miercuri",
  joi: "Joi",
  vineri: "Vineri",
  sambata: "Sâmbătă",
  duminica: "Duminică",
  "": "Fără zi",
};
const ORDINE = ["luni", "marti", "miercuri", "joi", "vineri", "sambata", "duminica", ""];

interface Gasit {
  zi: string;
  localitate: string;
  scris: string;
}
interface Negasit {
  scris: string;
  sugestii: string[];
}

export default function ZonePanel({
  token,
  onSalvat,
}: {
  token: string;
  /** „Ziua mea" își reîncarcă zona de azi imediat după salvare. */
  onSalvat?: () => void;
}) {
  const [deschis, setDeschis] = useState(false);
  const [text, setText] = useState("");
  const [gasite, setGasite] = useState<Gasit[] | null>(null);
  const [negasite, setNegasite] = useState<Negasit[]>([]);
  const [acum, setAcum] = useState<Array<{ zi: string; localitate: string }>>([]);
  const [ocupat, setOcupat] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);

  const incarca = useCallback(async () => {
    try {
      const r = await fetch(`/api/routes/zona?token=${encodeURIComponent(token)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { toate?: Array<{ zi: string; localitate: string }> };
      setAcum(d.toate ?? []);
    } catch {
      // fără semnal — reîncercăm la următoarea deschidere
    }
  }, [token]);

  useEffect(() => {
    incarca();
  }, [incarca]);

  async function cere(verificaDoar: boolean) {
    if (text.trim() === "") {
      setEroare("Scrie întâi zonele, pe zile.");
      return;
    }
    setOcupat(true);
    setEroare(null);
    setMesaj(null);
    try {
      const r = await fetch("/api/routes/zona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, text, verificaDoar }),
      });
      const d = (await r.json()) as {
        gasite?: Gasit[];
        negasite?: Negasit[];
        salvate?: number;
        error?: string;
      };
      if (!r.ok) {
        setEroare(d.error ?? `Eroare ${r.status}`);
        return;
      }
      setGasite(d.gasite ?? []);
      setNegasite(d.negasite ?? []);
      if (!verificaDoar) {
        setMesaj(`Gata — ți-am salvat ${d.salvate ?? 0} sate, pe zile.`);
        setText("");
        setGasite(null);
        await incarca();
        onSalvat?.();
      }
    } catch {
      setEroare("Fără semnal — încearcă din nou când prinzi rețea.");
    } finally {
      setOcupat(false);
    }
  }

  /** Grupează pe zile, în ordinea săptămânii. */
  function peZile<T extends { zi: string }>(lista: T[]) {
    return ORDINE.map((z) => ({ zi: z, randuri: lista.filter((x) => x.zi === z) })).filter(
      (g) => g.randuri.length > 0,
    );
  }

  const amZone = acum.length > 0;

  return (
    <section className="card fade-in p-5">
      <button
        type="button"
        onClick={() => setDeschis((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-2 py-1 text-left"
      >
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
          <MapPinned className="h-4 w-4 shrink-0 text-indigo-600" />
          <span className="min-w-0">Zonele mele pe zile</span>
          {amZone && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
              {acum.length} sate
            </span>
          )}
        </h2>
        <span className="shrink-0 text-slate-400">{deschis ? "▲" : "▼"}</span>
      </button>

      {deschis && (
        <div className="mt-4 space-y-4">
          {amZone && (
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Ce ai acum</p>
              <ul className="mt-1.5 space-y-1">
                {peZile(acum).map((g) => (
                  <li key={g.zi} className="break-words text-sm leading-snug">
                    <span className="font-semibold text-slate-800">
                      {ZILE_FRUMOS[g.zi] ?? g.zi}:
                    </span>{" "}
                    <span className="text-slate-600">
                      {g.randuri.map((r) => r.localitate).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label
              htmlFor="zone-text"
              className="block break-words text-sm leading-snug text-slate-600"
            >
              Scrie satele pe zile, exact cum le ai în cap. Nu contează
              diacriticele sau cum le prescurtezi.
            </label>
            <textarea
              id="zone-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={
                "luni - vf câmpului, Lozna, dersca, Strateni\nmarți: Dorohoi, Broscauti, padureni\nmiercuri - hudesti, alba, darabani"
              }
              className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-base leading-relaxed focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => cere(true)}
              disabled={ocupat}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {ocupat ? "Mă uit…" : "Verifică ce am înțeles"}
            </button>
            {gasite && gasite.length > 0 && (
              <button
                type="button"
                onClick={() => cere(false)}
                disabled={ocupat}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                Salvează zonele
              </button>
            )}
          </div>

          {/* Confirmarea: ce am înțeles, pe zile. Omul citește și decide. */}
          {gasite && gasite.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-xs font-semibold text-emerald-800">
                Am înțeles {gasite.length} sate:
              </p>
              <ul className="mt-1.5 space-y-1">
                {peZile(gasite).map((g) => (
                  <li key={g.zi} className="break-words text-sm leading-snug">
                    <span className="font-semibold text-emerald-900">
                      {ZILE_FRUMOS[g.zi] ?? g.zi}:
                    </span>{" "}
                    <span className="text-emerald-800">
                      {g.randuri.map((r) => r.localitate).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 break-words text-xs leading-snug text-emerald-700">
                Dacă e bine, apasă „Salvează zonele". Ce salvezi acum
                ÎNLOCUIEȘTE tot ce aveai înainte.
              </p>
            </div>
          )}
          {gasite && gasite.length === 0 && negasite.length === 0 && (
            <p className="break-words text-sm leading-snug text-slate-600">
              N-am găsit nicio zi și niciun sat în ce ai scris. Scrie ziua
              la începutul rândului și satele despărțite prin virgulă.
            </p>
          )}

          {negasite.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                {negasite.length}{" "}
                {negasite.length === 1 ? "sat nu l-am găsit" : "sate nu le-am găsit"}
              </p>
              <ul className="mt-1.5 space-y-1">
                {negasite.map((n, i) => (
                  <li key={i} className="break-words text-sm leading-snug text-amber-900">
                    „{n.scris}"
                    {n.sugestii.length > 0 && (
                      <span className="text-amber-700"> — ai vrut {n.sugestii.join(" / ")}?</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 break-words text-xs leading-snug text-amber-700">
                Corectează-le în text și verifică din nou. Restul se salvează
                oricum — nu pierzi ce am găsit.
              </p>
            </div>
          )}

          {mesaj && (
            <p className="break-words text-sm font-semibold leading-snug text-emerald-700">
              ✓ {mesaj}
            </p>
          )}
          {eroare && (
            <p className="break-words text-sm font-medium leading-snug text-rose-600">
              {eroare}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
