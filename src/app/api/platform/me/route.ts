import { getSession, stripeEnabled, webhookConfigured } from "@/modules/platform";

export const runtime = "nodejs";

/** Sesiunea curentă + ce integrări sunt configurate (pentru UI). */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  return Response.json({
    authenticated: true,
    admin: { id: session.adminId, email: session.email },
    integrations: {
      stripe: stripeEnabled(),
      stripeWebhook: webhookConfigured(),
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      r2: !!process.env.R2_ACCOUNT_ID,
      db: !!process.env.DATABASE_URL,
    },
  });
}
