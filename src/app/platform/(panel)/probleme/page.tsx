"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, CheckCircle2 } from "lucide-react";
import {
  Alert,
  Card,
  EmptyState,
  api,
  formatDateTime,
} from "../../ui";

interface Issue {
  id: string;
  reporter: string;
  role: string;
  page: string;
  message: string;
  aiDiagnosis: string;
  status: string;
  createdAt: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  noua: { label: "🆕 nouă", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  in_lucru: { label: "🔧 în lucru", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  rezolvata: { label: "✅ rezolvată", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

export default function ProblemePage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [counts, setCounts] = useState({ noi: 0, total: 0 });
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ issues: Issue[]; noi: number; total: number }>(
        `/api/platform/issues?status=${status}`,
      );
      setIssues(d.issues);
      setCounts({ noi: d.noi, total: d.total });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function setIssueStatus(id: string, to: string) {
    try {
      await api("/api/platform/issues", { method: "PATCH", json: { id, status: to } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Probleme raportate
        </h1>
        <p className="text-sm text-slate-500">
          {counts.noi} noi din {counts.total} — fiecare vine cu diagnosticul AI
          gata făcut. Copiază-l lui Claude (în sesiunea de development) pentru
          fix.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {["", "noua", "in_lucru", "rezolvata"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              status === s
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {s === "" ? "Toate" : STATUS_META[s]?.label ?? s}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : issues.length === 0 ? (
        <EmptyState text="Nicio problemă raportată. 🎉" />
      ) : (
        <div className="space-y-3">
          {issues.map((i) => {
            const meta = STATUS_META[i.status] ?? STATUS_META.noua;
            return (
              <Card key={i.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      <Bug className="h-4 w-4 shrink-0 text-rose-500" />
                      {i.message}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {i.reporter} ({i.role}) · {i.page || "pagină necunoscută"} ·{" "}
                      {formatDateTime(i.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                    {i.status !== "rezolvata" && (
                      <button
                        type="button"
                        onClick={() => setIssueStatus(i.id, "rezolvata")}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Rezolvată
                      </button>
                    )}
                  </div>
                </div>
                {i.aiDiagnosis && (
                  <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-700">
                    {i.aiDiagnosis}
                  </pre>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
