/* ── Settings ────────────────────────────────────────────────────────────── */
const SETTINGS_KEY = "fr_settings";
const SETTINGS_DEFAULTS = Object.freeze({
  defaultRate: 15,
  accentColor: "#0095f6",
  compactList: false,
  darkMode: "auto",
});

let _settingsCache = null;
function getSettings() {
  if (_settingsCache) return _settingsCache;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    _settingsCache = stored ? { ...SETTINGS_DEFAULTS, ...JSON.parse(stored) } : { ...SETTINGS_DEFAULTS };
  } catch {
    _settingsCache = { ...SETTINGS_DEFAULTS };
  }
  return _settingsCache;
}

function saveSettings(patch) {
  const updated = { ...getSettings(), ...patch };
  _settingsCache = updated;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  applySettings(updated);
  return updated;
}

function resolveDarkMode(dm) {
  if (dm === "auto" || dm === undefined || dm === null) {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  }
  return dm === true || dm === "dark";
}

function applySettings(s = getSettings()) {
  const color = s.accentColor || SETTINGS_DEFAULTS.accentColor;
  document.documentElement.style.setProperty("--primary", color);
  document.documentElement.style.setProperty("--accent", color);
  document.body.classList.toggle("compact", !!s.compactList);
  document.documentElement.setAttribute("data-theme", resolveDarkMode(s.darkMode) ? "dark" : "light");

  if (!window.__FR_DM_MQ_WIRED__) {
    window.__FR_DM_MQ_WIRED__ = true;
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => applySettings());
  }
}

/* ── Pay rate ─────────────────────────────────────────────────────────────────
 * This used to fall back to a hardcoded $15/hr, which meant a tech who hadn't
 * set their rate yet had every job silently priced at somebody else's number —
 * and the app looked confident about it. A wrong pay figure is worse than no
 * figure in an app whose whole job is catching short pays, so there is now a
 * real "not set yet" state: getDefaultRate() returns 0 and the UI asks.
 */
function hasPayRate() {
  return Number(getSettings().defaultRate) > 0;
}

/** The tech's first name, if they've given one. */
function getUserName() {
  return String(getSettings().userName || "").trim();
}

/**
 * Hours in a full shift. Efficiency is measured against this, so it has to be
 * the user's number — a dealer running 9s or a 4-day/10-hour shop would get a
 * misleading percentage off a hardcoded 8.
 */
function getStandardDayHours() {
  const h = Number(getSettings().standardDay);
  return Number.isFinite(h) && h > 0 && h <= 24 ? h : 8;
}

