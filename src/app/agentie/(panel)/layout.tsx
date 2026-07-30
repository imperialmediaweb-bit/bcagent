import { redirect } from "next/navigation";
import { getOrgSession } from "@/modules/platform";
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
  return (
    <OrgShell name={session.name || session.email} role={session.role}>
      {children}
    </OrgShell>
  );
}
