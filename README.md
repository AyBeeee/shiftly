# Shiftly

Shiftly turns a photo of a weekly paper work timetable into editable calendar events. It finds the employee row by name, reads each day column, highlights uncertain values, and adds approved shifts to a Google Calendar named **Work**.

![Shiftly social preview](public/og.png)

## What it does

- Captures or uploads a timetable photo on mobile and desktop.
- Uses the employee name to locate the correct row.
- Extracts dates and start/end times column by column.
- Flags uncertain cells instead of silently guessing.
- Lets the user edit, select, or remove shifts before syncing.
- Finds a Google Calendar named `Work` and inserts approved events.
- Skips events previously created by Shiftly.
- Exports an `.ics` calendar file when Google Calendar is not connected.
- Processes images in memory and does not persist timetable photos.

## Technology

- Next.js-compatible app running on [vinext](https://github.com/cloudflare/vinext)
- React 19 and TypeScript
- OpenAI Responses API with `gpt-5.6-luna`
- Google Identity Services and Google Calendar API
- Cloudflare-compatible Sites deployment

The timetable reader uses Luna with `reasoning.effort: "low"` to keep reasoning-token use modest while still allowing the model to reason over row and column relationships. Dense timetable images are sent at high image detail so small text remains legible.

## Requirements

- Node.js 22.13 or newer
- An OpenAI API key
- A Google Cloud OAuth 2.0 web client with Google Calendar API enabled

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the safe environment template:

   ```bash
   cp .env.example .env.local
   ```

3. Add your private values to `.env.local`:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_oauth_web_client_id
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

The local URL is printed in the terminal. If `OPENAI_API_KEY` is absent, the app deliberately returns demonstration shifts so the review interface can still be tested.

## Google Calendar setup

1. Create or choose a Google Cloud project.
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen.
4. Create an **OAuth client ID** for a web application.
5. Add the app's local and deployed origins to **Authorized JavaScript origins**.
6. Put the client ID—not the client secret—in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
7. In Google Calendar, create a calendar named exactly **Work**.

Shiftly uses Google Identity Services' browser token model. **Connect Google** opens Google's own account chooser and consent dialog. The returned short-lived access token tells the Calendar API which Google user selected the account; Shiftly then requests `GET /users/me/calendarList`, finds that user's writable `Work` calendar, and uses the Events API to add shifts. A private event property prevents duplicate imports.

The access token is kept only in memory and is not saved by Shiftly. Google is the only application-level account connection. A private Sites deployment can still require its separate hosting sign-in before the app loads; that gate controls who may open the private site and does not decide which Google Calendar receives events.

## Privacy and secrets

- Timetable images are submitted directly to the analysis route and are not written to disk or a database.
- `OPENAI_API_KEY` is read only on the server.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is intentionally public; OAuth web client IDs are identifiers, not secrets.
- Real environment files (`.env`, `.env.local`, and variants) are ignored by Git.
- `.env.example` contains variable names only and is safe to commit.
- Never add a Google OAuth client secret to this browser-based flow.

Before publishing a fork, review the photo-retention and data-processing terms of every service you configure.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create and validate the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Build and run the rendered HTML test |

## Project layout

```text
app/
├── api/analyze/route.ts  # Secure image-analysis endpoint
├── globals.css           # Responsive visual system
├── layout.tsx            # Metadata and social preview
└── page.tsx              # Photo, review, export, and calendar UI
public/
└── og.png                # Social sharing image
.openai/hosting.json      # Sites deployment metadata
.env.example              # Safe environment variable template
```

## Production checklist

- Set `OPENAI_API_KEY` as a server-side secret.
- Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` as a build/runtime variable.
- Add the production origin to the Google OAuth client.
- Keep the repository private if it contains internal operational context.
- Run `npm run build` before deployment.
- Test one clear timetable and one deliberately blurry timetable before regular use.

## Current limitations

- The paper must show the full header row and the employee name column.
- The employee name should closely match the printed timetable name.
- The destination calendar must be named `Work`.
- Low-effort Luna minimizes cost, but unusual layouts may need manual corrections in the review screen.

## License

Private project. No license is granted for redistribution.
