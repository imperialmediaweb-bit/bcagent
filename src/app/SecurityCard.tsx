"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Alert, Button, Card, api, formatDateTime, inputClass } from "@/app/platform/ui";

interface LoginEvent {
  ip: string;
  ok: boolean;
  createdAt: string;
}

/**
 * „Ca la bancă": autentificare în doi pași (Google Authenticator) +
 * istoricul conectărilor contului. Folosită și în panoul agenției, și
 * în cel de platformă — doar endpointul diferă.
 */
export default function SecurityCard({ endpoint }: { endpoint: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [history, setHistory] = useState<LoginEvent[]>([]);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ totpEnabled: boolean; history: LoginEvent[] }>(endpoint);
      setEnabled(d.totpEnabled);
      setHistory(d.history ?? []);
    } catch {
      setEnabled(null);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string) {
    setBusy(true);
    setMsg(null);
    try {
      const d = await api<{ qr?: string; secret?: string; ok?: boolean }>(endpoint, {
        method: "POST",
        json: { action, otp },
      });
      if (action === "init" && d.qr) {
        setSetup({ qr: d.qr, secret: d.secret ?? "" });
      }
      if (action === "enable" && d.ok) {
        setSetup(null);
        setOtp("");
        setMsg({ kind: "success", text: "2FA activat — de acum login-ul cere și codul din aplicație." });
        await load();
      }
      if (action === "disable" && d.ok) {
        setOtp("");
        setMsg({ kind: "success", text: "2FA dezactivat." });
        await load();
      }
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
        {enabled ? (
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
        ) : (
          <ShieldOff className="h-4 w-4 text-slate-400" />
        )}
        Securitatea contului
      </h2>
      <p className="text-xs text-slate-500">
        Autentificare în doi pași (cod din Google Authenticator la fiecare
        login) + istoricul conectărilor tale.
      </p>

      <div className="mt-3 space-y-3">
        {enabled === false && !setup && (
          <Button onClick={() => act("init")} disabled={busy}>
            🔐 Activează 2FA
          </Button>
        )}

        {setup && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">
              1. Scanează codul cu <strong>Google Authenticator</strong> (sau
              Microsoft Authenticator / Authy):
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR 2FA" className="h-40 w-40 rounded-lg bg-white p-1" />
            <p className="text-xs text-slate-500">
              Nu poți scana? Introdu manual cheia:{" "}
              <code className="rounded bg-white px-1 font-mono">{setup.secret}</code>
            </p>
            <p className="text-sm font-medium text-slate-700">
              2. Scrie codul de 6 cifre afișat de aplicație:
            </p>
            <div className="flex gap-2">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                className={`${inputClass} mt-0 w-32 text-center font-mono text-lg tracking-widest`}
              />
              <Button onClick={() => act("enable")} disabled={busy || otp.length !== 6}>
                Confirmă
              </Button>
            </div>
          </div>
        )}

        {enabled === true && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              ✓ 2FA activ
            </span>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="cod curent"
              className={`${inputClass} mt-0 w-28 text-center font-mono`}
            />
            <button
              type="button"
              onClick={() => act("disable")}
              disabled={busy || otp.length !== 6}
              className="text-xs text-slate-400 hover:text-rose-600 disabled:opacity-50"
            >
              Dezactivează
            </button>
          </div>
        )}

        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Ultimele conectări
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-xs">
              {history.slice(0, 8).map((h, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5">
                  <span className={h.ok ? "text-slate-600" : "font-semibold text-rose-600"}>
                    {h.ok ? "✓ reușit" : "✗ eșuat"}
                  </span>
                  <span className="text-slate-400">IP {h.ip || "—"}</span>
                  <span className="text-slate-500">{formatDateTime(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
