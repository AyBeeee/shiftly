import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { openAiConfigured: Boolean(process.env.OPENAI_API_KEY) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
