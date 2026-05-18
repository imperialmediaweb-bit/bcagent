import { notFound } from "next/navigation";
import { verifyToken } from "@/lib/signed-token";
import { isAIEnabled } from "@/lib/llm";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    throw new Error("TOKEN_SECRET not configured");
  }
  const payload = await verifyToken(token, secret);
  if (!payload) {
    notFound();
  }
  return (
    <Dashboard
      agentId={payload.agentId}
      agentName={payload.agentName}
      token={token}
      aiEnabled={isAIEnabled()}
    />
  );
}
