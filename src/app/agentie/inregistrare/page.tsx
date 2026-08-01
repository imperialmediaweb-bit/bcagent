"use client";

import Logo from "@/app/Logo";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * ÎNREGISTRARE: firma își face singură contul, în 30 de secunde,
 * și primește automat 14 zile de probă cu tot inclus.
 */
export default function InregistrarePage() {
  const router = useRouter();
  const [firma, setFirma] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agentie/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firma, name, email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Eroare la crearea contului");
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

  const inputCls =
    "mt-1.5 block w-full rounded-lg border-2 border-[#161412] px-3.5 py-3 text-[16px] font-medium text-[#161412] outline-none transition focus:bg-[#fdf3d8]";
  const labelCls =
    "block text-xs font-black uppercase tracking-widest text-[#161412]/50";

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
            Creează contul firmei
          </h1>
          <p className="mt-1 text-sm font-medium text-[#161412]/60">
            14 zile de probă, cu tot inclus. Fără card.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className={labelCls}>Firma</label>
              <input
                value={firma}
                onChange={(e) => setFirma(e.target.value)}
                required
                minLength={3}
                placeholder="Distribuție SRL"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Numele tău</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Ion Popescu"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="admin@firma.ro"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Parolă (minim 8 caractere)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={inputCls}
              />
            </div>

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
                  Creează contul <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs font-semibold text-[#161412]/45">
          Ai deja cont?{" "}
          <Link href="/agentie/login" className="underline">
            Intră în panou
          </Link>
          <br />
          După ce intri: adaugă agenții, importă clienții, încarcă vânzările —
          totul e explicat în{" "}
          <Link href="/ghid" className="underline">
            ghid
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
