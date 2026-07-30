"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, Target, Trophy } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  api,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface AgentTarget {
  name: string;
  target: number;
  realized: number;
  realizedValue: number;
  realizedVolume: number;
  pct: number | null;
}

function monthLabel(m: string): string {
  return new Date(m + "-01").toLocaleDateString("ro-RO", {
    month: "long",
    year: "numeric",
  });
}

export default function TargetePage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [agents, setAgents] = useState<AgentTarget[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ agents: AgentTarget[] }>(
        `/api/agentie/targets?month=${month}`,
      );
      setAgents(d.agents);
      setEdits(
        Object.fromEntries(
          d.agents.map((a) => [a.name, a.target > 0 ? String(a.target) : ""]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/agentie/targets", {
        method: "POST",
        json: {
          month,
          targets: agents.map((a) => ({
            name: a.name,
            target: parseFloat(edits[a.name] || "0") || 0,
          })),
        },
      });
      setNotice("Targeturile au fost salvate.");
      setTimeout(() => setNotice(null), 2500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const ranked = [...agents]
    .filter((a) => a.pct !== null)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Targeturi — {monthLabel(month)}
          </h1>
          <p className="text-sm text-slate-500">
            Ținta lunară per agent; realizatul vine din vânzările încărcate în
            platformă. Agentul își vede progresul în panoul lui.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={`${inputClass} mt-0 w-44`}
          />
          <Button onClick={save} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? "Se salvează..." : "Salvează"}
          </Button>
        </div>
      </header>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : agents.length === 0 ? (
        <EmptyState text="Niciun agent activ. Adaugă agenți din pagina Agenți." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Target lunar</th>
                <th className="px-4 py-3 font-medium">Realizat</th>
                <th className="w-1/3 px-4 py-3 font-medium">Progres</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map((a) => {
                const pct = a.pct;
                return (
                  <tr key={a.name}>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {a.name}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        value={edits[a.name] ?? ""}
                        onChange={(e) =>
                          setEdits((x) => ({ ...x, [a.name]: e.target.value }))
                        }
                        placeholder="ex: 25000"
                        className={`${inputClass} mt-0 w-32`}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatNumber(a.realized)}
                      <span className="text-xs text-slate-400">
                        {" "}
                        {a.realizedValue > 0 ? "RON" : "buc"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {pct === null ? (
                        <span className="text-xs text-slate-400">fără target</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 rounded-full bg-slate-100">
                            <div
                              className={`h-2.5 rounded-full ${
                                pct >= 100
                                  ? "bg-emerald-500"
                                  : pct >= 70
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                              }`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span
                            className={`w-12 text-right text-sm font-semibold ${
                              pct >= 100 ? "text-emerald-600" : "text-slate-700"
                            }`}
                          >
                            {pct}%
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {ranked.length > 0 && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Trophy className="h-4 w-4 text-amber-500" />
            Clasamentul lunii
          </h2>
          <ul className="space-y-1.5">
            {ranked.map((a, i) => (
              <li
                key={a.name}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm odd:bg-slate-50"
              >
                <span className="font-medium text-slate-800">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}{" "}
                  {a.name}
                </span>
                <span
                  className={`font-semibold ${(a.pct ?? 0) >= 100 ? "text-emerald-600" : "text-slate-600"}`}
                >
                  {a.pct}% din target
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="border-slate-200 bg-slate-50/60">
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Target className="mt-0.5 h-4 w-4 shrink-0" />
          Realizatul se calculează din XLS-urile de vânzări încărcate (pe
          numele agentului, în luna selectată) — în RON dacă există valori, în
          bucăți altfel. Încarcă vânzările la zi ca progresul să fie corect.
        </p>
      </Card>
    </div>
  );
}
