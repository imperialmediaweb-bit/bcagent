import { redirect } from "next/navigation";
import { getSession } from "@/modules/platform";
import PanelShell from "./PanelShell";

export const dynamic = "force-dynamic";

/** Gardă server-side: fără sesiune validă nu se randează nimic din panou. */
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/platform/login");
  return <PanelShell email={session.email}>{children}</PanelShell>;
}
