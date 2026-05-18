"use client";

import { useEffect, useState } from "react";

interface IssueResponse {
  token: string;
  url: string;
  expiresAt: string;
}

export default function AdminPage() {
  const [adminSecret, setAdminSecret] = useState("");
  const [remember, setRemember] = useState(true);
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [ttlDays, setTtlDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssueResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<
    Array<{ agentId: string; agentName: string; url: string; expiresAt: string }>
  >([]);

  useEffect(() => {
    const saved = localStorage.getItem("bcagent_admin_secret");
    if (saved) setAdminSecret(saved);
    const h = localStorage.getItem("bcagent_history");
    if (h) {
      try {
        setHistory(JSON.parse(h));
      } catch {
        // ignore
      }
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    if (remember && adminSecret) {
      localStorage.setItem("bcagent_admin_secret", adminSecret);
    } else if (!remember) {
      localStorage.removeItem("bcagent_admin_secret");
    }

    try {
      const res = await fetch("/api/issue-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": adminSecret,
        },
        body: JSON.stringify({
          agentId: agentId.trim(),
          agentName: agentName.trim(),
          ttlDays: Number(ttlDays),
        }),
      });
      const data = (await res.json()) as IssueResponse | { error: string };
      if (!res.ok || "error" in data) {
        setError(
          "error" in data ? data.error : `Eroare ${res.status}`,
        );
        return;
      }
      setResult(data);
      const entry = {
        agentId: agentId.trim(),
        agentName: agentName.trim(),
        url: data.url,
        expiresAt: data.expiresAt,
      };
      const newHistory = [entry, ...history].slice(0, 20);
      setHistory(newHistory);
      localStorage.setItem("bcagent_history", JSON.stringify(newHistory));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem("bcagent_history");
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-5 w-5"
          >
            <path d="M3 3v18h18" />
            <path d="m7 14 4-4 4 4 4-6" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            BC Agent — Admin
          </h1>
          <p className="text-sm text-slate-500">
            Emite linkuri magice pentru agenții tăi
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              ADMIN_SECRET
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="parola setată în Railway → Variables"
              required
              className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm focus:border-indigo-400 focus:outline-none"
            />
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-slate-300"
              />
              Salvează în browser-ul ăsta (localStorage)
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                ID agent
              </label>
              <input
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="a-001"
                required
                className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                Nume complet
              </label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Gavrilet Bogdan"
                required
                className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
              Valabilitate (zile)
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={ttlDays}
              onChange={(e) => setTtlDays(parseInt(e.target.value) || 30)}
              className="mt-1 block w-32 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "Se generează..." : "Generează link"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Link generat
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                readOnly
                value={result.url}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 rounded-md border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-800"
              />
              <button
                type="button"
                onClick={() => copyToClipboard(result.url)}
                className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700"
              >
                {copied ? "✓ Copiat" : "Copiază"}
              </button>
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                Deschide
              </a>
            </div>
            <p className="mt-2 text-xs text-emerald-700">
              Expiră: {new Date(result.expiresAt).toLocaleString("ro-RO")}
            </p>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">
              Istoric ({history.length})
            </h2>
            <button
              type="button"
              onClick={clearHistory}
              className="text-xs text-slate-500 hover:text-rose-600"
            >
              Șterge tot
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {history.map((h, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{h.agentName}</p>
                  <p className="truncate text-xs text-slate-500">
                    {h.agentId} · expiră {new Date(h.expiresAt).toLocaleDateString("ro-RO")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(h.url)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Copiază
                  </button>
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Deschide
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-500">
        Pagina asta nu îți afișează panoul de agent — doar generează linkuri.
        Pentru a vedea analytics-ul, deschide unul din linkurile generate
        (Deschide), care încarcă{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">/a/&lt;token&gt;</code>.
      </p>
    </main>
  );
}
