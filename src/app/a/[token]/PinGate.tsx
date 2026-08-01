"use client";

import Logo from "@/app/Logo";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * Poarta cu PIN a linkului de agent: la prima deschidere agentul își
 * creează PIN-ul; pe un dispozitiv nou, linkul cere PIN-ul. Linkul
 * singur, ajuns la altcineva, nu mai deschide nimic.
 */
export default function PinGate({
  token,
  agentName,
  mode,
}: {
  token: string;
  agentName: string;
  mode: "setup" | "verify";
}) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "setup" && pin !== pin2) {
      setError("PIN-urile nu coincid");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: mode, pin }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(d.error ?? `Eroare ${res.status}`);
        return;
      }
      window.location.reload();
    } catch {
      setError("Fără semnal — reîncearcă");
    } finally {
      setBusy(false);
    }
  }

  const pinInput =
    "mt-1.5 block w-full rounded-lg border-2 border-[#161412] px-3.5 py-3 text-center font-mono text-[22px] font-bold tracking-[0.5em] text-[#161412] outline-none transition focus:bg-[#fdf3d8]";

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{
        background: "#f5efe4",
        backgroundImage: "radial-gradient(#16141208 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Logo />
        </div>

        <div
          className="rounded-2xl border-2 border-[#161412] bg-white p-7"
          style={{ boxShadow: "6px 6px 0 #161412" }}
        >
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#161412]">
            <ShieldCheck className="h-5 w-5 text-[#0b5d3b]" />
            {mode === "setup" ? "Setează-ți PIN-ul" : "Dispozitiv nou"}
          </h1>
          <p className="mt-1 text-sm font-medium text-[#161412]/60">
            {mode === "setup"
              ? `Salut, ${agentName}! Prima dată aici: alege un PIN de 4-6 cifre. Panoul tău se va deschide doar cu el pe alte telefoane.`
              : `Salut, ${agentName}! Linkul a fost deschis de pe un dispozitiv nou — bagă PIN-ul tău ca să continui.`}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-[#161412]/50">
                PIN (4-6 cifre)
              </label>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="••••"
                className={pinInput}
              />
            </div>
            {mode === "setup" && (
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-[#161412]/50">
                  Repetă PIN-ul
                </label>
                <input
                  value={pin2}
                  onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="••••"
                  className={pinInput}
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg border-2 border-[#161412] bg-[#fbe7ec] px-3 py-2.5 text-sm font-semibold text-[#9f1239]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || pin.length < 4}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#161412] bg-[#ff4d00] py-3.5 text-[16px] font-black text-white transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-60"
              style={{ boxShadow: "4px 4px 0 #161412" }}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : mode === "setup" ? (
                "Salvează PIN-ul și intră"
              ) : (
                "Deblochează panoul"
              )}
            </button>
          </form>

          {mode === "verify" && (
            <p className="mt-4 text-xs font-semibold text-[#161412]/45">
              Ai uitat PIN-ul? Cere-i managerului să ți-l reseteze din panoul
              firmei (Agenți).
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
