import { NextResponse } from "next/server";
import { mcpManager } from "@/lib/mcp-manager";
import { oauthManager } from "@/lib/oauth";

export async function POST(req: Request) {
  const body = await req.json();
  const { connectionId, name, transport, url, command, args, headers, env } = body;

  if (!connectionId || !name) {
    return NextResponse.json({ error: "connectionId and name are required" }, { status: 400 });
  }
  if (!transport) {
    return NextResponse.json({ error: `Missing transport type. Got: ${JSON.stringify(body)}` }, { status: 400 });
  }

  try {
    let token: string | undefined;
    if (transport === "http" && url) {
      token = (await oauthManager.getToken(url)) || undefined;
    }

    const result = await mcpManager.connect(connectionId, name, {
      transport, url, command,
      args: args || [],
      headers: headers || {},
      env: env || {},
      token,
    });

    // Persist token to DB
    if (transport === "http" && url) {
      oauthManager.persistToDb(connectionId, url);
    }

    return NextResponse.json({
      tools: result.tools,
      tokenStatus: (transport === "http" && url) ? oauthManager.getTokenStatus(url) : null,
    });
  } catch (error: any) {
    console.error("MCP connect error:", error);
    const msg = (error.message || "").toLowerCase();
    const isAuthError = transport === "http" && (
      msg.includes("401") || msg.includes("unauthorized") || msg.includes("403") ||
      msg.includes("invalid_token") || msg.includes("token") || msg.includes("auth") ||
      msg.includes("forbidden") || !oauthManager.hasTokenSync(url || "")
    );
    if (isAuthError) {
      return NextResponse.json({ error: error.message, needsAuth: true }, { status: 401 });
    }
    return NextResponse.json({ error: error.message || "Failed to connect" }, { status: 500 });
  }
}
