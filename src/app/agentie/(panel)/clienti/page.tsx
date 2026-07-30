"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone, Search } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatDate,
  formatNumber,
  inputClass,
} from "@/app/platform/ui";

interface Client {
  cui: string;
  denumire: string;
  adresa: string;
  localitate: string;
  judet: string;
  telefon: string;
  agent: string;
  lastVisit: string | null;
}

export default function ClientiPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Array<{ agentId: string; name: string }>>([]);
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ clients: Client[]; total: number }>(
        `/api/agentie/clients?agent=${encodeURIComponent(agent)}&search=${encodeURIComponent(search)}&limit=200`,
      );
      setClients(d.clients);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agent, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

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
          Clienții firmei ({formatNumber(total)})
        </h1>
        <p className="text-sm text-slate-500">
          Toate firmele convertite, cu agentul responsabil și ultima vizită.
        </p>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după nume, localitate sau CUI"
              className={`${inputClass} mt-0 pl-9`}
            />
          </div>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className={`${inputClass} mt-0 sm:w-56`}
          >
            <option value="">Toți agenții</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : clients.length === 0 ? (
        <EmptyState text="Niciun client încă — agenții îi convertesc din teren, sau folosește importul din vânzări." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Localitate</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Ultima vizită</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.cui} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{c.denumire}</p>
                    <p className="text-xs text-slate-500">CUI {c.cui}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.localitate}
                    {c.judet ? ` (${c.judet})` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.agent || "—"}</td>
                  <td className="px-4 py-3">
                    {c.lastVisit ? (
                      formatDate(c.lastVisit)
                    ) : (
                      <span className="text-rose-600">niciodată</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.telefon ? (
                      <a
                        href={`tel:${c.telefon}`}
                        className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        {c.telefon}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
