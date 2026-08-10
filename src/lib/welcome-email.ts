import { isEmailEnabled, sendEmail } from "@/lib/email";

/**
 * Emailul de BUN VENIT la înregistrarea unei firme noi.
 *
 * Fire-and-forget: dacă emailul nu pleacă (cheie lipsă, domeniu neverificat
 * în Resend), înregistrarea NU se strică — contul e deja creat. Logăm
 * eroarea ca s-o vezi în server, dar utilizatorul intră oricum în panou.
 */
export async function sendWelcomeEmail(opts: {
  to: string;
  firma: string;
  name?: string;
  appUrl: string;
}): Promise<void> {
  if (!isEmailEnabled()) {
    console.warn("[welcome] RESEND_API_KEY lipsește — nu trimit bun venit");
    return;
  }
  const salut = opts.name?.trim() ? `Salut, ${opts.name.trim()}!` : "Salut!";
  const loginUrl = `${opts.appUrl}/agentie/login`;
  const ghidUrl = `${opts.appUrl}/ghid#training`;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#161412">
    <div style="background:#ff4d00;color:#fff;padding:20px 24px;border-radius:14px 14px 0 0">
      <h1 style="margin:0;font-size:20px">Bine ai venit pe Provendi 🎉</h1>
    </div>
    <div style="border:2px solid #161412;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px">
      <p style="font-size:15px">${salut}</p>
      <p style="font-size:15px">
        Contul pentru <b>${escapeHtml(opts.firma)}</b> e gata. Ai
        <b>14 zile de probă cu tot inclus</b>, fără card.
      </p>
      <p style="font-size:15px;font-weight:700;margin-top:18px">Primii 3 pași:</p>
      <ol style="font-size:15px;line-height:1.6;padding-left:18px">
        <li><b>Adaugă agenții</b> și trimite-le linkul pe WhatsApp (Agenți → Copiază linkul).</li>
        <li><b>Adu clienții</b>: tragi fișierul tău în „Clienți" — se împart singuri pe agenți.</li>
        <li><b>Încarcă vânzările</b> din SAGA în „Vânzări" — analizele se fac singure.</li>
      </ol>
      <p style="margin-top:22px">
        <a href="${loginUrl}" style="display:inline-block;background:#161412;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">
          Intră în panou →
        </a>
      </p>
      <p style="font-size:13px;color:#161412;opacity:.6;margin-top:20px">
        Tot ce face platforma, pas cu pas, e aici:
        <a href="${ghidUrl}" style="color:#ff4d00">ghidul de training</a>.
        Dacă întâlnești ceva, apasă butonul 💬 din panou și îți răspundem.
      </p>
    </div>
  </div>`;
  try {
    await sendEmail({
      to: opts.to,
      subject: `Provendi — contul ${opts.firma} e gata (14 zile gratuit)`,
      html,
    });
  } catch (e) {
    console.error("[welcome] emailul de bun venit nu a plecat:", e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
