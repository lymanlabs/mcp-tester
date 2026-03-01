import { NextResponse } from "next/server";
import { getConnection, updateConnection, deleteConnection } from "@/lib/db";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const conn = updateConnection(params.id, body);
    if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(conn);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ok = deleteConnection(params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}


