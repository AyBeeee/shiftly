import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ShiftResult = {
  shifts: Array<{
    id: string;
    day: string;
    date: string;
    start: string;
    end: string;
    title: string;
    confidence: "high" | "low";
  }>;
};

function openAiError(status: number) {
  if (status === 401 || status === 403) {
    return NextResponse.json({
      error: "OpenAI rejected the private API key. Replace the hosted secret and try again.",
      code: "OPENAI_API_KEY_INVALID",
    }, { status: 401 });
  }
  if (status === 429) {
    return NextResponse.json({
      error: "OpenAI's usage limit has been reached. Wait and try again.",
      code: "OPENAI_RATE_LIMITED",
    }, { status: 429 });
  }
  return NextResponse.json({ error: "OpenAI could not read this timetable. Try again." }, { status: 502 });
}

function extractOpenAiText(result: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  return result.output_text ?? result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
}

function parseShiftResult(outputText: string) {
  const cleaned = outputText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as ShiftResult;
  if (!Array.isArray(parsed.shifts)) throw new Error("Missing shifts");
  return parsed;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read. Please choose the timetable photo again." }, { status: 400 });
  }

  const image = form.get("image");
  const name = String(form.get("name") ?? "").trim();

  if (!name || !(image instanceof File)) return NextResponse.json({ error: "A name and timetable photo are required." }, { status: 400 });
  if (!SUPPORTED_IMAGE_TYPES.has(image.type.toLowerCase())) return NextResponse.json({ error: "Use a JPEG, PNG, or WebP image." }, { status: 415 });
  if (image.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Please use an image smaller than 10 MB." }, { status: 413 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({
    error: "Timetable reading is not configured yet.",
    code: "OPENAI_API_KEY_REQUIRED",
  }, { status: 503 });

  const bytes = Buffer.from(await image.arrayBuffer());
  const base64Image = bytes.toString("base64");
  const dataUrl = `data:${image.type || "image/jpeg"};base64,${base64Image}`;
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Extract work shifts from this photographed weekly staff timetable for the employee whose name best matches “${name}”.

Follow this process exactly:
1. Locate the table's day/date header row and read its columns from left to right.
2. Locate only the employee row matching “${name}”; allow name order and punctuation differences, but do not use another employee's row.
3. Read only the cells where that exact employee row intersects each day/date column.
4. Omit blank cells, “Day Off” cells, leave, absence, and any cell without a working time range.
5. Never infer shifts from totals, contracted hours, store hours, highlighted cells, or neighboring rows.
6. Convert dates to YYYY-MM-DD and times to 24-hour HH:MM. If the year is absent, choose the date occurrence closest to today that preserves the printed weekday.
7. Use title “Work”. Mark confidence low if the matched name, date, start, or end is unclear. Never guess unreadable values.

Return only the structured shifts.`;
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
            id: { type: "string", description: "Stable identifier for this shift." },
            day: { type: "string", description: "Full printed weekday name." },
            date: { type: "string", description: "Date in YYYY-MM-DD format." },
            start: { type: "string", description: "Start time in 24-hour HH:MM format." },
            end: { type: "string", description: "End time in 24-hour HH:MM format." },
            title: { type: "string", description: "Always Work." },
            confidence: { type: "string", enum: ["high", "low"] },
          },
        },
      },
    },
  };

  let outputText: string | undefined;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        reasoning: { effort: "low" },
        input: [{ role: "user", content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ] }],
        text: { format: { type: "json_schema", name: "weekly_shifts", strict: true, schema } },
      }),
    });
    const result = await response.json() as Parameters<typeof extractOpenAiText>[0];
    if (!response.ok) return openAiError(response.status);
    outputText = extractOpenAiText(result);
  } catch {
    return NextResponse.json({ error: "OpenAI could not be reached. Try again." }, { status: 502 });
  }

  if (!outputText) return NextResponse.json({ error: "No shifts were found for that name." }, { status: 422 });
  try {
    const parsed = parseShiftResult(outputText);
    return NextResponse.json({ shifts: parsed.shifts });
  } catch {
    return NextResponse.json({ error: "OpenAI returned a timetable result that could not be read. Try again." }, { status: 502 });
  }
}
