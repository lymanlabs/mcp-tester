import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  "https://mmgndtlmrouznineiolj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZ25kdGxtcm91em5pbmVpb2xqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1ODI1NTMsImV4cCI6MjA4ODE1ODU1M30.O7RNWF8eSnwMd4FU2gZZfsBymAANHB4V6oQOvz_quqk",
);

export async function GET() {
  const { data, error } = await supabase
    .from("mcps")
    .select("id, url, display_name, description, auth_type, healthy, tool_count, categories")
    .eq("healthy", true)
    .order("tool_count", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
