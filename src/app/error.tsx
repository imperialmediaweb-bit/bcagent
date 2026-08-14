"use client";

import { useEffect } from "react";

/**
 * PLASA DE SIGURANȚĂ a întregii aplicații: orice crash de JavaScript sau
 * bucată de cod care nu s-a descărcat (semnal slab pe teren!) NU mai
 * lasă ecran alb mut — omul vede un mesaj clar și un buton de reîncărcare.
 *
 * Caz special: „chunk load failed" (rețeaua a scăpat o bucată din
 * aplicație) — reîncărcăm automat O dată; de obicei a doua încărcare
 * reușește și utilizatorul nici nu apucă să vadă ecranul.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = String(error?.message ?? "");
    const eChunk =
      /chunk|Loading chunk|dynamically imported module|import\(\)|failed to fetch/i.test(
        msg,
      );
    if (eChunk && !sessionStorage.getItem("chunk-reload")) {
      sessionStorage.setItem("chunk-reload", "1");
      window.location.reload();
    }
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5efe4",
        padding: 20,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          background: "#fff",
          border: "3px solid #161412",
          boxShadow: "6px 6px 0 #161412",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>📵</div>
        <h1 style={{ fontSize: 18, margin: "10px 0 6px", color: "#161412" }}>
          S-a împiedicat ceva
        </h1>
        <p style={{ fontSize: 14, color: "#161412", opacity: 0.7, margin: 0 }}>
          Cel mai des e semnalul slab. Apasă butonul și își revine —
          nimic din ce ai lucrat nu s-a pierdut.
        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem("chunk-reload");
            reset();
            window.location.reload();
          }}
          style={{
            marginTop: 16,
            padding: "12px 22px",
            fontSize: 15,
            fontWeight: 700,
            background: "#ff4d00",
            color: "#fff",
            border: "2px solid #161412",
            cursor: "pointer",
          }}
        >
          🔄 Reîncarcă
        </button>
      </div>
    </main>
  );
}
