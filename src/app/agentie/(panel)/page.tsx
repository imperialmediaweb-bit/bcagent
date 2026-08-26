"use client";

import Link from "next/link";
import AiMarkdown from "@/components/AiMarkdown";
// (Link e folosit și în ghidul „Primii pași")
import { useEffect, useState } from "react";
import {
  Building2,
  CalendarClock,
  ClipboardList,
  UserRound,
} from "lucide-react";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  StatCard,
  api,
  formatDateTime,
  formatNumber,
} from "@/app/platform/ui";

interface Overview {
  org: {
    name: string;
    status: string;
    planName: string | null;
    agentLimit: number;
    trialEndsAt: string | null;
  };
  agents: Array<{
    id: string;
    agentId: string;
    name: string;
    active: boolean;
    awayFrom: string | null;
    awayUntil: string | null;
    visitsWeek: number;
  }>;
  visits: { azi: number; saptamana: number; luna: number };
  clients: { total: number; contactati: number; noi30: number };
  due: number;
  results30: Record<string, number>;
  recentVisits: Array<{
    agentName: string;
    denumire: string;
    result: string;
    note: string;
    visitedAt: string;
  }>;
}

/** Briefingul AI al firmei: 5 fraze + 3 acțiuni, la un buton. */
function BriefingCard() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setText("");
    setError(null);
    try {
      const res = await fetch("/api/agentie/briefing", { method: "POST" });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Eroare ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            🧠 Briefingul AI al firmei
          </h2>
          <p className="text-xs text-slate-500">
            Toate cifrele echipei, comprimate în 5 fraze + 3 acțiuni concrete.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Analizez firma..." : text ? "Regenerează" : "Generează briefingul"}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {text && (
        <div className="mt-3 rounded-lg bg-white p-4 text-sm leading-relaxed text-slate-700 shadow-sm">
          <AiMarkdown text={text} />
        </div>
      )}
    </Card>
  );
}

