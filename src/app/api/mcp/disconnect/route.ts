import { NextResponse } from "next/server";
import { mcpManager } from "@/lib/mcp-manager";

export async function POST(req: Request) {
  try {
    const { connectionId } = await req.json();
    if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });
    await mcpManager.disconnect(connectionId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
