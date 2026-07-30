"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import {
  Camera,
  GraduationCap,
  Loader2,
  Mic,
  MicOff,
  RefreshCcw,
  Send,
  Volume2,
} from "lucide-react";

function md(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "code", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote", "hr",
    ],
    ALLOWED_ATTR: [],
  });
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  hasImage?: boolean;
}

const OBIECTII = [
  "Mi-a zis că e prea scump — ce-i răspund?",
  "Zice că lucrează deja cu altă firmă",
  "Zice că nu se vinde, că n-are rost — cum îl conving?",
  "Cum abordez un patron nou, prima vizită?",
];

/** Recunoaștere vocală prin Web Speech API (Android Chrome o are nativ). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Micșorează poza pe telefon înainte de trimitere (max 1280px, JPEG). */
async function downscaleImage(file: File): Promise<{ data: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { data: dataUrl.split(",")[1], mime: "image/jpeg" };
}

export default function CoachPanel({
  token,
  summary,
  enabled,
}: {
  token: string;
  summary: unknown;
  enabled: boolean;
}) {
  const [mode, setMode] = useState<"chat" | "simulare">("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasVoice = useMemo(() => getSpeechRecognition() !== null, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(
    text: string,
    opts?: { image?: { data: string; mime: string }; modeOverride?: string },
  ) {
    const content = text.trim() || (opts?.image ? "Analizează poza de la stand." : "");
    if ((!content && !opts?.image) || busy) return;
    setError(null);
    const userMsg: Msg = { role: "user", content, hasImage: !!opts?.image };
    const next: Msg[] = [...messages, userMsg, { role: "assistant", content: "" }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          mode: opts?.modeOverride ?? mode,
          summary,
          image: opts?.image,
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Eroare ${res.status}`);
        setMessages((m) => m.slice(0, -1));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.lang = "ro-RO";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(
        { length: e.results.length },
        (_, i) => e.results[i][0].transcript,
      ).join(" ");
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>]/g, ""));
    u.lang = "ro-RO";
    window.speechSynthesis.speak(u);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const image = await downscaleImage(file);
      await send(input || "Uite cum arată standul la clientul ăsta — ce fac?", {
        image,
      });
    } catch {
      setError("Nu am putut procesa poza.");
    }
  }

  if (!enabled) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        Antrenorul AI se activează cu o cheie de AI (OPENAI_API_KEY,
        ANTHROPIC_API_KEY sau GEMINI_API_KEY).
      </div>
    );
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white">
            <GraduationCap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Antrenorul</h3>
            <p className="text-xs text-slate-500">
              Îți știe cifrele. Întreabă-l cu scris, cu voce sau cu o poză.
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setMode("chat");
              setMessages([]);
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              mode === "chat"
                ? "bg-amber-100 text-amber-800"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            💬 Sfaturi
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("simulare");
              setMessages([]);
              send("Începe simularea.", { modeOverride: "simulare" });
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              mode === "simulare"
                ? "bg-amber-100 text-amber-800"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            🎭 Simulare client
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              title="Resetează"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-4 flex max-h-[420px] min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 && mode === "chat" && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => send("Fă-mi planul de dezvoltare pe baza cifrelor mele.", { modeOverride: "plan" })}
              className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              🎯 Fă-mi planul de dezvoltare — unde sunt bun, unde pierd, ce am
              de învățat (din cifrele mele)
            </button>
            <p className="mt-1 text-xs text-slate-500">Sau întreabă direct:</p>
            {OBIECTII.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-amber-300 hover:bg-amber-50/50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.role === "assistant" && m.content === "" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : m.role === "assistant" ? (
                <div>
                  <div
                    className="prose-ai"
                    dangerouslySetInnerHTML={{ __html: md(m.content) }}
                  />
                  <button
                    type="button"
                    onClick={() => speak(m.content)}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                    title="Ascultă răspunsul"
                  >
                    <Volume2 className="h-3.5 w-3.5" /> ascultă
                  </button>
                </div>
              ) : (
                <>
                  {m.hasImage && <span className="mr-1">📷</span>}
                  {m.content}
                </>
              )}
            </div>
          </div>
        ))}
        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        )}
      </div>

      <form
        className="mt-3 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPhoto}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          title="Fă poză la stand — Antrenorul o analizează"
        >
          <Camera className="h-4 w-4" />
        </button>
        {hasVoice && (
          <button
            type="button"
            onClick={toggleVoice}
            disabled={busy}
            className={`shrink-0 rounded-lg border p-2.5 disabled:opacity-50 ${
              listening
                ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
            title={listening ? "Oprește dictarea" : "Dictează cu vocea"}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "simulare"
              ? "Vorbește cu clientul... (scrie STOP pentru feedback)"
              : "Ce ți-a zis clientul? Ce te frământă?"
          }
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-amber-400 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-lg bg-amber-600 p-2.5 text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </form>
    </div>
  );
}
