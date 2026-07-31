"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

/** Login super-admin — aceeași identitate de brand, accent negru. */
export default function PlatformLogin() {
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
      const res = await fetch("/api/platform/login", {
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
      router.replace("/platform");
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
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-[#161412] bg-[#161412] text-xl font-black text-[#ffd23f]"
            style={{ boxShadow: "4px 4px 0 #ff4d00" }}
          >
            B
          </span>
          <span
            className="text-2xl font-extrabold tracking-tight text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            BC AGENT
          </span>
        </Link>

        <div
          className="rounded-2xl border-2 border-[#161412] bg-white p-7"
          style={{ boxShadow: "6px 6px 0 #161412" }}
        >
          <h1
            className="flex items-center gap-2 text-xl font-extrabold text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            <ShieldCheck className="h-5 w-5" />
            Administrare platformă
          </h1>
          <p className="mt-1 text-sm font-medium text-[#161412]/60">
            Doar pentru super-administrator
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
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#161412] bg-[#161412] py-3.5 text-[16px] font-black text-[#ffd23f] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none disabled:opacity-60"
              style={{ boxShadow: "4px 4px 0 #ff4d00" }}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Intră în administrare <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs font-semibold text-[#161412]/45">
          Primul login: PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD din
          variabilele de mediu.
        </p>
      </div>
    </main>
  );
}
