import { NextResponse } from "next/server";
import { listConnections, createConnection } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export const dynamic = "force-dynamic";

export async function GET() {
  const conns = listConnections();
  // Don't leak tokens to the frontend
  const safe = conns.map((c) => ({
    ...c,
    access_token: c.access_token ? "***" : null,
    refresh_token: c.refresh_token ? "***" : null,
    client_secret: undefined,
    hasToken: !!c.access_token,
    tokenExpiresIn: c.token_expires_at ? Math.max(0, Math.round((c.token_expires_at - Date.now()) / 1000)) : null,
    hasRefresh: !!c.refresh_token,
    args: c.args ? JSON.parse(c.args) : [],
    headers: c.headers ? JSON.parse(c.headers) : {},
    env_vars: c.env_vars ? JSON.parse(c.env_vars) : {},
  }));
  return NextResponse.json(safe);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, transport, url, command, args, headers, env_vars } = body;

    if (!name || !transport) {
      return NextResponse.json({ error: "name and transport are required" }, { status: 400 });
    }

    const id = uuidv4();
    const conn = createConnection(id, { name, transport, url, command, args, headers, env_vars });

    return NextResponse.json(conn);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


