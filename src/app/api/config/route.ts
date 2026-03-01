import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    hasXaiKey: !!process.env.XAI_API_KEY,
  });
}

