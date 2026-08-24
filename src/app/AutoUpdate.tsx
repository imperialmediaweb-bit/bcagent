"use client";

import { useEffect } from "react";

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
 */
export default function AutoUpdate() {
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
        if (v !== versiuneMea && reincarca && !eOcupat()) {
          oprit = true;
          window.location.reload();
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

  return null;
}
