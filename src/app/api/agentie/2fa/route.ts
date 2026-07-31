import QRCode from "qrcode";
import { isDBEnabled } from "@/lib/db";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import {
  audit,
  getOrgUserTotp,
  loginHistory,
  requireOrgUser,
  setOrgUserTotp,
} from "@/modules/platform";

export const runtime = "nodejs";

/**
 * 2FA pentru conturile agenției (patron/manager) + istoricul conectărilor.
 *  GET            → starea 2FA + ultimele conectări
 *  POST init      → generează secret + QR de scanat în Authenticator
 *  POST enable    → confirmă cu primul cod → 2FA pornit
 *  POST disable   → oprește (cere codul curent — nu-l dezactivezi din greșeală)
 */

export async function GET() {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
  if ("response" in auth) return auth.response;
  try {
    const totp = await getOrgUserTotp(auth.session.userId);
    const history = await loginHistory("org", auth.session.email);
    return Response.json({ totpEnabled: totp.enabled, history });
  } catch (e) {
    console.error("[agentie 2fa GET]", e);
    return Response.json({ error: "Eroare" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isDBEnabled()) return Response.json({ enabled: false }, { status: 503 });
  const auth = await requireOrgUser();
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
      await setOrgUserTotp(auth.session.userId, secret, false);
      const uri = totpUri(secret, auth.session.email);
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      return Response.json({ secret, uri, qr });
    }
    if (body.action === "enable") {
      const totp = await getOrgUserTotp(auth.session.userId);
      if (!totp.secret) {
        return Response.json({ error: "Pornește întâi configurarea" }, { status: 400 });
      }
      if (!(await verifyTotp(totp.secret, String(body.otp ?? "")))) {
        return Response.json({ error: "Cod greșit — mai încearcă" }, { status: 400 });
      }
      await setOrgUserTotp(auth.session.userId, totp.secret, true);
      await audit(auth.session.email, "2fa.enable", auth.session.orgId);
      return Response.json({ ok: true });
    }
    if (body.action === "disable") {
      const totp = await getOrgUserTotp(auth.session.userId);
      if (totp.enabled && !(await verifyTotp(totp.secret, String(body.otp ?? "")))) {
        return Response.json({ error: "Cod greșit" }, { status: 400 });
      }
      await setOrgUserTotp(auth.session.userId, "", false);
      await audit(auth.session.email, "2fa.disable", auth.session.orgId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    console.error("[agentie 2fa POST]", e);
    return Response.json({ error: "Eroare la 2FA" }, { status: 500 });
  }
}
