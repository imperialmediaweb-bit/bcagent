"use client";

/**
 * Ultima linie de apărare: dacă pică chiar layout-ul rădăcină, tot nu
 * lăsăm ecran alb — mesaj + reîncărcare. (Trebuie să-și aducă singur
 * <html>/<body>, aici nu mai există layout.)
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ro">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f5efe4",
          margin: 0,
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
            Apasă butonul și își revine.
          </p>
          <button
            type="button"
            onClick={() => {
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
      </body>
    </html>
  );
}
