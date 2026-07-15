# Flat-Rate PWA — Pre-Launch Audit
_Generated 2026-06-21. Every issue is sourced from reading the actual code._

> **Status update 2026-07-15:** All 11 issues verified fixed in current source.
> #1–#10 resolved in code; #11 (admin passcode) documented as an obscurity-only
> gate with a TODO to move it server-side. Dead `PAGE`/`IS_MAIN`/`IS_MORE`
> constants from #6 removed from `src/utils.js`.

---

## 🔴 Critical — breaks core functionality

### 1. Bulk delete in History tab does NOT delete from Supabase
**File:** `src/more-page.js` ~line 1806 (`initBulkDelete`)  
**What:** The bulk-delete handler calls `await del(STORES.entries, id)`, which only removes the entry from the in-memory store. It never calls `softDeleteLog()`. On the next `safeLoadEntries()` the entries reappear from the database unchanged.  
**Fix:** Replace the `del()` call with `await softDeleteLog(sb(), id)` (already imported) and only fall back to `del()` on network error. Also refresh the local cache after deletion so the UI reflects the change immediately.

---

### 2. Bulk rate edit doesn't persist the new hourly rate to Supabase
**File:** `src/main-page.js` ~line 2282 (`bulkEditRate`)  
**What:** `bulkEditRate()` sends `{ cash_amount: newEarnings }` to `saveEditedLog()`. `apiUpdateLog()` in data-service.js builds its update payload from fixed fields and does **not** include `hourly_rate`. After the next data sync the entries reload from the server with the old rate, making the bulk-edit appear to have no effect.  
**Fix:** Pass `hourly_rate: rateVal` alongside `cash_amount` in the patch object:
```js
await saveEditedLog(e.id, { cash_amount: newEarnings, hourly_rate: rateVal });
```
And add `hourly_rate: Number(payload.hourly_rate || 0)` to `updateFields` in `apiUpdateLog`.

---

## 🟡 Major — important feature broken or significant UX problem

### 3. Pay-stub scan button ID mismatch — no loading state on OCR
**File:** `src/more-page.js` ~line 735–736 (`scanPayStub`)  
**What:** `scanPayStub()` opens with:
```js
const scanBtn = document.getElementById("scanCheckBtn");
```
No element with `id="scanCheckBtn"` exists in `index.html`. The real buttons are `scanCheckLibBtn` and `scanCheckCamBtn` (wired correctly lower in the same function at lines 794–795). `scanBtn` is `null`, so `scanBtn.textContent = "Scanning…"` throws a silent TypeError and the button never shows a loading state. The scan still fires via the correctly-wired buttons but there is zero visual feedback.  
**Fix:** Either add `id="scanCheckBtn"` to a wrapper element in the HTML, or update the variable to reference one of the existing IDs:
```js
const scanBtn = document.getElementById("scanCheckLibBtn");
```

---

### 4. `loadUserPrefixRules()` return value is discarded — custom prefix rules never applied
**File:** `src/classification-service.js` lines 113–129 and 201  
**What:** `loadUserPrefixRules()` fetches rows from `dealer_prefix_rules` and **returns** them, but the module-level `USER_PREFIX_RULES` array is never assigned. Wherever `window.__FR.loadUserPrefixRules` is called, the result is thrown away. Line 201 always evaluates to `getStockPrefixRules()` (the hardcoded fallback) because `USER_PREFIX_RULES.length` is always 0. Dealer-specific stock classification never works.  
**Fix:** Assign the result where the function is called, or change the function to assign internally:
```js
async function loadUserPrefixRules() {
  const { data, error } = await sb().from("dealer_prefix_rules").select("*");
  if (error) { console.error("Failed loading rules", error); return; }
  USER_PREFIX_RULES = (data || []).sort((a, b) => b.prefix.length - a.prefix.length);
}
```

---

### 5. `loadSubscription()` has no `user_id` filter — relies 100% on RLS
**File:** `src/data-service.js` (`loadSubscription`)  
**What:** The subscription check is:
```js
sb().from("subscriptions").select("status").maybeSingle()
```
There is no `.eq("user_id", uid)` filter. If RLS is ever misconfigured, disabled during a migration, or a policy gap exists, any authenticated user would receive the first matching subscription row in the table — potentially granting Pro access to non-paying users or returning the wrong status.  
**Fix:** Add a defense-in-depth filter even if RLS already enforces it:
```js
const uid = window.CURRENT_UID;
sb().from("subscriptions").select("status").eq("user_id", uid).maybeSingle()
```

