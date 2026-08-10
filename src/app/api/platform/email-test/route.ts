import { requireAdmin } from "@/modules/platform";
import { isEmailEnabled, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * DIAGNOSTIC EMAIL (doar admin platformă). Trimite un email de test și
 * întoarce EXACT ce a răspuns Resend — ca să vezi pe loc dacă emailurile
 * chiar pleacă, sau de ce nu. Cel mai frecvent motiv: Resend, până
 * verifici domeniul, livrează DOAR către adresa contului tău.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  if (!isEmailEnabled()) {
    return Response.json(
      {
        ok: false,
        motiv:
          "RESEND_API_KEY nu e setat în Railway — de aceea nu pleacă niciun email.",
      },
      { status: 200 },
    );
  }

  let body: { to?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, motiv: "Invalid JSON" }, { status: 400 });
  }
  const to = String(body.to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return Response.json(
      { ok: false, motiv: "Scrie o adresă de email validă." },
      { status: 400 },
    );
  }

  const from = process.env.EMAIL_FROM || "Provendi <onboarding@resend.dev>";
  try {
    await sendEmail({
      to,
      subject: "Provendi — test de email ✅",
      html: `<p style="font-family:system-ui">Acesta e un test din panoul de administrare Provendi.</p>
             <p>Dacă l-ai primit, trimiterea de emailuri funcționează.</p>`,
    });
    return Response.json({
      ok: true,
      trimisCatre: to,
      de_la: from,
      nota:
        "A plecat spre Resend. Dacă NU ajunge, verifică: (1) domeniul e verificat în Resend și EMAIL_FROM e o adresă de pe el; (2) în modul de test, Resend livrează doar către adresa contului tău; (3) verifică folderul Spam.",
    });
  } catch (e) {
    return Response.json({
      ok: false,
      de_la: from,
      motiv: e instanceof Error ? e.message : String(e),
      sugestie:
        "Dacă mesajul zice ceva de 'domain not verified' sau 'testing emails', înseamnă că trebuie verificat domeniul în Resend și setat EMAIL_FROM pe o adresă de pe el (ex: contact@provendi.ro).",
    });
  }
}
