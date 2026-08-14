import Link from "next/link";

/**
 * 404 pe românește. Cel mai frecvent caz REAL: un agent deschide un link
 * expirat sau tăiat/stricat de WhatsApp — fără pagina asta primea
 * „This page could not be found" în engleză și nu știa ce să facă.
 */
export default function NotFound() {
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
          maxWidth: 460,
          background: "#fff",
          border: "3px solid #161412",
          boxShadow: "6px 6px 0 #161412",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>🔗</div>
        <h1 style={{ fontSize: 18, margin: "10px 0 6px", color: "#161412" }}>
          Pagina asta nu există (sau linkul nu mai e bun)
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "#161412",
            opacity: 0.75,
            margin: 0,
            lineHeight: 1.55,
            textAlign: "left",
          }}
        >
          Dacă ai ajuns aici dintr-un <strong>link de agent</strong>:
        </p>
        <ul
          style={{
            fontSize: 14,
            color: "#161412",
            opacity: 0.75,
            margin: "8px 0 0",
            paddingLeft: 20,
            lineHeight: 1.55,
            textAlign: "left",
          }}
        >
          <li>
            verifică dacă linkul s-a copiat <strong>întreg</strong> din WhatsApp
            (e lung — uneori se taie); apasă direct pe el, nu-l rescrie
          </li>
          <li>
            dacă tot nu merge, linkul a expirat sau a fost înlocuit —{" "}
            <strong>cere-i managerului unul nou</strong> (îl face într-un minut)
          </li>
        </ul>
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "12px 22px",
            fontSize: 15,
            fontWeight: 700,
            background: "#ff4d00",
            color: "#fff",
            border: "2px solid #161412",
            textDecoration: "none",
          }}
        >
          Prima pagină
        </Link>
      </div>
    </main>
  );
}
