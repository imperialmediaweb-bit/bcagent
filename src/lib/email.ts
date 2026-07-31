/**
 * Trimitere de email prin Resend (REST, fără SDK).
 * Env: RESEND_API_KEY (re_...), opțional EMAIL_FROM
 * (implicit onboarding@resend.dev — merge fără domeniu verificat,
 * pentru producție se setează adresa proprie după verificarea domeniului).
 */

export function isEmailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY lipsește");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Provendi <onboarding@resend.dev>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}
