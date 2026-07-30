import { clearOrgSessionCookie } from "@/modules/platform";

export const runtime = "nodejs";

export async function POST() {
  await clearOrgSessionCookie();
  return Response.json({ ok: true });
}