---

### 6. `PAGE` constant always evaluates to `"main"` in the SPA — `IS_MORE` is dead code
**File:** `src/utils.js` line 56  
**What:**
```js
const PAGE = location.pathname.includes("more") ? "more" : "main";
```
In the SPA, the pathname is always `/` or `/index.html` — it never contains `"more"`. `PAGE` is permanently `"main"` and `IS_MORE` is permanently `false`. Two downstream effects:
- `setSummaryRange()` (line 84) always calls `scheduleRefreshUI(CURRENT_ENTRIES)`, including when the user is on the More tab, causing unnecessary re-renders.
- `setRangeMode()` (line 179) always enters the `PAGE === "main"` branch; the `IS_MORE` guard is never reached.

`window.__PAGE__` *is* kept current by `showSpaPage()` in boot.js — the constant just isn't used there.  
**Fix:** Replace `PAGE` with `window.__PAGE__` in the two functions that check it:
```js
if (window.__PAGE__ === "main") scheduleRefreshUI(CURRENT_ENTRIES);
```
```js
if (window.__PAGE__ === "main" && !opts.skipRefresh) { ... }
```

---

### 7. `dashboard.html` not copied to `www/` — missing in Capacitor/iOS build
**File:** `build.mjs` line 25 vs. line 258  
**What:** `dashboard.html` is listed in `HTML_FILES` (so its asset hashes get updated on build), but it is **not** listed in `WWW_ASSETS` and therefore never copied to `www/`. The admin feedback dashboard is inaccessible in the iOS native app.  
**Fix:** Add `"dashboard.html"` to the `WWW_ASSETS` array in `build.mjs`.

---

## 🟢 Minor — polish, edge cases, code hygiene

### 8. Double `window.__FR` initialization in boot.js
**File:** `src/boot.js` ~lines 56–59  
**What:** `window.__FR = window.__FR || {};` appears twice within a few lines. The second assignment is a no-op because the object already exists.  
**Fix:** Remove the first occurrence.

---

### 9. `requireUserId(sb)` ignores its parameter in photo-service.js
**File:** `src/photo-service.js` line 15  
**What:** The function signature accepts `sb` but the body never references it — it checks `window.CURRENT_UID` directly. Every call site passes `sb()` which is evaluated and discarded, wasting a client construction.  
**Fix:** Remove the `sb` parameter from the signature and all call sites, or actually use it inside the function.

---

### 10. Manifest icon `purpose` uses a space-separated string instead of separate entries
**File:** `manifest.webmanifest`  
**What:**
```json
{ "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" }
```
The spec technically allows space-separated purposes but many PWA auditors (Lighthouse, web.dev) and some Android/iOS installers expect separate icon objects — one with `"purpose": "any"` and one with `"purpose": "maskable"`.  
**Fix:**
```json
{ "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
{ "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" }
```
Repeat for the 512px icon.

---

### 11. Admin export passcode hardcoded in client-side JavaScript
**File:** `src/main-page.js` line 2173  
**What:**
```js
async function requireAdmin() {
  const pass = prompt("Admin export. Enter passcode:");
  return pass === "0231";
}
```
The passcode is visible in plain text in the minified bundle. Anyone with DevTools can run `window.requireAdmin = () => true` or simply read the source. This is a soft UX gate, not a security control.  
**Fix:** Either remove `exportAllCsvAdmin` from production and gate it server-side, or accept that this is an obscurity-only measure and document it as such. At minimum, don't use a numeric passcode visible in source.

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟡 Major | 5 |
| 🟢 Minor | 4 |

**Highest-priority fixes before launch:** Issues #1 (bulk delete) and #2 (bulk rate edit) corrupt data silently. Issue #3 (scan button) breaks the pay-stub OCR UX. Issue #4 (prefix rules) means the classification feature ships completely non-functional for any dealer who configured custom rules.
