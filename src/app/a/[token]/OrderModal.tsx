"use client";

import { useEffect, useState } from "react";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
import MicButton from "./MicButton";

/**
 * Comanda din teren: agentul o bate la client în 30 de secunde.
 * Liniile sunt libere (produs + cantitate + UM + preț opțional) —
 * fără catalog impus, exact ca pe foaia de hârtie, dar ajunge instant
 * la depozit.
 */

interface Line {
  produs: string;
  cantitate: string;
  um: string;
  pret: string;
}

const EMPTY_LINE: Line = { produs: "", cantitate: "", um: "bax", pret: "" };
const UMS = ["buc", "bax", "cartus", "pachet", "kg", "l"];
const DRAFT_KEY = "bcagent:order-draft";

export default function OrderModal({
  token,
  firm,
  onClose,
  onSent,
}: {
  token: string;
  firm: {
    cui: string;
    denumire: string;
    localitate: string;
    soldCents?: number | null;
  } | null;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // VAN SALES: la firmele de van agentul vinde marfa pe loc, din mașină —
  // preferința rămâne salvată, nu o alege la fiecare client.
  const [tip, setTip] = useState<"comanda" | "van">("comanda");
  const [plata, setPlata] = useState<"numerar" | "card" | "termen">("numerar");
  useEffect(() => {
    try {
      const t = localStorage.getItem("bcagent:order-tip");
      if (t === "van" || t === "comanda") setTip(t);
    } catch {
      // fără localStorage — rămâne comanda
    }
  }, []);
  function switchTip(t: "comanda" | "van") {
    setTip(t);
    try {
      localStorage.setItem("bcagent:order-tip", t);
    } catch {
      // nimic
    }
  }

  // Draft local: dacă pică semnalul în magazin, comanda nu se pierde.
  useEffect(() => {
    if (!firm) return;
    try {
      const raw = localStorage.getItem(`${DRAFT_KEY}:${firm.cui}`);
      if (raw) {
        const d = JSON.parse(raw) as { lines: Line[]; note: string };
        if (d.lines?.length) setLines(d.lines);
        setNote(d.note ?? "");
        return;
      }
    } catch {
      // draft corupt — pornim curat
    }
    setLines([{ ...EMPTY_LINE }]);
    setNote("");
    setError(null);
  }, [firm]);

  useEffect(() => {
    if (!firm) return;
    try {
      localStorage.setItem(
        `${DRAFT_KEY}:${firm.cui}`,
        JSON.stringify({ lines, note }),
      );
    } catch {
      // fără spațiu — mergem fără draft
    }
  }, [lines, note, firm]);

  if (!firm) return null;

  function set(i: number, k: keyof Line, v: string) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  }

  const validLines = lines.filter(
    (l) => l.produs.trim() !== "" && parseFloat(l.cantitate) > 0,
  );
  const total = validLines.every((l) => l.pret !== "")
    ? validLines.reduce(
        (s, l) => s + parseFloat(l.cantitate) * parseFloat(l.pret || "0"),
        0,
      )
    : null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          cui: firm!.cui,
          denumire: firm!.denumire,
          localitate: firm!.localitate,
          note,
          tip,
          plata: tip === "van" ? plata : "",
          lines: validLines.map((l) => ({
            produs: l.produs.trim(),
            cantitate: parseFloat(l.cantitate),
            um: l.um,
            pret: l.pret === "" ? null : parseFloat(l.pret),
          })),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Eroare ${res.status}`);
        return;
      }
      try {
        localStorage.removeItem(`${DRAFT_KEY}:${firm!.cui}`);
      } catch {
        // nimic
      }
      onSent(
        tip === "van"
          ? `Vânzare din mașină salvată ✓ — încasat ${plata}, stocul din dubă s-a scăzut`
          : `Comandă trimisă la depozit ✓ (${validLines.length} produse)`,
      );
      onClose();
    } catch {
      setError("Fără semnal — comanda rămâne salvată local, reîncearcă.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/40 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ShoppingCart className="h-4 w-4 text-emerald-600" />
              {tip === "van" ? "Vânzare din mașină" : "Comandă nouă"}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {firm.denumire} · {firm.localitate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Închide"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchTip("comanda")}
            className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
              tip === "comanda"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            📦 Comandă la depozit
          </button>
          <button
            type="button"
            onClick={() => switchTip("van")}
            className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
              tip === "van"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            🚐 Vând pe loc (van)
          </button>
        </div>

        {firm.soldCents !== undefined &&
          firm.soldCents !== null &&
          firm.soldCents > 0 && (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              ⚠ Clientul are restanță de plată:{" "}
              {(firm.soldCents / 100).toLocaleString("ro-RO")} RON — verifică
              înainte să iei comanda nouă.
            </p>
          )}

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={l.produs}
                onChange={(e) => set(i, "produs", e.target.value)}
                placeholder="Produs (ex: Marlboro Red)"
                className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={l.cantitate}
                onChange={(e) => set(i, "cantitate", e.target.value)}
                placeholder="Cant."
                className="w-16 rounded-md border border-slate-200 px-2 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
              <select
                value={l.um}
                onChange={(e) => set(i, "um", e.target.value)}
                className="rounded-md border border-slate-200 px-1.5 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              >
                {UMS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={l.pret}
                onChange={(e) => set(i, "pret", e.target.value)}
                placeholder="Preț"
                className="w-16 rounded-md border border-slate-200 px-2 py-2 text-sm focus:border-emerald-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  setLines((ls) =>
                    ls.length > 1 ? ls.filter((_, j) => j !== i) : ls,
                  )
                }
                className="shrink-0 rounded-md p-1.5 text-slate-300 hover:text-rose-500"
                aria-label="Șterge linia"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700"
        >
          <Plus className="h-4 w-4" /> Mai adaugă un produs
        </button>

        <div className="mt-3 flex items-center gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notă (opțional): livrare joi, plata la termen..."
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
          />
          <MicButton onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} />
        </div>

        {tip === "van" && (
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500">Încasat:</span>
            {(["numerar", "card", "termen"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlata(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${
                  plata === p
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "bg-white text-slate-600 ring-slate-200"
                }`}
              >
                {p === "numerar" ? "💵 numerar" : p === "card" ? "💳 card" : "📆 la termen"}
              </button>
            ))}
          </div>
        )}

        {total !== null && validLines.length > 0 && (
          <p className="mt-2 text-right text-sm font-semibold text-slate-800">
            Total: {total.toLocaleString("ro-RO", { maximumFractionDigits: 2 })} RON
          </p>
        )}
        {tip === "van" && validLines.length > 0 && total === null && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            La vânzarea pe loc pune prețul pe fiecare produs — e suma pe care
            o încasezi acum.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={
            busy ||
            validLines.length === 0 ||
            (tip === "van" && total === null)
          }
          onClick={send}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy
            ? "Se salvează..."
            : tip === "van"
              ? `Încasează ${total !== null ? total.toLocaleString("ro-RO", { maximumFractionDigits: 2 }) + " RON " : ""}și salvează`
              : `Trimite comanda la depozit (${validLines.length} produse)`}
        </button>
      </div>
    </div>
  );
}
