"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPinned } from "lucide-react";
import { Alert, Button, Card, api } from "@/app/platform/ui";

/**
 * ZONELE AGENȚILOR — lipești textul, platforma îl înțelege.
 *
 * Bogdan are zonele în cap și pe WhatsApp, nu într-un formular. Aici le
 * lipește exact cum sunt scrise („luni - vf câmpului, Lozna, dersca…"),
 * apasă „Verifică" și vede NEGRU PE ALB ce a înțeles platforma și ce nu
 * a găsit — abia apoi salvează. Fără ghicit în tăcere.
 */

interface ZonaLinie {
  localitate: string;
  zi: string;
}
interface AgentZone {
  nume: string;
  zone: ZonaLinie[];
}
interface Verificare {
  gasite: Array<{ zi: string; localitate: string; scris: string }>;
  negasite: Array<{ scris: string; sugestii: string[] }>;
  salvate?: number;
}

const ETICHETA_ZI: Record<string, string> = {
  "": "fără zi",
  luni: "Luni",
  marti: "Marți",
  miercuri: "Miercuri",
  joi: "Joi",
  vineri: "Vineri",
  sambata: "Sâmbătă",
  duminica: "Duminică",
};
const ORDINE = ["luni", "marti", "miercuri", "joi", "vineri", "sambata", "duminica", ""];

export default function ZonePage() {
  const [agenti, setAgenti] = useState<AgentZone[]>([]);
  const [ales, setAles] = useState("");
  const [text, setText] = useState("");
  const [rezultat, setRezultat] = useState<Verificare | null>(null);
  const [eroare, setEroare] = useState<string | null>(null);
  const [lucreaza, setLucreaza] = useState(false);
  const [salvat, setSalvat] = useState<string | null>(null);

  const incarca = useCallback(async () => {
    try {
      const d = await api<{ agenti: AgentZone[] }>("/api/agentie/zone");
      setAgenti(d.agenti);
      setAles((a) => a || d.agenti[0]?.nume || "");
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void incarca();
  }, [incarca]);

  async function trimite(verificaDoar: boolean) {
    setLucreaza(true);
    setEroare(null);
    setSalvat(null);
    try {
      const d = await api<Verificare>("/api/agentie/zone", {
        method: "POST",
        json: { agent: ales, text, verificaDoar },
      });
      setRezultat(d);
      if (!verificaDoar) {
        setSalvat(`Zona lui ${ales} a fost salvată: ${d.salvate ?? 0} localități.`);
        await incarca();
      }
    } catch (e) {
      setEroare(e instanceof Error ? e.message : String(e));
    } finally {
      setLucreaza(false);
    }
  }

  const zonaAlesului = agenti.find((a) => a.nume === ales)?.zone ?? [];
  const peZi = ORDINE.map((zi) => ({
    zi,
    localitati: zonaAlesului.filter((z) => z.zi === zi).map((z) => z.localitate),
  })).filter((g) => g.localitati.length > 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Zonele agenților
        </h1>
        <p className="text-sm text-slate-500">
          Lipești zonele exact cum le ai pe WhatsApp. Platforma le citește,
          le potrivește cu satele reale și-ți arată ce n-a găsit.
        </p>
      </header>

      {eroare && <Alert>{eroare}</Alert>}
      {salvat && <Alert kind="success">{salvat}</Alert>}

      <Card className="p-4">
        <label className="text-xs font-medium text-slate-500">Agentul</label>
        <select
          value={ales}
          onChange={(e) => {
            setAles(e.target.value);
            setRezultat(null);
            setSalvat(null);
          }}
          className="mt-1 w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          {agenti.map((a) => (
            <option key={a.nume} value={a.nume}>
              {a.nume} {a.zone.length > 0 ? `(${a.zone.length} localități)` : "(fără zonă)"}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-xs font-medium text-slate-500">
          Zona lui, pe zile (lipește textul din WhatsApp)
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={`luni - vf câmpului, Lozna, dersca, Strateni, Șendriceni, Dorohoi
marți - Dorohoi, Broscăuți, Cărăușa, Pădureni
miercuri - Hudești, Alba, Nărănca, Darabani, Păltiniș`}
          className="mt-1 block w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-indigo-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Merge cu sau fără diacritice, cu virgule sau cu „/". Ziua o scrii
          la începutul rândului. Dacă n-are zi, zona rămâne fără program.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => trimite(true)} disabled={lucreaza || !text.trim()}>
            {lucreaza ? "Citesc..." : "Verifică ce am înțeles"}
          </Button>
          <button
            type="button"
            onClick={() => trimite(false)}
            disabled={lucreaza || !text.trim()}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Salvează zona
          </button>
        </div>
      </Card>

      {rezultat && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            Ce am înțeles din text
          </h2>
          {rezultat.gasite.length > 0 && (
            <div className="mt-2 space-y-2">
              {ORDINE.map((zi) => {
                const ale = rezultat.gasite.filter((g) => g.zi === zi);
                if (ale.length === 0) return null;
                return (
                  <div key={zi} className="rounded-lg bg-emerald-50 px-3 py-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                      {ETICHETA_ZI[zi] ?? zi} · {ale.length} localități
                    </p>
                    <p className="break-words text-sm text-emerald-900">
                      {ale.map((g) => g.localitate).join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {rezultat.negasite.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                Nu am găsit aceste localități ({rezultat.negasite.length})
              </p>
              <ul className="mt-1 space-y-1 text-sm text-amber-900">
                {rezultat.negasite.map((n, i) => (
                  <li key={i} className="break-words">
                    <strong>{n.scris}</strong>
                    {n.sugestii.length > 0 && (
                      <span className="text-amber-800">
                        {" "}
                        — ai vrut să zici: {n.sugestii.join(", ")}?
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-amber-800">
                Scrie-le altfel în text și verifică din nou. Restul se salvează
                oricum.
              </p>
            </div>
          )}
          {rezultat.gasite.length === 0 && rezultat.negasite.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">
              N-am găsit nicio localitate în textul ăsta.
            </p>
          )}
        </Card>
      )}

      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MapPinned className="h-4 w-4 text-indigo-500" />
          Zona salvată a lui {ales || "—"}
        </h2>
        {peZi.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Încă n-are zonă. Lipește-o mai sus și salveaz-o.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {peZi.map((g) => (
              <div key={g.zi} className="rounded-lg border border-slate-100 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {ETICHETA_ZI[g.zi] ?? g.zi} · {g.localitati.length}
                </p>
                <p className="break-words text-sm text-slate-800">
                  {g.localitati.join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
