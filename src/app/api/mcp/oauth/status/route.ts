import { NextResponse } from "next/server";
import { oauthManager } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mcpUrl = searchParams.get("mcpUrl");

  if (!mcpUrl) {
    return NextResponse.json({ error: "mcpUrl is required" }, { status: 400 });
  }

  return NextResponse.json(oauthManager.getTokenStatus(mcpUrl));
}


