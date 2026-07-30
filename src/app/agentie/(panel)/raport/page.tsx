"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Printer } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  api,
  formatNumber,
} from "@/app/platform/ui";
import type { WeeklyReport } from "@/modules/platform/weekly-report";

/** Raportul săptămânal: cifrele echipei + concluzia AI, de printat sau primit pe email. */
export default function RaportPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ report: WeeklyReport; emailEnabled: boolean }>("/api/agentie/report")
      .then((d) => {
        setReport(d.report);
        setEmailEnabled(d.emailEnabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function sendMail() {
    setSending(true);
    setNotice(null);
    try {
      const res = await api<{ to: string }>("/api/agentie/report", {
        method: "POST",
      });
      setNotice(`Trimis pe ${res.to} ✓`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!report)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Adun cifrele săptămânii și concluzia AI...
      </p>
    );

  const t = report.totals;
  const trend =
    t.visitsLastWeek > 0
      ? Math.round(((t.visits - t.visitsLastWeek) / t.visitsLastWeek) * 100)
      : null;

  return (
    <div className="space-y-5 print:text-black">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Raportul săptămânii
          </h1>
          <p className="text-sm text-slate-500">
            {report.orgName} · {report.periodLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Printează
          </Button>
          {emailEnabled && (
            <Button onClick={sendMail} disabled={sending}>
              <Mail className="h-4 w-4" />
              {sending ? "Se trimite..." : "Trimite-mi pe email"}
            </Button>
          )}
        </div>
      </header>
      {notice && <Alert kind="info">{notice}</Alert>}
      {!emailEnabled && (
        <p className="text-xs text-slate-400 print:hidden">
          💡 Cu RESEND_API_KEY setat, raportul pleacă singur pe email în
          fiecare luni la 7:00 (vezi documentația cronului).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            "Vizite",
            `${t.visits}`,
            trend !== null ? `${trend >= 0 ? "+" : ""}${trend}% vs săpt. trecută` : "prima săptămână",
          ],
          ["Clienți noi", `${t.conversions}`, "conversii din teren"],
          [
            "Comenzi",
            `${t.ordersCount}`,
            t.ordersValue ? `${formatNumber(t.ordersValue)} lei` : "—",
          ],
          [
            "De recuperat",
            `${t.dueClients}`,
            `nevizitați · restanțe ${formatNumber(t.restanteRON)} lei`,
          ],
        ].map(([l, v, h]) => (
          <Card key={l as string} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {l}
            </p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{v}</p>
            <p className="mt-0.5 text-xs text-slate-500">{h}</p>
          </Card>
        ))}
      </div>

      {report.aiBriefing && (
        <Card className="border-amber-200 bg-amber-50/60">
          <p className="text-sm font-semibold text-slate-800">🧠 Pe scurt</p>
          <p className="mt-1 leading-relaxed text-slate-700">
            {report.aiBriefing}
          </p>
        </Card>
      )}

      {report.agents.length === 0 ? (
        <EmptyState text="Niciun agent activ — raportul se umple singur când echipa lucrează." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 text-right font-medium">Vizite</th>
                <th className="px-4 py-3 text-right font-medium">Săpt. trecută</th>
                <th className="px-4 py-3 text-right font-medium">Clienți noi</th>
                <th className="px-4 py-3 text-right font-medium">Comenzi</th>
                <th className="px-4 py-3 text-right font-medium">Target lună</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.agents.map((a) => (
                <tr key={a.name} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {a.visitsThisWeek}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      a.visitsThisWeek < a.visitsLastWeek
                        ? "text-rose-600"
                        : "text-slate-500"
                    }`}
                  >
                    {a.visitsLastWeek}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600">
                    {a.conversions || "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {a.ordersCount}
                    {a.ordersValue ? ` (${formatNumber(a.ordersValue)} lei)` : ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.targetPct !== null ? (
                      <span
                        className={`font-semibold ${
                          a.targetPct >= 100
                            ? "text-emerald-600"
                            : a.targetPct >= 70
                              ? "text-amber-600"
                              : "text-rose-600"
                        }`}
                      >
                        {a.targetPct}%
                      </span>
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
