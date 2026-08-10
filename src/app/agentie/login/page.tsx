"use client";

import Logo from "@/app/Logo";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/** Login agenție — pe identitatea brandului: hârtie, cerneală, portocaliu. */
export default function AgentieLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agentie/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, otp: otp || undefined }),
      });
      const data = (await res.json()) as { error?: string; needOtp?: boolean };
      if (data.needOtp) {
        setNeedOtp(true);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Autentificare eșuată");
        return;
      }
      router.replace("/agentie");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare de rețea");
    } finally {
      setLoading(false);
    }
  }

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
        <Link href="/" className="mb-8 flex flex-wrap items-center justify-center gap-2.5">
          <Logo iconSize={38} textClassName="text-lg" />
          <span className="rounded-full border-2 border-[#161412] bg-[#ffd23f] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#161412]">
            beta
          </span>
        </Link>

        <div
          className="rounded-2xl border-2 border-[#161412] bg-white p-7"
          style={{ boxShadow: "6px 6px 0 #161412" }}
        >
          <h1
            className="text-xl font-extrabold text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Panoul firmei
          </h1>
          <p className="mt-1 text-sm font-medium text-[#161412]/60">
            Pentru administrator și manageri
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-[#161412]/50">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="admin@firma.ro"
                className="mt-1.5 block w-full rounded-lg border-2 border-[#161412] px-3.5 py-3 text-[16px] font-medium text-[#161412] outline-none transition focus:bg-[#fdf3d8]"
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-[#161412]/50">
                Parolă
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="mt-1.5 block w-full rounded-lg border-2 border-[#161412] px-3.5 py-3 text-[16px] font-medium text-[#161412] outline-none transition focus:bg-[#fdf3d8]"
              />
            </div>

            {needOtp && (
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-[#161412]/50">
                  Cod din aplicația Authenticator
                </label>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="mt-1.5 block w-full rounded-lg border-2 border-[#161412] px-3.5 py-3 text-center font-mono text-[20px] font-bold tracking-[0.4em] text-[#161412] outline-none transition focus:bg-[#fdf3d8]"
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
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#161412] bg-[#ff4d00] py-3.5 text-[16px] font-black text-white transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-60"
              style={{ boxShadow: "4px 4px 0 #161412" }}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Intră în panou <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>
        </div>

        <Link
          href="/agentie/inregistrare"
          className="mt-4 block rounded-xl border-2 border-[#161412] bg-white py-3 text-center text-[15px] font-black text-[#161412] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
          style={{ boxShadow: "4px 4px 0 #161412" }}
        >
          ✨ Nu ai cont? Creează-l singur — 14 zile gratuit
        </Link>

        <div
          className="mt-4 rounded-xl border-2 border-[#161412] bg-[#ffd23f] p-3.5"
          style={{ boxShadow: "4px 4px 0 #161412" }}
        >
          <p className="text-center text-[13px] font-black uppercase tracking-wider text-[#161412]">
            🎬 Vezi DEMO — fără cont
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {(
              [
                ["patron", "Administrator"],
                ["manager", "Manager"],
                ["agent", "Agent"],
              ] as const
            ).map(([rol, label]) => (
              <a
                key={rol}
                href={`/api/agentie/demo-login?rol=${rol}`}
                className="rounded-lg border-2 border-[#161412] bg-white py-2.5 text-center text-[14px] font-black text-[#161412] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none"
                style={{ boxShadow: "3px 3px 0 #161412" }}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-xs font-semibold text-[#161412]/45">
          Platformă în versiune BETA — dacă întâlnești o eroare, apasă
          butonul 💬 din panou și o rezolvăm rapid.
          <br />
          Parola o schimbi din Setări după primul login. ·{" "}
          <Link href="/ghid" className="underline">
            Ghidul platformei
          </Link>
        </p>
      </div>
    </main>
  );
}
