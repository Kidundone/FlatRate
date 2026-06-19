// Suppress empty-object errors thrown by Supabase/Capacitor during boot
// (e.g. {} from WKWebView before network is ready) — log real errors only.
function logErr(label) {
  return (e) => {
    if (!e) return;
    const empty = typeof e === "object" && !(e instanceof Error) && !Object.keys(e).length;
    if (!empty) console.error(`[${label}]`, e);
  };
}

window.BUILD = "20260316-weekend-stable";
const BUILD_TAG = "weekend-stable";
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

window.__FR = window.__FR || {};
window.__FR.buildTag = BUILD_TAG;
window.__FR.featureFreeze = FEATURE_FREEZE;
window.__FR.activeDataPath = ACTIVE_DATA_PATH;
window.__FR.sb = sb();
window.__FR.supabase = window.supabase;

/* ─── SPA page switcher ─────────────────────────────────────────────────────
   Switches between #spa-main and #spa-more without any page reload.
   Called by tab-bar buttons (data-spa-page attribute) and from JS (showSpaPage).
────────────────────────────────────────────────────────────────────────────── */
let _moreSectionLoaded = false;

function showSpaPage(name) {
  const main = document.getElementById("spa-main");
  const more = document.getElementById("spa-more");
  if (main) main.style.display = name === "main" ? "" : "none";
  if (more) more.style.display = name === "more" ? "" : "none";
  document.body.dataset.page = name;
  window.__PAGE__ = name;
  document.querySelectorAll(".tabItem[data-spa-page]").forEach(t => {
    const active = t.dataset.spaPage === name;
    t.classList.toggle("tabItem--active", active);
    if (active) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);

  // Load more-page data on first visit (deferred from boot to avoid
  // "Supabase not ready" errors). Refresh on every subsequent visit.
  if (name === "more") {
    if (!_moreSectionLoaded) {
      _moreSectionLoaded = true;
      safeLoadEntries?.({ fullHistory: true })
        .then(() => refreshMorePagePanels?.())
        .catch(logErr("moreData"));
    } else {
      // Lightweight refresh: re-render panels with already-loaded entries
      refreshMorePagePanels?.().catch(logErr("moreRefresh"));
    }
  }
}
window.__FR.showSpaPage = showSpaPage;

// Wire tab bar buttons
document.querySelectorAll(".tabItem[data-spa-page]").forEach(btn => {
  btn.addEventListener("click", () => showSpaPage(btn.dataset.spaPage));
});

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

  await ensureDefaultTypes();

  // ================= MAIN PAGE INIT =================
  // Runs unconditionally in SPA — both sections are in the DOM at all times.
  if (typeof handleSave === "function") {

    await renderTypeDatalist();
    await renderTypesListInMore();

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

    // Auto-fill hours + rate from stored type defaults when a type is selected
    document.getElementById("typeText")?.addEventListener("change", async () => {
      const name = document.getElementById("typeText")?.value || "";
      await maybeAutofillFromType?.(name);
      updateEarningsPreview?.();
      checkDuplicates?.();
      updateSaveEnabled();
    });
    document.getElementById("typeText")?.addEventListener("blur", async () => {
      const name = document.getElementById("typeText")?.value || "";
      if (!String(name || "").trim()) return;
      await maybeSaveTypeNameOnly?.(name);
    });

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
    document.getElementById("typeText")?.addEventListener("input", () => {
      clearTimeout(_filterT);
      _filterT = setTimeout(filterTypeChips, 100);
    });

    syncClearTypeBtn();
    updateSaveEnabled();

    const keepLastWorkEl = document.getElementById("keepLastWork");
    keepLastWorkEl?.addEventListener("change", () => {
      setKeepLastWork?.(!!keepLastWorkEl.checked);
      if (keepLastWorkEl.checked) restoreLastWorkType?.({ force: false });
      updateSaveEnabled();
    });

    document.querySelectorAll("[data-hours-quick]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        setQuickHoursValue?.(btn.getAttribute("data-hours-quick"));
        restoreLastWorkType?.();
        updateEarningsPreview?.();
      });
    });

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
    document.getElementById("isComeback")?.addEventListener("change", () => debouncedSaveDraft?.());
    restoreDraft?.();
  }

  // ================= MORE PAGE INIT =================
  // Runs unconditionally in SPA — more section is always in the DOM.
  {
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
    if (savedTypeRate) savedTypeRate.value = String(getDefaultRate?.() || 15);
    const savedTypeCreateForm = document.getElementById("savedTypeCreateForm");
    if (savedTypeCreateForm && !savedTypeCreateForm.dataset.wired) {
      savedTypeCreateForm.dataset.wired = "1";
      savedTypeCreateForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        await saveTypeFromMoreForm?.();
      });
    }

    initMoreTabs?.();
    initBulkDelete?.();
    initJobTypeBulkDelete?.();
    initEntrySearch?.();
    initOweMe?.();
    initSettingsUI?.();
    initFeedbackUI?.();
    startMoreTour?.();
    scheduleShiftReminder?.();
    schedulePaydayReminder?.();

    // Upgrade modal
    document.getElementById("upgradeMonthlyBtn")?.addEventListener("click", () => startCheckout?.("monthly"));
    document.getElementById("upgradeYearlyBtn")?.addEventListener("click",  () => startCheckout?.("yearly"));
    document.getElementById("upgradeCloseBtn")?.addEventListener("click",   () => hideUpgradeModal?.());
    document.getElementById("upgradeModal")?.addEventListener("click", (e) => {
      if (e.target?.id === "upgradeModal") hideUpgradeModal?.();
    });
    // Show upgrade banner if user lands with ?upgraded=1 from Stripe success
    if (new URLSearchParams(location.search).get("upgraded") === "1") {
      await loadSubscription?.();
      toast?.("You're now on Pro — exports unlocked!");
      history.replaceState({}, "", location.pathname);
    }
    // Payday notification deep-link: ?paystub=1 → open Settings tab + expand pay stub
    if (new URLSearchParams(location.search).get("paystub") === "1") {
      history.replaceState({}, "", location.pathname);
      showSpaPage("more");
      setTimeout(() => {
        document.querySelector('.moreTab[data-tab="settings"]')?.click();
        const det = document.getElementById("payStubDetails");
        if (det) { det.open = true; det.scrollIntoView({ behavior: "smooth", block: "start" }); }
      }, 600);
    }
    initPayStubUI();
    if (hasGalleryUi) {
      initPhotosUI();
    }
    // Data for the more page loads on first tab visit (see showSpaPage below),
    // NOT here at boot — avoids "Supabase not ready" errors at startup.
  }
}

// PWA install prompt
let _deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "";
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    runOnce().catch(logErr("runOnce"));
  });
} else {
  runOnce().catch(logErr("runOnce"));
}
