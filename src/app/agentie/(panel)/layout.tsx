import { redirect } from "next/navigation";
import { getOrg, getOrgSession } from "@/modules/platform";
import OrgShell from "./OrgShell";

export const dynamic = "force-dynamic";

/** Gardă server-side pentru panoul agenției. */
export default async function AgentiePanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getOrgSession();
  if (!session) redirect("/agentie/login");
  // Perioada de probă: firma vede câte zile mai are (bannerul din shell).
  let trialDaysLeft: number | null = null;
  try {
    const org = await getOrg(session.orgId);
    if (org?.status === "trial" && org.trialEndsAt) {
      trialDaysLeft = Math.max(
        0,
        Math.ceil((new Date(org.trialEndsAt).getTime() - Date.now()) / 86400_000),
      );
    }
  } catch {
    // fără banner dacă nu putem citi organizația — nu blocăm panoul
  }
  return (
    <OrgShell
      name={session.name || session.email}
      role={session.role}
      trialDaysLeft={trialDaysLeft}
    >
      {children}
    </OrgShell>
  );
}
