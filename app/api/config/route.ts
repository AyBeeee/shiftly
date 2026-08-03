import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
      googleClientId: process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
