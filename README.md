# Flatrate Buddy

> A PWA for automotive flat-rate technicians to log jobs, track earnings, catch short pays, and analyze their work — all from their phone.

**Live app:** [app.nellylabs.dev](https://app.nellylabs.dev)

---

## Status

**v1.10, live in production.** Core job logging is free for everyone. **Flat-Rate Pro**
(export, PDF audit/dispute reports, cloud sync) is a paid subscription via Stripe. The
**Team/Shop dashboard** — invite your crew, see shop-wide totals, handle pay disputes —
is free for every shop, no Pro required, on either side.

---

## Features

- **Job logging** — hours, job type, RO/STK number, earnings, VIN, optional photo
- **Pay dashboard** — daily pay ring, week chart, goal tracking, catch-up target
- **Stats tab** — donut chart breakdown by job type (PDI, Pre-Owned, Sold, Re-Clean, etc.) with count, hours, and pay per category; 13 period filters including custom date range and pay period
- **Smart job-type normalization** — "pdi clean", "PDI", "Wash & Wax" → all grouped as PDI; "Full Detail on Pre-Owned Vehicle" → Pre-Owned; etc.
- **Short-pay detection** — flags weeks where logged hours exceed what was paid
- **OCR photo scan** — attach a repair order photo and the app extracts RO number and VIN automatically
- **Payday summary** — tap to review a full breakdown of the current pay period
- **Comeback tracking** — logs warranty returns and shows comeback rate
- **Shift efficiency** — clock in/out to track actual vs. flat hours
- **Cloud sync** — Supabase backend with row-level security; data synced across devices when signed in
- **PDF & CSV export** — weekly summary PDF or full CSV download
- **Offline support** — works offline; queues edits until reconnected
- **PWA** — installable on iOS and Android home screen; push notifications for payday reminders
- **Team/Shop dashboard** (`team.html`) — create or join a shop with a 6-character invite code; managers get a live dashboard of the whole crew's jobs, hours, and pay, a requests inbox for pay disputes, roster management, and CSV export; techs get their own jobs auto-shared with their shop's managers. Free for every shop. Guided tour built in for both roles.
- **Error monitoring** — client-side errors (including schema/API mismatches) are logged to a `client_errors` table so problems surface instead of failing silently

---

## Source Layout

All source files are under `src/`:

| File | Purpose |
|---|---|
| `src/boot.js` | Startup sequencing, SPA navigation, changelog/What's New, event wiring |
| `src/main-page.js` | Quick entry form, hero dashboard, job history, tour, Stats tab (donut chart, period filters, job-type normalization) |
| `src/more-page.js` | More tab: Insights, History/Export, Settings; payday summary; needs-review queue |
| `src/data-service.js` | Supabase auth, IndexedDB stores, API reads/writes, offline queue |
| `src/photo-service.js` | Photo picking, downscaling, uploads, OCR scan flow, gallery viewer |
| `src/utils.js` | Date helpers, formatting, math, filter/search utilities |

`team.html` is a separate, standalone page (its own inline script, not part of the
`src/` bundle) that powers the Team/Shop dashboard — manager view, tech view, guided
tour, and its own Supabase client.

---

## Architecture

Single-page app (`index.html`) with three SPA sections:

- `#spa-main` — Log tab (default)
- `#spa-stats` — Stats tab
- `#spa-more` — More tab

Navigation uses CSS `transform: translateX` (never `display:none`) to avoid iOS WKWebView hit-test bugs.

**Build:** `build.mjs` bundles `src/*.js` via esbuild → hashed `app.<hash>.js` + `app.<hash>.css` → copied to `www/`.

**Data:** IndexedDB for local storage; Supabase (`work_logs` table) for cloud sync when signed in.

**Pay periods:** bi-weekly, anchored to Mon Jan 6 2025.

---

## Build

```bash
node build.mjs
```

Then open `index.html` locally or deploy the `www/` folder to Cloudflare Pages.

---

## Deploy

Hosted on **Cloudflare Pages** (project `flatrate`) at `app.nellylabs.dev`. The Pages
project is connected to this GitHub repo with production branch **`master`** —
pushing to `master` triggers an automatic build + deploy. (This repo has never had a
`main` branch; `master` has always been the default.)

Netlify (`netlify.toml`, `astounding-twilight-d7f187.netlify.app`) and GitHub Pages
(`.github/workflows/deploy.yml`, `kidundone.github.io/FlatRate`) are leftover from
earlier hosting experiments and are **not** what serves production traffic.

---

## License

MIT
