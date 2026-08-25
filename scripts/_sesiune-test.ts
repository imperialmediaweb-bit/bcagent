/**
 * Sesiune de firmă pentru TESTE, făcută direct.
 *
 * Login-ul public e limitat (10 încercări / 5 minute pe IP) — pe bună
 * dreptate, e apărarea contra ghicirii parolelor. Dar suitele care rulează
 * una după alta ar consuma limita și ar pica din motive care n-au nimic
 * de-a face cu ce testează. Aici semnăm direct aceeași sesiune pe care
 * ar da-o login-ul, cu aceeași cheie.
 */
import { signOrgSession } from "../src/modules/platform/org-session";

/** Numele cookie-ului de sesiune al panoului de firmă. */
export const COOKIE_NAME = "bcagent_org";

export async function semneazaSesiuneTest(date: {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: "owner" | "manager";
}): Promise<string> {
  return signOrgSession({
    ...date,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}
