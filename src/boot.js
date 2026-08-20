// Suppress empty-object errors thrown by Supabase/Capacitor during boot
// (e.g. {} from WKWebView before network is ready) — log real errors only.
function logErr(label) {
  return (e) => {
    if (!e) return;
    const empty = typeof e === "object" && !(e instanceof Error) && !Object.keys(e).length;
    if (!empty) console.error(`[${label}]`, e);
  };
}

// Kill the native iOS "rubber-band" side-to-side wobble — this is a
// Capacitor app, not a webpage, and shouldn't be draggable off-center.
// The root WKWebView bounces on both axes by default; the main Log page
// still relies on the ROOT view scrolling vertically (it isn't wrapped in
// its own fixed-position panel like #spa-more/#spa-stats are), so we can't
// just disable scrolling outright — only the horizontal component gets
// blocked, and only for gestures that aren't inside something meant to
// scroll sideways (chip rows, period tabs, etc. keep working normally).
(function killHorizontalBounce() {
  let startX = 0, startY = 0, decided = false, blockHorizontal = false, allowNative = false;

  // Fast path: elements known to scroll sideways. Kept because closest() costs
  // nothing, but it is NO LONGER the only check — a hand-maintained list is
  // exactly the kind of thing that silently rots (the Stats period chips got
  // stuck precisely because matching here was the sole gate).
  const H_SCROLL_SELECTOR = ".statsChipsWrap, .mnthBarsScroll, .fr26QuickHours, " +
    ".fr26QuickTools, .pillRow, .entryActions, .hcActionRow, .recentTypeChips";

  // Ground truth: does anything under the finger actually have somewhere to
  // scroll horizontally? Walks a few ancestors reading scrollWidth/clientWidth.
  // This is a layout read, but a cheap one on a clean layout, and unlike the
  // getComputedStyle() version that once made the whole app feel laggy it does
  // not force a full style recalculation.
  function canScrollX(el) {
    for (let i = 0; el && el !== document.body && i < 6; i++, el = el.parentElement) {
      if (el.scrollWidth - el.clientWidth > 2) return true;
    }
    return false;
  }

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { allowNative = true; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    decided = false;
    blockHorizontal = false;
    const t = e.target;
    allowNative = !!(t && t.closest && t.closest(H_SCROLL_SELECTOR)) || canScrollX(t);
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (allowNative || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // too small to tell yet
      decided = true;
      blockHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (blockHorizontal) e.preventDefault();
  }, { passive: false });
})();

// target="_blank" links (Terms, Privacy, upgrade modal footer) have no
// default behavior inside a Capacitor WKWebView — there's no browser chrome
// to open a new tab in, so taps on them silently did nothing. Open them in
// the native in-app browser instead; on the web/PWA build target="_blank"
// already works natively, so just let those through untouched.
document.addEventListener("click", (e) => {
  const a = e.target?.closest?.('a[target="_blank"]');
  if (!a || !a.href) return;
  const cap = window.Capacitor;
  const Browser = cap?.Plugins?.Browser;
  if (!cap?.isNativePlatform?.() || !Browser) return;
  e.preventDefault();
  Browser.open({ url: a.href }).catch(() => { window.location.href = a.href; });
});

window.BUILD = "20260624-stable";
const BUILD_TAG = "stable";
const FEATURE_FREEZE = Object.freeze({
  active: true,
  entriesDataPath: "supabase",
});
const ACTIVE_DATA_PATH = FEATURE_FREEZE.entriesDataPath;

if ("serviceWorker" in navigator && !window.Capacitor?.isNativePlatform?.()) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
  // When a new SW takes control show a persistent banner — never auto-reload,
  // as that can interrupt an active sign-in or form submission.
  let _swUpdated = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swUpdated) return;
    _swUpdated = true;
    const banner = document.getElementById("swUpdateBanner");
    if (banner) banner.style.display = "";
  });
}

async function checkForAppUpdate() {
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) { toast?.("No update available"); return; }

  const btn = document.getElementById("checkUpdateBtn");
  const original = btn?.textContent;
  if (btn) { btn.textContent = "Checking…"; btn.disabled = true; }

  await reg.update().catch(() => {});

  const activate = (sw) => sw.postMessage({ type: "SKIP_WAITING" });

  if (reg.waiting) {
    activate(reg.waiting);
    // controllerchange will fire and reload
  } else if (reg.installing) {
    reg.installing.addEventListener("statechange", function () {
      if (this.state === "installed" && reg.waiting) activate(reg.waiting);
    });
  } else {
    toast?.("Already on the latest version");
    if (btn) { btn.textContent = original; btn.disabled = false; }
  }
}
window.__FR = window.__FR || {};
window.__FR.checkForAppUpdate = checkForAppUpdate;
window.__FR.buildTag = BUILD_TAG;
window.__FR.featureFreeze = FEATURE_FREEZE;
window.__FR.activeDataPath = ACTIVE_DATA_PATH;
try { window.__FR.sb = sb(); } catch {} // bootAuth handles Supabase-not-ready gracefully
window.__FR.supabase = window.supabase;

/* ─── SPA page switcher ─────────────────────────────────────────────────────
   Switches between #spa-main, #spa-more, and #spa-stats without any page reload.
   Called by tab-bar buttons (data-spa-page attribute) and from JS (showSpaPage).
────────────────────────────────────────────────────────────────────────────── */
let _moreSectionLoaded = false;
let _statsPageLoaded   = false;

