"use client";

import { useMemo, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

/**
 * Buton de dictare refolosibil: agentul vorbește, textul se scrie singur
 * (Web Speech API, ro-RO). Merge nativ pe Android Chrome — exact telefonul
 * agentului de teren. Textul dictat rămâne SCRIS (note, comenzi, chat),
 * deci se salvează și se ține minte.
 */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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
  className = "",
  size = 4,
}: {
  onText: (text: string) => void;
  className?: string;
  size?: 3 | 4;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = useMemo(() => getSR() !== null, []);
  if (!supported) return null;

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR = getSR();
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ro-RO";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(
        { length: e.results.length },
        (_, i) => e.results[i][0].transcript,
      ).join(" ");
      if (transcript.trim()) onText(transcript.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
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
