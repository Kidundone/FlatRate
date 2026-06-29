# Flatrate Buddy

> A PWA for automotive flat-rate technicians to log jobs, track earnings, catch short pays, and analyze their work — all from their phone.

**Live app:** [app.nellylabs.dev](https://app.nellylabs.dev)

---

## Status

**v1.3 Beta** — All features are free during the beta period. Paid plans are coming soon.

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

Hosted on Cloudflare Pages at `app.nellylabs.dev`. Push to `main` triggers automatic deploy.

---

## License

MIT
