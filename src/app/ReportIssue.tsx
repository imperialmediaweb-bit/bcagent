"use client";

import { useState } from "react";
import { Bug, Loader2, Send } from "lucide-react";

/**
 * „Raportează o problemă" — buton discret, formular minim, iar AI-ul
 * răspunde PE LOC cu o soluție dacă poate. Raportul complet (cu diagnostic)
 * ajunge la admin în /platform/probleme.
 */
export default function ReportIssue({ token }: { token?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          message,
          page: typeof window !== "undefined" ? window.location.pathname : "",
          context: {
            ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "",
          },
        }),
      });
      const data = (await res.json()) as { suggestion?: string | null; error?: string };
      if (!res.ok) {
        setResult({ kind: "err", text: data.error ?? `Eroare ${res.status}` });
        return;
      }
      setMessage("");
      setResult({
        kind: "ok",
        text: data.suggestion
          ? `Raportat ✓. Între timp, încearcă asta:\n${data.suggestion}`
          : "Raportat ✓ — adminul a primit problema și diagnosticul.",
      });
    } catch {
      setResult({ kind: "err", text: "Eroare de rețea — mai încearcă o dată." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setResult(null);
        }}
        className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:scale-105"
        title="Raportează o problemă"
        aria-label="Raportează o problemă"
      >
        <Bug className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center">
          <div className="absolute inset-0" onClick={() => setOpen(false)} aria-hidden />
          <div className="relative w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Bug className="h-4 w-4 text-rose-500" />
              Ce nu merge?
            </h3>
            <form onSubmit={submit} className="mt-3 space-y-3">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                required
                minLength={5}
                placeholder="Ex: nu merge încărcat fișierul CSV cu vânzările, zice că nu găsește coloanele"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              />
              {result && (
                <p
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    result.kind === "ok"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {result.text}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Închide
                </button>
                <button
                  type="submit"
                  disabled={busy || message.trim().length < 5}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {busy ? "AI-ul analizează..." : "Trimite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
