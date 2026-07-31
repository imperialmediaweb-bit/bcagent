import QRCode from "qrcode";
import { isDBEnabled } from "@/lib/db";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import {
  audit,
  describeDevice,
  getAdminTotp,
  listDevices,
  loginHistory,
  requireAdmin,
  setAdminTotp,
} from "@/modules/platform";

export const runtime = "nodejs";

/** 2FA pentru super-admin + istoricul conectărilor lui. */

export async function GET() {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  try {
    const totp = await getAdminTotp(auth.session.adminId);
    const history = await loginHistory("platform", auth.session.email);
    const devices = (await listDevices("platform", auth.session.email)).map((d) => ({
      name: describeDevice(d.ua),
      ip: d.ip,
      lastSeen: d.lastSeen,
    }));
    return Response.json({ totpEnabled: totp.enabled, history, devices });
  } catch (e) {
    console.error("[platform 2fa GET]", e);
    return Response.json({ error: "Eroare" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  let body: { action?: string; otp?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "init") {
      const secret = generateTotpSecret();
      await setAdminTotp(auth.session.adminId, secret, false);
      const uri = totpUri(secret, auth.session.email, "Provendi Admin");
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      return Response.json({ secret, uri, qr });
    }
    if (body.action === "enable") {
      const totp = await getAdminTotp(auth.session.adminId);
      if (!totp.secret) {
        return Response.json({ error: "Pornește întâi configurarea" }, { status: 400 });
      }
      if (!(await verifyTotp(totp.secret, String(body.otp ?? "")))) {
        return Response.json({ error: "Cod greșit — mai încearcă" }, { status: 400 });
      }
      await setAdminTotp(auth.session.adminId, totp.secret, true);
      await audit(auth.session.email, "2fa.enable", "platform");
      return Response.json({ ok: true });
    }
    if (body.action === "disable") {
      const totp = await getAdminTotp(auth.session.adminId);
      if (totp.enabled && !(await verifyTotp(totp.secret, String(body.otp ?? "")))) {
        return Response.json({ error: "Cod greșit" }, { status: 400 });
      }
      await setAdminTotp(auth.session.adminId, "", false);
      await audit(auth.session.email, "2fa.disable", "platform");
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[platform 2fa POST]", e);
    return Response.json({ error: "Eroare la 2FA" }, { status: 500 });
  }
}
