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

const DEMO_SHIFTS: Shift[] = [
  { id: "mon", day: "Monday", date: "2026-08-03", start: "09:00", end: "17:00", title: "Work", confidence: "high", selected: true },
  { id: "tue", day: "Tuesday", date: "2026-08-04", start: "10:00", end: "18:00", title: "Work", confidence: "high", selected: true },
  { id: "thu", day: "Thursday", date: "2026-08-06", start: "08:30", end: "16:30", title: "Work", confidence: "low", selected: true },
  { id: "fri", day: "Friday", date: "2026-08-07", start: "12:00", end: "20:00", title: "Work", confidence: "high", selected: true },
];

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function calendarTimestamp(date: string, time: string) {
  return `${date}T${time}:00`;
}

function escapeIcs(value: string) {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

export default function Home() {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [stage, setStage] = useState<"upload" | "reading" | "review" | "done">("upload");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(localStorage.getItem("shiftly-name") ?? "");
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  useEffect(() => {
    if (name.trim()) localStorage.setItem("shiftly-name", name.trim());
  }, [name]);

  const selectedCount = useMemo(() => shifts.filter((shift) => shift.selected).length, [shifts]);
  const totalHours = useMemo(() => shifts.filter((shift) => shift.selected).reduce((total, shift) => {
    const [sh, sm] = shift.start.split(":").map(Number);
    const [eh, em] = shift.end.split(":").map(Number);
    return total + Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
  }, 0), [shifts]);

  function chooseFile(nextFile?: File) {
    if (!nextFile || !nextFile.type.startsWith("image/")) return;
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
    setStage("reading");
    setNotice("");
    try {
      const data = new FormData();
      data.append("image", file);
      data.append("name", name.trim());
      const response = await fetch("/api/analyze", { method: "POST", body: data });
      const result = await response.json() as { shifts?: Shift[]; error?: string; demo?: boolean };
      if (!response.ok || !result.shifts) throw new Error(result.error || "We couldn't read this timetable.");
      setShifts(result.shifts.map((shift, index) => ({ ...shift, id: shift.id || `${shift.date}-${index}`, selected: true })));
      setStage("review");
      if (result.demo) setNotice("Preview mode is on. Connect an OpenAI key to read your real timetable.");
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

  async function syncWithGoogle() {
    if (!GOOGLE_CLIENT_ID || !window.google) {
      setNotice("Google Calendar isn't connected yet. Download the calendar file instead, or add a Google OAuth client ID.");
      return;
    }
    setNotice("Connecting to Google Calendar…");
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
      callback: async (token) => {
        if (!token.access_token) return setNotice("Google Calendar connection was cancelled.");
        try {
          const headers = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };
          const calendarsResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers });
          const calendars = await calendarsResponse.json() as { items?: Array<{ id: string; summary: string }> };
          const workCalendar = calendars.items?.find((calendar) => calendar.summary.toLowerCase() === "work");
          if (!workCalendar) throw new Error('Create a Google calendar named “Work” first, then try again.');

          for (const shift of shifts.filter((item) => item.selected)) {
            const duplicateKey = `shiftly-${shift.date}-${shift.start}`;
            const query = new URLSearchParams({
              timeMin: new Date(calendarTimestamp(shift.date, "00:00")).toISOString(),
              timeMax: new Date(calendarTimestamp(shift.date, "23:59")).toISOString(),
              privateExtendedProperty: `shiftlyKey=${duplicateKey}`,
              singleEvents: "true",
            });
            const existingResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(workCalendar.id)}/events?${query}`, { headers });
            const existing = await existingResponse.json() as { items?: unknown[] };
            if (existing.items?.length) continue;
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(workCalendar.id)}/events`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                summary: shift.title || "Work",
                start: { dateTime: calendarTimestamp(shift.date, shift.start), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                end: { dateTime: calendarTimestamp(shift.date, shift.end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                extendedProperties: { private: { shiftlyKey: duplicateKey } },
              }),
            });
          }
          setStage("done");
          setNotice("");
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Calendar sync failed.");
        }
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Shiftly home"><span className="brand-mark">S</span> Shiftly</a>
        <div className="header-note"><span className="pulse" /> Photos stay private</div>
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
              <span><b>{selectedCount}</b> shifts</span><span><b>{totalHours}</b> hours</span><span className="calendar-chip"><i /> Work calendar</span>
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
              <button className="primary" disabled={!selectedCount} onClick={syncWithGoogle}>Add to Google Calendar <span>→</span></button>
            </div>
            <p className="fine-print">Duplicates are skipped automatically. Nothing is added until you press the button.</p>
          </section>
        ) : (
          <section className="upload-panel">
            <div className="form-row">
              <label className="name-field"><span>Your name on the timetable</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Abdullah Baig" autoComplete="name" /></label>
              <span className="saved">Saved on this device</span>
            </div>
            <button
              className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}
            >
              {preview ? <img src={preview} alt="Selected timetable" /> : <div className="camera">⌁</div>}
              <div><b>{file ? file.name : "Take or choose a photo"}</b><span>{file ? "Tap to replace it" : "Make sure the full table and day headers are visible"}</span></div>
            </button>
            <input ref={inputRef} hidden type="file" accept="image/*" capture="environment" onChange={handleFile} />
            {notice && <p className="notice">{notice}</p>}
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