function showSpaPage(name) {
  const main  = document.getElementById("spa-main");
  const more  = document.getElementById("spa-more");
  const stats = document.getElementById("spa-stats");
  if (main) main.style.display = name === "main" ? "" : "none";
  // #spa-more and #spa-stats use CSS transforms — never display:none (iOS WKWebView bug).
  document.body.dataset.page = name;
  window.__PAGE__ = name;
  document.querySelectorAll(".tabItem[data-spa-page]").forEach(t => {
    const active = t.dataset.spaPage === name;
    t.classList.toggle("tabItem--active", active);
    if (active) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  // Page-enter animation
  const pageEl = name === "main" ? main : name === "more" ? more : name === "stats" ? stats : null;
  if (pageEl) {
    pageEl.classList.remove("spaPageIn");
    void pageEl.offsetWidth;
    pageEl.classList.add("spaPageIn");
    setTimeout(() => pageEl.classList.remove("spaPageIn"), 260);
  }
  window.scrollTo(0, 0);
  if (name === "more"  && more)  more.scrollTop  = 0;
  if (name === "stats" && stats) stats.scrollTop = 0;

  // Load more-page data on first visit (deferred from boot to avoid
  // "Supabase not ready" errors). Refresh on every subsequent visit.
  if (name === "more") {
    if (!_moreSectionLoaded) {
      _moreSectionLoaded = true;
      safeLoadEntries?.({ fullHistory: true })
        .then(() => refreshMorePagePanels?.())
        .catch(logErr("moreData"));
    } else {
      refreshMorePagePanels?.().catch(logErr("moreRefresh"));
    }
    setTimeout(() => window.__FR?.startMoreTour?.(), 600);
  }

  // Stats / Breakdown page
  // Stats offers "This Year" and "All Time", but the app only keeps the last
  // 90 days in memory by default — so without pulling full history first those
  // periods silently under-report (they'd chart 90 days and call it a year).
  // Same full-history load the More page does, just triggered from here too.
  if (name === "stats") {
    const drawStats = () => window.__FR?.[_statsPageLoaded ? "renderBreakdownPage" : "initBreakdownPage"]?.(
      _statsPageLoaded ? (window.__STATS_PERIOD__ || "week") : undefined
    );
    if (!_statsPageLoaded) {
      setTimeout(() => { window.__FR?.initBreakdownPage?.(); _statsPageLoaded = true; }, 150);
    } else {
      setTimeout(drawStats, 100);
    }
    if (!_fullHistoryLoaded) {
      safeLoadEntries?.({ fullHistory: true })
        .then(() => window.__FR?.renderBreakdownPage?.(window.__STATS_PERIOD__ || "week"))
        .catch(logErr("statsFullHistory"));
    }
  }
}
window.__FR.showSpaPage = showSpaPage;

/* ── "Set your pay rate" banner ────────────────────────────────────────────
 * Shown until the tech sets a real rate. Deliberately loud: every earnings
 * figure in the app is meaningless until this number is theirs.
 */
function refreshRateBanner() {
  const el = document.getElementById("rateSetupBanner");
  if (!el) return;
  el.style.display = (typeof hasPayRate === "function" && hasPayRate()) ? "none" : "";
}
window.__FR.refreshRateBanner = refreshRateBanner;

/* ── Greeting ──────────────────────────────────────────────────────────────
 * Swaps the app name for the tech's own once they've given one. Small thing,
 * but this is a tool someone opens twenty times a shift — it should feel like
 * theirs, not like a product.
 */
function refreshGreeting() {
  const el = document.getElementById("headerGreeting");
  if (!el) return;
  const name = typeof getUserName === "function" ? getUserName() : "";
  if (!name) { el.textContent = "Flatrate Buddy"; return; }
  const h = new Date().getHours();
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  el.textContent = `${part}, ${name}`;
}
window.__FR.refreshGreeting = refreshGreeting;

document.getElementById("rateSetupBtn")?.addEventListener("click", () => {
  haptic?.("light");
  showSpaPage("more");
  setTimeout(() => {
    document.querySelector('.moreTab[data-tab="settings"]')?.click();
    const input = document.getElementById("settingsDefaultRate");
    if (input) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus();
      input.classList.add("fieldPulse");
      setTimeout(() => input.classList.remove("fieldPulse"), 1600);
    }
  }, 320);
});

// Wire tab bar buttons
document.querySelectorAll(".tabItem[data-spa-page]").forEach(btn => {
  btn.addEventListener("click", () => { window.haptic?.("selection"); showSpaPage(btn.dataset.spaPage); });
});

// Any [data-open-upgrade] control opens the upgrade modal.
document.addEventListener("click", (e) => {
  if (e.target?.closest?.("[data-open-upgrade]")) {
    e.preventDefault();
    window.haptic?.("light");
    window.__FR?.showUpgradeModal?.() || (typeof showUpgradeModal === "function" && showUpgradeModal());
  }
});

// ── Collapse Emp # once it's known ────────────────────────────────────────
// Your employee number is set once, but it used to sit between the scan button
// and the hours field — dead space in a form filled dozens of times a shift.
// Once set it becomes a small chip, so the form starts where the work starts.
(function initEmpChip() {
  const bar   = document.getElementById("empBar");
  const input = document.getElementById("empId");
  const chip  = document.getElementById("empChipBtn");
  if (!bar || !input || !chip) return;

  const collapse = () => {
    const val = (input.value || "").trim();
    if (!val) return expand(false);
    chip.textContent = `Emp ${val}`;
    chip.hidden = false;
    bar.classList.add("fr26EmployeeBar--collapsed");
  };

  const expand = (focus = true) => {
    chip.hidden = true;
    bar.classList.remove("fr26EmployeeBar--collapsed");
    if (focus) { try { input.focus(); input.select(); } catch {} }
  };

  chip.addEventListener("click", () => expand(true));
  // Collapse again once they're done editing, if a value is present.
  input.addEventListener("blur", () => { if ((input.value || "").trim()) collapse(); });

  // Initial state — collapsed only when we already know the number.
  if ((input.value || "").trim()) collapse();
  else {
    // Value may be restored from storage slightly after boot.
    setTimeout(() => { if ((input.value || "").trim()) collapse(); }, 400);
  }
})();

// ── Remember which More-page sections you left open ───────────────────────
// Previously only Pay Stub persisted; every other section collapsed on each
// visit, so the ones you actually use had to be reopened every time. Keys are
// derived from the section heading, so a renamed heading simply resets that
// one section to its default instead of breaking.
(function persistMoreSections() {
  const all = document.querySelectorAll("details.moreSectionDetails");
  if (!all.length) return;

  const seen = new Set();
  all.forEach((det, i) => {
    // Pay Stub manages its own state in more-page.js — don't double-bind it.
    if (det.id === "payStubDetails") return;

    const heading = det.querySelector("summary")?.textContent || "";
    let slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    if (!slug || seen.has(slug)) slug = `${slug || "section"}-${i}`;
    seen.add(slug);
    const key = `fr_sect_${slug}`;

    try {
      if (localStorage.getItem(key) === "1") det.open = true;
    } catch {}

    det.addEventListener("toggle", () => {
      try { localStorage.setItem(key, det.open ? "1" : "0"); } catch {}
    });
  });
})();

// ── Hero "More stats" disclosure ──────────────────────────────────────────
// Keeps the shift view to one headline number + one status line. Everything
// else (pay period, records, rank, goal gap) is one tap away. The open/closed
// choice persists so it stays however the user likes it.
(function initHeroDetails() {
  const btn  = document.getElementById("heroDetailsToggle");
  const wrap = document.getElementById("heroDetails");
  if (!btn || !wrap) return;

  const LS_KEY = "fr_hero_details_open";
  const label  = btn.querySelector(".heroDetailsToggleLabel");

  const apply = (open) => {
    wrap.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("heroDetailsToggle--open", open);
    if (label) label.textContent = open ? "Less" : "More stats";
  };

  let open = false;
  try { open = localStorage.getItem(LS_KEY) === "1"; } catch {}
  apply(open);

  btn.addEventListener("click", () => {
    open = !open;
    apply(open);
    try { localStorage.setItem(LS_KEY, open ? "1" : "0"); } catch {}
  });

  // Don't offer a toggle that opens an empty panel (e.g. a brand-new user with
  // no records or pay period yet). The render code shows/hides these children
  // by setting inline display, so watch for that and mirror it on the button.
  const syncToggleVisibility = () => {
    const hasContent = Array.from(wrap.children).some(
      (c) => c.style.display !== "none" && (c.textContent || "").trim() !== ""
    );
    btn.style.display = hasContent ? "" : "none";
    if (!hasContent && open) apply(false);
  };
  syncToggleVisibility();
  try {
    new MutationObserver(syncToggleVisibility).observe(wrap, {
      subtree: true, childList: true,
      attributes: true, attributeFilter: ["style"],
    });
  } catch {}
})();

// ── Global tactile feedback ───────────────────────────────────────────────
// One delegated listener gives every interactive control a light tap on press.
// Fires on pointerdown so the buzz lands the instant a finger touches down —
// the same trick native iOS controls use to feel responsive. Elements with
// their own stronger haptic (save = success, timer = medium) layer on top.
if (!window.__FR_HAPTIC_DELEGATED__) {
  window.__FR_HAPTIC_DELEGATED__ = true;
  const TAP_SELECTOR = [
    "button", "[role=\"button\"]",
    ".fr26HourBtn", ".recentTypeChip", ".tabItem",
    ".comebackChipBtn", ".fr26TimerBtn", ".fr26ScanJob", ".fr26ScanJobAlt",
    ".asConfirm", ".asCancel", ".chip", ".pill",
  ].join(",");
  document.addEventListener("pointerdown", (e) => {
    // Only the primary button (left-click / finger tap). Skip right/middle-click.
    if (e.button && e.button !== 0) return;
    const t = e.target?.closest?.(TAP_SELECTOR);
    if (!t || t.disabled || t.getAttribute("aria-disabled") === "true") return;
    window.haptic?.("light");
  }, { passive: true, capture: true });
}

// Legacy deep-link: old app navigated to more.html which now redirects here with ?goto=more
// Runs at script-load time (defer — DOM already parsed) so no try/catch can swallow it.
if (new URLSearchParams(location.search).get("goto") === "more") {
  history.replaceState({}, "", location.pathname);
  showSpaPage("more");
}

// Wire shortPayAlertLink → switch to more page
document.getElementById("shortPayAlertLink")?.addEventListener("click", () => showSpaPage("more"));
// Wire cloudNudge sign-in button → switch to more page
document.getElementById("cloudNudgeSignInBtn")?.addEventListener("click", () => showSpaPage("more"));

// Sync settingsEmpId with main empId on focus/blur
(function wireSettingsEmpId() {
  const settingsEl = document.getElementById("settingsEmpId");
  if (!settingsEl) return;
  // Populate from localStorage on first render
  const saved = (localStorage.getItem("fr_emp_id") || "").trim();
  if (saved) settingsEl.value = saved;
  // Save back to localStorage and sync main input on change
  const syncUp = () => {
    const digits = (settingsEl.value || "").trim().replace(/\D/g, "");
    if (digits.length >= 5) {
      localStorage.setItem("fr_emp_id", digits);
      const mainEl = document.getElementById("empId");
      if (mainEl) mainEl.value = digits;
    }
  };
  settingsEl.addEventListener("blur", syncUp);
  settingsEl.addEventListener("change", syncUp);
  settingsEl.addEventListener("input", () => {
    const digits = (settingsEl.value || "").trim().replace(/\D/g, "");
    if (digits.length === 5) syncUp();
  });
})();

/* -------------------- Boot -------------------- */
applySettings();

async function runOnce() {
  if (window.__FR_BOOTED__) return;
  window.__FR_BOOTED__ = true;

  // Init tabs FIRST — synchronously, before any await that could hang on network.
  // bootAuth() awaits a Supabase network call and can hang indefinitely on slow
  // connections (especially iOS). Tabs must work even if auth never resolves.
  initMoreTabs?.();

  wirePhotoPickers?.();
  setSelectedPhotoFile?.(null);
  setPhotoUploadTarget?.("");
  initEmpIdBoot?.();
  wireEmpIdReload?.();
  wireAuthUI();
  if (window.__APP_BOOTED__) {
    console.warn("App already booted.");
  } else {
    window.__APP_BOOTED__ = true;
    await bootAuth().catch(logErr("bootAuth"));
  }

  // Dismiss splash — auth is done, app is ready to show
  const _splash = document.getElementById("appSplash");
  if (_splash) {
    _splash.classList.add("hide");
    setTimeout(() => { _splash.style.display = "none"; }, 380);
  }

  await ensureDefaultTypes().catch(logErr("ensureDefaultTypes"));

  // ================= MAIN PAGE INIT =================
  // Runs unconditionally in SPA — both sections are in the DOM at all times.
  if (typeof handleSave === "function") {

    await renderTypeDatalist().catch(logErr("renderTypeDatalist"));
    await renderTypesListInMore().catch(logErr("renderTypesListInMore"));

    document.getElementById("filterSelect")?.addEventListener("change", () => refreshUI(CURRENT_ENTRIES));

    const sIn = document.getElementById("searchInput");
    const sClr = document.getElementById("clearSearchBtn");
    if (sIn) {
      let _searchT = null;
      sIn.addEventListener("input", () => {
        if (sClr) sClr.hidden = !sIn.value.trim();
        clearTimeout(_searchT);
        _searchT = setTimeout(() => refreshUI(CURRENT_ENTRIES), 150);
      });
    }
    if (sClr) {
      sClr.addEventListener("click", () => {
        if (sIn) sIn.value = "";
        sClr.hidden = true;
        refreshUI(CURRENT_ENTRIES);
        sIn?.focus();
      });
    }

    document.getElementById("exportSelectedBtn")?.addEventListener("click", () => exportSelected?.());

    const resetNavOffset = () => { window.__NAV_OFFSET__ = 0; };
    document.getElementById("rangeDayBtn")?.addEventListener("click", () => { resetNavOffset(); setRangeMode("day"); });
    document.getElementById("rangeWeekBtn")?.addEventListener("click", () => { resetNavOffset(); setRangeMode("week"); });
    document.getElementById("rangeMonthBtn")?.addEventListener("click", () => { resetNavOffset(); setRangeMode("month"); });
    document.getElementById("rangeAllBtn")?.addEventListener("click", () => { resetNavOffset(); setRangeMode("all"); });

    document.getElementById("rangeNavPrev")?.addEventListener("click", () => {
      const mode = window.__RANGE_MODE__ || "day";
      const step = mode === "week" ? -7 : -1;
      window.__NAV_OFFSET__ = (Number(window.__NAV_OFFSET__ || 0)) + step;
      refreshUI(CURRENT_ENTRIES);
    });
    document.getElementById("rangeNavNext")?.addEventListener("click", () => {
      const mode = window.__RANGE_MODE__ || "day";
      const step = mode === "week" ? 7 : 1;
      const next = (Number(window.__NAV_OFFSET__ || 0)) + step;
      window.__NAV_OFFSET__ = Math.min(next, 0);
      refreshUI(CURRENT_ENTRIES);
    });

    const syncWeekBtns = () => {
      document.getElementById("weekThisBtn")?.classList.toggle("active", summaryRange === "thisWeek");
      document.getElementById("weekLastBtn")?.classList.toggle("active", summaryRange === "lastWeek");
    };

    document.getElementById("weekThisBtn")?.addEventListener("click", () => {
      setSummaryRange("thisWeek");
      syncWeekBtns();
    });

    document.getElementById("weekLastBtn")?.addEventListener("click", () => {
      setSummaryRange("lastWeek");
      syncWeekBtns();
    });

    syncWeekBtns();
    setRangeMode(window.__RANGE_MODE__ || "day", { skipRefresh: true });

    document.getElementById("refTypeRO")?.addEventListener("click", () => setRefType("RO"));
    document.getElementById("refTypeSTK")?.addEventListener("click", () => setRefType("STOCK"));
    setRefType(document.getElementById("refTypeSTK")?.classList.contains("active") ? "STOCK" : "RO");

    const hoursInput = $("hours");
    const rateInput  = document.querySelector('input[name="rate"]');

    if (hoursInput) {
      hoursInput.addEventListener("input", () => {
        hoursInput.dataset.touched = "1";
        if (num(hoursInput.value) > 0) restoreLastWorkType?.();
        // Keep chip selected state in sync with whatever is typed
        const raw = hoursInput.value.trim();
        document.querySelectorAll("[data-hours-quick]").forEach(b =>
          b.classList.toggle("selected", b.getAttribute("data-hours-quick") === raw));
      });
      hoursInput.addEventListener("blur", () => {
        const v = round1(num(hoursInput.value));
        if (Number.isFinite(v) && v > 0) { hoursInput.value = String(v); restoreLastWorkType?.(); }
        else if (hoursInput.value) hoursInput.value = "";
      });
    }
    if (rateInput) rateInput.addEventListener("input", () => rateInput.dataset.touched = "1");

    syncKeepLastWorkInput?.();

    document.getElementById("closePhotoBtn")?.addEventListener("click", closePhotoModal);
    document.getElementById("photoModal")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "photoModal") closePhotoModal();
    });

    const logForm = document.getElementById("logForm");
    if (logForm && typeof handleSave === "function") {
      if (!logForm.dataset.saveWired) {
        logForm.dataset.saveWired = "1";

        // Block Enter key from submitting the form on any input/select/textarea.
        // Only the Save button (type="submit") should trigger save.
        logForm.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const t = e.target;
            if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") {
              e.preventDefault();
              // Move focus to next focusable field rather than submitting
              const fields = [...logForm.querySelectorAll("input:not([hidden]):not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")];
              const idx = fields.indexOf(t);
              if (idx >= 0 && idx < fields.length - 1) fields[idx + 1].focus();
              else t.blur();
            }
          }
        });

        logForm.addEventListener("submit", (e) => {
          e.preventDefault();
          if (window.__saving) return;
          window.__saving = true;
          Promise.resolve(handleSave(e))
            .catch(logErr("handleSave"))
            .finally(() => (window.__saving = false));
        });
      }
    }

    document.getElementById("clearBtn")?.addEventListener("click", handleClear);
    document.getElementById("cancelEditBtn")?.addEventListener("click", handleClear);

    function updateSaveEnabled() {
      const empOk  = !!getEmpId();
      const typeOk = !!(document.getElementById("typeText")?.value || "").trim();
      const hrsOk  = num(document.getElementById("hours")?.value) > 0;
      const btn = document.getElementById("saveBtn");
      if (btn) btn.disabled = !(empOk && typeOk && hrsOk);
    }
    window.updateSaveEnabled = updateSaveEnabled;

    const detailsBtn = document.getElementById("toggleDetailsBtn");
    const detailsPanel = document.getElementById("detailsPanel");
    if (detailsBtn && detailsPanel) {
      detailsPanel.style.display = "none";
      detailsBtn.textContent = "Add Details";
      detailsBtn.addEventListener("click", () => {
        const isOpen = detailsPanel.style.display !== "none";
        detailsPanel.style.display = isOpen ? "none" : "block";
        detailsBtn.textContent = isOpen ? "Add Details" : "Less";

        const saveBtn = document.getElementById("saveBtn");
        const primaryAction = document.querySelector(".fr26PrimaryAction");
        const detailsGroup = detailsPanel.querySelector(".fr26Group");
        if (saveBtn && primaryAction && detailsGroup) {
          if (!isOpen) {
            detailsGroup.appendChild(saveBtn);
          } else {
            primaryAction.appendChild(saveBtn);
          }
        }
      });
    }

    window.addEventListener("online", () => { flushPendingSync?.().catch(() => {}); syncOfflineDot?.(); });
    window.addEventListener("offline", () => syncOfflineDot?.());
    syncOfflineDot?.();
    updatePendingBadge?.();
    maybeShowOnboarding?.();
    maybeStartTour?.();
    initPullToRefresh?.();
    refreshRateBanner?.();
    refreshGreeting?.();
    // Re-arm notification schedules on every boot (reminders live in more-page.js
    // but must fire even when user opens index.html directly)
    setTimeout(() => {
      window.scheduleShiftReminder?.();
      window.schedulePaydayReminder?.();
    }, 1500);

    ["empId", "ref", "typeText", "hours"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("input", updateSaveEnabled);
      el?.addEventListener("change", updateSaveEnabled);
    });

    // Collapse empId bar when already set; expand on focus
    function syncEmpIdBarState() {
      const bar = document.querySelector(".fr26EmployeeBar");
      if (!bar) return;
      const empId = getEmpId?.();
      bar.classList.toggle("empSet", !!(empId && String(empId).trim().length > 0));
    }
    syncEmpIdBarState();
    document.getElementById("empId")?.addEventListener("blur", syncEmpIdBarState);
    document.getElementById("empId")?.addEventListener("change", syncEmpIdBarState);

    // ── Type-hours chip: shows stored hours for the current job type ──────
    async function updateTypeHoursChip(name) {
      const chip = document.getElementById("typeHoursChip");
      if (!chip) return;
      if (!name?.trim()) { chip.style.display = "none"; return; }
      const t = await findTypeByName?.(cleanEmpId?.(getEmpId?.()), name);
      if (t && Number.isFinite(Number(t.lastHours)) && Number(t.lastHours) > 0) {
        chip.textContent = String(t.lastHours);
        chip.title = `${name} — your stored time`;
        chip.style.display = "";
      } else {
        chip.style.display = "none";
      }
    }
    document.getElementById("typeHoursChip")?.addEventListener("click", (e) => {
      e.preventDefault();
      const chip = document.getElementById("typeHoursChip");
      if (chip) setQuickHoursValue?.(chip.textContent?.trim());
      updateEarningsPreview?.();
    });

    // Auto-fill hours + rate from stored type defaults when a type is selected
    document.getElementById("typeText")?.addEventListener("change", async () => {
      const name = document.getElementById("typeText")?.value || "";
      await maybeAutofillFromType?.(name);
      await updateTypeHoursChip(name);
      // Re-render smart chips tuned to this job type
      renderSmartHourChips?.([], name);
      updateEarningsPreview?.();
      checkDuplicates?.();
      updateSaveEnabled();
    });
    // Type name is saved only on form submit (via upsertTypeDefaults), not on blur,
    // so partial/in-progress text doesn't pollute the job type library.

    const syncClearTypeBtn = () => {
      const typeEl = document.getElementById("typeText");
      const clearBtn = document.getElementById("clearTypeBtn");
      if (!clearBtn) return;
      clearBtn.hidden = !String(typeEl?.value || "").trim();
    };
    const clearTypeInput = () => {
      const typeEl = document.getElementById("typeText");
      if (!typeEl) return;
      typeEl.value = "";
      typeEl.dispatchEvent(new Event("input", { bubbles: true }));
      typeEl.dispatchEvent(new Event("change", { bubbles: true }));
      syncClearTypeBtn();
      typeEl.focus();
    };
    document.getElementById("clearTypeBtn")?.addEventListener("click", clearTypeInput);
    document.getElementById("typeText")?.addEventListener("input", syncClearTypeBtn);
    document.getElementById("typeText")?.addEventListener("change", syncClearTypeBtn);

    // Strip is rendered once after load; focus/blur toggle visibility + filter out dupes
    const typeStrip = document.getElementById("typeSuggestStrip");
    function filterTypeChips() {
      if (!typeStrip) return;
      const q = (document.getElementById("typeText")?.value || "").toLowerCase().trim();
      let anyVisible = false;
      typeStrip.querySelectorAll(".typeSuggestChip").forEach(c => {
        const name = (c.dataset.name || "");
        // Hide if exact match (already selected) OR if typed 2+ chars and chip doesn't contain query
        const isExact = name === q;
        const noMatch = q.length >= 2 && !name.includes(q);
        c.hidden = isExact || noMatch;
        if (!c.hidden) anyVisible = true;
      });
      // Show/hide the hint element if all chips hidden
      const hint = typeStrip.querySelector(".typeSuggestHint");
      if (hint) hint.hidden = anyVisible;
    }
    document.getElementById("typeText")?.addEventListener("focus", () => {
      if (typeStrip) { typeStrip.hidden = false; filterTypeChips(); }
    });
    document.getElementById("typeText")?.addEventListener("blur", () => {
      if (typeStrip) typeStrip.hidden = true;
    });
    let _filterT = null;
    let _chipT = null;
    document.getElementById("typeText")?.addEventListener("input", () => {
      clearTimeout(_filterT);
      _filterT = setTimeout(filterTypeChips, 100);
      // Re-render smart chips for the current type (debounced 300ms)
      clearTimeout(_chipT);
      _chipT = setTimeout(() => {
        const name = document.getElementById("typeText")?.value || "";
        renderSmartHourChips?.([], name);
      }, 300);
    });

    syncClearTypeBtn();
    updateSaveEnabled();

    const keepLastWorkEl = document.getElementById("keepLastWork");
    keepLastWorkEl?.addEventListener("change", () => {
      setKeepLastWork?.(!!keepLastWorkEl.checked);
      if (keepLastWorkEl.checked) restoreLastWorkType?.({ force: false });
      updateSaveEnabled();
    });

    // Smart hour chips are rendered dynamically by renderSmartHourChips() in main-page.js
    // with inline click handlers — no static wiring needed here.
    // Render fallback chips immediately so the row isn't blank before entries load.
    renderSmartHourChips?.([]);
    // Initialize hero to empty state so "Log a job to see your earnings here" shows
    // even before entries load (refreshUI skips when there are no entries).
    updateHeroSection?.(0, 0, 0, 0, 0, 0, []);

    // ── Custom hour chips ──────────────────────────────────────────────────
    const LS_CUSTOM_CHIPS = "fr_custom_hour_chips";
    function getCustomChips() {
      try { return JSON.parse(localStorage.getItem(LS_CUSTOM_CHIPS) || "[]"); } catch { return []; }
    }
    function saveCustomChips(arr) {
      try { localStorage.setItem(LS_CUSTOM_CHIPS, JSON.stringify(arr)); } catch {}
    }
    function renderCustomChips() {
      const container = document.getElementById("customHourChips");
      if (!container) return;
      container.innerHTML = "";
      getCustomChips().forEach((val) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fr26HourBtn fr26HourBtnCustom";
        btn.dataset.hoursQuick = String(val);
        btn.textContent = String(val);
        // tap = set value; long-press = delete
        let pressTimer = null;
        const startPress = () => { pressTimer = setTimeout(() => removeChip(val), 600); };
        const endPress = () => clearTimeout(pressTimer);
        btn.addEventListener("pointerdown", startPress);
        btn.addEventListener("pointerup", endPress);
        btn.addEventListener("pointercancel", endPress);
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          setQuickHoursValue?.(String(val));
          restoreLastWorkType?.();
          updateEarningsPreview?.();
        });
        container.appendChild(btn);
      });
    }
    function removeChip(val) {
      const updated = getCustomChips().filter(v => v !== val);
      saveCustomChips(updated);
      renderCustomChips();
      if (navigator.vibrate) navigator.vibrate(30);
    }
    document.getElementById("addCustomHourChip")?.addEventListener("click", (e) => {
      e.preventDefault();
      const raw = prompt("Add custom hour chip (e.g. 1.9, 0.3):");
      if (raw === null) return; // cancelled
      const num = Math.round(parseFloat(raw) * 10) / 10;
      if (!Number.isFinite(num) || num <= 0) { alert("Enter a positive number like 1.9"); return; }
      const chips = getCustomChips();
      if (!chips.includes(num)) { chips.push(num); chips.sort((a, b) => a - b); saveCustomChips(chips); }
      renderCustomChips();
    });
    renderCustomChips();

    const _hoursEl = document.getElementById("hours");
    const _rateEl = document.querySelector('input[name="rate"]');
    _hoursEl?.addEventListener("input", () => updateEarningsPreview?.());
    _rateEl?.addEventListener("input", () => updateEarningsPreview?.());

    document.getElementById("repeatLastBtn")?.addEventListener("click", () => repeatLastEntry?.());
    document.getElementById("deleteSelectedBtn")?.addEventListener("click", () => deleteSelectedEntries?.());
    document.getElementById("bulkApplyBtn")?.addEventListener("click", () => bulkEditRate?.());
    document.getElementById("bulkCancelBtn")?.addEventListener("click", () => {
      if (Array.isArray(window.CURRENT_ENTRIES)) {
        window.CURRENT_ENTRIES.forEach(e => { e.selected = false; });
        CURRENT_ENTRIES = window.CURRENT_ENTRIES;
      }
      refreshUI?.(CURRENT_ENTRIES);
    });
    ["ref", "typeText", "hours"].forEach(id =>
      document.getElementById(id)?.addEventListener("input", () => checkDuplicates?.())
    );

    const _offlineBanner = document.getElementById("offlineBanner");
    if (_offlineBanner) {
      const _syncOffline = () => { _offlineBanner.style.display = navigator.onLine ? "none" : ""; };
      window.addEventListener("online", _syncOffline);
      window.addEventListener("offline", _syncOffline);
      _syncOffline();
    }

    ["typeText", "hours", "ref"].forEach((id) => {
      document.getElementById(id)?.addEventListener("keydown", (e) => {
        if (id === "typeText" && e.key === "Escape") {
          e.preventDefault();
          clearTypeInput();
          return;
        }
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (id === "hours") {
          document.getElementById("typeText")?.focus();
          return;
        }
        const btn = document.getElementById("saveBtn");
        if (btn && !btn.disabled) btn.click();
      });
    });

    document.getElementById("shareTodayBtn")?.addEventListener("click", () => shareDaySummary?.());
    document.getElementById("shareWeekPDFBtn")?.addEventListener("click", () => shareWeekPDF?.());
    document.getElementById("shareWeekCardBtn")?.addEventListener("click", () => shareWeekCard?.());
    document.getElementById("shareReferralBtn")?.addEventListener("click", () => shareReferral?.());
    document.getElementById("notifSetupBtn")?.addEventListener("click", () => requestPushPermission?.());

    document.getElementById("historyBtn")?.addEventListener("click", () => {
      const panel = document.getElementById("historyPanel");
      const isOpen = panel?.classList.contains("open");
      if (isOpen) { showHistory(false); }
      else { showHistory(true); renderHistory(); }
    });
    // exportCsvMainBtn removed from main page; Export CSV available on More page
    document.getElementById("closeHistoryBtn")?.addEventListener("click", () => showHistory(false));
    document.getElementById("historyPanel")?.addEventListener("click", (e) => {
      if (e.target?.id === "historyPanel") showHistory(false);
    });
    document.querySelectorAll("[data-hist-range]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-hist-range]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderHistory();
      });
    });
    document.getElementById("historySearchInput")?.addEventListener("input", () => {
      clearTimeout(window.__HIST_SEARCH_T__);
      window.__HIST_SEARCH_T__ = setTimeout(renderHistory, 180);
    });

    updateShortPayBadge?.();
    initClockIn?.();
    initRepeatChip?.();
    initComboChip?.();

    // Draft auto-save
    ["hours", "typeText", "ref", "vin8"].forEach(id =>
      document.getElementById(id)?.addEventListener("input", () => debouncedSaveDraft?.())
    );
    document.querySelector('input[name="rate"]')?.addEventListener("input", () => debouncedSaveDraft?.());
    document.querySelector('textarea[name="notes"]')?.addEventListener("input", () => debouncedSaveDraft?.());
    document.getElementById("notesInline")?.addEventListener("input", () => debouncedSaveDraft?.());
    document.getElementById("isComeback")?.addEventListener("change", () => debouncedSaveDraft?.());
    restoreDraft?.();
    // Seed date picker to today on load (type="date" has no way to set a dynamic default in HTML)
    const _datePickerEl = document.getElementById("entryDate");
    if (_datePickerEl && !_datePickerEl.value) _datePickerEl.value = todayKeyLocal?.() || new Date().toISOString().slice(0, 10);
  }

  // ================= MORE PAGE INIT =================
  // Runs unconditionally in SPA — more section is always in the DOM.
  try {
    const hasReviewUi = !!document.getElementById("reviewList");
    const hasGalleryUi = !!document.getElementById("photoGallery");

    const wrapMoreClick = (id, handler) => {
      const el = document.getElementById(id);
      if (!el || typeof handler !== "function") return;
      el.addEventListener("click", async (ev) => {
        try {
          const r = handler.call(el, ev);
          if (r?.then) await r;
        } catch {}
      });
    };

    wrapMoreClick("exportCsvBtn", exportCSV);
    wrapMoreClick("exportJsonBtn", exportJSON);
    wrapMoreClick("exportAuditBtn", exportAuditReport);
    wrapMoreClick("exportDisputeWeekBtn", exportDisputeThisWeek);
    wrapMoreClick("saveFlaggedBtn", saveFlaggedHours);
    wrapMoreClick("savePayStubBtn", savePayStubEntry);
    if (hasReviewUi) {
      document.getElementById("reviewRefreshBtn")?.addEventListener("click", renderReview);
      document.getElementById("reviewRange")?.addEventListener("change", renderReview);
      document.getElementById("reviewFocus")?.addEventListener("change", renderReview);
      document.getElementById("reviewGroup")?.addEventListener("change", renderReview);
      document.getElementById("reviewSearch")?.addEventListener("input", () => {
        clearTimeout(window.__REVIEW_T__);
        window.__REVIEW_T__ = setTimeout(renderReview, 150);
      });
    }

    document.getElementById("retakeTourBtn")?.addEventListener("click", () => {
      localStorage.removeItem("fr_tour_done");
      sessionStorage.setItem("fr_force_tour", "1");
      showSpaPage("main");
      setTimeout(() => maybeStartTour?.(), 100);
    });

    document.getElementById("shareAppBtn")?.addEventListener("click", async () => {
      const url = "https://app.nellylabs.dev/landing.html";
      const text = "Check out Flatrate Buddy — free app for tracking flat-rate jobs and catching short pay.";
      if (navigator.share) {
        try { await navigator.share({ title: "Flatrate Buddy", text, url }); return; } catch {}
      }
      try { await navigator.clipboard.writeText(url); toast?.("Link copied!"); } catch {
        toast?.("Share: " + url);
      }
    });

    document.getElementById("repairBtn")?.addEventListener("click", async () => {
      const empId = getEmpId();
      if (!empId) return alert("Enter Employee # first.");
      setStatusMsg("Repairing… keep this page open.");
      try {
        const fixed = await backfillDayKeysForEmp(empId);
        alert(`Repair complete. Fixed ${fixed} entries.`);
      } catch (e) {
        alert("Repair failed: " + (e?.message || e));
      } finally {
        setStatusMsg("");
      }
    });

    const stepPayStubWeek = (days) => {
      const el = document.getElementById("payStubWeekEnding");
      if (!el) return;
      const d = parseDateInputValue?.(el.value) || new Date();
      d.setDate(d.getDate() + days);
      el.value = dateKey(d);
      el.dispatchEvent(new Event("change"));
    };
    document.getElementById("payStubPrevWeekBtn")?.addEventListener("click", () => stepPayStubWeek(-7));
    document.getElementById("payStubNextWeekBtn")?.addEventListener("click", () => stepPayStubWeek(7));
    const savedTypeRate = document.getElementById("savedTypeRate");
    if (savedTypeRate) {
      const dr = Number(getDefaultRate?.()) || 0;
      savedTypeRate.value = dr > 0 ? String(dr) : "";
    }
    const savedTypeCreateForm = document.getElementById("savedTypeCreateForm");
    if (savedTypeCreateForm && !savedTypeCreateForm.dataset.wired) {
      savedTypeCreateForm.dataset.wired = "1";
      savedTypeCreateForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await saveTypeFromMoreForm?.();
      });
    }

    initBulkDelete?.();
    initJobTypeBulkDelete?.();
    initEntrySearch?.();
    initOweMe?.();
    initSettingsUI?.();
    initFeedbackUI?.();
    window.__FR?.initTypeCleanup?.();
    startMoreTour?.();
    scheduleShiftReminder?.();
    schedulePaydayReminder?.();

    // Upgrade modal: close + checkout buttons
    document.getElementById("upgradeCloseBtn")?.addEventListener("click",   () => hideUpgradeModal?.());
    document.getElementById("upgradeDismissBtn")?.addEventListener("click", () => hideUpgradeModal?.());
    document.getElementById("upgradeModal")?.addEventListener("click", (e) => {
      if (e.target?.id === "upgradeModal") hideUpgradeModal?.();
    });
    document.getElementById("upgradeMonthlyBtn")?.addEventListener("click", () => startCheckout?.("monthly"));
    document.getElementById("upgradeYearlyBtn")?.addEventListener("click",  () => startCheckout?.("yearly"));
    // Returning from Stripe Checkout
    window.__FR?.handleCheckoutReturn?.();
    // PWA shortcut deep-links: ?tab=history or ?tab=settings
    const _tabParam = new URLSearchParams(location.search).get("tab");
    if (_tabParam === "history" || _tabParam === "settings") {
      history.replaceState({}, "", location.pathname);
      showSpaPage("more");
      setTimeout(() => {
        document.querySelector(`.moreTab[data-tab="${_tabParam}"]`)?.click();
      }, 400);
    }
    // Payday notification deep-link: ?paystub=1 → show week summary, then open pay stub
    if (new URLSearchParams(location.search).get("paystub") === "1") {
      history.replaceState({}, "", location.pathname);
      showSpaPage("more");
      setTimeout(async () => {
        // Show payday week summary modal first
        await window.__FR?.showPaydaySummary?.();
        // Also open pay stub section underneath
        document.querySelector('.moreTab[data-tab="settings"]')?.click();
        setTimeout(() => {
          const det = document.getElementById("payStubDetails");
          if (det) { det.open = true; }
        }, 400);
      }, 800);
    }
    initPayStubUI();
    if (hasGalleryUi) {
      initPhotosUI();
    }
    // Requests-to-manager section. Wiring only — it fetches on first expand.
    window.__FR?.initRequestsUI?.();
    // Data for the more page loads on first tab visit (see showSpaPage below),
    // NOT here at boot — avoids "Supabase not ready" errors at startup.
  } catch (e) { logErr("moreInit")(e); }
}

