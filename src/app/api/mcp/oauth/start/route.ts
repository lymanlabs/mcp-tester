import { NextResponse } from "next/server";
import { oauthManager } from "@/lib/oauth";

export async function POST(req: Request) {
  try {
    const { mcpUrl } = await req.json();
    if (!mcpUrl) {
      return NextResponse.json({ error: "mcpUrl is required" }, { status: 400 });
    }

    // Build callback URL from the request origin
    const origin = new URL(req.url).origin;
    const callbackUrl = `${origin}/api/mcp/oauth/callback`;

    const { authUrl, state } = await oauthManager.startFlow(mcpUrl, callbackUrl);

    return NextResponse.json({ authUrl, state });
  } catch (err: any) {
    console.error("OAuth start error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to start OAuth flow" },
      { status: 500 }
    );
  }
}


