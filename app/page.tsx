"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Shift = {
  id: string;
  day: string;
  date: string;
  start: string;
  end: string;
  title: string;
  confidence: "high" | "low";
  selected: boolean;
};

type GoogleConnection = {
  accessToken: string;
  email: string;
  workCalendarId: string | null;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_UPLOAD_DIMENSION = 3200;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type AiProvider = "gemini" | "openrouter" | "openai";

const AI_PROVIDERS: Record<AiProvider, {
  label: string;
  optionLabel: string;
  placeholder: string;
  keyUrl: string;
  hint: string;
}> = {
  gemini: {
    label: "Google Gemini",
    optionLabel: "Google Gemini — free tier",
    placeholder: "AIza…",
    keyUrl: "https://aistudio.google.com/app/apikey",
    hint: "A free tier is available; usage limits and regional availability apply.",
  },
  openrouter: {
    label: "OpenRouter Free",
    optionLabel: "OpenRouter — free models",
    placeholder: "sk-or-v1-…",
    keyUrl: "https://openrouter.ai/settings/keys",
    hint: "Uses an available free vision model, so speed and results can vary.",
  },
  openai: {
    label: "OpenAI",
    optionLabel: "OpenAI",
    placeholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "Uses GPT-5.6 Luna with low reasoning effort.",
  },
};

type AnalysisResult = {
  shifts?: Shift[];
  provider?: AiProvider;
  error?: string;
  code?: "AI_API_KEY_REQUIRED" | "AI_API_KEY_INVALID" | "AI_RATE_LIMITED";
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function calendarTimestamp(date: string, time: string) {
  return `${date}T${time}:00`;
}

function escapeIcs(value: string) {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function isSupportedImage(file: File) {
  if (SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) return true;
  return /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("This image could not be opened. Use a JPEG, PNG, or WebP image."));
    };
    image.src = source;
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("This photo could not be prepared for upload."));
    }, "image/jpeg", quality);
  });
}

async function prepareImageForUpload(file: File) {
  if (file.size <= MAX_UPLOAD_IMAGE_BYTES) return file;

  const image = await loadImage(file);
  const initialScale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale));
  let quality = 0.9;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the timetable photo.");

  while (true) {
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    const blob = await encodeJpeg(canvas, quality);
    if (blob.size <= MAX_UPLOAD_IMAGE_BYTES) {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "timetable";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    }
    if (quality > 0.72) {
      quality = Math.max(0.7, quality - 0.08);
      continue;
    }
    if (Math.max(width, height) <= 1600) {
      throw new Error("This photo remains too large after optimization. Crop it closer to the timetable and try again.");
    }
    width = Math.max(1, Math.round(width * 0.82));
    height = Math.max(1, Math.round(height * 0.82));
    quality = 0.86;
  }
}

