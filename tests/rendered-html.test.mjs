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
  form.set("name", "Baig, Abdullah");
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
  form.set("name", "Baig, Abdullah");
  form.set("image", new File(["not an image"], "timetable.svg", { type: "image/svg+xml" }));

  const response = await request("/api/analyze", { method: "POST", body: form });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Use a JPEG, PNG, or WebP image." });
});
