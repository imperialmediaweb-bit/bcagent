"use client";

import AiMarkdown from "@/components/AiMarkdown";
import { paginaRaport } from "@/lib/md-print";
import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Alert,
  Button,
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
            <option value={30}>Ultima lună</option>
            <option value={60}>Ultimele 2 luni</option>
            <option value={90}>Ultimele 3 luni</option>
            <option value={180}>Ultimele 6 luni</option>
            <option value={365}>Ultimul an</option>
            <option value={365}>Ultimul an</option>
          </select>
        </div>
      </Card>

      <ClientVoice agent={agent} days={days} />

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

/**
 * VOCEA CLIENTULUI: AI-ul citește notele dictate de agenți la vizite și
 * scoate ce cere piața — ce vor clienții, de ce se plâng, oportunități,
 * urgențe. Aceeași analiză pentru manager și administrator; se poate filtra
 * pe agent și perioadă (moștenite din filtrele de sus).
 */
function ClientVoice({ agent, days }: { agent: string; days: number }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  async function run() {
    setBusy(true);
    setErr(null);
    setText(null);
    try {
      const d = await api<{ text: string; count: number; enough: boolean }>(
        "/api/agentie/client-voice",
        { method: "POST", json: { agent, days } },
      );
      setText(d.text);
      setCount(d.count);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Vocea clientului — ce zic clienții, pe scurt
          </h2>
          <p className="mt-0.5 text-xs text-indigo-800/70">
            AI-ul citește notele dictate de agenți la vizite și scoate ce
            cer, de ce se plâng, oportunități și pe cine să suni repede.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? "Analizez notele..." : text ? "Reanalizează" : "Analizează notele"}
        </Button>
      </div>
      {err && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </p>
      )}
      {text && (
        <div className="voice-md mt-3 rounded-lg border border-indigo-100 bg-white p-4 text-sm leading-relaxed text-slate-800">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {count > 0 && (
              <p className="text-xs font-medium text-indigo-600">
                Din {count} note de vizită.
              </p>
            )}
            {/* Raportul pleacă mai departe: managerul îl salvează PDF din
                fereastra de tipărire și-l trimite patronului pe WhatsApp. */}
            <button
              type="button"
              onClick={() => {
                const zile: Record<number, string> = {
                  7: "ultimele 7 zile", 30: "ultima lună", 60: "ultimele 2 luni",
                  90: "ultimele 3 luni", 180: "ultimele 6 luni", 365: "ultimul an",
                };
                const f = window.open("", "_blank");
                if (!f) return;
                f.document.write(
                  paginaRaport({
                    titlu: "Vocea clientului — ce zic clienții",
                    subtitlu: `Perioada: ${zile[days] ?? `ultimele ${days} zile`} · ${count} note de vizită · generat ${new Date().toLocaleDateString("ro-RO")} din notele dictate de agenți pe teren`,
                    corpMd: text,
                  }),
                );
                f.document.close();
              }}
              className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              ⬇️ Descarcă PDF
            </button>
          </div>
          <AiMarkdown text={text} />
        </div>
      )}
    </Card>
  );
}

