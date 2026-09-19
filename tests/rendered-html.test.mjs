import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function request(path = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Shiftly application", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Shiftly/);
  assert.match(html, /Snap it\. Shift it\./);
  assert.match(html, /Your name on the timetable/);
  assert.match(html, /Before reading/);
  assert.match(html, /Full weekly table is visible/);
  assert.doesNotMatch(html, /AI provider|API key/);
  assert.doesNotMatch(html, /codex-preview/);
});

test("configuration endpoint reports private runtime setup", async () => {
  const response = await request("/api/config");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { openAiConfigured: false, googleClientId: "" });
});

test("analysis endpoint validates size before checking configuration", async () => {
  const route = await readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
  const sizeValidation = route.indexOf("image.size > MAX_IMAGE_BYTES");
  const configurationCheck = route.indexOf("const apiKey = process.env.OPENAI_API_KEY");
  assert.ok(sizeValidation > 0);
  assert.ok(configurationCheck > sizeValidation);
  assert.doesNotMatch(route, /demoShifts|demo:\s*true/);
});

test("analysis endpoint fails closed when AI is not configured", async () => {
  const form = new FormData();
  form.set("name", "Taylor Morgan");
  form.set("image", new File(["small timetable"], "timetable.jpg", { type: "image/jpeg" }));

  const response = await request("/api/analyze", { method: "POST", body: form });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Timetable reading is not configured yet.",
    code: "OPENAI_API_KEY_REQUIRED",
  });
});

test("analysis endpoint rejects unsupported image types", async () => {
  const form = new FormData();
  form.set("name", "Taylor Morgan");
  form.set("image", new File(["not an image"], "timetable.svg", { type: "image/svg+xml" }));

  const response = await request("/api/analyze", { method: "POST", body: form });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Use a JPEG, PNG, or WebP image." });
});

test("the browser accepts HEIC and converts it to a PNG before upload", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /heic2any/);
  assert.match(page, /toType: "image\/png"/);
  assert.match(page, /multiple: true/);
  assert.match(page, /\.heic/);
  assert.match(page, /image\/heic/);
  assert.match(page, /converted to PNG/);
});

test("analysis endpoint rejects malformed AI shift output", async () => {
  await withMockOpenAiResponse({
    shifts: [{
      id: "bad-time",
      day: "Monday",
      date: "2026-02-30",
      start: "25:00",
      end: "17:00",
      title: "Work",
      confidence: "high",
    }],
  }, async () => {
    const response = await request("/api/analyze", { method: "POST", body: analysisForm() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "OpenAI returned a timetable result that could not be read. Try again." });
  });
});

test("analysis endpoint rejects zero-duration shifts", async () => {
  await withMockOpenAiResponse({
    shifts: [{
      id: "zero-duration",
      day: "Monday",
      date: "2026-08-24",
      start: "09:00",
      end: "09:00",
      title: "Work",
      confidence: "high",
    }],
  }, async () => {
    const response = await request("/api/analyze", { method: "POST", body: analysisForm() });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "OpenAI returned a timetable result that could not be read. Try again." });
  });
});

test("analysis endpoint accepts overnight shifts", async () => {
  const overnightShift = {
    id: "fri-night",
    day: "Friday",
    date: "2026-08-28",
    start: "22:00",
    end: "06:00",
    title: "Work",
    confidence: "high",
  };

  await withMockOpenAiResponse({ shifts: [overnightShift] }, async () => {
    const response = await request("/api/analyze", { method: "POST", body: analysisForm() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { shifts: [overnightShift] });
  });
});

test("calendar export and Google sync use the next day for overnight shift ends", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /DTEND:\$\{compactIcsTimestamp\(shiftEndDate\(shift\), shift\.end\)\}/);
  assert.match(page, /timeMax: new Date\(calendarTimestamp\(shiftEndDate\(shift\), "23:59"\)\)\.toISOString\(\)/);
  assert.match(page, /end: \{ dateTime: shiftEndTimestamp\(shift\), timeZone:/);
});

test("Google sync uses a selected calendar instead of a fixed Work calendar", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /selectedCalendarId/);
  assert.match(page, /normalizeGoogleCalendars/);
  assert.match(page, /Add to selected calendar/);
  assert.doesNotMatch(page, /workCalendarId|named .Work|Add to Work|Connect & add to Work/);
});

function analysisForm() {
  const form = new FormData();
  form.set("name", "Baig, Abdullah");
  form.set("image", new File(["small timetable"], "timetable.jpg", { type: "image/jpeg" }));
  return form;
}

async function withMockOpenAiResponse(body, callback) {
  const previousFetch = globalThis.fetch;
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    return Response.json({ output_text: JSON.stringify(body) });
  };
  try {
    await callback();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
}
