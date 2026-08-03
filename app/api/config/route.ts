import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      configuredProviders: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
