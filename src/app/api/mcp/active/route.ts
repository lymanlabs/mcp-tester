import { NextResponse } from "next/server";
import { mcpManager } from "@/lib/mcp-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ activeIds: mcpManager.getActiveIds(), count: mcpManager.getActiveCount() });
}


