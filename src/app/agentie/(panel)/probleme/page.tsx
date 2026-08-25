"use client";

import { useEffect, useState } from "react";

import { Alert, Card, EmptyState, api } from "@/app/platform/ui";

/**
 * RAPOARTELE OAMENILOR TĂI — ce au trimis agenții (și birourile) din
 * butonul 💬 „Raportează o problemă". Până acum ajungeau doar la
 * platformă; acum administratorul/managerul le vede aici, cu soluția
 * dată pe loc de AI, ca să știe ce-i doare pe băieți fără telefoane.
 */

interface Issue {
  id: string;
  reporter: string;
  role: string;
  page: string;
  message: string;
  solutie: string;
  status: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  noua: "nouă",
  in_lucru: "în lucru",
  rezolvata: "rezolvată",
};

export default function ProblemePage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ issues: Issue[] }>("/api/agentie/issues");
        setIssues(d.issues);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Probleme raportate</h1>
        <p className="text-sm text-slate-500">
          Ce au trimis oamenii tăi din butonul 💬 — cu soluția primită pe
          loc. Problemele ajung și la echipa platformei, care le repară.
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? (
        <Card>
          <p className="p-4 text-sm text-slate-500">Se încarcă…</p>
        </Card>
      ) : issues.length === 0 ? (
        <EmptyState text="Nicio problemă raportată încă. Când un agent apasă 💬 și scrie ce nu-i merge, raportul apare aici." />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {issues.map((i) => (
              <li key={i.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{i.reporter}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {i.role === "agent" ? "agent de teren" : i.role}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      i.status === "rezolvata"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : i.status === "in_lucru"
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-indigo-50 text-indigo-700 ring-indigo-200"
                    }`}
                  >
                    {STATUS_LABEL[i.status] ?? i.status}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {new Date(i.createdAt).toLocaleString("ro-RO", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="break-words text-sm text-slate-800">{i.message}</p>
                {i.solutie && (
                  <p className="break-words rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                    💡 Soluția dată pe loc: {i.solutie}
                  </p>
                )}
                {i.page && (
                  <p className="text-[11px] text-slate-400">pagina: {i.page}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