function getDefaultRate() {
  const r = Number(getSettings().defaultRate);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/* ── Shared edge-function auth token ─────────────────────────────────────────
 * Every OCR/AI edge-function caller (scan-ro, scan-paystub, cluster-job-types,
 * draft-dispute) used to force a full auth.refreshSession() network round
 * trip before EVERY call, "just to be safe." refreshSession() always talks to
 * Supabase's auth server; getSession() reads a cached token for free. On the
 * kind of spotty shop wifi/cell signal this app runs on, that forced refresh
 * — not the OCR call itself — was very often what made a scan feel like it
 * "took forever to fire." Only pay for a real refresh when the cached token
 * is actually missing or genuinely close to expiring.
 */
const AUTH_TOKEN_REFRESH_MARGIN_S = 90;

async function getFreshAuthToken(sbInstance, marginS = AUTH_TOKEN_REFRESH_MARGIN_S) {
  if (!sbInstance) return null;
  const { data } = await sbInstance.auth.getSession().catch(() => ({ data: null }));
  const session = data?.session;
  const expiresAt = session?.expires_at || 0; // unix seconds
  const stillFresh = session?.access_token && (expiresAt - Date.now() / 1000) > marginS;
  if (stillFresh) return session.access_token;

  const refreshed = await sbInstance.auth.refreshSession().catch(() => null);
  return refreshed?.data?.session?.access_token || session?.access_token || null;
}
window.getFreshAuthToken = getFreshAuthToken;

/**
 * Fire-and-forget prewarm: call the moment a scan/draft picker or action
 * opens, so the (possibly network-bound) token check runs in the background
 * while the user is still framing a photo or typing a request, rather than
 * after they've already committed to the action. Callers `await` the same
 * promise inside their own getToken() so the network work never happens
 * twice — this only ever saves time, it can't cost any.
 */
const _authTokenPrewarm = new Map(); // key -> Promise<token|null>
function prewarmAuthToken(key, sbInstance) {
  if (!sbInstance) return;
  _authTokenPrewarm.set(key, getFreshAuthToken(sbInstance).catch(() => null));
}
async function consumePrewarmedAuthToken(key, sbInstance) {
  const pending = _authTokenPrewarm.get(key);
  if (pending) {
    _authTokenPrewarm.delete(key);
    const warm = await pending;
    if (warm) return warm;
  }
  return getFreshAuthToken(sbInstance);
}
window.prewarmAuthToken = prewarmAuthToken;

/* ── Haptics engine ───────────────────────────────────────────────────────────
 * haptic(kind) — one entry point for all tactile feedback.
 *   kinds: "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection"
 * Native: Capacitor Haptics (impact / notification / selectionChanged).
 * Web fallback: navigator.vibrate patterns.
 * Respects the user's haptic setting and rate-limits rapid fire so delegated
 * listeners never buzz-spam. Never throws.
 */
let _lastHapticAt = 0;
const _VIBE = {
  light: 12, medium: 22, heavy: 34,
  selection: 8,
  success: [18, 40, 26],
  warning: [26, 50, 26],
  error: [40, 60, 40],
};
function haptic(kind = "light") {
  try {
    if (getSettings().haptic === false) return;
    // Rate-limit: collapse bursts fired within 28ms (e.g. pointerdown + click)
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (now - _lastHapticAt < 28) return;
    _lastHapticAt = now;

    const cap = window.Capacitor;
    const H = cap?.Plugins?.Haptics;
    if (cap?.isNativePlatform?.() && H) {
      switch (kind) {
        case "selection": H.selectionChanged?.().catch(() => {}); break;
        case "success":   H.notification?.({ type: "SUCCESS" }).catch(() => {}); break;
        case "warning":   H.notification?.({ type: "WARNING" }).catch(() => {}); break;
        case "error":     H.notification?.({ type: "ERROR" }).catch(() => {}); break;
        case "heavy":     H.impact?.({ style: "HEAVY" }).catch(() => {}); break;
        case "medium":    H.impact?.({ style: "MEDIUM" }).catch(() => {}); break;
        case "light":
        default:          H.impact?.({ style: "LIGHT" }).catch(() => {}); break;
      }
      return;
    }
    // Web fallback
    navigator.vibrate?.(_VIBE[kind] ?? _VIBE.light);
  } catch { /* haptics are best-effort */ }
}
window.haptic = haptic;

/* ── Page detect (GLOBAL) ─────────────────────────────────────────────────── */
// Initial value only — boot.js showSpaPage() keeps window.__PAGE__ current.
window.__PAGE__ = location.pathname.includes("more") ? "more" : "main";

let rangeMode = "day";
let currentRefType = "RO";
let summaryRange = (window.__WEEK_WHICH__ === "last" || window.__WEEK_WHICH__ === "lastWeek") ? "lastWeek" : "thisWeek"; // "thisWeek" | "lastWeek"

// Coalesce rapid UI-driven refreshUI calls into a single animation frame.
// Data-load paths (renderLogs, safeLoadEntries) call refreshUI directly.
let _rafFrame = null;
let _rafArg = null;
function scheduleRefreshUI(entries) {
  _rafArg = entries !== undefined ? entries : CURRENT_ENTRIES;
  if (_rafFrame) return;
  _rafFrame = requestAnimationFrame(() => {
    _rafFrame = null;
    const arg = _rafArg;
    _rafArg = null;
    refreshUI(arg).catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[refreshUI]", e); });
  });
}

function setSummaryRange(next) {
  summaryRange = (next === "lastWeek") ? "lastWeek" : "thisWeek";
  window.__WEEK_WHICH__ = summaryRange;
  if (window.__PAGE__ === "main") scheduleRefreshUI(CURRENT_ENTRIES);
}

function setRefType(t) {
  currentRefType = t === "STOCK" ? "STOCK" : "RO";
  const ro = document.getElementById("refTypeRO");
  const stk = document.getElementById("refTypeSTK");
  ro?.classList.toggle("active", currentRefType === "RO");
  stk?.classList.toggle("active", currentRefType === "STOCK");
}

function setStatusMsg(msg){
  const s = $("statusMsg");
  if (s) s.textContent = msg;
}

function setDataWarning(msg) {
  const el = document.getElementById("dataWarning");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function toast(msg, ms = 2000){
  const t = document.getElementById("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._toastTimer);
  t._toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

let UNDO_STATE = null; // { onUndo, timer }

function showUndoBar({ text, onUndo, ttlMs = 8000 }) {
  const bar = document.getElementById("undoBar");
  const txt = document.getElementById("undoText");
  const btn = document.getElementById("undoBtn");
  const dismiss = document.getElementById("undoDismissBtn");
  if (!bar || !txt || !btn || !dismiss) return;

  if (UNDO_STATE?.timer) clearTimeout(UNDO_STATE.timer);
  UNDO_STATE = { onUndo, timer: null };

  txt.textContent = text || "Deleted.";
  bar.style.display = "block";

  const hide = () => {
    bar.style.display = "none";
    if (UNDO_STATE?.timer) clearTimeout(UNDO_STATE.timer);
    UNDO_STATE = null;
  };

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await onUndo?.();
      hide();
    } catch (e) {
      console.error("UNDO FAILED", e);
      alert("Undo failed: " + (e?.message || e));
    } finally {
      btn.disabled = false;
    }
  };

  dismiss.onclick = hide;

  UNDO_STATE.timer = setTimeout(hide, ttlMs);
}

function withTimeout(promise, ms = 4000, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))
  ]);
}

