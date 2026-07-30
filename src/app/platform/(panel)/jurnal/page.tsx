"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry } from "@/modules/platform/types";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  api,
  formatDateTime,
  formatNumber,
  inputClass,
} from "../../ui";

const PAGE_SIZE = 100;

const ACTION_LABELS: Record<string, string> = {
  "admin.login": "Autentificare admin",
  "admin.bootstrap": "Creare cont admin inițial",
  "admin.password": "Schimbare parolă admin",
  "org.create": "Organizație creată",
  "org.update": "Organizație modificată",
  "org.delete": "Organizație ștearsă",
  "orguser.create": "Cont firmă creat",
  "orguser.reset": "Parolă resetată",
  "orguser.activate": "Cont activat",
  "orguser.deactivate": "Cont dezactivat",
  "orguser.delete": "Cont șters",
  "agent.token": "Link agent emis",
  "plan.upsert": "Plan salvat",
  "plan.delete": "Plan șters",
  "invoice.create": "Factură creată",
  "invoice.status": "Status factură schimbat",
  "invoice.delete": "Factură ștearsă",
  "billing.checkout": "Link de plată generat",
  "billing.portal": "Portal facturare deschis",
  "billing.sync": "Facturi sincronizate",
};

export default function JurnalPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ entries: AuditEntry[]; total: number }>(
        `/api/platform/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      );
      setEntries(data.entries);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) =>
        `${e.actor} ${e.action} ${e.target}`.toLowerCase().includes(q),
      )
    : entries;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Jurnal de activitate
        </h1>
        <p className="text-sm text-slate-500">
          {formatNumber(total)} acțiuni înregistrate — cine a făcut ce și când.
        </p>
      </header>

      <Card className="p-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrează în pagina curentă (email, acțiune, țintă)"
          className={`${inputClass} mt-0`}
        />
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : shown.length === 0 ? (
        <EmptyState text="Nicio acțiune înregistrată." />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {ACTION_LABELS[e.action] ?? e.action}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {e.actor}
                    {e.target ? ` → ${e.target}` : ""}
                  </p>
                  {Object.keys(e.meta).length > 0 && (
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
                      {JSON.stringify(e.meta)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-400">
                  {formatDateTime(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Înapoi
          </Button>
          <span className="text-sm text-slate-500">
            Pagina {page + 1} din {pages}
          </span>
          <Button
            variant="secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Înainte →
          </Button>
        </div>
      )}
    </div>
  );
}
