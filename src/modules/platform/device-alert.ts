import { cookies } from "next/headers";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import { describeDevice, hasAnyDevice, touchDevice } from "./login-security";

/**
 * „Conectare de pe un dispozitiv nou" — ca la Facebook.
 * Fiecare browser primește un ID persistent (cookie 1 an). La login
 * reușit: dacă ID-ul nu e printre dispozitivele cunoscute ale contului,
 * proprietarul primește email de alertă (dispozitiv, IP, oră). Primul
 * login al contului doar înregistrează, fără alertă.
 */

const DEVICE_COOKIE = "bcagent_device";

export async function handleDeviceOnLogin(
  kind: "org" | "platform",
  email: string,
  req: Request,
  ip: string,
): Promise<void> {
  try {
    const jar = await cookies();
    let deviceId = jar.get(DEVICE_COOKIE)?.value ?? "";
    if (!/^[a-f0-9]{32}$/.test(deviceId)) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Reîmprospătăm cookie-ul la fiecare login (persistă 1 an).
    jar.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 86400,
    });

    const ua = req.headers.get("user-agent") ?? "";
    const existedBefore = await hasAnyDevice(kind, email);
    const isNew = await touchDevice(kind, email, deviceId, ua, ip);

    if (isNew && existedBefore && isEmailEnabled()) {
      const when = new Date().toLocaleString("ro-RO", {
        timeZone: "Europe/Bucharest",
        dateStyle: "long",
        timeStyle: "short",
      });
      await sendEmail({
        to: email,
        subject: "⚠️ Conectare nouă la BC Agent de pe un dispozitiv necunoscut",
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#161412">Conectare de pe un dispozitiv nou</h2>
            <p>Contul tău <strong>${email}</strong> tocmai a fost accesat de pe
            un dispozitiv pe care nu l-am mai văzut:</p>
            <table style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:4px 12px 4px 0;color:#666">Dispozitiv</td><td><strong>${describeDevice(ua)}</strong></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">Adresă IP</td><td>${ip || "necunoscut"}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">Data și ora</td><td>${when}</td></tr>
            </table>
            <p style="margin-top:16px"><strong>Ai fost tu?</strong> Nu trebuie să faci nimic.</p>
            <p><strong>Nu ai fost tu?</strong> Schimbă parola imediat din
            Setări și activează autentificarea în doi pași (2FA). Dispozitivele
            contului se văd în panou, la Setări → Securitatea contului.</p>
            <p style="color:#999;font-size:12px;margin-top:20px">BC Agent — alertă automată de securitate.</p>
          </div>`,
      });
    }
  } catch (e) {
    // Alerta nu are voie să strice login-ul — doar logăm.
    console.error("[device-alert]", e);
  }
}
