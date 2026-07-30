"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/app/platform/ui";

export default function AgentieLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-4" />
            </svg>
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
            BC Agent — Agenția mea
          </h1>
          <p className="text-sm text-slate-500">
            Panoul firmei de distribuție (patron & manageri)
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className={inputClass}
              placeholder="patron@firma.ro"
            />
          </Field>
          <Field label="Parolă">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>

          {error && <Alert>{error}</Alert>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Se verifică..." : "Intră în panou"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Contul îl primești de la administratorul platformei, împreună cu
          parola inițială. O schimbi din Setări după primul login.
        </p>
      </div>
    </main>
  );
}
