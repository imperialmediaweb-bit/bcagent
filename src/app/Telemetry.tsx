"use client";

import { useEffect } from "react";

/**
 * Paznicul tăcut: prinde AUTOMAT tot ce se împiedică la utilizator —
 * crash-uri JavaScript și cereri API care pică (status >= 400) — și le
 * trimite la /api/telemetry. Utilizatorul nu vede și nu face nimic;
 * adminul le găsește în /platform/activitate.
 *
 * Reguli de siguranță: fire-and-forget (nu blochează nimic), dedupe pe
 * sesiune (max 25 de rapoarte), orice defect al paznicului e înghițit.
 */
export default function Telemetry() {
  useEffect(() => {
    const seen = new Set<string>();
    let budget = 25;

    function report(kind: "js_error" | "api_error", message: string, status?: number) {
      try {
        const sig = `${kind}|${message.slice(0, 120)}`;
        if (seen.has(sig) || budget <= 0) return;
        seen.add(sig);
        budget--;
        const payload = JSON.stringify({
          kind,
          message: message.slice(0, 500),
          status,
          page: window.location.pathname,
        });
        // sendBeacon nu ține pagina ocupată și merge și la închidere.
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/telemetry",
            new Blob([payload], { type: "application/json" }),
          );
        } else {
          fetch("/api/telemetry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // paznicul nu are voie să facă el însuși probleme
      }
    }

    const onError = (e: ErrorEvent) => {
      report("js_error", `${e.message} @ ${e.filename ?? "?"}:${e.lineno ?? 0}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report("js_error", `unhandled: ${r instanceof Error ? r.message : String(r).slice(0, 200)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // Interceptăm fetch: orice răspuns >= 400 de la propriile API-uri se
    // raportează. Comportamentul cererii rămâne 100% neatins.
    const orig = window.fetch.bind(window);
    const patched: typeof window.fetch = async (input, init) => {
      const res = await orig(input, init);
      try {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.pathname
              : input.url;
        const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
        if (
          res.status >= 400 &&
          path.startsWith("/api/") &&
          !path.startsWith("/api/telemetry")
        ) {
          report("api_error", `${init?.method ?? "GET"} ${path}`, res.status);
        }
      } catch {
        // niciodată nu stricăm cererea originală
      }
      return res;
    };
    window.fetch = patched;

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.fetch = orig;
    };
  }, []);

  return null;
}
