"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertOctagon, KeyRound } from "lucide-react";
import { Alert, Card, EmptyState, api, formatDateTime, inputClass } from "../../ui";

interface Err {
  kind: string;
  message: string;
  page: string;
  status: number | null;
  count: number;
  last: string;
}
interface FailedLogin {
  kind: string;
  email: string;
  ip: string;
  count: number;
  last: string;
}
interface Act {
  actor: string;
  action: string;
  target: string;
  at: string;
}

/**
 * ACTIVITATE: vezi TU unde se împiedică utilizatorii — erori prinse
 * automat din browserele lor, login-uri eșuate și tot ce au făcut —
 * fără ca ei să raporteze nimic.
 */
export default function ActivitatePage() {
  const [errors, setErrors] = useState<Err[]>([]);
  const [failedLogins, setFailedLogins] = useState<FailedLogin[]>([]);
  const [activity, setActivity] = useState<Act[]>([]);
  const [hours, setHours] = useState(48);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{
        errors: Err[];
        failedLogins: FailedLogin[];
        activity: Act[];
      }>(`/api/platform/activity?hours=${hours}`);
      setErrors(d.errors);
      setFailedLogins(d.failedLogins);
      setActivity(d.activity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Activitate & erori
          </h1>
          <p className="text-sm text-slate-500">
            Ce se împiedică la utilizatori — prins automat, fără să raporteze
            ei. Se reîmprospătează singur la un minut.
          </p>
        </div>
        <select
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value))}
          className={`${inputClass} mt-0 w-44`}
        >
          <option value={6}>Ultimele 6 ore</option>
          <option value={24}>Ultimele 24 ore</option>
          <option value={48}>Ultimele 2 zile</option>
          <option value={168}>Ultima săptămână</option>
        </select>
      </header>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : (
        <>
          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <AlertOctagon className="h-4 w-4 text-rose-500" />
              Erori prinse automat ({errors.length})
            </h2>
            {errors.length === 0 ? (
              <EmptyState text="Nicio eroare în perioada asta — totul curge. 🎉" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {errors.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">
                        <span
                          className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                            e.kind === "api_error"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {e.kind === "api_error" ? `API ${e.status ?? ""}` : "CRASH JS"}
                        </span>
                        {e.message}
                      </p>
                      <p className="text-xs text-slate-500">pe pagina {e.page || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      <p className="font-semibold text-slate-700">×{e.count}</p>
                      <p>{formatDateTime(e.last)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <KeyRound className="h-4 w-4 text-amber-500" />
              Login-uri eșuate ({failedLogins.length})
            </h2>
            {failedLogins.length === 0 ? (
              <EmptyState text="Nimeni nu s-a împiedicat la intrare." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {failedLogins.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <p className="font-medium text-slate-800">
                      {f.email}
                      <span className="ml-2 text-xs text-slate-400">
                        {f.kind} · IP {f.ip || "—"}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">×{f.count}</span>{" "}
                      · ultima: {formatDateTime(f.last)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Activity className="h-4 w-4 text-emerald-600" />
              Ce au făcut utilizatorii ({activity.length})
            </h2>
            {activity.length === 0 ? (
              <EmptyState text="Nicio acțiune în perioada asta." />
            ) : (
              <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                {activity.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                    <p className="min-w-0 truncate text-slate-700">
                      <span className="font-medium text-slate-900">{a.actor}</span>{" "}
                      · {a.action}
                      {a.target ? <span className="text-slate-400"> → {a.target}</span> : null}
                    </p>
                    <p className="shrink-0 text-xs text-slate-400">{formatDateTime(a.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
