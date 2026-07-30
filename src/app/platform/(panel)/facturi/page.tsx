"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import type { Invoice, Organization } from "@/modules/platform/types";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  api,
  formatDate,
  formatMoney,
  formatNumber,
  inputClass,
} from "../../ui";

const STATUSES = ["", "draft", "open", "paid", "uncollectible", "void"];
const PAGE_SIZE = 50;

export default function FacturiPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [orgId, setOrgId] = useState("");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        orgId,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      const data = await api<{ invoices: Invoice[]; total: number }>(
        `/api/platform/invoices?${params}`,
      );
      setInvoices(data.invoices);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, orgId, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ orgs: Organization[] }>("/api/platform/orgs?limit=200")
      .then((d) => setOrgs(d.orgs))
      .catch(() => setOrgs([]));
  }, []);

  async function changeStatus(id: string, next: string) {
    try {
      await api("/api/platform/invoices", {
        method: "PATCH",
        json: { id, status: next },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm("Ștergi factura din platformă? (nu se șterge din Stripe)")) return;
    try {
      await api(`/api/platform/invoices?id=${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function exportCsv() {
    const head = "Numar;Organizatie;Suma;Moneda;Status;Emisa;Platita\n";
    const body = invoices
      .map((i) =>
        [
          i.number,
          i.orgName ?? "",
          (i.amountCents / 100).toFixed(2),
          i.currency,
          i.status,
          formatDate(i.issuedAt),
          formatDate(i.paidAt),
        ].join(";"),
      )
      .join("\n");
    const blob = new Blob(["﻿" + head + body], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sumPaid = invoices
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amountCents, 0);
  const sumOpen = invoices
    .filter((i) => i.status === "open")
    .reduce((s, i) => s + i.amountCents, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Facturi
          </h1>
          <p className="text-sm text-slate-500">
            {formatNumber(total)} facturi · încasat pe pagină{" "}
            {formatMoney(sumPaid)} · de încasat {formatMoney(sumOpen)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!invoices.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Factură manuală
          </Button>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            value={orgId}
            onChange={(e) => {
              setPage(0);
              setOrgId(e.target.value);
            }}
            className={`${inputClass} mt-0 flex-1`}
          >
            <option value="">Toate organizațiile</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => {
              setPage(0);
              setStatus(e.target.value);
            }}
            className={`${inputClass} mt-0 sm:w-48`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "Toate statusurile" : s}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/60" />
      ) : invoices.length === 0 ? (
        <EmptyState text="Nicio factură care să corespundă filtrelor." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Număr</th>
                <th className="px-4 py-3 font-medium">Organizație</th>
                <th className="px-4 py-3 font-medium">Sumă</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Emisă</th>
                <th className="px-4 py-3 font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((i) => (
                <tr key={i.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{i.number || "—"}</p>
                    {i.stripeInvoiceId && (
                      <p className="font-mono text-xs text-slate-400">Stripe</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/organizatii/${i.orgId}`}
                      className="text-slate-700 hover:text-indigo-600"
                    >
                      {i.orgName ?? i.orgId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {formatMoney(i.amountCents, i.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={i.status}
                      onChange={(e) => changeStatus(i.id, e.target.value)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      {STATUSES.filter(Boolean).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(i.issuedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {i.pdfUrl && (
                        <a
                          href={i.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          PDF
                        </a>
                      )}
                      {i.hostedUrl && (
                        <a
                          href={i.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Link
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(i.id)}
                        className="text-rose-500 hover:text-rose-600"
                        title="Șterge"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      <ManualInvoiceModal
        open={showNew}
        orgs={orgs}
        onClose={() => setShowNew(false)}
        onSaved={() => {
          setShowNew(false);
          load();
        }}
      />
    </div>
  );
}

function ManualInvoiceModal({
  open,
  orgs,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgs: Organization[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    orgId: "",
    number: "",
    amount: 0,
    status: "open",
    issuedAt: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/platform/invoices", {
        method: "POST",
        json: {
          orgId: form.orgId,
          number: form.number,
          amountCents: Math.round(form.amount * 100),
          currency: "RON",
          status: form.status,
          issuedAt: new Date(form.issuedAt).toISOString(),
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Factură manuală">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Organizație">
          <select
            value={form.orgId}
            onChange={(e) => setForm((f) => ({ ...f, orgId: e.target.value }))}
            required
            className={inputClass}
          >
            <option value="">Alege...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Serie / număr">
            <input
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              required
              className={inputClass}
              placeholder="BCA-2026-001"
            />
          </Field>
          <Field label="Sumă (RON)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
              }
              className={inputClass}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className={inputClass}
            >
              {STATUSES.filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data emiterii">
            <input
              type="date"
              value={form.issuedAt}
              onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))}
              className={inputClass}
            />
          </Field>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Renunță
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Se salvează..." : "Adaugă factura"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
