"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

/**
 * Buton de dictare refolosibil: agentul vorbește, textul se scrie singur
 * (Web Speech API, ro-RO). Merge nativ pe Android Chrome — exact telefonul
 * agentului de teren. Textul dictat rămâne SCRIS (note, comenzi, chat),
 * deci se salvează și se ține minte.
 *
 * Două moduri:
 *  - normal (o propoziție): apeși, zici, se scrie, se oprește singur;
 *  - continuu (`live`): agentul vorbește tot ce a zis clientul, fără pauze —
 *    ascultarea NU se oprește după fiecare propoziție, iar textul se umple
 *    LIVE (onInterim), ca la dictarea din telefon. Se oprește doar când
 *    apasă din nou. Tot ce zice e consemnat.
 */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
}

function getSR(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function MicButton({
  onText,
  onInterim,
  onListening,
  live = false,
  className = "",
  size = 4,
}: {
  /** Text FINAL (o bucată terminată de vorbire) — se adaugă la notă. */
  onText: (text: string) => void;
  /** Text PROVIZORIU, live, cât timp agentul încă vorbește (doar afișare). */
  onInterim?: (text: string) => void;
  /** Anunță când pornește/oprește ascultarea (pentru indicatorul „te ascult"). */
  onListening?: (on: boolean) => void;
  /** Ascultare continuă: nu se oprește după fiecare propoziție. */
  live?: boolean;
  className?: string;
  size?: 3 | 4;
}) {
  const [listening, setListeningState] = useState(false);
  const setListening = (on: boolean) => {
    setListeningState(on);
    onListening?.(on);
  };
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // În modul continuu, browserul mai închide sesiunea singur din când în
  // când — o repornim automat cât timp agentul vrea să dicteze.
  const wantOn = useRef(false);
  const supported = useMemo(() => getSR() !== null, []);

  useEffect(() => {
    return () => {
      wantOn.current = false;
      try {
        recRef.current?.stop();
      } catch {
        // nimic — oricum plecăm
      }
    };
  }, []);

  if (!supported) return null;

  function build(): SpeechRecognitionLike | null {
    const SR = getSR();
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "ro-RO";
    rec.interimResults = live;
    rec.continuous = live;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? "";
        if (r.isFinal) {
          if (txt.trim()) onText(txt.trim());
        } else {
          interim += txt;
        }
      }
      if (live && onInterim) onInterim(interim);
    };
    rec.onend = () => {
      // Continuu: dacă agentul n-a apăsat stop, repornim.
      if (wantOn.current && live) {
        try {
          rec.start();
          return;
        } catch {
          // dacă nu putem reporni, ne oprim curat
        }
      }
      wantOn.current = false;
      setListening(false);
      if (live && onInterim) onInterim("");
    };
    rec.onerror = (ev) => {
      // „no-speech" în continuu nu e o eroare reală — lăsăm onend să reia.
      if (live && ev?.error === "no-speech") return;
      wantOn.current = false;
      setListening(false);
      if (live && onInterim) onInterim("");
    };
    return rec;
  }

  function toggle() {
    if (listening) {
      wantOn.current = false;
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = build();
    if (!rec) return;
    recRef.current = rec;
    wantOn.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      wantOn.current = false;
      setListening(false);
    }
  }

  const iconCls = size === 3 ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      type="button"
      onClick={toggle}
      className={`shrink-0 rounded-md border p-1.5 ${
        listening
          ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600"
          : "border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      } ${className}`}
      title={listening ? "Oprește dictarea" : "Dictează cu vocea"}
      aria-label="Dictează cu vocea"
    >
      {listening ? <MicOff className={iconCls} /> : <Mic className={iconCls} />}
    </button>
  );
}