const RESULT_LABELS: Record<string, string> = {
  gandeste: "🤔 se gândește",
  ne_suna: "📞 ne sună",
  client: "🤝 client nou",
  nu_vrea: "❌ nu vrea",
  inchis: "🚪 închis",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AgentieDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/api/agentie/overview")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />
        ))}
      </div>
    );
  }

  const conversii = data.results30["client"] ?? 0;
  const inConcediu = data.agents.filter(
    (a) =>
      a.awayUntil &&
      a.awayUntil >= todayISO() &&
      (!a.awayFrom || a.awayFrom <= todayISO()),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {data.org.name}
          </h1>
          <p className="text-sm text-slate-500">
            Plan {data.org.planName ?? "—"} ·{" "}
            {data.agents.filter((a) => a.active).length}/{data.org.agentLimit}{" "}
            agenți activi
          </p>
        </div>
        <Badge status={data.org.status}>{data.org.status}</Badge>
      </header>

      {data.org.status === "trial" && data.org.trialEndsAt && (
        <Alert kind="info">
          Perioada de probă se termină pe{" "}
          {new Date(data.org.trialEndsAt).toLocaleDateString("ro-RO")}.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vizite azi / săptămână"
          value={`${data.visits.azi} / ${data.visits.saptamana}`}
          hint={`${data.visits.luna} luna asta`}
          tone="indigo"
          icon={<ClipboardList className="h-5 w-5" />}
        />
        <StatCard
          label="Clienți"
          value={formatNumber(data.clients.total)}
          hint={`+${data.clients.noi30} în ultimele 30 zile`}
          tone="emerald"
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label="De vizitat (7 zile)"
          value={formatNumber(data.due)}
          hint="clienți fără vizită săptămâna asta"
          tone={data.due > 0 ? "rose" : "emerald"}
          icon={<CalendarClock className="h-5 w-5" />}
        />
        <StatCard
          label="Conversii (30 zile)"
          value={formatNumber(conversii)}
          hint={`${data.clients.contactati} în discuții`}
          tone="amber"
          icon={<UserRound className="h-5 w-5" />}
        />
      </div>

      {inConcediu.length > 0 && (
        <Alert kind="info">
          În concediu:{" "}
          {inConcediu
            .map(
              (a) =>
                `${a.name} (până la ${new Date(a.awayUntil!).toLocaleDateString("ro-RO")})`,
            )
            .join(" · ")}
        </Alert>
      )}

      {data.agents.length === 0 && (
        <Card className="border-[#ff4d00] bg-[#fdeee3]">
          <h2 className="text-sm font-black uppercase tracking-widest text-[#161412]">
            🚀 Primii pași — firma ta e gata în 10 minute
          </h2>
          <ol className="mt-3 space-y-2.5 text-sm font-medium text-[#161412]/80">
            <li>
              <strong>1. Adaugă agenții</strong> — în{" "}
              <Link href="/agentie/agenti" className="font-bold text-[#ff4d00] underline">
                Agenți
              </Link>{" "}
              → „Agent nou": pui numele EXACT ca în rapoartele de vânzări și
              trimiți linkul pe WhatsApp.
            </li>
            <li>
              <strong>2. Urcă vânzările</strong> — în{" "}
              <Link href="/agentie/vanzari" className="font-bold text-[#ff4d00] underline">
                Vânzări
              </Link>
              : fișierul XLS/CSV îl scoți din SAGA (Situații → Ieșiri pe
              documente → Export Excel). Coloanele se detectează singure.
            </li>
            <li>
              <strong>3. Importă soldurile</strong> — în{" "}
              <Link href="/agentie/solduri" className="font-bold text-[#ff4d00] underline">
                Solduri
              </Link>
              : copy-paste din raportul „Solduri clienți" din SAGA — restanțele
              apar la agenți pe hartă.
            </li>
          </ol>
        </Card>
      )}

      <BriefingCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Activitatea agenților (săptămâna asta)
            </h2>
            <Link
              href="/agentie/agenti"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              Gestionează →
            </Link>
          </div>
          {data.agents.length === 0 ? (
            <EmptyState text="Niciun agent încă — adaugă primul din pagina Agenți." />
          ) : (
            <ul className="space-y-2">
              {[...data.agents]
                .sort((a, b) => b.visitsWeek - a.visitsWeek)
                .map((a) => {
                  const max = Math.max(...data.agents.map((x) => x.visitsWeek), 1);
                  const away =
                    a.awayUntil &&
                    a.awayUntil >= todayISO() &&
                    (!a.awayFrom || a.awayFrom <= todayISO());
                  return (
                    <li key={a.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span
                          className={`font-medium ${a.active ? "text-slate-800" : "text-slate-400 line-through"}`}
                        >
                          {a.name}
                          {away && (
                            <span className="ml-1.5 text-xs text-sky-600">
                              🏖 concediu
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500">
                          {/* „1 vizite" arată ca o aplicație făcută în
                              genunchi. Omul se uită la ecranul ăsta în
                              fiecare zi. */}
                          {a.visitsWeek} {a.visitsWeek === 1 ? "vizită" : "vizite"}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                        <div
                          className="h-1.5 rounded-full bg-emerald-500"
                          style={{ width: `${(a.visitsWeek / max) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Ultimele vizite din teren
            </h2>
            <Link
              href="/agentie/vizite"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              Toate →
            </Link>
          </div>
          {data.recentVisits.length === 0 ? (
            <EmptyState text="Nicio vizită înregistrată încă." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentVisits.slice(0, 8).map((v, i) => (
                <li key={i} className="py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <p className="min-w-0 truncate font-medium text-slate-800">
                      {v.denumire || "—"}
                    </p>
                    <span className="shrink-0 text-xs text-slate-500">
                      {RESULT_LABELS[v.result] ?? v.result}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {v.agentName} · {formatDateTime(v.visitedAt)}
                    {v.note ? ` · „${v.note}"` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
