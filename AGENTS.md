# Shiftly Agent Instructions

These instructions apply to all agentic work in this repository. Follow them unless the user explicitly overrides them.

## Product

Shiftly turns a photographed weekly paper work timetable into reviewed Google Calendar shifts. The user enters their name, uploads one timetable image, reviews extracted shifts, and optionally exports an `.ics` file or adds approved shifts to a selected writable Google Calendar.

## Stack and entry points

- Node.js `>=22.13.0`, npm, TypeScript, React 19, Next-compatible Vinext, Vite, and Cloudflare Workers output.
- `app/page.tsx`: client upload flow, image preparation, review UI, Google OAuth, Calendar sync, and ICS export.
- `app/api/analyze/route.ts`: multipart validation, in-memory image encoding, private OpenAI Responses API call, and strict shift-result validation.
- `app/api/config/route.ts`: exposes only non-secret runtime configuration status.
- `app/calendar.ts`: date/time and overnight-shift helpers.
- `app/globals.css`: application styling.
- `worker/index.ts`: hosting worker entry point.
- `next.config.ts`: hosted request limits.
- `.openai/hosting.json`: existing Sites project metadata; preserve its `project_id` and bindings.

## Image workflow

- Accept JPEG, PNG, WebP, HEIC, and HEIF source files up to 50 MB in the browser.
- HEIC/HEIF must be converted client-side to a browser-readable PNG before preview and analysis. Keep `heic2any` lazy-loaded so ordinary uploads do not load the decoder.
- The normalized image follows the existing workflow: files over 3 MB are resized to a maximum 3200-pixel edge and encoded as JPEG until under the upload target. The API receives only the normalized image and applies its final 10 MB limit.
- Do not add native image-processing dependencies to the Cloudflare worker unless the hosting/runtime constraints are verified first.
- Uploaded photos are processed in memory and must not be persisted.

## OpenAI and Google boundaries

- `OPENAI_API_KEY` is a server-side secret only. Never expose it through client code, `NEXT_PUBLIC_*`, logs, source control, or responses.
- `GOOGLE_CLIENT_ID` is a public browser identifier; OAuth access tokens stay in memory and must not be persisted.
- Do not fabricate sample shifts when OpenAI is unavailable. Preserve fail-closed configuration and parse/validate structured output.
- Never write Google Calendar events before the user reviews and confirms shifts. Preserve duplicate protection and selected-calendar behavior.
- Keep employee names, timetable photos, tokens, API keys, and real environment files out of commits.

## Coding and change conventions

- Make the smallest coherent change that satisfies the request and preserve existing behavior for unrelated workflows.
- Prefer existing helpers and patterns. Keep user-facing errors actionable and fail safely.
- Add or update automated coverage for behavior changes. Avoid live OpenAI calls or Google writes in tests.
- Do not remove, reset, overwrite, or reformat unrelated user changes. Use `apply_patch` for source edits.
- Do not use destructive Git commands such as `git reset --hard` or `git checkout --` without explicit user approval.

## Required validation

Run these before committing and again after merging:

```bash
npx tsc --noEmit
npm run lint
npm test
git diff --check
```

`npm test` builds the production worker and runs `tests/rendered-html.test.mjs`. A real timetable and real Google Calendar sync require manual verification and credentials; do not substitute them with fake integration results.

## Feature Git workflow

For each feature implementation:

1. Inspect status and current branch; preserve unrelated work.
2. Pull the latest `main` with `git pull --ff-only origin main`.
3. Create a focused feature branch, e.g. `feature/heic-image-support`.
4. Implement the change and add tests/documentation as appropriate.
5. Run all required validation commands and review `git diff`.
6. Commit with a focused imperative message.
7. Push the feature branch and report its commit.
8. Switch to `main`, pull `origin/main` again, and merge the feature branch without losing history.
9. Run validation on the merged `main` state.
10. Push `main`. Keep the working tree clean and report the final branch/commit state.

Do not claim a branch was pushed or merged unless the Git command succeeded. Do not expose credentials used for a private source repository.

## CI/CD

`.github/workflows/ci.yml` is the canonical CI gate. It runs on pull requests and pushes to `main` or `feature/**`, installs with `npm ci`, then runs TypeScript checking, linting, and `npm test`. Keep the workflow aligned with the local validation commands.

For Sites deployment work, treat `.openai/hosting.json` as authoritative. Build and validate first, push the exact validated commit to the Sites-bound source repository when required, package using the Sites `package-site.sh` helper, save a version from the exact full `git rev-parse --verify HEAD` SHA, and deploy only that saved version. Preserve the existing private access policy; never change audience/access settings unless the user explicitly asks.

## Documentation

Update `README.md` when user-visible behavior, setup, limits, troubleshooting, privacy, or deployment behavior changes. Keep this file focused on instructions for agents rather than duplicating the full product guide.