export default function Home() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [stage, setStage] = useState<"upload" | "reading" | "review" | "done">("upload");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleConnection, setGoogleConnection] = useState<GoogleConnection | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<Record<AiProvider, boolean> | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [aiApiKey, setAiApiKey] = useState("");
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restoreName = window.setTimeout(() => {
      setName(localStorage.getItem("shiftly-name") ?? "");
    }, 0);
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => setGoogleReady(true);
    document.head.appendChild(script);
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: { configuredProviders?: Partial<Record<AiProvider, boolean>> }) => {
        const nextConfiguredProviders = {
          gemini: Boolean(config.configuredProviders?.gemini),
          openrouter: Boolean(config.configuredProviders?.openrouter),
          openai: Boolean(config.configuredProviders?.openai),
        };
        setConfiguredProviders(nextConfiguredProviders);
        if (nextConfiguredProviders.gemini) setAiProvider("gemini");
        else if (nextConfiguredProviders.openrouter) setAiProvider("openrouter");
        else if (nextConfiguredProviders.openai) setAiProvider("openai");
      })
      .catch(() => setConfiguredProviders(null));
    return () => {
      window.clearTimeout(restoreName);
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (name.trim()) localStorage.setItem("shiftly-name", name.trim());
  }, [name]);

  const selectedCount = useMemo(() => shifts.filter((shift) => shift.selected).length, [shifts]);
  const selectedProvider = AI_PROVIDERS[aiProvider];
  const providerHasHostedKey = configuredProviders?.[aiProvider] ?? false;
  const totalHours = useMemo(() => shifts.filter((shift) => shift.selected).reduce((total, shift) => {
    const [sh, sm] = shift.start.split(":").map(Number);
    const [eh, em] = shift.end.split(":").map(Number);
    return total + Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
  }, 0), [shifts]);

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    if (!isSupportedImage(nextFile)) {
      setNotice("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (nextFile.size > MAX_SOURCE_IMAGE_BYTES) {
      setNotice("This photo is larger than 50 MB. Crop it closer to the timetable and try again.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setNotice("");
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  async function analyse() {
    if (!name.trim()) return setNotice("Add your name exactly as it appears on the timetable.");
    if (!file) return setNotice("Take or choose a timetable photo first.");
    if (configuredProviders && !providerHasHostedKey && !aiApiKey.trim()) {
      return setNotice(`Add a ${selectedProvider.label} API key below before reading the timetable.`);
    }
    setStage("reading");
    setNotice("");
    try {
      if (file.size > MAX_UPLOAD_IMAGE_BYTES) setNotice("Optimizing this large photo before upload…");
      const uploadFile = await prepareImageForUpload(file);
      setNotice("");
      const data = new FormData();
      data.append("image", uploadFile, uploadFile.name);
      data.append("name", name.trim());
      data.append("provider", aiProvider);
      if (aiApiKey.trim()) data.append("aiApiKey", aiApiKey.trim());
      const response = await fetch("/api/analyze", { method: "POST", body: data });
      const rawResult = await response.text();
      let result: AnalysisResult;
      try {
        result = rawResult ? JSON.parse(rawResult) as AnalysisResult : {};
      } catch {
        if (response.status === 413 || /payload too large/i.test(rawResult)) {
          throw new Error("The optimized photo is still too large to upload. Crop it closer to the timetable and try again.");
        }
        throw new Error("The timetable service returned an unexpected response. Please try again.");
      }
      if (result.code === "AI_API_KEY_REQUIRED") {
        setConfiguredProviders((current) => ({
          gemini: current?.gemini ?? false,
          openrouter: current?.openrouter ?? false,
          openai: current?.openai ?? false,
          [aiProvider]: false,
        }));
      }
      if (!response.ok || !result.shifts) throw new Error(result.error || "We couldn't read this timetable.");
      setShifts(result.shifts.map((shift, index) => ({ ...shift, id: shift.id || `${shift.date}-${index}`, selected: true })));
      setStage("review");
    } catch (error) {
      setStage("upload");
      setNotice(error instanceof Error ? error.message : "We couldn't read this timetable.");
    }
  }

  function updateShift(id: string, patch: Partial<Shift>) {
    setShifts((current) => current.map((shift) => shift.id === id ? { ...shift, ...patch } : shift));
  }

  function removeShift(id: string) {
    setShifts((current) => current.filter((shift) => shift.id !== id));
  }

  function reset() {
    setStage("upload");
    setFile(null);
    setShifts([]);
    setNotice("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
  }

  function exportIcs() {
    const chosen = shifts.filter((shift) => shift.selected);
    const body = chosen.map((shift) => [
      "BEGIN:VEVENT",
      `UID:shiftly-${shift.date}-${shift.start.replace(":", "")}@shiftly`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
      `DTSTART:${shift.date.replace(/-/g, "")}T${shift.start.replace(":", "")}00`,
      `DTEND:${shift.date.replace(/-/g, "")}T${shift.end.replace(":", "")}00`,
      `SUMMARY:${escapeIcs(shift.title || "Work")}`,
      "END:VEVENT",
    ].join("\r\n")).join("\r\n");
    const blob = new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Shiftly//EN\r\n${body}\r\nEND:VCALENDAR`], { type: "text/calendar" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "work-shifts.ics";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function connectGoogle(): Promise<GoogleConnection | null> {
    if (!GOOGLE_CLIENT_ID) {
      setNotice("Google Calendar needs a Google OAuth web client ID before it can connect.");
      return null;
    }
    if (!GOOGLE_CLIENT_ID || !window.google) {
      setNotice("Google's account chooser is still loading. Try again in a moment.");
      return null;
    }
    setGoogleConnecting(true);
    setNotice("Connecting to Google Calendar…");
    return new Promise((resolve) => {
      const tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
        callback: async (token) => {
          if (!token.access_token) {
            setGoogleConnecting(false);
            setNotice("Google Calendar connection was cancelled.");
            resolve(null);
            return;
          }
          try {
            const headers = { Authorization: `Bearer ${token.access_token}` };
            const [profileResponse, calendarsResponse] = await Promise.all([
              fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers }),
              fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer", { headers }),
            ]);
            if (!profileResponse.ok || !calendarsResponse.ok) throw new Error("Google did not grant the required Calendar access.");
            const profile = await profileResponse.json() as { email?: string };
            const calendars = await calendarsResponse.json() as { items?: Array<{ id: string; summary: string }> };
            const workCalendar = calendars.items?.find((calendar) => calendar.summary.trim().toLowerCase() === "work");
            const connection = {
              accessToken: token.access_token,
              email: profile.email || "Google account",
              workCalendarId: workCalendar?.id ?? null,
            };
            setGoogleConnection(connection);
            setNotice(workCalendar
              ? `Connected ${connection.email} to the Work calendar.`
              : `Connected ${connection.email}, but no writable calendar named “Work” was found.`);
            resolve(connection);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Google Calendar connection failed.");
            resolve(null);
          } finally {
            setGoogleConnecting(false);
          }
        },
      });
      tokenClient.requestAccessToken({ prompt: "select_account" });
    });
  }

  async function syncWithGoogle() {
    const connection = googleConnection ?? await connectGoogle();
    if (!connection) return;
    if (!connection.workCalendarId) {
      setNotice(`Create a writable Google calendar named “Work” in ${connection.email}, then reconnect.`);
      return;
    }
    setNotice(`Adding shifts to ${connection.email} · Work…`);
    try {
      const headers = { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json" };
      for (const shift of shifts.filter((item) => item.selected)) {
        const duplicateKey = `shiftly-${shift.date}-${shift.start}`;
        const query = new URLSearchParams({
          timeMin: new Date(calendarTimestamp(shift.date, "00:00")).toISOString(),
          timeMax: new Date(calendarTimestamp(shift.date, "23:59")).toISOString(),
          privateExtendedProperty: `shiftlyKey=${duplicateKey}`,
          singleEvents: "true",
        });
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.workCalendarId)}/events`;
        const existingResponse = await fetch(`${calendarUrl}?${query}`, { headers });
        if (existingResponse.status === 401) {
          setGoogleConnection(null);
          throw new Error("Your Google session expired. Reconnect and try again.");
        }
        if (!existingResponse.ok) throw new Error("Google Calendar could not check for duplicate shifts.");
        const existing = await existingResponse.json() as { items?: unknown[] };
        if (existing.items?.length) continue;
        const insertResponse = await fetch(calendarUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            summary: shift.title || "Work",
            start: { dateTime: calendarTimestamp(shift.date, shift.start), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            end: { dateTime: calendarTimestamp(shift.date, shift.end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
            extendedProperties: { private: { shiftlyKey: duplicateKey } },
          }),
        });
        if (!insertResponse.ok) throw new Error(`Google Calendar could not add the ${shift.day} shift.`);
      }
      setStage("done");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Calendar sync failed.");
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Shiftly home"><span className="brand-mark">S</span> Shiftly</a>
        <div className="header-actions">
          <div className="header-note"><span className="pulse" /> Photos stay private</div>
          <button className={`google-connect ${googleConnection ? "connected" : ""}`} onClick={connectGoogle} disabled={googleConnecting || (!googleReady && Boolean(GOOGLE_CLIENT_ID))}>
            <span className="google-g">G</span>
            {googleConnecting ? "Connecting…" : googleConnection ? googleConnection.email : "Connect Google"}
          </button>
        </div>
      </header>

      <section className="shell">
        <div className="intro">
          <p className="eyebrow">YOUR PAPER ROTA, SORTED</p>
          <h1>{stage === "review" ? "Check your week." : stage === "done" ? "Week sorted." : "Snap it. Shift it."}</h1>
          <p className="lede">{stage === "review" ? "We found your row. Fix anything that looks off, then send the selected shifts to Work." : stage === "done" ? "Your selected shifts are now in your Work calendar." : "Turn the weekly timetable photo into clean Google Calendar events—in under a minute."}</p>
        </div>

        {stage === "done" ? (
          <section className="success-card">
            <div className="success-icon">✓</div>
            <h2>{selectedCount} shifts added</h2>
            <p>Google Calendar · Work</p>
            <button className="primary" onClick={reset}>Add next week</button>
          </section>
        ) : stage === "review" ? (
          <section className="review-panel">
            <div className="review-top">
              <div><p className="step">STEP 2 OF 2</p><h2>Your shifts</h2></div>
              <button className="text-button" onClick={reset}>Use another photo</button>
            </div>
            <div className="summary-strip">
              <span><b>{selectedCount}</b> shifts</span><span><b>{totalHours}</b> hours</span><span className="calendar-chip"><i /> {googleConnection ? `${googleConnection.email} · Work` : "Google not connected"}</span>
            </div>
            <div className="shift-list">
              {shifts.map((shift) => (
                <article className={`shift-card ${shift.confidence === "low" ? "uncertain" : ""}`} key={shift.id}>
                  <input aria-label={`Include ${shift.day}`} type="checkbox" checked={shift.selected} onChange={(event) => updateShift(shift.id, { selected: event.target.checked })} />
                  <div className="date-block"><b>{shift.day.slice(0, 3)}</b><span>{formatDate(shift.date)}</span></div>
                  <label><span>Starts</span><input type="time" value={shift.start} onChange={(event) => updateShift(shift.id, { start: event.target.value })} /></label>
                  <span className="dash">—</span>
                  <label><span>Ends</span><input type="time" value={shift.end} onChange={(event) => updateShift(shift.id, { end: event.target.value })} /></label>
                  {shift.confidence === "low" && <span className="confidence">Check this</span>}
                  <button className="remove" aria-label={`Remove ${shift.day}`} onClick={() => removeShift(shift.id)}>×</button>
                </article>
              ))}
            </div>
            {notice && <p className="notice">{notice}</p>}
            <div className="actions">
              <button className="secondary" disabled={!selectedCount} onClick={exportIcs}>Download calendar file</button>
              <button className="primary" disabled={!selectedCount || googleConnecting} onClick={syncWithGoogle}>{googleConnection ? "Add to Work calendar" : "Connect & add to Work"} <span>→</span></button>
            </div>
            <p className="fine-print">Google’s account chooser decides whose calendar is used. Duplicates are skipped automatically.</p>
          </section>
        ) : (
          <section className="upload-panel">
            <div className="form-row">
              <label className="name-field"><span>Your name on the timetable</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. John Doe" autoComplete="name" /></label>
              <span className="saved">Saved on this device</span>
            </div>
            <button
              className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
            >
              {/* Blob previews are local-only and cannot use the framework image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview ? <img src={preview} alt="Selected timetable" /> : <div className="camera">⌁</div>}
              <div><b>{file ? file.name : "Take or choose a photo"}</b><span>{file ? `${formatFileSize(file.size)} · ${file.size > MAX_UPLOAD_IMAGE_BYTES ? "optimized before upload" : "Tap to replace it"}` : "Make sure the full table and day headers are visible"}</span></div>
            </button>
            <input ref={inputRef} hidden type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" capture="environment" onChange={handleFile} />
            {notice && <p className="notice">{notice}</p>}
            <div className="api-key-panel">
              <div className="api-key-copy">
                <b>Choose timetable AI</b>
                <span>{selectedProvider.hint} Keys stay only in this browser tab and are never saved.</span>
                <a href={selectedProvider.keyUrl} target="_blank" rel="noreferrer">Get a {selectedProvider.label} key ↗</a>
              </div>
              <div className="api-key-controls">
                <label className="api-provider-field">
                  <span>AI provider</span>
                  <select
                    value={aiProvider}
                    onChange={(event) => {
                      setAiProvider(event.target.value as AiProvider);
                      setAiApiKey("");
                      setShowAiApiKey(false);
                      setNotice("");
                    }}
                  >
                    {(Object.entries(AI_PROVIDERS) as Array<[AiProvider, typeof AI_PROVIDERS[AiProvider]]>).map(([value, provider]) => (
                      <option key={value} value={value}>{provider.optionLabel}</option>
                    ))}
                  </select>
                </label>
                <label className="api-key-field">
                  <span>{providerHasHostedKey ? "API key (optional)" : "API key"}</span>
                  <div>
                    <input
                      type={showAiApiKey ? "text" : "password"}
                      value={aiApiKey}
                      onChange={(event) => setAiApiKey(event.target.value)}
                      placeholder={providerHasHostedKey ? "Using private hosted key" : selectedProvider.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" onClick={() => setShowAiApiKey((current) => !current)}>{showAiApiKey ? "Hide" : "Show"}</button>
                  </div>
                </label>
              </div>
            </div>
            <button className="primary wide" disabled={stage === "reading"} onClick={analyse}>
              {stage === "reading" ? <><span className="spinner" /> Reading your timetable…</> : <>Find my shifts <span>→</span></>}
            </button>
            <div className="trust-row"><span>✓ Review before adding</span><span>✓ Detects unclear times</span><span>✓ No photo storage</span></div>
          </section>
        )}

        <section className="how-it-works">
          <div><span>01</span><b>Take a clear photo</b><p>Fit the full weekly table in frame.</p></div>
          <div><span>02</span><b>We find your row</b><p>Dates and times are read column by column.</p></div>
          <div><span>03</span><b>You approve</b><p>Only checked shifts go to Work.</p></div>
        </section>
      </section>
      <footer>Built for weekly rotas · Your timetable photo is processed once and not saved</footer>
    </main>
  );
}
