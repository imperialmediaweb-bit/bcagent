"use client";

import { useEffect, useState } from "react";

/**
 * ACTUALIZARE FĂRĂ SĂ FACĂ NIMENI NIMIC.
 *
 * Agenții de teren nu știu (și n-au de ce să știe) să „închidă și să
 * redeschidă aplicația". Când urcăm o versiune nouă, telefoanele cu
 * pagina veche rămâneau pe cod vechi și puteau da peste ecrane goale.
 *
 * Aici verificăm discret versiunea serverului și reîmprospătăm pagina
 * DOAR în momentele sigure: când agentul revine în aplicație după ce a
 * fost în altă parte (WhatsApp, telefon) — deci nu în timp ce scrie o
 * comandă sau dictează o notă. Dacă nu revine niciodată, verificăm și la
 * fiecare 10 minute, dar tot cu aceleași reguli de siguranță.
 *
 * Iar dacă e ceva în lucru (scrie o comandă, dictează), NU-i smulgem
 * pagina de sub mână: apare o BANDĂ jos — „E o versiune nouă · Actualizează"
 * — și o apasă când e liber. Fără versiune nouă, nu apare nicio bandă,
 * deci nimeni nu mai trebuie să dea refresh „de siguranță".
 */
export default function AutoUpdate() {
  // Doar când CHIAR există versiune nouă pe server (altfel: nimic pe ecran).
  const [versiuneNoua, setVersiuneNoua] = useState(false);

  useEffect(() => {
    let versiuneMea = "";
    let oprit = false;

    // Ultima dată când agentul a scris ceva (tastat sau dictat) și
    // CÂMPURILE în care a scris efectiv: dacă vreunul mai are text
    // nesalvat, nu reîmprospătăm — i l-am șterge. (Câmpurile cu valori
    // implicite — preț, comision — NU intră aici: doar ce a atins omul.)
    let ultimaScriere = 0;
    const campuriAtinse = new WeakSet<Element>();
    const amScris = (e: Event) => {
      ultimaScriere = Date.now();
      if (e.target instanceof Element) campuriAtinse.add(e.target);
    };
    document.addEventListener("input", amScris, true);

    /**
     * Momente în care NU avem voie să reîmprospătăm: e ceva în lucru.
     * ATENȚIE la falsele alarme: „orice câmp cu valoare" NU e un semn de
     * lucru — panoul are câmpuri completate din start (preț, comision,
     * bife), iar cu regula aia aplicația nu s-ar actualiza niciodată.
     */
    function eOcupat(): boolean {
      // 1. Fereastră deschisă: comandă, vizită, poză, meniul mobil.
      //    Modalele noastre sunt straturi „fixed inset-0" peste pagină.
      if (document.querySelector('[role="dialog"], dialog[open]')) return true;
      const straturi = Array.from(document.querySelectorAll<HTMLElement>("div"));
      const areFereastra = straturi.some((el) => {
        const s = getComputedStyle(el);
        if (s.position !== "fixed" || s.display === "none") return false;
        const r = el.getBoundingClientRect();
        // acoperă tot ecranul = fereastră/fundal de fereastră
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
      });
      if (areFereastra) return true;
      // 2. Scrie chiar acum.
      const activ = document.activeElement as HTMLElement | null;
      if (activ) {
        const t = activ.tagName;
        if (t === "INPUT" || t === "TEXTAREA" || activ.isContentEditable) return true;
      }
      // 3. Notă dictată/scrisă, nesalvată (textarea n-are valori implicite).
      const note = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
      if (note.some((n) => (n.value ?? "").trim().length > 0)) return true;
      // 3b. Orice câmp ÎN CARE OMUL A SCRIS și care încă are text — chiar
      //     dacă nu mai e focalizat (a tastat, a atins altceva, urma să
      //     revină). Actualizarea i-ar șterge ce a scris.
      const campuri = Array.from(
        document.querySelectorAll<HTMLInputElement>("input"),
      );
      if (
        campuri.some(
          (c) => campuriAtinse.has(c) && (c.value ?? "").trim().length > 0,
        )
      )
        return true;
      // 4. A scris ceva în ultimele 2 minute — poate se întoarce la el.
      if (ultimaScriere && Date.now() - ultimaScriere < 120_000) return true;
      return false;
    }

    async function verifica(reincarca: boolean) {
      if (oprit) return;
      try {
        const r = await fetch("/api/versiune", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { versiune?: string };
        const v = String(d.versiune ?? "");
        if (!v) return;
        if (!versiuneMea) {
          versiuneMea = v;
          return;
        }
        if (v !== versiuneMea) {
          // Versiune nouă. Dacă e liber, o luăm singuri (ca până acum);
          // dacă e în mijlocul unei comenzi, îi arătăm banda și decide el.
          if (reincarca && !eOcupat()) {
            oprit = true;
            window.location.reload();
            return;
          }
          setVersiuneNoua(true);
        }
      } catch {
        // fără semnal — reîncercăm data viitoare
      }
    }

    verifica(false);
    const laRevenire = () => {
      if (document.visibilityState === "visible") void verifica(true);
    };
    document.addEventListener("visibilitychange", laRevenire);
    window.addEventListener("focus", laRevenire);
    const ceas = setInterval(() => void verifica(true), 10 * 60 * 1000);

    return () => {
      document.removeEventListener("input", amScris, true);
      document.removeEventListener("visibilitychange", laRevenire);
      window.removeEventListener("focus", laRevenire);
      clearInterval(ceas);
    };
  }, []);

  if (!versiuneNoua) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] flex items-center justify-center gap-3 bg-[#ff4d00] px-4 py-3 text-white shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
      <span className="text-sm font-semibold">
        ✨ E o versiune nouă a aplicației
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#ff4d00] shadow-sm"
      >
        Actualizează
      </button>
      <button
        type="button"
        onClick={() => setVersiuneNoua(false)}
        aria-label="Ascunde"
        className="text-lg font-bold text-white/80 hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
