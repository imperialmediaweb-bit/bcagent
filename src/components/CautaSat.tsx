"use client";

import { useEffect, useRef, useState } from "react";

/**
 * CAUTĂ UN SAT ȘI ALEGE-L.
 *
 * Când textul are ceva ce nu recunoaștem — „Țara Dornelor (toate
 * locațiile)" — nu ghicim ce sate sunt în el. Un sat băgat greșit în ziua
 * unui agent înseamnă un drum degeaba și o cifră falsă în raport.
 *
 * Dar nici nu-l punem pe om să scrie patruzeci de nume. Tastează două
 * litere, îi apar satele LUI, apasă pe ele. Alegerea e a lui, datele sunt
 * ale lui, noi n-am inventat nimic — iar el aproape că n-a scris.
 *
 * Merge la fel în panoul firmei și pe telefonul agentului: aceeași
 * căsuță, aceeași adresă, alt fel de a spune cine ești.
 */
export default function CautaSat({
  onAlege,
  /** Ruta care caută. Panoul firmei și cel al agentului au adrese diferite. */
  adresa = "/api/agentie/zone",
  /** Ce mai trebuie trimis ca să știe cine întreabă (tokenul agentului). */
  extra,
  eticheta = "caută satul și alege-l",
  /**
   * E o ZONĂ, nu un sat scris greșit („Țara Dornelor").
   *
   * Atunci NU are rost „pune-l așa cum l-am scris": niciun client nu stă
   * într-un sat cu numele ăla. Omul trebuie să caute SATELE din ea și să
   * le adauge pe rând — poate alege câte vrea, căsuța rămâne deschisă.
   */
  zona = false,
}: {
  onAlege: (localitate: string) => void;
  adresa?: string;
  extra?: Record<string, unknown>;
  eticheta?: string;
  zona?: boolean;
}) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<string[]>([]);
  const [caut, setCaut] = useState(false);
  const [deschis, setDeschis] = useState(false);
  // Fiecare căutare o are pe a ei: dacă răspunsul vechi vine după cel nou
  // (se întâmplă pe semnal prost), nu-l lăsăm să-l acopere.
  const nr = useRef(0);

  useEffect(() => {
    const cautat = q.trim();
    if (cautat.length < 2) {
      setLista([]);
      return;
    }
    // Nu batem serverul la fiecare literă: așteptăm să se oprească din scris.
    const al = ++nr.current;
    const t = setTimeout(async () => {
      // „Caut…" se aprinde ABIA când chiar plecăm la server. Înainte îl
      // aprindeam odată cu tastarea, iar dacă omul mai scria o literă,
      // așteptarea se anula — dar becul rămânea aprins la nesfârșit.
      setCaut(true);
      try {
        const r = await fetch(adresa, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(extra ?? {}), cauta: cautat }),
        });
        const d = (await r.json()) as { localitati?: string[] };
        if (al === nr.current) setLista(d.localitati ?? []);
      } catch {
        if (al === nr.current) setLista([]);
      } finally {
        if (al === nr.current) setCaut(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      setCaut(false);
    };
    // `extra` e un obiect nou la fiecare randare a părintelui; dacă l-am
    // pune în listă, am căuta la nesfârșit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, adresa]);

  if (!deschis) {
    return (
      <button
        type="button"
        onClick={() => setDeschis(true)}
        className="mt-1 inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        🔍 {eticheta}
      </button>
    );
  }

  return (
    <div className="mt-1">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={
          zona
            ? "scrie 2-3 litere din numele unui SAT: dorn, vatra…"
            : "scrie 2-3 litere: dorn, vatra, poi…"
        }
        className="block w-full min-w-0 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      {caut && <p className="mt-1 text-xs text-amber-800">caut…</p>}
      {zona && (
        <p className="mt-1 break-words text-xs leading-snug text-amber-800">
          Caută pe rând satele din ea și apasă pe fiecare. Poți alege câte
          vrei — căsuța rămâne deschisă.
        </p>
      )}
      {!caut && q.trim().length >= 2 && lista.length === 0 && (
        <div className="mt-1">
          <p className="break-words text-xs leading-snug text-amber-800">
            Niciun sat din listele noastre nu seamănă cu asta — sunt sate
            adevărate în care încă n-avem nicio firmă.
          </p>
          {/* SATUL EXISTĂ, DOAR CĂ NOI NU-L AVEM.
              Tarnița, Palma, Poieni-Solca sunt sate prin care agentul
              trece săptămânal, dar în care nu e înregistrată nicio firmă —
              deci nu apar nici în registru, nici în tabelul de localități.
              Nu-l punem pe om să se lupte cu lista noastră: îl ia așa cum
              l-a scris el. Când apare acolo primul client sau primul
              magazin de pe hartă, se leagă singur. */}
          {/* La o ZONĂ nu se pune numele ei ca sat: n-ar folosi la nimic,
              fiindcă niciun client nu stă într-un sat cu numele ăla. */}
          {!zona && (
            <button
              type="button"
              onClick={() => {
                onAlege(q.trim());
                setQ("");
                setLista([]);
              }}
              className="mt-1 min-h-9 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              + Pune-l așa cum l-am scris: „{q.trim()}"
            </button>
          )}
        </div>
      )}
      {lista.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {lista.map((l) => (
            <li key={l}>
              <button
                type="button"
                onClick={() => {
                  onAlege(l);
                  setQ("");
                  setLista([]);
                }}
                className="min-h-9 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:bg-emerald-50 hover:text-emerald-800"
              >
                + {l}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
