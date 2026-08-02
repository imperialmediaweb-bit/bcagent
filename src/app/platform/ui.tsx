"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Primitive UI refolosite în tot panoul de super-admin. */

export function formatMoney(cents: number, currency = "RON"): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("ro-RO").format(n);
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border-2 border-[#161412] bg-white p-5 shadow-[4px_4px_0_rgba(22,20,18,0.9)] ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "indigo",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "indigo" | "emerald" | "amber" | "rose" | "slate";
  icon?: ReactNode;
}) {
  const tones: Record<string, string> = {
    indigo: "#ff4d00",
    emerald: "#0b5d3b",
    amber: "#ffd23f",
    rose: "#9f1239",
    slate: "#161412",
  };
  const iconText = tone === "amber" ? "text-[#161412]" : "text-white";
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-black uppercase tracking-widest text-[#161412]/50">
            {label}
          </p>
          <p className="display mt-1 text-2xl font-extrabold tracking-tight text-[#161412]">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs font-medium text-[#161412]/55">{hint}</p>}
        </div>
        {icon && (
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 border-[#161412] ${iconText}`}
            style={{ background: tones[tone], boxShadow: "3px 3px 0 rgba(22,20,18,0.9)" }}
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

const STATUS_STYLES: Record<string, string> = {
  activ: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  trial: "bg-sky-50 text-sky-700 ring-sky-200",
  suspendat: "bg-amber-50 text-amber-700 ring-amber-200",
  anulat: "bg-slate-100 text-slate-600 ring-slate-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  open: "bg-sky-50 text-sky-700 ring-sky-200",
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  void: "bg-slate-100 text-slate-500 ring-slate-200",
  uncollectible: "bg-rose-50 text-rose-700 ring-rose-200",
};

export function Badge({
  children,
  status,
}: {
  children: ReactNode;
  status?: string;
}) {
  const style =
    (status && STATUS_STYLES[status]) ||
    "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants: Record<string, string> = {
    primary:
      "border-2 border-[#161412] bg-[#ff4d00] text-white shadow-[3px_3px_0_rgba(22,20,18,0.9)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none",
    secondary:
      "border-2 border-[#161412] bg-white text-[#161412] shadow-[3px_3px_0_rgba(22,20,18,0.9)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none",
    danger:
      "border-2 border-[#161412] bg-rose-600 text-white shadow-[3px_3px_0_rgba(22,20,18,0.9)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none",
    ghost: "text-[#161412]/60 hover:bg-[#161412]/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "mt-1 block w-full rounded-lg border-2 border-[#161412]/80 bg-white px-3 py-2 text-sm font-medium text-[#161412] outline-none transition focus:border-[#161412] focus:bg-[#fdf3d8]";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border-2 border-[#161412] bg-white p-5 shadow-[6px_6px_0_rgba(22,20,18,0.9)] sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Închide"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "bg-rose-50 text-rose-700 border-rose-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles[kind]}`}>
      {children}
    </div>
  );
}

/** Text cu buton de copiere — pentru parole generate și linkuri magice. */
export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {label && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
      )}
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800"
        />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // clipboard blocat — utilizatorul poate selecta manual
            }
          }}
        >
          {copied ? "✓" : "Copiază"}
        </Button>
      </div>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

/** Wrapper de fetch care întoarce mereu JSON și aruncă cu mesajul serverului. */
export async function api<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json
      ? { "Content-Type": "application/json", ...(rest.headers ?? {}) }
      : rest.headers,
    body: json ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Răspuns invalid de la server (${res.status})`);
  }
  if (!res.ok) {
    // Sesiunea a expirat (panoul se reîmprospătează singur la un minut):
    // nu e o eroare de arătat, ci un motiv să te ducem la login.
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/platform/login")
    ) {
      window.location.href = "/platform/login";
      throw new Error("Sesiune expirată — te ducem la autentificare.");
    }
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Eroare ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}