// PWA install prompt
let _deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  const banner = document.getElementById("installBanner");
  if (banner) {
    banner.style.display = "";
    // Hide cloud nudge when install banner is showing — don't stack two banners
    const nudge = document.querySelector(".cloudNudge");
    if (nudge) nudge.style.display = "none";
  }
});

document.addEventListener("click", async (e) => {
  if (!e.target?.closest?.("#installBtn")) return;
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  if (outcome === "accepted") {
    const banner = document.getElementById("installBanner");
    if (banner) banner.style.display = "none";
  }
  _deferredInstallPrompt = null;
});

document.getElementById("installDismissBtn")?.addEventListener("click", () => {
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "none";
});

window.__FR.canInstall   = () => !!_deferredInstallPrompt;
window.__FR.triggerInstall = () => document.getElementById("installBtn")?.click();

/* ── iOS "Add to Home Screen" nudge (no beforeinstallprompt on iOS Safari) ── */
(function iosInstallBanner() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  if (!isIOS || isStandalone) return;
  if (localStorage.getItem("fr26_ios_install_dismissed")) return;
  const banner = document.getElementById("installBanner");
  if (!banner) return;
  banner.innerHTML =
    '<span>📲 Add to Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong></span>' +
    '<div class="u-row" style="gap:8px;"><button class="btn primary" id="iosInstallGotItBtn" type="button">Got it</button></div>';
  banner.style.display = "";
  document.getElementById("iosInstallGotItBtn")?.addEventListener("click", () => {
    localStorage.setItem("fr26_ios_install_dismissed", "1");
    banner.style.display = "none";
  });
})();