function num(v){
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

function setRangeMode(m, opts = {}) {
  rangeMode = m;
  window.__RANGE_MODE__ = m;

  document.getElementById("rangeDayBtn")?.classList.toggle("active", m === "day");
  document.getElementById("rangeWeekBtn")?.classList.toggle("active", m === "week");
  document.getElementById("rangeMonthBtn")?.classList.toggle("active", m === "month");
  document.getElementById("rangeAllBtn")?.classList.toggle("active", m === "all");

  const row = document.getElementById("weekWhichRow");
  if (row) row.style.display = (m === "week") ? "inline-flex" : "none";

  if (window.__PAGE__ === "main" && !opts.skipRefresh) {
    if (m === "all" && !_fullHistoryLoaded) {
      refreshUI(CURRENT_ENTRIES); // show what we have now
      safeLoadEntries({ fullHistory: true }).catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[loadHistory]", e); }); // fill in older entries
    } else {
      scheduleRefreshUI(CURRENT_ENTRIES);
    }
  }
}

function getRate(){
  const rateInput = document.querySelector('[name="rate"]');
  return rateInput ? num(rateInput.value) : getDefaultRate();
}

function getNotes(){
  const notesInput = document.querySelector('[name="notes"]');
  return notesInput ? (notesInput.value || "").trim() : "";
}

function nowISO(){ return new Date().toISOString(); }
function todayKeyLocal(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatMoney(n){
  const x = Number(n || 0);
  // Thousands separators so big pay numbers read cleanly ($1,234.00). Display-only.
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function round1(n){
  return Math.round((Number(n) || 0) * 10) / 10;
}
function round2(n){
  return Math.round((Number(n) || 0) * 100) / 100;
}
function formatHours(n){
  const x = round1(n);
  return (x % 1 === 0) ? String(x.toFixed(0)) : String(x.toFixed(1));
}
function formatDayLabel(dayKey){
  if (!dayKey) return "";
  const [y, m, d] = String(dayKey).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function bootEmp() {
  const empId = getEmpId();
  const input = document.getElementById("empId");
  if (input && empId) input.value = empId;
}

function setActiveEmp(empId){
  setEmpId(empId);
}
function uuid(){
  return crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

const MEMORY_STORES = {
  [STORES.entries]: new Map(),
  [STORES.types]: new Map(),
  [STORES.weekflags]: new Map(),
  [STORES.payroll]: new Map(),
};
const PERSISTED_STORE_KEYS = {
  [STORES.types]: "fr_store_types_v2",
  [STORES.weekflags]: "fr_store_weekflags",
  [STORES.payroll]: "fr_store_payroll",
};
const HYDRATED_STORES = new Set();

function cloneStoreValue(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function getPersistedStoreKey(storeName) {
  return PERSISTED_STORE_KEYS[storeName] || "";
}

function hydrateStoreMap(storeName) {
  const storageKey = getPersistedStoreKey(storeName);
  if (!storageKey || HYDRATED_STORES.has(storeName)) return;

  HYDRATED_STORES.add(storeName);
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
    const map = MEMORY_STORES[storeName] || new Map();
    if (Array.isArray(raw)) {
      for (const item of raw) {
        const key = item?.id ?? item?.weekStartKey;
        if (key == null) continue;
        map.set(key, item);
      }
    }
    MEMORY_STORES[storeName] = map;
  } catch {}
}

function persistStoreMap(storeName) {
  const storageKey = getPersistedStoreKey(storeName);
  if (!storageKey) return;

  const map = MEMORY_STORES[storeName] || new Map();
  if (!map.size) {
    localStorage.removeItem(storageKey);
    return;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(map.values())));
  } catch {}
}

function getStoreMap(storeName) {
  hydrateStoreMap(storeName);
  if (!MEMORY_STORES[storeName]) MEMORY_STORES[storeName] = new Map();
  return MEMORY_STORES[storeName];
}

function getWeekEnding(dateStr) {
  // Parse "YYYY-MM-DD" as LOCAL time — new Date("YYYY-MM-DD") parses as UTC
  // midnight, which shifts the day-of-week for anyone west of UTC.
  const d = parseDateInputValue(dateStr) || new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";

  const day = d.getDay(); // 0=Sun
  const diff = 5 - day;   // Friday payroll assumption

  d.setDate(d.getDate() + diff);

  return dateKey(d);
}

function normalizeEntries(entries) {
  return (entries || []).map((e) => {
    const parsed = e?.createdAt ? Date.parse(e.createdAt) : (e?.date ? Date.parse(e.date) : NaN);
    const createdAtMs = (typeof e?.createdAtMs === "number")
      ? e.createdAtMs
      : (Number.isFinite(parsed) ? parsed : Date.now());

    const dayKey = e?.dayKey || dayKeyFromISO(e?.createdAt || e?.date) || "";
    const entry = {
      ...e,
      createdAtMs,
      dayKey: dayKey || "",
    };

    entry.weekEnding = entry.dayKey ? getWeekEnding(entry.dayKey) : (entry.weekEnding || "");
    return entry;
  });
}

async function getAll(storeName) {
  if (storeName === STORES.entries) {
    return normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  }
  return Array.from(getStoreMap(storeName).values()).map(cloneStoreValue);
}

async function get(storeName, key) {
  return cloneStoreValue(getStoreMap(storeName).get(key) || null);
}

async function put(storeName, item) {
  if (storeName === STORES.entries) {
    const next = cloneStoreValue(item);
    const rows = Array.isArray(CURRENT_ENTRIES) ? [...CURRENT_ENTRIES] : [];
    const idx = rows.findIndex((r) => String(r?.id) === String(next?.id));
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
    CURRENT_ENTRIES = syncStateEntries(rows);
    return;
  }
  const map = getStoreMap(storeName);
  const key = item?.id ?? item?.weekStartKey ?? crypto.randomUUID?.() ?? String(Date.now());
  map.set(key, cloneStoreValue(item));
  persistStoreMap(storeName);
}

async function del(storeName, key) {
  if (storeName === STORES.entries) {
    CURRENT_ENTRIES = syncStateEntries(
      (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
        .filter((r) => String(r?.id) !== String(key))
    );
    return;
  }
  getStoreMap(storeName).delete(key);
  persistStoreMap(storeName);
}

async function clearStore(storeName) {
  if (storeName === STORES.entries) CURRENT_ENTRIES = syncStateEntries([]);
  getStoreMap(storeName).clear();
  persistStoreMap(storeName);
}

function applySearch(entries, q){
  if (!String(q || "").trim()) return entries;
  return entries.filter(e => matchSearch(e, q));
}

function populateDealerFilter(entries) {
  const select = document.getElementById("dealerFilter");
  if (!select) return;

  const prev = select.value || "all";
  const dealers = [...new Set((entries || []).map((e) => String(e?.dealer || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  select.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All Dealers";
  select.appendChild(allOpt);

  for (const d of dealers) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  }

  select.value = dealers.includes(prev) || prev === "all" ? prev : "all";
}

function applyDealerFilter(entries) {
  const select = document.getElementById("dealerFilter");
  const selected = select?.value || "all";
  if (selected === "all") return entries;
  return (entries || []).filter((e) => (e?.dealer || "UNKNOWN") === selected);
}

function weekdayLabel(i){
  // i: 0..6 where 0 = Monday
  return ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i] || "";
}

function computeWeekBreakdown(entries, weekStart){
  const days = [];
  for (let i = 0; i < 7; i++){
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    const dayEntries = entries.filter(e => e.dayKey === key);
    const totals = computeTotals(dayEntries);
    days.push({ i, key, totals, count: totals.count });
  }
  return days;
}

function renderWeekBreakdown(days){
  const card = document.getElementById("weekBreakdownCard");
  const list = document.getElementById("weekBreakdownList");
  if (!card || !list) return;

  if (!days || !days.length){
    card.style.display = "none";
    return;
  }

  card.style.display = "block";

  const picked = window.__WEEK_DAY_PICK__ || ""; // dayKey or ""
  list.innerHTML = days.map(d => {
    const active = picked === d.key;
    return `
      <div class="item" data-daykey="${d.key}" style="${active ? "outline:2px solid rgba(47,125,255,.7);" : ""}">
        <div class="itemTop">
          <div>
            <div class="mono">${weekdayLabel(d.i)} • ${d.key}</div>
            <div class="small muted">${d.count} entries</div>
          </div>
          <div class="right">
            <div class="mono">${d.totals.hours.toFixed(1)} hrs</div>
            <div style="margin-top:6px;">${formatMoney(d.totals.dollars)}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Tap to filter list by that day; tap again to clear
  list.querySelectorAll(".item[data-daykey]").forEach(el => {
    el.addEventListener("click", () => {
      const dk = el.getAttribute("data-daykey") || "";
      window.__WEEK_DAY_PICK__ = (window.__WEEK_DAY_PICK__ === dk) ? "" : dk;
      scheduleRefreshUI(CURRENT_ENTRIES);
    });
  });
}

// Week math: choose week start. Most payroll weeks start Monday.
// If yours starts Sunday, set WEEK_START = 0.
const WEEK_START = 1; // 0=Sun, 1=Mon

function startOfWeek(date, weekStart = WEEK_START) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0..6
  const diff = (day - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function weekRangeFor(key, now = new Date()) {
  const thisStart = startOfWeek(now);
  const thisEnd = addDays(thisStart, 7); // exclusive
  if (key === "thisWeek") return { start: thisStart, end: thisEnd };

  const lastStart = addDays(thisStart, -7);
  const lastEnd = thisStart; // exclusive
  return { start: lastStart, end: lastEnd };
}

function inRange(tsMs, start, end) {
  return tsMs >= start.getTime() && tsMs < end.getTime();
}

function weekKey(date) {
  // key by start-of-week date in YYYY-MM-DD
  const s = startOfWeek(date);
  const y = s.getFullYear();
  const m = String(s.getMonth() + 1).padStart(2, "0");
  const d = String(s.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const PAY_STUBS_KEY = "frPayStubsByWeek";

function loadPaidMap() {
  try { return JSON.parse(localStorage.getItem("paidHoursByWeek") || "{}"); }
  catch { return {}; }
}

function savePaidMap(map) {
  localStorage.setItem("paidHoursByWeek", JSON.stringify(map));
}

function setPaidHoursForWeekKey(weekStartKey, value) {
  const map = loadPaidMap();
  map[String(weekStartKey || "")] = Number(value) || 0;
  savePaidMap(map);
}

function removePaidHoursForWeekKey(weekStartKey) {
  const key = String(weekStartKey || "").trim();
  if (!key) return;
  const map = loadPaidMap();
  if (!Object.prototype.hasOwnProperty.call(map, key)) return;
  delete map[key];
  savePaidMap(map);
}

function getPaidRecordForWeekStart(startDate) {
  const key = weekKey(startDate);
  const map = loadPaidMap();
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  return Number(map[key]) || 0;
}

function setPaidHoursForThisWeek(value) {
  setPaidHoursForWeekKey(weekKey(new Date()), value);
  if (typeof scheduleRefreshUI === "function") scheduleRefreshUI(CURRENT_ENTRIES);
}

function getPaidHoursForWeekStart(startDate) {
  const v = getPaidRecordForWeekStart(startDate);
  return v == null ? 0 : v;
}

function loadPayStubMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(PAY_STUBS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function savePayStubMap(map) {
  localStorage.setItem(PAY_STUBS_KEY, JSON.stringify(map || {}));
}

function getPayStubForWeekKey(weekStartKey) {
  const key = String(weekStartKey || "").trim();
  if (!key) return null;
  const map = loadPayStubMap();
  const row = map[key];
  return row && typeof row === "object" ? row : null;
}

function upsertPayStubEntry(entry) {
  const key = String(entry?.weekStartKey || "").trim();
  if (!key) return;
  const map = loadPayStubMap();
  map[key] = {
    weekStartKey: key,
    weekEnding: String(entry?.weekEnding || ""),
    hoursPaid: Number(entry?.hoursPaid || 0),
    amountPaid: Number(entry?.amountPaid || 0),
    biweekly: !!entry?.biweekly,
    linkedWeek: String(entry?.linkedWeek || "").trim(),
    updatedAt: nowISO(),
  };
  savePayStubMap(map);
  setPaidHoursForWeekKey(key, Number(entry?.hoursPaid || 0));
}

function removePayStubEntry(weekStartKey, { includeLinked = true } = {}) {
  const key = String(weekStartKey || "").trim();
  if (!key) return 0;

  const map = loadPayStubMap();
  const row = map[key];
  if (!row) return 0;

  let removed = 0;
  const keysToRemove = [key];
  const linkedKey = String(row?.linkedWeek || "").trim();
  if (includeLinked && linkedKey && map[linkedKey]) keysToRemove.push(linkedKey);

  for (const target of keysToRemove) {
    if (!map[target]) continue;
    delete map[target];
    removePaidHoursForWeekKey(target);
    removed++;
  }

  savePayStubMap(map);
  return removed;
}

function parseDateInputValue(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mon - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mon - 1 || dt.getDate() !== d) return null;
  return dt;
}

function weekStartKeyFromDateInput(ymd) {
  const dt = parseDateInputValue(ymd);
  if (!dt) return "";
  return dateKey(startOfWeekLocal(dt));
}

function weekEndingForWeekStartKey(weekStartKey) {
  const dt = parseDateInputValue(weekStartKey);
  if (!dt) return "";
  return dateKey(endOfWeekLocal(dt));
}

/* -------------------- Week helpers (Mon–Sun) -------------------- */
function dateKey(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/* ── Pay week configuration ───────────────────────────────────────────────────
 * Shops don't all run Monday–Sunday. A common setup is payroll cutting off
 * Saturday at 2pm: anything turned in after that lands on the NEXT check. The
 * app used to bucket strictly by calendar week, so its totals could never match
 * the pay stub — which is fatal for an app whose job is comparing the two.
 *
 * Two knobs, both defaulting to the old behaviour so nothing shifts underneath
 * anyone who hasn't set them:
 *   payWeekStartDay  0=Sun … 6=Sat   (default 1 = Monday)
 *   payWeekCutoff    "HH:MM"          (default "00:00" = no time cutoff)
 */
function getPayWeekConfig() {
  const s = getSettings();
  const rawDay = Number(s.payWeekStartDay);
  const day = Number.isInteger(rawDay) && rawDay >= 0 && rawDay <= 6 ? rawDay : 1;
  const t = typeof s.payWeekCutoff === "string" && /^\d{1,2}:\d{2}$/.test(s.payWeekCutoff)
    ? s.payWeekCutoff : "00:00";
  const [hh, mm] = t.split(":").map(Number);
  return {
    day,
    cutoff: t,
    minutes: (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0),
  };
}

function startOfWeekLocal(d=new Date()){
  const { day: startDay } = getPayWeekConfig();
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Walk back to the most recent configured start day (0 when already on it).
  const diff = (x.getDay() - startDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

/**
 * Which day an entry counts toward for pay-week bucketing.
 *
 * Identical to its work date except on the cutoff day: work turned in BEFORE
 * the cutoff belongs to the period that's closing, so it's pushed back a day to
 * land in the previous week under date-only bucketing. The true work date is
 * never modified — this is only the bucketing key.
 *
 * Time comes from when the entry was logged, which is only trustworthy when it
 * was logged the same day it was worked. Logged later, we can't know the hour,
 * so it counts toward the period the work was done in — the conservative read.
 */
function payDayKeyFor(entry) {
  const dayKey = entry?.dayKey || dayKeyFromISO(entry?.createdAt || entry?.created_at || "") || entry?.work_date || "";
  const { day: startDay, minutes } = getPayWeekConfig();
  if (!dayKey || !minutes) return dayKey;           // no time cutoff configured

  const [yy, mm, dd] = String(dayKey).split("-").map(Number);
  if (!yy || !mm || !dd) return dayKey;
  const workDate = new Date(yy, mm - 1, dd);
  if (workDate.getDay() !== startDay) return dayKey; // only the cutoff day is ambiguous

  const stampRaw = entry?.createdAt || entry?.created_at || "";
  const stamp = stampRaw ? new Date(stampRaw) : null;
  const loggedSameDay = stamp && !Number.isNaN(stamp.getTime()) && dayKeyFromISO(stampRaw) === dayKey;
  const loggedMinutes = loggedSameDay ? stamp.getHours() * 60 + stamp.getMinutes() : 0;

  if (loggedMinutes >= minutes) return dayKey;       // after cutoff → new period
  const prev = new Date(yy, mm - 1, dd - 1);         // before cutoff → period closing
  return dateKey(prev);
}
function endOfWeekLocal(d=new Date()){
  const s = startOfWeekLocal(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return e;
}
function inWeek(dayKeyStr, weekStart){
  // dayKeyStr = YYYY-MM-DD
  const s = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  const e = endOfWeekLocal(weekStart);
  const [yy,mm,dd] = dayKeyStr.split("-").map(Number);
  const v = new Date(yy, mm-1, dd);
  return v >= s && v <= e;
}
function startOfMonthLocal(d=new Date()){
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonthLocal(d=new Date()){
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function inMonth(dayKeyStr, monthStart){
  const [yy,mm,dd] = String(dayKeyStr || "").split("-").map(Number);
  if (!yy || !mm || !dd) return false;
  const s = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const e = endOfMonthLocal(monthStart);
  const v = new Date(yy, mm - 1, dd);
  return v >= s && v <= e;
}

function dayKeyFromISO(iso){
  // Use local time consistently
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekFromDateKey(dayKeyStr){
  const [yy,mm,dd] = dayKeyStr.split("-").map(Number);
  const d = new Date(yy, mm-1, dd);
  return startOfWeekLocal(d);
}

function getLastWeekRange(){
  const now = new Date();
  const thisWs = startOfWeekLocal(now);
  const lastWs = new Date(thisWs);
  lastWs.setDate(lastWs.getDate() - 7);
  const lastWe = endOfWeekLocal(lastWs);
  return { ws: lastWs, we: lastWe };
}

/**
 * Strip everything but letters/digits and uppercase. RO/STK numbers get
 * written down in a dozen inconsistent shapes — "RO# 12345", "12345-A",
 * "12345 / A", "SLS 13860" — and a plain substring search breaks the moment
 * the punctuation on the search box doesn't exactly match the punctuation on
 * the stored entry (or vice versa). Comparing the stripped form catches all
 * of these as the same identifier.
 */
function normalizeIdChars(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Same idea, but for VINs specifically: the ISO 3779 VIN alphabet never
 * contains I, O, or Q (they're excluded on purpose because they're easy to
 * mistake for 1, 0, and 0/9). That makes I->1 and O->0 a safe, one-directional
 * normalization for MATCHING PURPOSES ONLY — it can never cause two genuinely
 * different real VINs to collide, since no real VIN contains those letters
 * to begin with. It just forgives a tech (or the OCR) reading/typing "O" for
 * a "0" or "I" for a "1", which is the single most common VIN transcription
 * mistake in the shop.
 */
function normalizeVinChars(s) {
  return normalizeIdChars(s).replace(/I/g, "1").replace(/O/g, "0");
}

function matchSearch(e, q){
  if (!q) return true;
  const s = String(q).trim().toLowerCase();
  const idQuery = normalizeIdChars(q);
  const vinQuery = normalizeVinChars(q);

  // Identifier fields (RO/STK numbers, VIN): match on the raw lowercase
  // substring (cheap, catches the common case) OR the normalized form, so
  // formatting differences between what's stored and what's typed don't
  // hide a real match. VIN fields additionally forgive I/O <-> 1/0.
  const idFields = [e.ref, e.ro, e.ro_number, e.stock];
  const vinFields = [e.vin, e.vin8];
  const proseFields = [e.type, e.typeText, e.notes];

  // Bidirectional: covers both "stored has extra formatting the query
  // doesn't" (stored "RO-12345", query "12345") AND "query has a prefix the
  // stored value doesn't" (stored "12345", query "RO-12345" or "RO#12345")
  // — a tech searching often adds the "RO"/"STK"/"#" label back in even
  // though it was never saved as part of the number.
  // The reverse direction (stored value is a substring of the query) is only
  // trustworthy once the stored value is long enough to be a real identifier
  // rather than a coincidental short fragment — a stored ref of "5" matching
  // every query that happens to contain a "5" would be a false positive, not
  // a feature.
  const MIN_REVERSE_LEN = 3;
  const idHit = idFields.some(v => {
    const raw = String(v || "");
    if (!raw) return false;
    if (raw.toLowerCase().includes(s)) return true;
    if (!idQuery) return false;
    const rawKey = normalizeIdChars(raw);
    if (rawKey.includes(idQuery)) return true;
    return rawKey.length >= MIN_REVERSE_LEN && idQuery.includes(rawKey);
  });
  if (idHit) return true;

  const vinHit = vinFields.some(v => {
    const raw = String(v || "");
    if (!raw) return false;
    if (raw.toLowerCase().includes(s)) return true;
    if (!vinQuery) return false;
    const rawKey = normalizeVinChars(raw);
    if (rawKey.includes(vinQuery)) return true;
    return rawKey.length >= MIN_REVERSE_LEN && vinQuery.includes(rawKey);
  });
  if (vinHit) return true;

  return proseFields.some(v => String(v || "").toLowerCase().includes(s));
}

function entryRoValue(e) {
  return String(e?.ro || e?.ref || e?.ro_number || "").trim();
}

function parseRoNumericSuffix(roValue) {
  const numericPart = String(roValue || "").replace(/^\D+/, "");
  if (!numericPart) return null;
  const n = Number.parseInt(numericPart, 10);
  return Number.isFinite(n) ? n : null;
}

function compareEntriesByRo(a, b) {
  const aRo = entryRoValue(a);
  const bRo = entryRoValue(b);
  const aNum = parseRoNumericSuffix(aRo);
  const bNum = parseRoNumericSuffix(bRo);

  if (aNum != null && bNum != null && aNum !== bNum) return aNum - bNum;

  const lex = aRo.localeCompare(bRo, undefined, { numeric: true, sensitivity: "base" });
  if (lex !== 0) return lex;

  return (a.createdAt || "").localeCompare(b.createdAt || "");
}

function sortEntriesByRo(entries) {
  return (entries || []).sort(compareEntriesByRo);
}

function groupByDay(entries){
  const map = new Map();
  for (const e of entries) {
    const k = e.dayKey || dayKeyFromISO(e.createdAt) || "unknown";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const keys = Array.from(map.keys()).sort((a,b)=>b.localeCompare(a));
  return keys.map(k => ({ dayKey: k, entries: map.get(k) }));
}

function groupEntriesByWeek(entries){
  const groups = {};

  (entries || []).forEach(e => {
    const week = e.weekEnding || "unknown";
    if (!groups[week]) groups[week] = [];
    groups[week].push(e);
  });

  return groups;
}

function groupEntriesByBrand(entries) {
  const grouped = {};

  for (const entry of entries) {
    const brand = entry.detected_brand || "Unknown";

    if (!grouped[brand]) grouped[brand] = [];
    grouped[brand].push(entry);
  }

  return grouped;
}

function groupByDealer(entries){
  const grouped = groupEntriesByBrand(entries || []);
  const keys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  return keys.map((k) => ({ dealer: k, entries: grouped[k] || [] }));
}

function entryRefLabel(e){
  const ref = e.ref || e.ro || e.stock || e.roStock || "";
  const kind = e.refType || e.refKind || "";
  return kind ? `${kind} ${ref}` : `${ref}`;
}

function formatWhen(iso){
  try { return new Date(iso).toLocaleString(); } catch { return iso || ""; }
}

function formatTimeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    if (hrs < 48) return "Yesterday";
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return iso || ""; }
}

function normalizeEntryToken(value) {
  return String(value || "").trim().toUpperCase();
}

function entryHasStoredPhoto(entry) {
  return !!(entry?.photo_path || entry?.photoPath || entry?.photoDataUrl);
}

function getEntryReviewState(entry) {
  const hasPhoto = entryHasStoredPhoto(entry);
  const statusLabel = hasPhoto ? "Photo attached" : "No photo";

  return {
    hasPhoto,
    statusLabel,
    statusDetail: "",
    needsReview: false,
    suggestionsPending: false,
    roMismatch: false,
    stockMismatch: false,
    vinMismatch: false,
  };
}

function getEntryRecordFacts(entry) {
  const review = getEntryReviewState(entry);
  return {
    dayKey: entry?.dayKey || dayKeyFromISO(entry?.createdAt) || entry?.work_date || "-",
    vin8: String(entry?.vin8 || "").trim() || "-",
    photoText: review.hasPhoto ? "attached" : "none",
    createdText: formatWhen(entry?.createdAt || entry?.created_at || ""),
    updatedText: formatWhen(entry?.updatedAt || entry?.updated_at || entry?.createdAt || entry?.created_at || ""),
    review,
  };
}

/* ── Action Sheet (replaces browser confirm/alert) ───────────────── */
/**
 * showActionSheet({ title, message, confirmLabel, danger, cancelLabel })
 * Returns a Promise<boolean> — true if user confirmed.
 * iOS-style bottom sheet with safe-area padding, backdrop tap to cancel.
 */
function showActionSheet({ title, message, confirmLabel = "Confirm", danger = false, cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    lockBodyScroll();

    const overlay = document.createElement("div");
    overlay.className = "asOverlay";
    overlay.innerHTML = `
      <div class="asCard" role="dialog" aria-modal="true">
        <div class="asHandle"></div>
        ${title   ? `<div class="asTitle">${escapeHtml(title)}</div>`     : ""}
        ${message ? `<div class="asMsg">${escapeHtml(message)}</div>`     : ""}
        <button type="button" class="asConfirm${danger ? " asDanger" : ""}">${confirmLabel}</button>
        <button type="button" class="asCancel">${cancelLabel}</button>
      </div>`;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("asOverlay--in"));

    const dismiss = (result) => {
      overlay.classList.remove("asOverlay--in");
      setTimeout(() => { overlay.remove(); unlockBodyScroll(); resolve(result); }, 220);
    };

    overlay.querySelector(".asConfirm").addEventListener("click", () => dismiss(true));
    overlay.querySelector(".asCancel").addEventListener("click",  () => dismiss(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(false); });
  });
}

/* ── Body scroll lock (iOS-safe) ─────────────────────────────────── */
let _scrollLockY = 0;

function lockBodyScroll() {
  if (document.body.classList.contains("modal-open")) return;
  _scrollLockY = window.scrollY;
  document.body.style.top = `-${_scrollLockY}px`;
  document.body.classList.add("modal-open");
}

function unlockBodyScroll() {
  if (!document.body.classList.contains("modal-open")) return;
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  window.scrollTo(0, _scrollLockY);
}

/* ── Lost Time ────────────────────────────────────────────────────────────────
 * Flat rate only pays for turned hours. The difference between clocked time and
 * flat hours is unpaid — usually parts delays, dead dispatch, or free comeback
 * rework. Logging where it went turns an invisible loss into evidence you can
 * put in front of a service manager.
 *
 * Stored locally per employee. The record shape is deliberately sync-friendly
 * (stable id + timestamps) so it can move to Supabase later without migration.
 */
const LOST_TIME_KEY = "fr_lost_time_";

const LOST_TIME_CATEGORIES = Object.freeze([
  { id: "parts",    label: "Parts delay",   emoji: "📦", blame: "shop" },
  { id: "nowork",   label: "No work",       emoji: "🪑", blame: "shop" },
  { id: "comeback", label: "Comeback",      emoji: "🔁", blame: "mixed" },
  { id: "cleanup",  label: "Cleanup",       emoji: "🧹", blame: "shop" },
  { id: "helping",  label: "Helping tech",  emoji: "🤝", blame: "shop" },
  { id: "training", label: "Training",      emoji: "📚", blame: "shop" },
  { id: "other",    label: "Other",         emoji: "•",  blame: "mixed" },
]);

function lostTimeCategory(id) {
  return LOST_TIME_CATEGORIES.find(c => c.id === id) || null;
}

function getLostTime(empId) {
  const id = String(empId || "").trim();
  if (!id) return [];
  try {
    const raw = localStorage.getItem(LOST_TIME_KEY + id);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveLostTime(empId, rows) {
  const id = String(empId || "").trim();
  if (!id) return false;
  try {
    localStorage.setItem(LOST_TIME_KEY + id, JSON.stringify(Array.isArray(rows) ? rows : []));
    return true;
  } catch { return false; }
}

/** Add entries for one day. `items` = [{category, hours, note}]. Ignores zero/invalid rows. */
function addLostTime(empId, items, dayKey) {
  const id = String(empId || "").trim();
  if (!id || !Array.isArray(items)) return 0;
  const day = dayKey || todayKeyLocal();
  const now = new Date().toISOString();
  const rows = getLostTime(id);
  let added = 0;
  for (const it of items) {
    const hours = round1(Number(it?.hours) || 0);
    if (!(hours > 0)) continue;
    if (!lostTimeCategory(it?.category)) continue;
    rows.push({
      id: `lt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dayKey: day,
      category: it.category,
      hours,
      note: String(it?.note || "").slice(0, 200),
      createdAt: now,
    });
    added++;
  }
  if (added) saveLostTime(id, rows);
  return added;
}

function removeLostTime(empId, rowId) {
  const rows = getLostTime(empId);
  const next = rows.filter(r => r.id !== rowId);
  if (next.length === rows.length) return false;
  return saveLostTime(empId, next);
}

/**
 * Summarize lost time between two dayKeys (inclusive; omit for all-time).
 * Returns { totalHours, dollars, byCategory:[{id,label,emoji,hours,dollars,pct}] }
 */
function summarizeLostTime(empId, fromKey, toKey, rate) {
  const rows = getLostTime(empId).filter(r => {
    const k = r?.dayKey;
    if (!k) return false;
    if (fromKey && k < fromKey) return false;
    if (toKey   && k > toKey)   return false;
    return true;
  });

  const hourlyRate = Number(rate) > 0 ? Number(rate) : (Number(getDefaultRate?.()) || 0);
  const map = new Map();
  let totalHours = 0;
  for (const r of rows) {
    const h = Number(r.hours) || 0;
    if (!(h > 0)) continue;
    totalHours += h;
    map.set(r.category, (map.get(r.category) || 0) + h);
  }
  totalHours = round1(totalHours);

  const byCategory = Array.from(map.entries())
    .map(([id, h]) => {
      const cat = lostTimeCategory(id) || { id, label: id, emoji: "•" };
      const hours = round1(h);
      return {
        id,
        label: cat.label,
        emoji: cat.emoji,
        hours,
        dollars: round2(hours * hourlyRate),
        pct: totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  return {
    totalHours,
    dollars: round2(totalHours * hourlyRate),
    count: rows.length,
    byCategory,
  };
}
