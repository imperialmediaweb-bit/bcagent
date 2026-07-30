"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Building2,
  CircleDollarSign,
  Database,
  Users,
} from "lucide-react";
import type { Invoice, Organization, PlatformMetrics } from "@/modules/platform/types";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  StatCard,
  api,
  formatDate,
  formatMoney,
  formatNumber,
} from "../ui";

interface MetricsResponse {
  metrics: PlatformMetrics;
  series: Array<{ month: string; orgs: number; paidCents: number }>;
  recentOrgs: Organization[];
  recentInvoices: Invoice[];
}

export default function PlatformDashboard() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MetricsResponse>("/api/platform/metrics")
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

  const m = data.metrics;
  const chart = data.series.map((s) => ({
    luna: s.month.slice(5) + "." + s.month.slice(2, 4),
    Organizații: s.orgs,
    Încasat: s.paidCents / 100,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Dashboard platformă
        </h1>
        <p className="text-sm text-slate-500">
          Starea generală a SaaS-ului: clienți, abonamente, încasări.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Venit lunar recurent"
          value={formatMoney(m.mrrCents)}
          hint={`${m.orgs.activ} organizații active`}
          tone="emerald"
          icon={<CircleDollarSign className="h-5 w-5" />}
        />
        <StatCard
          label="Organizații"
          value={formatNumber(m.orgs.total)}
          hint={`${m.orgs.trial} în trial · ${m.orgs.suspendat} suspendate`}
          tone="indigo"
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label="Utilizatori & agenți"
          value={`${formatNumber(m.users)} / ${formatNumber(m.agents)}`}
          hint="conturi firmă / agenți de teren"
          tone="amber"
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Bază de prospecți"
          value={formatNumber(m.prospects.total)}
          hint={`${formatNumber(m.prospects.verified)} verificate ANAF`}
          tone="slate"
          icon={<Database className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Încasări lunare (RON)
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="incasari" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="luna" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={50} />
                <Tooltip
                  formatter={(v: number) => `${new Intl.NumberFormat("ro-RO").format(v)} RON`}
                  contentStyle={{ borderRadius: 12, fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="Încasat"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#incasari)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-800">
            Organizații noi / lună
          </h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="luna" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={30} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="Organizații" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Ultimele organizații
            </h2>
            <Link
              href="/platform/organizatii"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Vezi toate →
            </Link>
          </div>
          {data.recentOrgs.length === 0 ? (
            <EmptyState text="Încă nu există organizații. Adaugă prima firmă de distribuție." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentOrgs.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/platform/organizatii/${o.id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
                    >
                      {o.name}
                    </Link>
                    <p className="truncate text-xs text-slate-500">
                      {o.planName ?? "fără plan"} · {formatDate(o.createdAt)}
                    </p>
                  </div>
                  <Badge status={o.status}>{o.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              Ultimele facturi
            </h2>
            <Link
              href="/platform/facturi"
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
            >
              Vezi toate →
            </Link>
          </div>
          {data.recentInvoices.length === 0 ? (
            <EmptyState text="Nicio factură încă." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {inv.number || inv.id}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {inv.orgName ?? "—"} · {formatDate(inv.issuedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      {formatMoney(inv.amountCents, inv.currency)}
                    </span>
                    <Badge status={inv.status}>{inv.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-800">Facturare</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Încasat total</p>
            <p className="text-lg font-semibold text-emerald-600">
              {formatMoney(m.invoices.paidCents)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">De încasat</p>
            <p className="text-lg font-semibold text-amber-600">
              {formatMoney(m.invoices.openCents)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Facturi emise</p>
            <p className="text-lg font-semibold text-slate-800">
              {formatNumber(m.invoices.count)}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
