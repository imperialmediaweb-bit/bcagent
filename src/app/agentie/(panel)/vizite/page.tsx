"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatDateTime,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface Visit {
  id: string;
  agentId: string;
  agentName: string;
  cui: string;
  denumire: string;
  result: string;
  note: string;
  visitedAt: string;
}

const RESULT_BADGES: Record<string, { label: string; cls: string }> = {
  gandeste: { label: "🤔 se gândește", cls: "bg-amber-50 text-amber-700" },
  ne_suna: { label: "📞 ne sună", cls: "bg-sky-50 text-sky-700" },
  client: { label: "🤝 client nou", cls: "bg-emerald-50 text-emerald-700" },
  nu_vrea: { label: "❌ nu vrea", cls: "bg-rose-50 text-rose-700" },
  inchis: { label: "🚪 închis", cls: "bg-slate-100 text-slate-600" },
};

export default function VizitePage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Array<{ agentId: string; name: string }>>([]);
  const [agent, setAgent] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ visits: Visit[]; total: number }>(
        `/api/agentie/visits?agent=${encodeURIComponent(agent)}&days=${days}&limit=200`,
      );
      setVisits(d.visits);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agent, days]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ agents: Array<{ agentId: string; name: string }> }>(
      "/api/agentie/agents",
    )
      .then((d) => setAgents(d.agents))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Jurnalul vizitelor
        </h1>
        <p className="text-sm text-slate-500">
          {formatNumber(total)} vizite în perioada selectată — exact ce au
          apăsat agenții pe teren.
        </p>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className={`${inputClass} mt-0 flex-1`}
          >
            <option value="">Toți agenții</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className={`${inputClass} mt-0 sm:w-48`}
          >
            <option value={7}>Ultimele 7 zile</option>
            <option value={30}>Ultimele 30 zile</option>
            <option value={90}>Ultimele 90 zile</option>
            <option value={365}>Ultimul an</option>
          </select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : visits.length === 0 ? (
        <EmptyState text="Nicio vizită în perioada asta." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {visits.map((v) => {
              const badge = RESULT_BADGES[v.result] ?? {
                label: v.result,
                cls: "bg-slate-100 text-slate-600",
              };
              return (
                <li key={v.id} className="flex flex-wrap items-start gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {v.denumire || `CUI ${v.cui}`}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {v.agentName} · {formatDateTime(v.visitedAt)}
                      {v.note ? ` · „${v.note}"` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
