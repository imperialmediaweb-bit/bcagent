import { isDBEnabled } from "@/lib/db";
import { clientIP, rateLimit } from "@/lib/rate-limit";
import { verifyTotp } from "@/lib/totp";
import {
  audit,
  countAdmins,
  createAdmin,
  getAdminByEmail,
  setSessionCookie,
  SESSION_TTL_SECONDS,
  touchAdminLogin,
  verifyPassword,
} from "@/modules/platform";

export const runtime = "nodejs";

/**
 * Login super-admin.
 *
 * Bootstrap: dacă nu există niciun admin în baza de date și sunt setate
 * PLATFORM_ADMIN_EMAIL + PLATFORM_ADMIN_PASSWORD, primul login cu acele
 * credențiale creează contul. După aceea variabilele nu mai contează.
 */
export async function POST(req: Request) {
  if (!isDBEnabled()) {
    return Response.json(
      { error: "Baza de date nu e configurată (DATABASE_URL)" },
      { status: 503 },
    );
  }

  const ip = clientIP(req);
  const rl = rateLimit(`platform-login:${ip}`, { max: 10, windowMs: 300_000 });
  if (!rl.ok) {
    return Response.json(
      { error: "Prea multe încercări. Reîncearcă în câteva minute." },
      { status: 429 },
    );
  }

  let body: { email?: string; password?: string; otp?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return Response.json(
      { error: "Email și parolă obligatorii" },
      { status: 400 },
    );
  }

  try {
    const { isLockedOut, recordLoginEvent, adminTotpByEmail, handleDeviceOnLogin } =
      await import("@/modules/platform");
    if (await isLockedOut("platform", email)) {
      return Response.json(
        {
          error:
            "Cont blocat temporar (prea multe încercări greșite). Reîncearcă peste 15 minute.",
        },
        { status: 423 },
      );
    }

    let admin = await getAdminByEmail(email);

    if (!admin && (await countAdmins()) === 0) {
      const bootEmail = (process.env.PLATFORM_ADMIN_EMAIL ?? "")
        .trim()
        .toLowerCase();
      const bootPass = process.env.PLATFORM_ADMIN_PASSWORD ?? "";
      if (bootEmail && bootPass && email === bootEmail && password === bootPass) {
        await createAdmin(bootEmail, bootPass, "Super Admin");
        admin = await getAdminByEmail(bootEmail);
        await audit(bootEmail, "admin.bootstrap", bootEmail);
      }
    }

    if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
      // Mesaj identic pentru user inexistent și parolă greșită.
      await recordLoginEvent("platform", email, ip, false);
      return Response.json(
        { error: "Email sau parolă incorecte" },
        { status: 401 },
      );
    }

    // 2FA pentru super-admin — contul cu cea mai mare putere.
    const totp = await adminTotpByEmail(email);
    if (totp.enabled) {
      const otp = String(body.otp ?? "");
      if (!otp) return Response.json({ needOtp: true });
      if (!(await verifyTotp(totp.secret, otp))) {
        await recordLoginEvent("platform", email, ip, false);
        return Response.json({ error: "Cod 2FA greșit" }, { status: 401 });
      }
    }

    await setSessionCookie({
      adminId: admin.id,
      email: admin.email,
      role: "platform_admin",
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    });
    await touchAdminLogin(admin.id);
    await recordLoginEvent("platform", email, ip, true);
    await handleDeviceOnLogin("platform", email, req, ip);
    await audit(admin.email, "admin.login", admin.email, { ip });

    return Response.json({
      ok: true,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (e) {
    console.error("[platform login]", e);
    return Response.json({ error: "Eroare la autentificare" }, { status: 500 });
  }
}
