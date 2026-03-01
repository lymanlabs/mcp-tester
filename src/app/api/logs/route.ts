import { NextResponse } from "next/server";
import { mcpManager } from "@/lib/mcp-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const after = parseInt(new URL(req.url).searchParams.get("after") || "0", 10);
  return NextResponse.json(mcpManager.getLogs(after));
}
