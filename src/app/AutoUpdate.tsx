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

    /** Momente în care NU avem voie să reîmprospătăm: e ceva în lucru. */
    function eOcupat(): boolean {
      // fereastră deschisă (comandă, vizită, poză)
      if (document.querySelector('[role="dialog"], dialog[open]')) return true;
      const activ = document.activeElement as HTMLElement | null;
      if (activ) {
        const t = activ.tagName;
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return true;
        if (activ.isContentEditable) return true;
      }
      // text început într-un câmp, chiar dacă nu e focalizat acum
      const campuri = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
      );
      if (campuri.some((c) => (c.value ?? "").trim().length > 0)) return true;
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
      document.removeEventListener("visibilitychange", laRevenire);
      window.removeEventListener("focus", laRevenire);
      clearInterval(ceas);
    };
  }, []);

  return null;
}