/* ── What's New changelog ───────────────────────── */
const APP_VERSION = "1.8";
const LS_SEEN_VER = "fr_seen_version";

const CHANGELOG = {
  "1.8": [
    "💵 Your pay rate is yours — the app no longer assumes $15/hr",
    "🗓 Set your shop's pay week and payroll cutoff so app totals match your check",
    "🏆 New win tracker — see how much you've clawed back from resolved requests",
    "📊 New efficiency % on Stats — hours turned vs. hours available, with trend",
    "👋 Add your name in Settings and the app greets you instead of itself",
    "New techs get a clear prompt to set their real rate before logging work",
    "Blank rate stays blank instead of quietly saving someone else's number",
    "Terms and Privacy links now actually open in the iOS app",
    "Stats now loads your full history — 'This Year' really means this year",
    "Tap any job type in Stats to see the exact jobs behind the number",
    "Stats totals count up, the chart sweeps in, and each type shows its share",
  ],
  "1.7": [
    "📸 OCR scans are faster and more reliable — fixed a bug causing scan failures",
    "Scan a whole RO and combine multiple jobs into one entry, hours added together",
    "Password reset now actually works everywhere in the app",
    "Team dashboard: promote, demote, or remove techs right from the roster",
    "Invite techs with one tap — shares the app link + join code together",
    "Photos open instantly on repeat views instead of reloading every time",
    "Fixed the app sliding side to side and delayed vibration feedback",
    "Buttons throughout the app are bigger and more precise — fewer mis-taps",
  ],
  "1.6": [
    "🏆 New Job Scorecard — see which job types actually pay best per hour",
    "Spots your top earner and flags jobs with high comeback rates",
    "Fixed: forgetting to clock out no longer wrecks your efficiency number",
    "Photos load more reliably in the iOS app",
    "Big numbers now show commas — $1,234.00",
  ],
  "1.5": [
    "The whole app feels snappier — tactile haptics on every tap 📳",
    "Your pay total glows when it climbs 💫",
    "Springier buttons, chips, and tabs — everything reacts to your touch",
    "Bigger celebration when you rank up: buzz + confetti 🎉",
    "Cleaner Buddy app icon — no more box-in-a-box",
    "Respects iOS Reduce Motion for a calmer view when you want it",
  ],
  "1.4": [
    "Meet Buddy! New app icon — your official flat-rate mascot 👻",
    "Fresh blue look throughout the whole app 💙",
    "Photos now load correctly in the iOS app (no more failed loads)",
    "App runs smoother on iPhone and Android — less lag scrolling jobs",
    "Native iOS splash screen with Buddy on launch",
    "Notification color updated to match the new brand",
  ],
  "1.3-beta": [
    "Beta mode — all features free while we build with you 🧪",
    "New Stats tab — job type breakdown with donut chart 📊",
    "13 period filters: today, pay period, custom date range, and more",
    "Smart job-type merging: PDI, Pre-Owned, Re-Clean, Sold auto-grouped",
    "Stats normalization now flows into payday summary and insights",
    "Tour updated to walk through the new Stats tab",
  ],
};

