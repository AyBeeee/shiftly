import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read. Please choose the timetable photo again." }, { status: 400 });
  }
  const image = form.get("image");
  const name = String(form.get("name") ?? "").trim();
  const suppliedApiKey = String(form.get("openaiApiKey") ?? "").trim();
  if (!name || !(image instanceof File)) return NextResponse.json({ error: "A name and timetable photo are required." }, { status: 400 });
  if (!SUPPORTED_IMAGE_TYPES.has(image.type.toLowerCase())) return NextResponse.json({ error: "Use a JPEG, PNG, WebP, or non-animated GIF image." }, { status: 415 });
  if (image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Please use an image smaller than 10 MB." }, { status: 413 });

  const apiKey = suppliedApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({
    error: "Add your OpenAI API key below to read the real timetable.",
    code: "OPENAI_API_KEY_REQUIRED",
  }, { status: 503 });

  const bytes = Buffer.from(await image.arrayBuffer());
  const dataUrl = `data:${image.type || "image/jpeg"};base64,${bytes.toString("base64")}`;
  const today = new Date().toISOString().slice(0, 10);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["shifts"],
    properties: {
      shifts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "day", "date", "start", "end", "title", "confidence"],
          properties: {
            id: { type: "string" }, day: { type: "string" }, date: { type: "string" },
            start: { type: "string" }, end: { type: "string" }, title: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
          },
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      input: [{ role: "user", content: [
        { type: "input_text", text: `Today is ${today}. Read this weekly staff timetable. Find the row whose employee name best matches “${name}”. Read that row column by column, using the dates or weekdays in the top header. Return only working shifts, not days off or blank cells. Convert dates to YYYY-MM-DD and times to 24-hour HH:MM. If a date has no year, choose the occurrence closest to today that preserves the pictured weekday. Use title “Work”. Mark confidence low whenever the name, date, or either time is unclear. Never guess an unreadable time.` },
        { type: "input_image", image_url: dataUrl, detail: "high" },
      ] }],
      text: { format: { type: "json_schema", name: "weekly_shifts", strict: true, schema } },
    }),
  });

  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
  if (response.status === 401) return NextResponse.json({
    error: "OpenAI rejected this API key. Check the key and try again.",
    code: "OPENAI_API_KEY_INVALID",
  }, { status: 401 });
  if (!response.ok) return NextResponse.json({ error: result.error?.message || "The timetable reader is unavailable." }, { status: 502 });
  const outputText = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!outputText) return NextResponse.json({ error: "No shifts were found for that name." }, { status: 422 });
  try {
    const parsed = JSON.parse(outputText) as { shifts: Array<{ id: string; day: string; date: string; start: string; end: string; title: string; confidence: "high" | "low" }> };
    return NextResponse.json({ shifts: parsed.shifts });
  } catch {
    return NextResponse.json({ error: "The timetable result could not be read." }, { status: 502 });
  }
}