function showWhatsNew(version) {
  const modal  = document.getElementById("whatsNewModal");
  const list   = document.getElementById("whatsNewList");
  const verLbl = document.getElementById("whatsNewVersionLabel");
  if (!modal || !list) return;
  const items = CHANGELOG[version] || [];
  if (!items.length) return;
  list.innerHTML = items.map(t => `<li>${t}</li>`).join("");
  if (verLbl) verLbl.textContent = version.includes("beta") ? "v1.3 Beta 🧪" : "v" + version;
  modal.style.display = "flex";
}

function closeWhatsNew() {
  const modal = document.getElementById("whatsNewModal");
  if (modal) modal.style.display = "none";
  localStorage.setItem(LS_SEEN_VER, APP_VERSION);
}

document.getElementById("whatsNewCloseBtn")?.addEventListener("click", closeWhatsNew);
document.getElementById("whatsNewDoneBtn")?.addEventListener("click", closeWhatsNew);
document.getElementById("whatsNewModal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeWhatsNew();
});
document.getElementById("whatsNewBtn")?.addEventListener("click", () => showWhatsNew(APP_VERSION));

// Show automatically once per version (after a short delay so the app settles)
const _seenVer = localStorage.getItem(LS_SEEN_VER);
if (_seenVer !== APP_VERSION) {
  setTimeout(() => showWhatsNew(APP_VERSION), 1800);
}

/* ── Test notification button ───────────────────── */
document.getElementById("testNotifBtn")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    window.__FR?.toast?.("Notifications aren't supported in this browser");
    return;
  }
  const perm = await Notification.requestPermission?.().catch(() => "denied");
  if (perm === "denied") {
    window.__FR?.toast?.("Notifications blocked — enable them in browser settings");
    return;
  }
  await window.__FR?.sendNotification?.(
    "Flatrate Buddy 🔔",
    "Notifications are working! You're all set.",
    "fr-test"
  );
  window.__FR?.toast?.("Test notification sent!");
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    runOnce().catch(logErr("runOnce"));
  });
} else {
  runOnce().catch(logErr("runOnce"));
}
