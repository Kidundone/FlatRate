let EDITING_ID = null; // null = creating new
let EDITING_ENTRY = null;
let isSaving = false;

// Cached entries for context-aware chip rendering
let _smartChipEntries = [];

/* ── Form draft (survives accidental refresh) ── */
const LS_DRAFT = "fr_form_draft";
let _draftTimer = null;

function saveDraft() {
  if (EDITING_ID) return;
  const draft = {
    hours: document.getElementById("hours")?.value || "",
    typeText: document.getElementById("typeText")?.value || "",
    ref: document.getElementById("ref")?.value || "",
    vin8: document.getElementById("vin8")?.value || "",
    rate: document.querySelector('input[name="rate"]')?.value || "",
    notes: document.querySelector('#notesInline, textarea[name="notes"]')?.value || "",
    isComeback: !!(document.getElementById("isComeback")?.checked),
    refType: currentRefType,
    detailsOpen: document.getElementById("detailsPanel")?.style.display !== "none",
    savedAt: Date.now(),
  };
  if (!draft.hours && !draft.typeText) { localStorage.removeItem(LS_DRAFT); return; }
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); } catch {}
}

function debouncedSaveDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveDraft, 400);
}

function restoreDraft() {
  if (EDITING_ID) return;
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || (!draft.hours && !draft.typeText)) return;

    // Only restore transient fields (hours, type) within a 15-min window.
    // After that, the user has moved on — starting fresh is less surprising.
    const ageMs = Date.now() - (draft.savedAt || 0);
    const fresh = ageMs < 15 * 60 * 1000;
    if (!fresh) {
      localStorage.removeItem(LS_DRAFT);
      return;
    }

    const hoursEl = document.getElementById("hours");
    const typeEl  = document.getElementById("typeText");
    const refEl   = document.getElementById("ref");
    const vinEl   = document.getElementById("vin8");
    const rateEl  = document.querySelector('input[name="rate"]');
    const notesEl = document.querySelector('#notesInline, textarea[name="notes"]');
    const cbEl    = document.getElementById("isComeback");

    if (draft.hours   && hoursEl) { hoursEl.value = draft.hours; hoursEl.dataset.touched = "1"; }
    if (draft.typeText && typeEl) typeEl.value = draft.typeText;
    if (draft.rate    && rateEl)  { rateEl.value = draft.rate; rateEl.dataset.touched = "1"; }
    if (draft.notes   && notesEl) notesEl.value = draft.notes;
    if (cbEl) cbEl.checked = !!draft.isComeback;
    if (draft.refType) setRefType(draft.refType);

    const hasDetails = draft.ref || draft.vin8 || draft.detailsOpen;
    if (hasDetails) {
      if (draft.ref && refEl) refEl.value = draft.ref;
      if (draft.vin8 && vinEl) vinEl.value = draft.vin8;
      const dp  = document.getElementById("detailsPanel");
      const dbt = document.getElementById("toggleDetailsBtn");
      if (dp)  dp.style.display  = "block";
      if (dbt) dbt.textContent   = "Less";
    }

    // Seed date picker to today if not already set
    const datePickerEl2 = document.getElementById("entryDate");
    if (datePickerEl2 && !datePickerEl2.value) datePickerEl2.value = todayKeyLocal();

    updateEarningsPreview?.();
    // Trigger listeners so updateSaveEnabled re-evaluates the restored values
    ["hours", "typeText"].forEach(id =>
      document.getElementById(id)?.dispatchEvent(new Event("input", { bubbles: true }))
    );
    // silent restore — user can see their content was carried over
  } catch {}
}

function clearDraft() {
  clearTimeout(_draftTimer);
  localStorage.removeItem(LS_DRAFT);
}
const LS_KEEP_LAST_WORK = "fr_keep_last_work";
const LS_LAST_WORK_TYPE = "fr_last_work_type";

function shouldKeepLastWork() {
  return localStorage.getItem(LS_KEEP_LAST_WORK) !== "0";
}

function setKeepLastWork(enabled) {
  localStorage.setItem(LS_KEEP_LAST_WORK, enabled ? "1" : "0");
}

function syncKeepLastWorkInput() {
  const keepLastWorkEl = document.getElementById("keepLastWork");
  if (keepLastWorkEl) keepLastWorkEl.checked = shouldKeepLastWork();
}

function getLastWorkType() {
  return String(localStorage.getItem(LS_LAST_WORK_TYPE) || "").trim();
}

function rememberLastWorkType(typeName) {
  const next = String(typeName || "").trim();
  if (!next) return;
  localStorage.setItem(LS_LAST_WORK_TYPE, next);
}

function restoreLastWorkType({ force = false } = {}) {
  if (!shouldKeepLastWork() || EDITING_ID) return;
  const typeEl = document.getElementById("typeText");
  if (!typeEl) return;
  if (!force && String(typeEl.value || "").trim()) return;
  const lastType = getLastWorkType();
  if (!lastType) return;
  typeEl.value = lastType;
}

function setQuickHoursValue(value) {
  const hoursEl = document.getElementById("hours");
  if (!hoursEl) return;
  const next = String(value || "").trim();
  if (!(num(next) > 0)) return;
  hoursEl.value = next;
  hoursEl.dataset.touched = "1";
  hoursEl.dispatchEvent(new Event("input", { bubbles: true }));
  hoursEl.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelectorAll("[data-hours-quick]").forEach((btn) => {
    const isSelected = btn.getAttribute("data-hours-quick") === next;
    btn.classList.toggle("selected", isSelected);
    if (isSelected) {
      btn.classList.remove("chipPop");
      void btn.offsetWidth;
      btn.classList.add("chipPop");
      setTimeout(() => btn.classList.remove("chipPop"), 320);
    }
  });
}

function setEditingEntry(entry) {
  EDITING_ENTRY = entry || null;
  EDITING_ID = entry?.id ?? null;

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.textContent = EDITING_ID ? "Update" : "Save";

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.textContent = "Clear";

  const cancelBtn = document.getElementById("cancelEditBtn");
  if (cancelBtn) cancelBtn.style.display = EDITING_ID ? "inline-flex" : "none";
}

function startEditEntry(entry) {
  if (!entry) return;
  setEditingEntry(entry);

  const empInputEl = document.getElementById("empId");
  const refEl = document.getElementById("ref");
  const vinEl = document.getElementById("vin8");
  const typeEl = document.getElementById("typeText");
  const hoursEl = document.getElementById("hours");
  const rateEl = document.querySelector('input[name="rate"]');
  const notesEl = document.querySelector('#notesInline, textarea[name="notes"]');

  if (empInputEl && entry.empId) {
    empInputEl.value = entry.empId;
    setActiveEmp(entry.empId);
  }
  if (refEl) refEl.value = entry.ref || entry.ro || "";
  if (vinEl) vinEl.value = entry.vin8 || "";
  if (typeEl) typeEl.value = entry.typeText || entry.type || "";
  if (hoursEl) { hoursEl.value = entry.hours != null ? String(entry.hours) : ""; hoursEl.dataset.touched = "1"; }
  if (rateEl) { rateEl.value = entry.rate != null ? String(entry.rate) : String(getDefaultRate()); rateEl.dataset.touched = "1"; }
  if (notesEl) notesEl.value = entry.notes || "";
  const isComebackEl = document.getElementById("isComeback");
  if (isComebackEl) isComebackEl.checked = !!entry.isComeback;
  // Show the entry's original date in the date picker
  const editDateEl = document.getElementById("entryDate");
  if (editDateEl) {
    const dk = entry.dayKey || dayKeyFromISO(entry.createdAt || "");
    editDateEl.value = dk || todayKeyLocal();
  }
  clearPickedPhoto();
  setPhotoLabelFromEntry(entry);

  setRefType(entry.refType || "RO");

  const detailsPanel = document.getElementById("detailsPanel");
  const detailsBtn = document.getElementById("toggleDetailsBtn");
  if (detailsPanel && detailsBtn) {
    detailsPanel.style.display = "block";
    detailsBtn.textContent = "Less";
  }

  // Let updateSaveEnabled() (boot.js) decide button state based on actual field values
  if (typeof updateSaveEnabled === "function") updateSaveEnabled();
}

document.addEventListener("click", async (e) => {
  const btn = e.target?.closest?.("[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");

  if (action === "view-photo") {
    e.preventDefault();
    e.stopPropagation();
    await viewPhotoById(id);
    return;
  }

  // ...existing actions (edit/delete/etc)
}, true);

document.addEventListener("click", (ev) => {
  const btn = ev.target?.closest?.("[data-edit-id]");
  if (!btn) return;

  const id = (btn.getAttribute("data-edit-id") || "").trim();
  if (!id) return;

  const pool = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  const entry = pool.find(e => String(e.id) === id);
  if (!entry) return;

  startEditEntry(entry);
});

document.addEventListener("click", async (ev) => {
  const delBtn = ev.target?.closest?.("[data-del]");
  if (!delBtn) return;

  const id = (delBtn.getAttribute("data-del") || "").trim();
  if (!id) return;

  await onDeleteClicked(delBtn, id);
});

async function handleDeleteEntry(entry, ev) {
  ev?.preventDefault();
  ev?.stopPropagation();
  if (!entry || entry.id == null) return toast("Missing id.");

  const typeStr = String(entry.type || entry.typeText || "this entry");
  const refStr  = (entry.ref || entry.ro) ? ` · RO ${entry.ref || entry.ro}` : "";
  const ok = await showActionSheet({
    title: "Delete Job?",
    message: `${typeStr}${refStr}`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;

  await onDeleteClicked(null, entry.id, { skipConfirm: true });
}

function handleClear(ev, options = {}) {
  if (ev) ev.preventDefault();
  clearDraft();
  const preserveType = !!options.preserveType;
  const preservedType = preserveType ? String(options.typeValue || getLastWorkType()).trim() : "";
  setEditingEntry(null);
  const empInputEl = document.getElementById("empId");
  const refEl = document.getElementById("ref");
  const vinEl = document.getElementById("vin8");
  const typeEl = document.getElementById("typeText");
  const hoursEl = document.getElementById("hours");
  const rateEl = document.querySelector('input[name="rate"]');
  const notesEl = document.querySelector('#notesInline, textarea[name="notes"]');

  if (refEl) refEl.value = "";
  if (vinEl) vinEl.value = "";
  if (typeEl) typeEl.value = preservedType;
  if (hoursEl) { hoursEl.value = ""; hoursEl.dataset.touched = ""; }
  // Deselect all hour chips when form clears
  document.querySelectorAll("[data-hours-quick]").forEach(b => b.classList.remove("selected"));
  if (rateEl) { rateEl.value = String(getDefaultRate()); rateEl.dataset.touched = ""; }
  // Hide type-hours chip when form clears (it'll reappear when a type is picked)
  const typeChipEl = document.getElementById("typeHoursChip");
  if (typeChipEl) typeChipEl.style.display = "none";
  if (notesEl) notesEl.value = "";
  clearPickedPhoto();
  // The OCR scan status line and job chips are part of the form's state,
  // not a separate thing to tidy up by hand — wipe them here too so
  // scan → log → scan → log flows without any manual cleanup in between.
  const scanStatusEl = document.getElementById("photoScanStatus");
  if (scanStatusEl) {
    scanStatusEl.textContent = "";
    scanStatusEl.style.display = "none";
    scanStatusEl.className = "fr26ScanStatus";
  }
  const scanAltsEl = document.getElementById("scanJobAlternatives");
  if (scanAltsEl) { scanAltsEl.innerHTML = ""; scanAltsEl.style.display = "none"; }
  const scanHeroBtn = document.getElementById("scanRoHeroBtn");
  if (scanHeroBtn) scanHeroBtn.classList.remove("scanning");
  // Reset date picker to today
  const datePickerEl = document.getElementById("entryDate");
  if (datePickerEl) datePickerEl.value = todayKeyLocal();
  if (empInputEl) empInputEl.value = getEmpId();
  setRefType("RO");
  const detailsPanel = document.getElementById("detailsPanel");
  const detailsBtn = document.getElementById("toggleDetailsBtn");
  if (detailsPanel) detailsPanel.style.display = "none";
  if (detailsBtn) detailsBtn.textContent = "Add Details";
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = EDITING_ID ? "Update" : "Save"; }
  const dw = document.getElementById("dupWarnGlobal");
  if (dw) { dw.style.display = "none"; dw.dataset.level = ""; }
  const ep = document.getElementById("earningsPreview");
  if (ep) { ep.textContent = ""; ep.classList.remove("hasValue"); }
  // Show repeat chip if a last job is stored
  setTimeout(() => updateRepeatChip?.(), 50);
}

function focusHoursInput() {
  const hoursEl = document.getElementById("hours");
  if (!hoursEl) return;
  requestAnimationFrame(() => {
    try {
      hoursEl.focus({ preventScroll: true });
    } catch {
      hoursEl.focus();
    }
  });
}


function buildEntryMetaHtml(entry) {
  const vin8 = String(entry?.vin8 || "").trim();
  const updatedAt = entry?.updatedAt || entry?.updated_at || entry?.createdAt || entry?.created_at || "";
  const parts = [escapeHtml(formatTimeAgo(updatedAt))];
  // Show rate only when it differs from the current default — helps spot mismatches
  const entryRate = Number(entry?.rate);
  const defaultRate = Number(getDefaultRate?.() || 0);
  if (entryRate > 0 && Math.abs(entryRate - defaultRate) > 0.01) {
    parts.push(`$${entryRate}/hr`);
  }
  if (vin8) parts.push(`VIN ${escapeHtml(vin8)}`);
  if (entryHasPhoto(entry)) parts.push("📷");
  return `<div class="itemMeta">${parts.join(" · ")}</div>`;
}

function typeColorClass(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("preown") || t.includes("pre-own") || t.includes("used")) return "typeBadge--preowned";
  if (t.includes("fpf") || t.includes("f&i") || t.includes("finance")) return "typeBadge--fpf";
  if (t.includes("warrant")) return "typeBadge--warranty";
  if (t.includes("sold")) return "typeBadge--sold";
  return "typeBadge--default";
}

function typeBadgeHtml(label) {
  return `<span class="typeBadge ${typeColorClass(label)}">${escapeHtml(label)}</span>`;
}

function checkDuplicates() {
  const warn = document.getElementById("dupWarnGlobal");
  if (!warn) return;

  const refRaw = String(document.getElementById("ref")?.value || "").trim().toUpperCase();
  // Compare on the punctuation-stripped form too — "RO-12345" and "RO 12345"
  // are the same job, and a tech re-typing it slightly differently than the
  // first time shouldn't defeat the duplicate check.
  const refKey = normalizeIdChars(refRaw);
  const type = String(document.getElementById("typeText")?.value || "").trim().toLowerCase();
  const hours = round1(num(document.getElementById("hours")?.value));
  const dayKey = todayKeyLocal();

  const pool = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
    .filter(e => e.dayKey === dayKey && String(e.id ?? "") !== String(EDITING_ID ?? ""));

  // Strong: same RO on same day
  if (refRaw.length >= 2) {
    const hit = pool.find(e => {
      const eRef = String(e.ref || e.ro || "").trim().toUpperCase();
      return eRef === refRaw || (refKey && normalizeIdChars(eRef) === refKey);
    });
    if (hit) {
      warn.dataset.level = "strong";
      warn.style.display = "";
      warn.textContent = `⛔ RO ${refRaw} already logged today — ${hit.type || hit.typeText || "?"} · ${hit.hours} hrs · ${formatMoney(hit.earnings)}`;
      return;
    }
  }

  // Weak: same type + same hours on same day
  if (type && hours > 0) {
    const hit = pool.find(e =>
      String(e.type || e.typeText || "").trim().toLowerCase() === type &&
      round1(e.hours) === hours
    );
    if (hit) {
      warn.dataset.level = "weak";
      warn.style.display = "";
      warn.textContent = `⚠️ Similar entry today — ${hit.type || "?"} · ${hit.hours} hrs · ${formatTimeAgo(hit.updatedAt || hit.createdAt)}`;
      return;
    }
  }

  warn.dataset.level = "";
  warn.style.display = "none";
}

function updateEarningsPreview() {
  const el = document.getElementById("earningsPreview");
  if (!el) return;
  const hours = parseFloat(document.getElementById("hours")?.value) || 0;
  const rate = parseFloat(document.querySelector('input[name="rate"]')?.value) || getDefaultRate();
  if (hours > 0 && rate > 0) {
    el.innerHTML = `= ${formatMoney(round2(hours * rate))} <span class="epRate">@ ${formatMoney(rate)}/hr</span>`;
    el.classList.add("hasValue");
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 300);
  } else {
    el.innerHTML = "";
    el.classList.remove("hasValue", "pop");
  }
}

function updateHeaderTodayTotal(dollars) {
  const el = document.getElementById("headerTodayTotal");
  if (!el) return;
  if (dollars > 0) {
    el.textContent = formatMoney(dollars);
    el.style.opacity = "1";
  } else {
    el.style.opacity = "0";
  }
}

function updateHeroSection(todayDollars, weekHours, flaggedHours, todayCount, daysWorked, weekDollars, allEntries) {
  // Big pay number — animated count-up
  const payEl = document.getElementById("heroPayAmt");
  if (payEl) animateHeroNumber(payEl, todayDollars);

  // Goal ring — supports hours goal OR pay goal
  const arcEl = document.getElementById("heroGoalArc");
  const pctEl = document.getElementById("heroGoalPct");
  const subEl2 = document.getElementById("heroGoalSub");
  const circ = 238.8;
  if (arcEl && pctEl) {
    const goalType = localStorage.getItem("fr_goal_type") || "hours";
    const goalVal  = Number(localStorage.getItem("fr_goal_value") || 0);
    let pct, display, subTxt;

    if (goalType === "pay" && goalVal > 0) {
      pct = Math.min(1, weekDollars / goalVal);
      display = String(Math.round(pct * 100)) + "%";
      subTxt = `of ${formatMoney(goalVal)}`;
    } else {
      const maxHrs = goalVal > 0 ? goalVal : (flaggedHours > 0 ? flaggedHours : 40);
      pct = Math.min(1, weekHours / maxHrs);
      display = weekHours > 0 ? (Math.round(weekHours * 10) / 10).toFixed(1) : "0";
      subTxt = maxHrs > 40 || goalVal > 0 ? `/ ${(Math.round(maxHrs * 10) / 10).toFixed(0)}h` : "WK HRS";
    }

    arcEl.style.strokeDashoffset = String(circ - pct * circ);
    pctEl.textContent = display;
    if (subEl2) subEl2.textContent = subTxt;
  }

  // Sub line — show week total + today job count
  const subEl = document.getElementById("heroSubLine");
  if (subEl) {
    subEl.style.fontStyle = "";
    subEl.style.opacity = "";
    if (weekDollars > 0 && todayCount > 0) {
      subEl.textContent = `${formatMoney(weekDollars)} this week · ${todayCount} job${todayCount !== 1 ? "s" : ""} today`;
    } else if (weekDollars > 0) {
      subEl.textContent = `${formatMoney(weekDollars)} this week`;
    } else if (todayCount > 0) {
      subEl.textContent = `${todayCount} job${todayCount !== 1 ? "s" : ""} today`;
    } else {
      subEl.textContent = "Log a job to see your earnings here";
      subEl.style.fontStyle = "italic";
      subEl.style.opacity = "0.55";
    }
  }

  // Pace line
  const paceEl = document.getElementById("heroPaceLine");
  if (paceEl) {
    if (daysWorked > 0 && weekDollars > 0) {
      const proj = round2((weekDollars / daysWorked) * 5);
      const avgJob = todayCount > 0 ? ` · ${formatMoney(round2(todayDollars / todayCount))}/job` : "";
      paceEl.textContent = `On pace for ${formatMoney(proj)}${avgJob}`;
    } else if (todayCount > 0) {
      paceEl.textContent = `${formatMoney(round2(todayDollars / todayCount))}/job avg`;
    } else {
      paceEl.textContent = "";
    }
  }

  // Pay period projection
  const ppLineEl = document.getElementById("heroPayPeriodLine");
  if (ppLineEl) {
    const [ppStart, ppEnd] = _statsPayPeriodRange(0);
    const empId2 = getEmpId();
    const ppEntries = (allEntries || []).filter(e => {
      if (empId2 && cleanEmpId(e.empId) !== cleanEmpId(empId2)) return false;
      const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
      return dk >= ppStart && (!ppEnd || dk <= ppEnd);
    });
    const ppEarned = ppEntries.reduce((s, e) => s + Number(e.earnings || 0), 0);
    if (ppEarned > 0) {
      const ppStartDate = new Date(ppStart + "T12:00:00");
      const ppEndDate   = ppEnd ? new Date(ppEnd + "T12:00:00") : new Date(ppStartDate.getTime() + 13 * 86400000);
      const totalDays   = Math.round((ppEndDate - ppStartDate) / 86400000) + 1;
      const now2        = new Date();
      const daysIn      = Math.max(1, Math.round((now2 - ppStartDate) / 86400000) + 1);
      const daysLeft    = Math.max(0, totalDays - daysIn);
      const daysWorkedPP = new Set(ppEntries.map(e => e.dayKey || dayKeyFromISO(e.createdAt || ""))).size;
      if (daysLeft === 0) {
        ppLineEl.textContent = `Pay period total: ${formatMoney(ppEarned)}`;
        ppLineEl.style.display = "";
      } else if (daysWorkedPP > 0) {
        const proj = round2(ppEarned + (ppEarned / daysWorkedPP) * daysLeft);
        ppLineEl.textContent = `Pay period: ${formatMoney(ppEarned)} → ~${formatMoney(proj)}`;
        ppLineEl.style.display = "";
      } else {
        ppLineEl.style.display = "none";
      }
    } else {
      ppLineEl.style.display = "none";
    }
  }

  // Goal celebration + milestone check
  if (flaggedHours > 0) {
    const pct = Math.min(100, Math.round((weekHours / flaggedHours) * 100));
    checkGoalCelebration(pct);
  }
  checkPayMilestone(todayDollars);
  updateStreakBadge(computeStreak(allEntries || []));
  updateHeroRecords(allEntries || []);
  updateTechRankBadge(round1((filterEntriesByEmp(normalizeEntries(allEntries || []), getEmpId())).reduce((s, e) => s + (Number(e.hours) || 0), 0)));

  // ── Behind-pace warning ───────────────────────────────────────
  // If it's past noon, a goal is set, and you're under 50% of expected pace,
  // show a nudge below the pace line.
  const paceWarnEl = document.getElementById("heroPaceWarn");
  if (paceWarnEl) {
    const goalVal  = Number(localStorage.getItem("fr_goal_value") || 0);
    const goalType = localStorage.getItem("fr_goal_type") || "hours";
    const nowHr = new Date().getHours();
    let behindPace = false;
    if (goalVal > 0 && nowHr >= 12) {
      if (goalType === "pay") {
        const weekProg = Math.min(1, weekDollars / goalVal);
        const dayOfWeek = new Date().getDay(); // 0=Sun … 6=Sat
        const workDaysPassed = Math.max(1, Math.min(dayOfWeek, 5));
        behindPace = weekProg < (workDaysPassed / 5) * 0.55;
      } else {
        const maxHrs = goalVal;
        const weekProg = Math.min(1, weekHours / maxHrs);
        const dayOfWeek = new Date().getDay();
        const workDaysPassed = Math.max(1, Math.min(dayOfWeek, 5));
        behindPace = weekProg < (workDaysPassed / 5) * 0.55;
      }
    }
    paceWarnEl.style.display = behindPace ? "" : "none";
    if (behindPace) {
      const dayOfWeekNow = new Date().getDay();
      const daysLeft = Math.max(1, 5 - Math.min(dayOfWeekNow, 5));
      const dayWord = `${daysLeft} day${daysLeft !== 1 ? "s" : ""} left`;
      // A per-day target you physically can't hit ("need 19.0 hrs/day") reads as
      // a verdict, not a plan. Past a realistic ceiling, show the remaining gap
      // instead — same information, but something you can actually act on.
      const MAX_REALISTIC_FLAT_HRS_PER_DAY = 12;
      if (goalType === "pay") {
        const shortfall  = round2(Math.max(0, goalVal - weekDollars));
        const needPerDay = round2(shortfall / daysLeft);
        // Without a real rate we can't judge whether a daily target is
        // achievable, so state the plain shortfall rather than invent a ceiling.
        const rate       = Number(getDefaultRate?.()) || 0;
        const ceiling    = rate > 0 ? rate * MAX_REALISTIC_FLAT_HRS_PER_DAY : 0;
        paceWarnEl.textContent = (!ceiling || needPerDay > ceiling)
          ? `${formatMoney(shortfall)} to goal · ${dayWord}`
          : `${formatMoney(needPerDay)}/day to hit goal · ${dayWord}`;
      } else {
        const shortfall  = round1(Math.max(0, goalVal - weekHours));
        const needPerDay = round1(shortfall / daysLeft);
        paceWarnEl.textContent = needPerDay > MAX_REALISTIC_FLAT_HRS_PER_DAY
          ? `${shortfall.toFixed(1)} hrs to goal · ${dayWord}`
          : `${needPerDay.toFixed(1)} hrs/day to hit goal · ${dayWord}`;
      }
    }
  }
  updateClockInDisplay?.();
  renderSmartHourChips(allEntries);
  renderRecentTypeChips(allEntries);
}

/**
 * Build quick-hour chips from the tech's own entry history.
 * When forType is provided, chips are tuned to that specific job type.
 * Falls back to global most-used hours, then [0.5, 1.0, 2.0] for new users.
 */

/**
 * Render the "recent job types" one-tap row above the type input.
 * Shows last 3 unique job types with their stored default hours.
 * Tapping fills type + hours + fires earnings preview.
 */
function renderRecentTypeChips(entries) {
  const container = document.getElementById("recentTypeChips");
  if (!container) return;

  const empId = getEmpId();
  const myEntries = Array.isArray(entries)
    ? entries.filter(e => !empId || cleanEmpId(e.empId) === cleanEmpId(empId))
    : [];

  // Get last 3 unique types in recency order
  const seen = new Set();
  const recentTypes = [];
  for (const e of myEntries) {
    const name = (e.type || e.typeName || e.type_name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    recentTypes.push(name);
    if (recentTypes.length >= 3) break;
  }

  container.innerHTML = "";
  if (!recentTypes.length) return;

  for (const typeName of recentTypes) {
    // Look up stored hours for this type
    const stored = _savedTypes?.find?.(t =>
      (t.name || "").trim().toLowerCase() === typeName.toLowerCase()
    );
    const storedHours = stored?.lastHours || stored?.hours || null;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "recentTypeChip";
    chip.setAttribute("aria-label", `Quick-fill: ${typeName}`);

    const nameEl = document.createElement("span");
    nameEl.className = "recentTypeChipName";
    nameEl.textContent = typeName;
    chip.appendChild(nameEl);

    if (storedHours && Number(storedHours) > 0) {
      const hrsEl = document.createElement("span");
      hrsEl.className = "recentTypeChipHours";
      hrsEl.textContent = `${storedHours}h`;
      chip.appendChild(hrsEl);
    }

    chip.addEventListener("click", (e) => {
      e.preventDefault();
      // Fill type
      const typeEl = document.getElementById("typeText");
      if (typeEl) {
        typeEl.value = typeName;
        typeEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // Fill hours if stored
      if (storedHours && Number(storedHours) > 0) {
        setQuickHoursValue(String(storedHours));
      }
      updateEarningsPreview?.();
      restoreLastWorkType?.();

      // Tap animation
      chip.classList.remove("tapped");
      void chip.offsetWidth;
      chip.classList.add("tapped");
      setTimeout(() => chip.classList.remove("tapped"), 300);
    });

    container.appendChild(chip);
  }
}

let _savedTypes = [];
window.__FR.renderRecentTypeChips = function(e) { renderRecentTypeChips(e); };

function renderSmartHourChips(entries, forType) {
  const container = document.getElementById("smartHourChips");
  if (!container) return;

  // Cache entries so we can re-render when job type changes
  if (Array.isArray(entries) && entries.length > 0) _smartChipEntries = entries;
  const allEntries = _smartChipEntries;

  const empId = getEmpId();
  const myEntries = allEntries
    .filter(e => !empId || cleanEmpId(e.empId) === cleanEmpId(empId));

  const typeKey = (forType || "").trim().toLowerCase();
  let vals = [];
  let isTypeSpecific = false;

  // If a job type is active, try type-specific chips first
  if (typeKey) {
    const typeEntries = myEntries.filter(e =>
      (e.type || e.typeName || "").trim().toLowerCase() === typeKey
    );
    if (typeEntries.length >= 2) {
      const freq = {};
      for (const e of typeEntries) {
        const h = round1(Number(e.hours));
        if (Number.isFinite(h) && h > 0) freq[h] = (freq[h] || 0) + 1;
      }
      vals = Object.keys(freq)
        .map(Number)
        .sort((a, b) => freq[b] - freq[a] || a - b)
        .slice(0, 6);
      isTypeSpecific = vals.length > 0;
    }
  }

  // Fall back to global most-used hours
  if (vals.length === 0) {
    const freq = {};
    for (const e of myEntries) {
      const h = round1(Number(e.hours));
      if (Number.isFinite(h) && h > 0) freq[h] = (freq[h] || 0) + 1;
    }
    vals = Object.keys(freq)
      .map(Number)
      .sort((a, b) => freq[b] - freq[a] || a - b)
      .slice(0, 8);
  }

  // New user fallback
  if (vals.length === 0) vals = [0.5, 1.0, 2.0];

  // Sort ascending for display
  vals.sort((a, b) => a - b);

  // Sync selected state with current hours value
  const currentHours = document.getElementById("hours")?.value?.trim() || "";

  container.innerHTML = "";

  // Label so user knows chips are tuned to this job
  if (isTypeSpecific) {
    const hint = document.createElement("span");
    hint.className = "fr26ChipHint";
    hint.textContent = "for this job ↓";
    container.appendChild(hint);
  }

  for (const val of vals) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fr26HourBtn";
    if (currentHours === String(val)) btn.classList.add("selected");
    btn.dataset.hoursQuick = String(val);
    btn.textContent = String(val);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setQuickHoursValue?.(String(val));
      restoreLastWorkType?.();
      updateEarningsPreview?.();
    });
    container.appendChild(btn);
  }
}

function renderHeroChart(entries, weekStart) {
  const svg = document.getElementById("heroChartSvg");
  const labelsRow = document.getElementById("heroChartLabels");
  if (!svg || !labelsRow) return;

  // ── Year mode: 12 monthly bars ──────────────────────────────────────
  const heroMode = window.__RANGE_MODE__ || rangeMode || "day";
  if (heroMode === "year") {
    const navNow = navRefDate();
    const yr = navNow.getFullYear();
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const curMonth = (new Date()).getFullYear() === yr ? (new Date()).getMonth() : 11;
    const buckets = monthNames.map((lbl, mo) => {
      const prefix = `${yr}-${String(mo + 1).padStart(2, "0")}`;
      const moEntries = entries.filter(e => (e.dayKey || "").startsWith(prefix));
      const dollars = moEntries.reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0);
      return { label: lbl, prefix, dollars, isCurrent: mo === curMonth };
    });
    const max = Math.max(...buckets.map(b => b.dollars), 1);
    const W = 300, H = 56, n = 12;
    const barW = (W - (n + 1) * 3) / n;
    const gap  = 3;
    const isLight = document.documentElement.dataset.theme === "light";
    const emptyColor = isLight ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)";
    const pastColor  = isLight ? "rgba(37,99,235,.30)" : "rgba(37,99,235,.28)";
    svg.innerHTML = "";
    buckets.forEach((b, i) => {
      const x = gap + i * (barW + gap);
      const barH = b.dollars > 0 ? Math.max(3, (b.dollars / max) * (H - 6)) : 3;
      const y = H - barH;
      const color = b.isCurrent ? "#2563EB" : b.dollars > 0 ? pastColor : emptyColor;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x.toFixed(1));
      rect.setAttribute("y", y.toFixed(1));
      rect.setAttribute("width", barW.toFixed(1));
      rect.setAttribute("height", barH.toFixed(1));
      rect.setAttribute("rx", "3");
      rect.setAttribute("fill", color);
      rect.style.transformOrigin = `${(x + barW / 2).toFixed(1)}px ${H}px`;
      rect.style.transform = "scaleY(0)";
      rect.style.transition = `transform 380ms cubic-bezier(.34,1.56,.64,1) ${i * 35}ms`;
      svg.appendChild(rect);
    });
    requestAnimationFrame(() => {
      svg.querySelectorAll("rect").forEach(r => { r.style.transform = "scaleY(1)"; });
    });
    labelsRow.innerHTML = buckets.map(b =>
      `<span class="heroChartLabel${b.isCurrent ? " heroChartLabel--now" : ""}">${b.label}</span>`
    ).join("");
    window.__heroEntries = entries;
    svg.querySelectorAll("rect").forEach((rect, i) => {
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => {
        const b = buckets[i];
        const moEntries = (window.__heroEntries || []).filter(e => (e.dayKey || "").startsWith(b.prefix));
        const hrs = moEntries.reduce((s, e) => s + (Number(e.flat_hours ?? e.hours ?? 0) || 0), 0);
        const cnt = moEntries.length;
        const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setT("hcsHours", hrs > 0 ? round1(hrs) : "0");
        setT("hcsJobs", String(cnt));
        setT("hcsPay", b.dollars > 0 ? formatMoney(b.dollars) : "$0");
        setT("hcsAvg", cnt > 0 ? formatMoney(round2(b.dollars / cnt)) : "—");
        setT("hcRangeLabel", `${b.label} ${yr}`);
        svg.querySelectorAll("rect").forEach((r, j) => { r.style.opacity = j === i ? "1" : "0.45"; });
        labelsRow.querySelectorAll("span").forEach((s, j) => { s.classList.toggle("heroChartLabel--now", j === i); });
        // The job list below was the whole year's jobs — narrow it to just
        // this month, same as the stats above it, so tapping a bar doesn't
        // leave the numbers and the list disagreeing about the period.
        renderRangeEntries(moEntries.slice().sort((a, b2) => (b2.createdAt || "").localeCompare(a.createdAt || "")), "month");
      });
    });
    // Default: highlight most recent month with data
    let lastIdx = -1;
    buckets.forEach((b, i) => { if (b.dollars > 0) lastIdx = i; });
    if (lastIdx >= 0) svg.querySelectorAll("rect")[lastIdx]?.click();
    return;
  }

  // ── Month mode: weekly bars within the current month ──────────────────
  if (heroMode === "month") {
    const navNow = navRefDate();
    const monthStart = startOfMonthLocal(navNow);
    const monthEnd   = endOfMonthLocal(navNow);
    const isLight = document.documentElement.dataset.theme === "light";
    const emptyColor = isLight ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)";
    const pastColor  = isLight ? "rgba(37,99,235,.30)" : "rgba(37,99,235,.28)";

    // Walk week starts that overlap this month
    const wkBuckets = [];
    let wk = startOfWeekLocal(monthStart);
    const monthEndKey = dateKey(monthEnd);
    const todayDk = todayKeyLocal();
    while (dateKey(wk) <= monthEndKey) {
      const wkEnd = endOfWeekLocal(wk);
      const wkDollars = entries.reduce((s, e) => {
        const dk = e.dayKey || dayKeyFromISO(e.createdAt);
        if (dk < dateKey(wk) || dk > dateKey(wkEnd)) return s;
        if (dk < dateKey(monthStart) || dk > monthEndKey) return s;
        return s + (Number(e.earnings ?? e.dollars ?? 0) || 0);
      }, 0);
      const wkEntries = entries.filter(e => {
        const dk = e.dayKey || dayKeyFromISO(e.createdAt);
        return dk >= dateKey(wk) && dk <= dateKey(wkEnd) && dk >= dateKey(monthStart) && dk <= monthEndKey;
      });
      const isCurrentWk = todayDk >= dateKey(wk) && todayDk <= dateKey(wkEnd);
      wkBuckets.push({ label: `Wk${wkBuckets.length + 1}`, wkStart: dateKey(wk), wkEnd: dateKey(wkEnd), dollars: wkDollars, entries: wkEntries, isCurrent: isCurrentWk });
      const next = new Date(wk);
      next.setDate(next.getDate() + 7);
      wk = next;
    }

    const n = wkBuckets.length;
    const max = Math.max(...wkBuckets.map(b => b.dollars), 1);
    const W = 300, H = 56;
    const barW = (W - (n + 1) * 6) / n;
    const gap  = 6;
    svg.innerHTML = "";
    wkBuckets.forEach((b, i) => {
      const x = gap + i * (barW + gap);
      const barH = b.dollars > 0 ? Math.max(3, (b.dollars / max) * (H - 6)) : 3;
      const y = H - barH;
      const color = b.isCurrent ? "#2563EB" : b.dollars > 0 ? pastColor : emptyColor;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x.toFixed(1));
      rect.setAttribute("y", y.toFixed(1));
      rect.setAttribute("width", barW.toFixed(1));
      rect.setAttribute("height", barH.toFixed(1));
      rect.setAttribute("rx", "4");
      rect.setAttribute("fill", color);
      rect.style.transformOrigin = `${(x + barW / 2).toFixed(1)}px ${H}px`;
      rect.style.transform = "scaleY(0)";
      rect.style.transition = `transform 420ms cubic-bezier(.34,1.56,.64,1) ${i * 80}ms`;
      svg.appendChild(rect);
    });
    requestAnimationFrame(() => {
      svg.querySelectorAll("rect").forEach(r => { r.style.transform = "scaleY(1)"; });
    });
    labelsRow.innerHTML = wkBuckets.map(b =>
      `<span class="heroChartLabel${b.isCurrent ? " heroChartLabel--now" : ""}">${b.label}</span>`
    ).join("");
    window.__heroEntries = entries;
    svg.querySelectorAll("rect").forEach((rect, i) => {
      rect.style.cursor = "pointer";
      rect.addEventListener("click", () => {
        const b = wkBuckets[i];
        const hrs = b.entries.reduce((s, e) => s + (Number(e.flat_hours ?? e.hours ?? 0) || 0), 0);
        const cnt = b.entries.length;
        const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setT("hcsHours", hrs > 0 ? round1(hrs) : "0");
        setT("hcsJobs", String(cnt));
        setT("hcsPay", b.dollars > 0 ? formatMoney(b.dollars) : "$0");
        setT("hcsAvg", cnt > 0 ? formatMoney(round2(b.dollars / cnt)) : "—");
        setT("hcRangeLabel", b.label);
        svg.querySelectorAll("rect").forEach((r, j) => { r.style.opacity = j === i ? "1" : "0.45"; });
        labelsRow.querySelectorAll("span").forEach((s, j) => { s.classList.toggle("heroChartLabel--now", j === i); });
        // Same fix as year mode: narrow the job list below to just this
        // week's jobs so it matches what the numbers above are showing.
        renderRangeEntries(b.entries.slice().sort((a, b2) => (b2.createdAt || "").localeCompare(a.createdAt || "")), "week");
      });
    });
    // Default: highlight current week
    const curIdx = wkBuckets.findIndex(b => b.isCurrent);
    if (curIdx >= 0) svg.querySelectorAll("rect")[curIdx]?.click();
    return;
  }

  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today = new Date();
  const todayKey = todayKeyLocal();

  // Build 7-day buckets starting from weekStart
  const buckets = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const k = dateKey(d);
    const dayEntries = entries.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === k);
    const dollars = dayEntries.reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0);
    buckets.push({ label: days[d.getDay()], key: k, dollars, isToday: k === todayKey });
  }

  const max = Math.max(...buckets.map(b => b.dollars), 1);
  const W = 300, H = 56, barW = 30, gap = (W - 7 * barW) / 8;
  const isLight = document.documentElement.dataset.theme === "light";
  const emptyColor = isLight ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)";
  const pastColor  = isLight ? "rgba(37,99,235,.30)" : "rgba(37,99,235,.28)";

  // Animated bars
  svg.innerHTML = "";
  buckets.forEach((b, i) => {
    const x = gap + i * (barW + gap);
    const barH = Math.max(3, (b.dollars / max) * (H - 6));
    const y = H - barH;
    const color = b.isToday ? "#2563EB" : b.dollars > 0 ? pastColor : emptyColor;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", x.toFixed(1));
    rect.setAttribute("y", y.toFixed(1));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", barH.toFixed(1));
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", color);
    // Stagger-in animation
    rect.style.transformOrigin = `${(x + barW/2).toFixed(1)}px ${H}px`;
    rect.style.transform = "scaleY(0)";
    rect.style.transition = `transform 420ms cubic-bezier(.34,1.56,.64,1) ${i * 55}ms`;
    svg.appendChild(rect);
  });
  // Trigger animation next frame
  requestAnimationFrame(() => {
    svg.querySelectorAll("rect").forEach(r => { r.style.transform = "scaleY(1)"; });
  });

  // Dollar amounts above day labels + tappable labels
  labelsRow.innerHTML = buckets.map(b => {
    const amtTxt = b.dollars > 0
      ? (b.dollars >= 1000 ? `$${(b.dollars/1000).toFixed(1)}k` : `$${Math.round(b.dollars)}`)
      : "";
    return `<span class="heroChartLabel${b.isToday ? " heroChartLabel--now" : ""}">` +
      `<span class="heroChartLabelAmt">${amtTxt}</span>${b.label}</span>`;
  }).join("");

  // Vs-last-week meta line
  const metaEl = document.getElementById("heroChartMeta");
  if (metaEl) {
    const wsDate = new Date(weekStart);
    const lastWkStart = new Date(wsDate); lastWkStart.setDate(wsDate.getDate() - 7);
    const lastWkEnd   = new Date(wsDate); lastWkEnd.setDate(wsDate.getDate() - 1);
    const thisWkTotal = buckets.reduce((s, b) => s + b.dollars, 0);
    const lastWkTotal = entries.reduce((s, e) => {
      const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
      if (!dk) return s;
      const d = new Date(dk + "T12:00:00");
      return (d >= lastWkStart && d <= lastWkEnd) ? s + Number(e.earnings ?? e.dollars ?? 0) : s;
    }, 0);
    if (thisWkTotal > 0 && lastWkTotal > 0) {
      const diff = thisWkTotal - lastWkTotal;
      const arrow = diff >= 0 ? "↑" : "↓";
      const sign  = diff >= 0 ? "+" : "";
      metaEl.textContent = `${arrow} ${sign}${formatMoney(diff)} vs last week`;
      metaEl.style.display = "";
    } else {
      metaEl.style.display = "none";
    }
  }

  // Tappable bars + labels — show day stats and filter entries list
  function showDayStats(bucket, idx) {
    const hrsEl   = document.getElementById("hcsHours");
    const jobsEl  = document.getElementById("hcsJobs");
    const payEl   = document.getElementById("hcsPay");
    const avgEl   = document.getElementById("hcsAvg");
    const labelEl = document.getElementById("hcRangeLabel");
    if (!hrsEl || !jobsEl || !payEl) return;

    const dayEntries = (window.__heroEntries || []).filter(e => {
      const k = e.dayKey || dayKeyFromISO(e.createdAt);
      return k === bucket.key;
    });
    const hrs = dayEntries.reduce((s, e) => s + (Number(e.flat_hours ?? e.hours ?? 0) || 0), 0);
    const cnt = dayEntries.length;
    hrsEl.textContent  = hrs > 0 ? round1(hrs) : "0";
    jobsEl.textContent = String(cnt);
    payEl.textContent  = bucket.dollars > 0 ? formatMoney(bucket.dollars) : "$0";
    if (avgEl) avgEl.textContent = cnt > 0 ? formatMoney(round2(bucket.dollars / cnt)) : "—";
    if (labelEl) labelEl.textContent = bucket.isToday ? "Today" : bucket.label;

    // Update entries list for the tapped day
    renderRangeEntries(dayEntries, "day");

    // Highlight selected bar + label, dim others
    svg.querySelectorAll("rect").forEach((r, i) => {
      r.style.opacity = i === idx ? "1" : "0.45";
    });
    labelsRow.querySelectorAll("span.heroChartLabel").forEach((s, i) => {
      s.classList.toggle("heroChartLabel--now", i === idx);
    });
  }

  // Store entries for tap handler access
  window.__heroEntries = entries;

  // Wire click on bars
  svg.querySelectorAll("rect").forEach((rect, i) => {
    rect.style.cursor = "pointer";
    rect.addEventListener("click", () => showDayStats(buckets[i], i));
  });
  // Wire click on labels too
  labelsRow.querySelectorAll("span.heroChartLabel").forEach((s, i) => {
    s.addEventListener("click", () => showDayStats(buckets[i], i));
  });

  // Default: show today — only in day mode so Week/Month/All stats aren't overwritten
  if (!window.__RANGE_MODE__ || window.__RANGE_MODE__ === "day") {
    const todayIdx = buckets.findIndex(b => b.isToday);
    if (todayIdx >= 0) showDayStats(buckets[todayIdx], todayIdx);
  }
}

/* ─── Records entries list (inside chart card) ─────── */

function renderRangeEntries(entries, mode) {
  const container = document.getElementById("hcEntriesList");
  if (!container) return;

  if (!entries || entries.length === 0) {
    container.innerHTML = `<div class="hcEntryEmpty">No entries for this period</div>`;
    return;
  }

  const MAX = 60;
  const shown = entries.slice(0, MAX);
  const hasMore = entries.length > MAX;
  const showDate = mode !== "day";

  const fmtDay = (dk) => {
    if (!dk) return "";
    const d = new Date(dk + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  container.innerHTML = "";

  // Rows flow in staggered instead of snapping into place — same treatment
  // as the History list, so switching Day/Week/Month or tapping a bar reads
  // as the list actually updating rather than an instant, jarring swap.
  let __rowStagger = 0;

  for (const e of shown) {
    const refLabel = e.refType === "STOCK" ? "STK" : "RO";
    const refVal = e.ref || e.ro || "—";
    const hasPhoto = entryHasPhoto(e);
    const vin8 = String(e.vin8 || "").trim();
    const typeStr = e.type || e.typeText || "—";
    const hrs = (Math.round(Number(e.hours || 0) * 10) / 10).toFixed(1);

    // Row wrapper
    const wrap = document.createElement("div");
    wrap.className = "hcEntryWrap entryPopIn";
    wrap.style.animationDelay = (Math.min(__rowStagger++, 10) * 22) + "ms";

    // Main row
    const row = document.createElement("div");
    row.className = "hcEntryRow";

    // Left side — ref, type, photo chip, vin, date
    const left = document.createElement("div");
    left.className = "hcEntryLeft";

    const refSpan = document.createElement("span");
    refSpan.className = "hcEntryRef";
    refSpan.textContent = `${refLabel} ${refVal}`;

    const typeSpan = document.createElement("span");
    typeSpan.className = "hcEntryType";
    typeSpan.textContent = typeStr;

    left.appendChild(refSpan);
    left.appendChild(typeSpan);

    if (hasPhoto) {
      const photoChip = document.createElement("span");
      photoChip.className = "hcEntryPhotoChip";
      photoChip.innerHTML = '<span class="hcEntryPhotoIcon">📷</span> View Photo';
      photoChip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openPhoto(e);
      });
      left.appendChild(photoChip);
    }

    if (vin8) {
      const vinSpan = document.createElement("span");
      vinSpan.className = "hcEntryVin";
      vinSpan.textContent = `VIN …${vin8.slice(-8)}`;
      left.appendChild(vinSpan);
    }

    if (showDate && e.dayKey) {
      const dateSpan = document.createElement("span");
      dateSpan.className = "hcEntryDate";
      dateSpan.textContent = fmtDay(e.dayKey);
      left.appendChild(dateSpan);
    }

    // Right side — pay + hours
    const right = document.createElement("div");
    right.className = "hcEntryRight";
    right.innerHTML = `<span class="hcEntryPay">${formatMoney(e.earnings)}</span><span class="hcEntryHrs">${hrs}h</span>`;

    // Action buttons — edit + delete, always visible, inline icon squares
    const actions = document.createElement("div");
    actions.className = "hcEntryActions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "hcEntryEditBtn";
    editBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.title = "Edit";
    editBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      startEditEntry(e);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "hcEntryDelBtn";
    delBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    delBtn.title = "Delete";
    delBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handleDeleteEntry(e, ev);
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(actions);

    // Tap row body = see what the job actually was (read-only) — jumping
    // straight into the edit form on every tap was the wrong default; most
    // taps are "what did I log here", not "I want to change this."
    row.addEventListener("click", () => openEntryDetail(e));

    wrap.appendChild(row);
    container.appendChild(wrap);
  }

  if (hasMore) {
    const more = document.createElement("div");
    more.className = "hcEntryMore";
    more.textContent = `+${entries.length - MAX} more`;
    container.appendChild(more);
  }

  // (swipe-to-delete removed — buttons are always visible inline)
}

/* ─── Job detail sheet ────────────────────────────────────────────────────
   Tapping a job in the list shows this read-only view instead of dropping
   straight into the edit form. Edit/Delete/Photo are one deliberate tap
   further, not the default outcome of just wanting to see what a job was. */
let _entryDetailCurrent = null;

function openEntryDetail(entry) {
  if (!entry) return;
  _entryDetailCurrent = entry;

  const modal = document.getElementById("entryDetailModal");
  if (!modal) return;

  const refLabel = entry.refType === "STOCK" ? "STK" : "RO";
  const refVal = entry.ref || entry.ro || "—";
  const vin8 = String(entry.vin8 || "").trim();
  const dk = entry.dayKey || dayKeyFromISO(entry.createdAt);
  const dateTxt = dk ? new Date(dk + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const subParts = [`${refLabel} ${refVal}`];
  if (vin8) subParts.push(`VIN …${vin8.slice(-8)}`);
  if (dateTxt) subParts.push(dateTxt);
  if (entry.isComeback || entry.comeback) subParts.push("Comeback");

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT("edType", entry.type || entry.typeText || "Job");
  setT("edSub", subParts.join(" · "));
  setT("edHours", `${(Math.round(Number(entry.hours || 0) * 10) / 10).toFixed(1)}h`);
  setT("edPay", formatMoney(entry.earnings));

  const notesWrap = document.getElementById("edNotesWrap");
  const notes = String(entry.notes || "").trim();
  if (notesWrap) notesWrap.style.display = notes ? "" : "none";
  setT("edNotes", notes);

  const photoBtn = document.getElementById("edPhotoBtn");
  if (photoBtn) photoBtn.style.display = entryHasPhoto(entry) ? "" : "none";

  modal.style.display = "";
  requestAnimationFrame(() => modal.classList.add("open"));
}

function closeEntryDetail() {
  const modal = document.getElementById("entryDetailModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.style.display = "none";
  _entryDetailCurrent = null;
}

document.getElementById("entryDetailCloseBtn")?.addEventListener("click", closeEntryDetail);
document.getElementById("entryDetailModal")?.addEventListener("click", (ev) => {
  if (ev.target?.id === "entryDetailModal") closeEntryDetail();
});
document.getElementById("edPhotoBtn")?.addEventListener("click", () => {
  if (_entryDetailCurrent) openPhoto(_entryDetailCurrent);
});
document.getElementById("edEditBtn")?.addEventListener("click", () => {
  const entry = _entryDetailCurrent;
  closeEntryDetail();
  if (entry) {
    startEditEntry(entry);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});
document.getElementById("edDeleteBtn")?.addEventListener("click", (ev) => {
  const entry = _entryDetailCurrent;
  closeEntryDetail();
  if (entry) handleDeleteEntry(entry, ev);
});

/* ─── VIN search ──────────────────────────────────────── */

function initVinSearch() {
  const input = document.getElementById("vinSearchInput");
  const clearBtn = document.getElementById("vinSearchClear");
  if (!input) return;

  const doSearch = () => {
    const raw = input.value.trim();

    if (!raw) {
      // Restore normal range view — re-trigger current tab render
      const activeTab = document.querySelector("[data-hc-range].hcTab--active");
      activeTab?.click();
      return;
    }

    // Same normalized VIN/RO matching as everywhere else in the app (History
    // search, More page review) — this box used to have its own stricter
    // copy that didn't forgive punctuation differences or the O/0, I/1 mix-ups
    // that are the most common VIN transcription mistake.
    const all = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
    const matches = all.filter(e => matchSearch(e, raw));

    const container = document.getElementById("hcEntriesList");
    if (!container) return;

    if (matches.length === 0) {
      container.innerHTML = `<div class="hcEntryEmpty">No entries found for VIN "${input.value.trim()}"</div>`;
      return;
    }

    // Render matches sorted newest-first using existing renderer (mode "year" shows dates)
    const sorted = [...matches].sort((a, b) =>
      (b.createdAt || b.created_at || "").localeCompare(a.createdAt || a.created_at || "")
    );
    renderRangeEntries(sorted, "year");
  };

  // Debounced like every other search-as-you-type box in the app (History
  // search, More page review search — see historySearchInput/reviewSearch in
  // boot.js). This one was the odd one out, re-filtering the full entry list
  // and rebuilding up to 60 DOM rows (with entrance animations) on every
  // single keystroke — the kind of thing that reads as "the app feels slow"
  // even though the rest of the app was already snappy. The clear (×) button
  // still shows/hides instantly since that's a cheap style toggle, not tied
  // to the expensive part.
  let _vinSearchT = null;
  input.addEventListener("input", () => {
    clearBtn && (clearBtn.style.display = input.value.trim() ? "" : "none");
    clearTimeout(_vinSearchT);
    _vinSearchT = setTimeout(doSearch, 180);
  });
  clearBtn?.addEventListener("click", () => {
    input.value = "";
    clearBtn.style.display = "none";
    clearTimeout(_vinSearchT);
    doSearch();
    input.focus();
  });
}

/* ─── Animation & effects helpers ───────────────────── */

let __lastGoalPct = 0;
let __lastTodayDollars = 0;
const PAY_MILESTONES = [100, 250, 500, 750, 1000, 1500, 2000];

/* ── Tech Rank system ─────────────────────────────────────────────────────────
   Rank is based on cumulative flat-rate hours logged by the employee.
   Stored in localStorage so it persists and level-up fires exactly once.
──────────────────────────────────────────────────────────────────────────── */
const TECH_RANKS = [
  { minHrs: 0,    emoji: "🔧", title: "Rookie",            sub: "Every legend starts here." },
  { minHrs: 50,   emoji: "🛠️", title: "Grease Monkey",     sub: "You're getting your hands dirty." },
  { minHrs: 150,  emoji: "⚙️", title: "Journeyman",        sub: "You know your way around a bay." },
  { minHrs: 350,  emoji: "🏎️", title: "Speed Wrench",      sub: "Fast, accurate, and reliable." },
  { minHrs: 700,  emoji: "👑", title: "Master Tech",       sub: "Customers ask for you by name." },
  { minHrs: 1500, emoji: "🔥", title: "Flat Rate Legend",  sub: "Few ever make it this far." },
];

function getTechRank(totalHours) {
  let rank = TECH_RANKS[0];
  for (const r of TECH_RANKS) {
    if (totalHours >= r.minHrs) rank = r;
    else break;
  }
  const idx = TECH_RANKS.indexOf(rank);
  const next = TECH_RANKS[idx + 1] || null;
  return { rank, idx, next };
}

function updateTechRankBadge(totalHours) {
  const badge = document.getElementById("techRankBadge");
  if (!badge) return;
  const { rank, next } = getTechRank(totalHours);
  let label = `${rank.emoji} ${rank.title}`;
  if (next) {
    const remaining = Math.ceil(next.minHrs - totalHours);
    label += ` · ${remaining} hrs to ${next.title}`;
  }
  badge.textContent = label;
  badge.style.display = "";
}

const LS_TECH_RANK = "fr_tech_rank_idx";

function checkRankUp(allEntries) {
  const empId = getEmpId();
  if (!empId) return;
  const own = filterEntriesByEmp(normalizeEntries(Array.isArray(allEntries) ? allEntries : []), empId);
  const totalHours = round1(own.reduce((s, e) => s + (Number(e.hours) || 0), 0));
  const { rank, idx } = getTechRank(totalHours);
  updateTechRankBadge(totalHours);

  const prevIdx = Number(localStorage.getItem(LS_TECH_RANK) ?? -1);
  if (prevIdx === -1) {
    // First time — just save, don't animate
    localStorage.setItem(LS_TECH_RANK, String(idx));
    return;
  }
  if (idx > prevIdx) {
    localStorage.setItem(LS_TECH_RANK, String(idx));
    showLevelUpAnimation(rank);
  }
}

function showLevelUpAnimation(rank) {
  const overlay = document.getElementById("levelUpOverlay");
  const emojiEl = document.getElementById("levelUpEmoji");
  const rankEl  = document.getElementById("levelUpRank");
  const subEl   = document.getElementById("levelUpSub");
  if (!overlay || !emojiEl || !rankEl || !subEl) return;

  emojiEl.textContent = rank.emoji;
  rankEl.textContent  = rank.title;
  subEl.textContent   = rank.sub;

  overlay.style.display = "flex";
  overlay.classList.remove("levelUp-exit");
  void overlay.offsetWidth;
  overlay.classList.add("levelUp-enter");

  // Celebratory haptic burst: firm hit, then the iOS success chime
  haptic?.("heavy");
  setTimeout(() => haptic?.("success"), 140);

  triggerConfetti(60);

  const hide = () => {
    overlay.classList.add("levelUp-exit");
    setTimeout(() => { overlay.style.display = "none"; overlay.classList.remove("levelUp-enter","levelUp-exit"); }, 500);
  };
  overlay.onclick = hide;
  clearTimeout(overlay.__t);
  overlay.__t = setTimeout(hide, 4000);
}

// Random save quotes — shown as a brief flash after each entry save
const SAVE_QUOTES = [
  "💸 Money logged!", "🔥 Keep grinding!", "💪 That's the way!",
  "🚀 Stack those hours!", "⚡ Fast hands, full pockets!", "💰 Bread earned!",
  "🏁 Another one in the books!", "🛠️ Dialed in!", "👊 Let's go!",
  "📈 Building that bag!", "🎯 Locked in!", "😤 No days off!",
];
let __lastQuoteIdx = -1;
function randomSaveQuote() {
  let idx;
  do { idx = Math.floor(Math.random() * SAVE_QUOTES.length); } while (idx === __lastQuoteIdx);
  __lastQuoteIdx = idx;
  return SAVE_QUOTES[idx];
}

function flashSaveBtn() {
  const btn = document.getElementById("saveBtn");
  if (!btn) return;
  btn.classList.remove("btn-success");
  void btn.offsetWidth;
  btn.classList.add("btn-success");
  setTimeout(() => btn.classList.remove("btn-success"), 440);
}

function shakeEl(el) {
  if (!el) return;
  el.classList.remove("shake", "invalid");
  void el.offsetWidth;
  el.classList.add("shake", "invalid");
  el.focus?.({ preventScroll: true });
  setTimeout(() => el.classList.remove("shake", "invalid"), 600);
}

function shakeHourChips() {
  const c = document.getElementById("smartHourChips");
  if (!c) return;
  c.classList.remove("shake");
  void c.offsetWidth;
  c.classList.add("shake");
  setTimeout(() => c.classList.remove("shake"), 600);
}

function animateHeroNumber(el, to) {
  if (!el) return;
  // Always count up from 0 on first render of each page session
  const from = el.dataset.animated ? (parseFloat(el.dataset.rawVal || "0") || 0) : 0;
  el.dataset.rawVal = String(to);
  el.dataset.animated = "1";
  if (from === to && from !== 0) return;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  const start = performance.now();
  const dur = Math.min(900, Math.max(400, Math.abs(to - from) * 2 + 300));
  // Ease-out-back: counts up fast then slightly overshoots and settles
  const easeOutBack = (t) => {
    const c1 = 1.40158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const grew = to > from;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = easeOutBack(t);
    el.textContent = formatMoney(Math.max(0, from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
    else {
      el.textContent = formatMoney(to);
      // Reward glow the moment the number lands (only when earnings grew)
      if (grew) {
        el.classList.remove("landed");
        void el.offsetWidth;
        el.classList.add("landed");
        setTimeout(() => el.classList.remove("landed"), 700);
      }
    }
  };
  requestAnimationFrame(step);
}

// Reset animation state on iOS bfcache restore so count-up always fires from 0
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) {
    document.querySelectorAll("[data-animated]").forEach(el => {
      el.removeAttribute("data-animated");
      el.removeAttribute("data-raw-val");
    });
  }
});

function triggerConfetti(count = 36) {
  const colors = ["#2563EB","#4ade80","#86efac","#ffffff","#fbbf24","#f472b6","#60a5fa"];
  const ox = window.innerWidth / 2;
  const oy = window.innerHeight * 0.22;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "cfp";
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 200;
    const ex = Math.cos(angle) * dist, ey = Math.sin(angle) * dist + 80;
    const rot = (Math.random() * 720 - 360) + "deg";
    const dur = (480 + Math.random() * 520) + "ms";
    p.style.cssText = `left:${ox + (Math.random()-0.5)*80}px;top:${oy}px;background:${colors[i%colors.length]};--cf-end:translate(${ex}px,${ey}px);--cf-rot:${rot};--cf-dur:${dur};`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }
}

function checkGoalCelebration(pct) {
  if (pct >= 100 && __lastGoalPct < 100) {
    triggerConfetti(42);
    showMilestoneToast("🎯 Weekly goal smashed!");
  }
  __lastGoalPct = pct;
}

function showMilestoneToast(msg) {
  let el = document.getElementById("__mToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "__mToast";
    el.className = "mToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el.__t);
  el.__t = setTimeout(() => el.classList.remove("show"), 3000);
}

function checkPayMilestone(todayDollars) {
  const prev = __lastTodayDollars;
  for (const m of PAY_MILESTONES) {
    if (prev < m && todayDollars >= m) {
      showMilestoneToast(`💰 $${m} today — keep going!`);
      haptic?.("success");
      break;
    }
  }
  __lastTodayDollars = todayDollars;
}

function computeStreak(entries) {
  const days = new Set(entries.map(e => e.dayKey || dayKeyFromISO(e.createdAt)).filter(Boolean));
  let streak = 0;
  const d = new Date();
  if (!days.has(todayKeyLocal())) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 366; i++) {
    if (!days.has(dateKey(d))) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function updateStreakBadge(streak) {
  const subLine = document.querySelector(".heroSubLine");
  if (!subLine) return;
  let badge = document.getElementById("__heroStreak");
  if (streak >= 2) {
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "__heroStreak";
      badge.className = "heroStreak";
      subLine.insertAdjacentElement("afterend", badge);
    }
    badge.textContent = `🔥 ${streak}-day streak`;
  } else if (badge) {
    badge.remove();
  }
}

function animateFirstEntry() {
  requestAnimationFrame(() => {
    const first = document.querySelector("#entryList .item");
    if (first) {
      first.classList.remove("item-enter");
      void first.offsetWidth;
      first.classList.add("item-enter");
    }
  });
}

function checkShortPay(entry, allEntries) {
  if (!entry || !allEntries?.length) return false;
  const h = Number(entry.hours), d = Number(entry.earnings ?? entry.dollars ?? 0);
  if (h <= 0 || d <= 0) return false;
  const recent = allEntries.slice(0, 30).filter(e => Number(e.hours) > 0 && Number(e.earnings ?? e.dollars ?? 0) > 0);
  if (recent.length < 4) return false;
  const avg = recent.reduce((s, e) => s + Number(e.earnings ?? e.dollars ?? 0) / Number(e.hours), 0) / recent.length;
  return (d / h) < avg * 0.62;
}

function initPullToRefresh() {
  if (window.__ptrWired) return;
  window.__ptrWired = true;
  let bar = document.getElementById("ptrBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ptrBar";
    bar.innerHTML = '<div id="ptrDot"></div><span id="ptrLabel">Pull to refresh</span>';
    const hero = document.querySelector(".heroSection");
    if (hero) hero.insertAdjacentElement("beforebegin", bar);
    else document.body.prepend(bar);
  }
  const label = document.getElementById("ptrLabel");
  const dot = () => document.getElementById("ptrDot");
  const TRIGGER = 60, MAX_H = 92, SETTLE_H = 40;
  let startY = 0, tracking = false, pulling = false, armed = false;

  document.addEventListener("touchstart", e => {
    tracking = window.scrollY === 0;
    startY = tracking ? e.touches[0].clientY : 0;
    armed = false;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!tracking || window.scrollY > 0) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return;
    if (!pulling) { pulling = true; bar.classList.add("pulling"); }
    // Rubber-band: the bar follows the finger at roughly half speed and
    // caps out, so it never feels like it's stretching forever.
    bar.style.height = Math.min(MAX_H, dy * 0.55) + "px";
    const nowArmed = dy > TRIGGER;
    if (nowArmed !== armed) {
      armed = nowArmed;
      bar.classList.toggle("armed", armed);
      if (label) label.textContent = armed ? "Release to refresh" : "Pull to refresh";
      if (armed) haptic("selection");
    }
  }, { passive: true });

  document.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    bar.classList.remove("pulling");
    if (!armed) { bar.style.height = "0px"; return; }
    armed = false;
    bar.classList.remove("armed");
    bar.style.height = SETTLE_H + "px";
    if (label) label.textContent = "Refreshing…";
    dot()?.classList.add("spin");
    try { await safeLoadEntries(); } catch {}
    dot()?.classList.remove("spin");
    if (label) label.textContent = "Updated";
    bar.classList.add("done");
    haptic("success");
    setTimeout(() => {
      bar.classList.remove("done");
      bar.style.height = "0px";
      if (label) label.textContent = "Pull to refresh";
    }, 550);
  });
}

async function repeatLastEntry() {
  const entries = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  const last = entries[0];
  if (!last) { toast("No previous entry."); return; }
  const typeEl = document.getElementById("typeText");
  const rateEl = document.querySelector('input[name="rate"]');
  if (typeEl) { typeEl.value = last.type || last.typeText || ""; typeEl.dispatchEvent(new Event("input", { bubbles: true })); }
  if (rateEl) { rateEl.value = last.rate != null ? String(last.rate) : String(getDefaultRate()); rateEl.dispatchEvent(new Event("input", { bubbles: true })); }
  updateEarningsPreview();
  toast("Last job loaded — update hours and save.");
}

async function deleteSelectedEntries() {
  const selected = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []).filter(e => e.selected);
  if (!selected.length) { toast("No entries selected."); return; }
  const word = selected.length === 1 ? "entry" : "entries";
  const ok = await showActionSheet({
    title: `Delete ${selected.length} ${word}?`,
    message: "This cannot be undone.",
    confirmLabel: `Delete ${selected.length}`,
    danger: true,
  });
  if (!ok) return;
  let failed = 0;
  for (const e of selected) {
    try { await onDeleteClicked(null, e.id, { skipConfirm: true }); } catch { failed++; }
  }
  if (failed > 0) toast(`${failed} entr${failed === 1 ? "y" : "ies"} failed to delete — try again`);
  await safeLoadEntries();
}

window.__FR = window.__FR || {};
window.__FR.updateEarningsPreview = updateEarningsPreview;
window.syncOfflineDot = syncOfflineDot;
window.__FR.repeatLastEntry = repeatLastEntry;
window.__FR.deleteSelectedEntries = deleteSelectedEntries;
window.__FR.checkDuplicates = checkDuplicates;
window.__FR.bulkEditRate = bulkEditRate;


async function saveEntry(entry, options = {}) {
  const preserveType = !!options.preserveType;
  const preservedType = String(options.preservedType || "").trim();
  const payload = normalizeEntryForApi(entry);
  const photoFile = getSelectedPhotoFile();
  const empId = getEmpId();
  const client = empId ? sb() : null;
  const uid = client ? await requireUserId(client) : null;

  // SAVE LOG FIRST
  let saved;
  let photoStatus = "none";
  let photo_path = null;

  if (EDITING_ID) {
    const { photo_path: _ignored, ...patch } = payload;
    if (photoFile) toast("Uploading photo...");
    patch.updated_at = new Date().toISOString();
    saved = await withTimeout(saveEditedLog(EDITING_ID, patch), 20000, "Save timed out — please try again");
    photo_path = saved?.photo_path || null;
    if (photoFile) photoStatus = "ok";
  } else {
    try {
      saved = await withTimeout(apiCreateLog(payload, entry), 20000, "Save timed out — please try again");
    } catch (err) {
      const isTimeout = String(err?.message || "").startsWith("Save timed out");
      const errMsg = String(err?.message || "");
      const isNetworkErr = !navigator.onLine
        || errMsg === "Failed to fetch"
        || err?.name === "TypeError"
        || err?.name === "NetworkError"
        || errMsg.includes("network")
        || errMsg.includes("fetch");
      // Auth errors (not signed in) → save locally and queue for later sync
      const isAuthErr = errMsg === "Sign in required"
        || errMsg.toLowerCase().includes("sign in")
        || errMsg.toLowerCase().includes("jwt")
        || errMsg.toLowerCase().includes("unauthorized")
        || errMsg.toLowerCase().includes("not authenticated");
      if (isTimeout || isNetworkErr || isAuthErr) {
        const localEntry = { ...entry, _pending: true };
        CURRENT_ENTRIES = syncStateEntries([localEntry, ...(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])]);
        queuePendingEntry(entry, payload);
        setEditingEntry(null);
        const msg = isAuthErr
          ? "Saved locally — sign in to back up to cloud"
          : isTimeout
          ? "Connection slow — saved locally, will sync"
          : "Saved offline — syncs when back online";
        toast(msg);
        handleClear(null, { preserveType: options.preserveType, typeValue: options.preservedType });
        return;
      }
      throw err;
    }
    photo_path = saved?.photo_path || payload.photo_path || null;
    if (photoFile) {
      toast("Uploading photo...");
      try {
        const uploaded = await uploadProofPhoto({
          sb: client,
          empId,
          logId: saved.id,
          file: photoFile,
          roNumber: payload.ro_number || null,
        });
        const newPath = uploaded?.path || null;
        setPhotoUploadTarget(newPath);
        photo_path = newPath;
        photoStatus = "ok";
        // Fire-and-forget: scan photo in background, patch RO/VIN if found
        autoScanPhotoAndPatch?.(photoFile, saved.id, payload.ro_number, entry.vin8)?.catch(e => console.warn("[OCR]", e?.message || e));
      } catch (err) {
        photoStatus = "fail";
      }
    }
  }

  const shouldUpdatePhotoPath = !photoFile && !!photo_path;
  if (shouldUpdatePhotoPath && empId && uid) {
    const { error } = await client
      .from("work_logs")
      .update({ photo_path })
      .eq("id", saved.id)
      .eq("user_id", uid)
      .eq("employee_number", empId);
    if (error) {
      if (photoFile) photoStatus = "fail";
    }
  }

  // Build optimistic entry with server-assigned ID so the list can update immediately
  // without waiting for the background safeLoadEntries round-trip.
  let _savedEntry = null;
  if (!EDITING_ID && saved?.id) {
    _savedEntry = mapServerLogToEntry({
      id: saved.id,
      work_date: payload.work_date,
      category: payload.category || "work",
      ro_number: payload.ro_number || null,
      description: payload.description || null,
      flat_hours: Number(payload.flat_hours || 0),
      cash_amount: Number(payload.cash_amount || 0),
      location: payload.location || null,
      vin8: payload.vin8 || null,
      photo_path: photo_path || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false,
      is_comeback: !!(document.getElementById("isComeback")?.checked),
      refType: entry.refType || "RO",
    });
  }
  setEditingEntry(null);
  const earningsStr = formatMoney(entry.earnings || 0);
  const isEdit = options.__isEdit;

  // Build "N jobs · $X today" suffix for save toast
  const todayKey2 = todayKeyLocal?.() || new Date().toISOString().slice(0, 10);
  const todayEntries = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
    .filter(e => (e.dayKey || dayKeyFromISO?.(e.createdAt)) === todayKey2);
  const todayJobCount = todayEntries.length + (isEdit ? 0 : 1);
  const todayTotal = todayEntries.reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0)
    + (isEdit ? 0 : (entry.earnings || 0));
  const daySuffix = todayJobCount > 0
    ? ` · ${todayJobCount} job${todayJobCount !== 1 ? "s" : ""} · ${formatMoney(round2(todayTotal))} today`
    : "";

  if (photoStatus === "fail") toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr}${daySuffix} (photo failed)`);
  else if (photoStatus === "ok") toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr}${daySuffix} + Photo`);
  else toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr}${daySuffix}`);

  if (!isEdit) {
    const _empId = getEmpId();
    // Store for repeat-chip
    storeLastJob?.(_empId, entry);
    // Personal records check
    checkPersonalRecords?.(CURRENT_ENTRIES, entry);
    // Combo suggestion (show after tiny delay so save toast is first)
    setTimeout(() => showComboSuggestion?.(entry.type || entry.typeText || "", CURRENT_ENTRIES), 2200);
    // Show repeat chip on next clear
    setTimeout(() => updateRepeatChip?.(), 400);
  }

  handleClear(null, { preserveType, typeValue: preservedType });
  return _savedEntry;
}

async function handleSave(ev) {
  ev?.preventDefault();
  const saveBtn = document.getElementById("saveBtn");
  if (isSaving) return;
  isSaving = true;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  try {
    await ensureSession?.();
    const empId = getEmpId();
    if (!empId) { toast("Employee # required"); return; }

    const isEditing = !!EDITING_ID;
    const baseEntry = isEditing ? (EDITING_ENTRY || {}) : {};

    const refEl = document.getElementById("ref");
    const vinEl = document.getElementById("vin8");
    const typeEl = document.getElementById("typeText");
    const hoursEl = document.getElementById("hours");
    const rateEl = document.querySelector('input[name="rate"]');
    const notesEl = document.querySelector('#notesInline, textarea[name="notes"]');

    const ref = (refEl?.value || "").trim();
    const vin8 = (vinEl?.value || "").trim().toUpperCase();
    const typeName = (typeEl?.value || "").trim();
    const hoursVal = num(hoursEl?.value);
    const rateVal = num(rateEl?.value) || getDefaultRate();
    const notes = (notesEl?.value || "").trim();
    const keepLastWork = shouldKeepLastWork() && !isEditing;

    if (!typeName) { shakeEl(typeEl); toast("Add a job type ↑"); return; }
    if (!hoursVal || hoursVal <= 0) { shakeEl(hoursEl); shakeHourChips(); toast("Pick or enter hours ↑"); return; }
    if (hoursVal > 24) {
      const ok = await showActionSheet({
        title: `${hoursVal} hours?`,
        message: "That's unusually high. Save anyway?",
        confirmLabel: "Save Anyway",
      });
      if (!ok) return;
    }

    // Warn if hours are much higher than the stored average for this job type
    if (typeName && hoursVal > 0 && hoursVal <= 24) {
      const storedT = await findTypeByName?.(cleanEmpId?.(empId), typeName);
      const usualHrs = Number(storedT?.lastHours);
      if (usualHrs > 0 && hoursVal > usualHrs * 2.5) {
        const ratio = (hoursVal / usualHrs).toFixed(1);
        const ok = await showActionSheet({
          title: `${typeName}: ${hoursVal} hrs?`,
          message: `Your usual time for this job is ${usualHrs} hrs — that's ${ratio}× your normal. Double-check before saving.`,
          confirmLabel: "Save Anyway",
        });
        if (!ok) return;
      }
    }

    if (!isEditing) {
      const todayKey = dayKeyFromISO(nowISO());
      const pool = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []).filter(e => e.dayKey === todayKey);

      // Strong block: same RO on same day
      if (ref) {
        const refUp = ref.toUpperCase();
        const hit = pool.find(e => String(e.ref || e.ro || "").trim().toUpperCase() === refUp);
        if (hit) {
          const ok = await showActionSheet({
            title: `Duplicate RO: ${ref}`,
            message: `Already logged today: ${hit.type || hit.typeText || "?"} · ${hit.hours} hrs · ${formatMoney(hit.earnings)}`,
            confirmLabel: "Save Anyway",
            danger: true,
          });
          if (!ok) return;
        }
      }

      // Weak warn: same type + same hours on same day (no RO match)
      if (!ref && typeName && hoursVal > 0) {
        const tLow = typeName.trim().toLowerCase();
        const hRound = round1(hoursVal);
        const hit = pool.find(e =>
          String(e.type || e.typeText || "").trim().toLowerCase() === tLow &&
          round1(e.hours) === hRound
        );
        if (hit) {
          const ok = await showActionSheet({
            title: "Possible Duplicate",
            message: `Same type + hours already logged today: ${hit.type || "?"} · ${hit.hours} hrs · ${formatTimeAgo(hit.updatedAt || hit.createdAt)}`,
            confirmLabel: "Save Anyway",
          });
          if (!ok) return;
        }
      }
    }

    // Use the date picker value when adding a new entry (or if editing without a prior createdAt).
    // The date input gives a local "YYYY-MM-DD" string; we build a noon-local ISO so timezone
    // rounding never shifts it to the wrong day.
    const dateInputEl = document.getElementById("entryDate");
    const dateInputVal = dateInputEl ? dateInputEl.value : "";
    let createdAt, createdAtMs, dayKey;
    if (isEditing && baseEntry.createdAt) {
      createdAt = baseEntry.createdAt;
      createdAtMs = Number.isFinite(baseEntry.createdAtMs) ? baseEntry.createdAtMs : Date.now();
      dayKey = baseEntry.dayKey || dayKeyFromISO(createdAt);
    } else if (dateInputVal) {
      // noon local time on the chosen date keeps us safely inside the chosen calendar day
      const noonLocal = new Date(`${dateInputVal}T12:00:00`);
      createdAt = noonLocal.toISOString();
      createdAtMs = noonLocal.getTime();
      dayKey = dateInputVal; // "YYYY-MM-DD" == dayKey format
    } else {
      createdAt = nowISO();
      createdAtMs = Date.now();
      dayKey = dayKeyFromISO(createdAt);
    }
    const entry = {
      ...baseEntry,
      // IMPORTANT: never generate a new id while editing.
      // If you do, you'll create duplicates and edits won't "stick".
      id: isEditing ? (baseEntry.id ?? EDITING_ID) : uuid(),
      empId,
      createdAt,
      createdAtMs,
      dayKey,
      weekStartKey: baseEntry.weekStartKey || dateKey(startOfWeekLocal(new Date(createdAt))),
      refType: currentRefType,
      ref,
      ro: ref,
      dealer: baseEntry.dealer || null,
      vin8,
      type: typeName,
      typeText: typeName,
      hours: round1(hoursVal),
      rate: round2(rateVal),
      earnings: round2(hoursVal * rateVal),
      notes,
      isComeback: !!(document.getElementById("isComeback")?.checked),
      photoDataUrl: null,
      location: baseEntry.location ?? null
    };

    await upsertTypeDefaults?.(typeName, hoursVal, rateVal);
    if (keepLastWork) rememberLastWorkType(typeName);
    const savedEntry = await saveEntry(entry, {
      preserveType: keepLastWork,
      preservedType: keepLastWork ? typeName : "",
      __isEdit: isEditing,
    });
    haptic("success");
    flashSaveBtn();
    // Optimistic update: show the new entry immediately using the server-returned ID,
    // then resync in the background to pick up any server-side fields we don't have locally.
    if (!isEditing && savedEntry) {
      CURRENT_ENTRIES = syncStateEntries([savedEntry, ...(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])]);
      setCachedEntries(empId, CURRENT_ENTRIES);
    }
    refreshUI(CURRENT_ENTRIES);
    if (!isEditing) animateFirstEntry();
    // Fun save quote toast + rank check (after a brief delay so UI settles)
    if (!isEditing) {
      setTimeout(() => {
        showMilestoneToast(randomSaveQuote());
        checkRankUp(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
      }, 350);
    }
    safeLoadEntries().catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[safeLoad]", e); });
    // Stay on the form after logging a new job. Techs log several in a row, and
    // jumping to the entry list scrolled the form (and the field we then focus)
    // off screen. On an edit, scrolling to the list is useful — it shows the
    // change landed.
    if (isEditing) {
      document.getElementById("entryList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setSelectedPhotoFile(null);
    document.getElementById("photoPicker") && (document.getElementById("photoPicker").value = "");
    document.getElementById("photoCamera") && (document.getElementById("photoCamera").value = "");
    document.getElementById("photoFile") && (document.getElementById("photoFile").value = "");
    // Auto-focus the next field so back-to-back jobs flow without tapping:
    // type was preserved (keepLastWork) → go to hours; type cleared → go to type.
    // Skipped on edits, where we scroll to the list instead and focusing the
    // form would fight that scroll.
    if (!isEditing) {
      requestAnimationFrame(() => {
        const typeEl = document.getElementById("typeText");
        const hoursEl = document.getElementById("hours");
        if (typeEl && !typeEl.value.trim()) {
          typeEl.focus({ preventScroll: true });
        } else if (hoursEl) {
          hoursEl.focus({ preventScroll: true });
        }
      });
    }
  } catch (err) {
    console.error("Save failed", err);
    const errStr = String(err?.message || "") + String(err?.code || "");
    const isAuthErr = /UNSUPPORTED_TOKEN_ALGORITHM|invalid.*token|token.*expired|not_authenticated|unauthorized/i.test(errStr);
    const msg = isAuthErr
      ? "Session expired — sign out and sign back in"
      : /sign in required/i.test(errStr)
        ? "Sign in on More page first"
        : (err?.message || "Save failed");
    if (isAuthErr) {
      try { await sb().auth.signOut(); } catch {}
    }
    toast(msg, 5000);
  } finally {
    isSaving = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = EDITING_ID ? "Update" : "Save";
    }
  }
}

function showHistory(open = true) {
  const p = $("historyPanel");
  if (!p) return;
  p.classList.toggle("open", open);
  p.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) lockBodyScroll(); else unlockBodyScroll();
}

function buildHistEntryRow(e) {
  const refLabel = e.refType === "STOCK" ? "STK" : "RO";
  const refVal   = e.ref || e.ro || "—";
  const hasPhoto = entryHasPhoto(e);
  const vinHtml  = e.vin8 ? `<div class="histEntryVin">VIN: <span class="histEntryVinVal">${escapeHtml(e.vin8)}</span></div>` : "";
  const notesHtml = e.notes ? `<div class="histEntryNotes">${escapeHtml(e.notes)}</div>` : "";

  const row = document.createElement("div");
  row.className = "histEntryRow";
  // Ref number — tappable to view photo when one exists
  const refHtml = hasPhoto
    ? `<span class="histEntryRefNum histEntryRefNum--photo" title="Tap to view photo"><span class="histEntryRefPhotoIcon">📷</span>${refLabel} ${escapeHtml(refVal)}</span>`
    : `<span class="histEntryRefNum">${refLabel} ${escapeHtml(refVal)}</span>`;
  row.innerHTML = `
    <div class="histEntryLeft">
      <div class="histEntryTopLine">
        ${refHtml}
        ${e.isComeback ? `<span class="comebackBadge">CB</span>` : ""}
      </div>
      <div class="histEntryTypeLine">
        ${typeBadgeHtml(e.type || e.typeText || "—")}
      </div>
      ${vinHtml}
      ${notesHtml}
      <div class="histEntryMeta">${escapeHtml(formatTimeAgo(e.updatedAt || e.createdAt))}</div>
      <div class="histEntryActions">
        <button class="iBtn" data-edit-id="${escapeHtml(String(e.id ?? ""))}" ${e.id == null ? "disabled" : ""}>Edit</button>
        <button class="iBtn iBtn--danger" data-del="${e.id}">Delete</button>
      </div>
    </div>
    <div class="histEntryRight">
      <div class="histEntryPay">${formatMoney(e.earnings)}</div>
      <div class="histEntryHrs">${formatHours(e.hours)} hrs</div>
    </div>
  `;

  const editBtn = row.querySelector("[data-edit-id]");
  if (editBtn) editBtn.addEventListener("click", () => { showHistory(false); startEditEntry(e); });
  if (hasPhoto) {
    const refEl = row.querySelector(".histEntryRefNum--photo");
    if (refEl) refEl.addEventListener("click", (ev) => { ev.stopPropagation(); openPhoto(e); });
  }
  return row;
}

async function renderHistory() {
  const empId = getEmpId();
  if (!empId) { toast("Employee # required"); return; }

  const q = ($("historySearchInput")?.value || "").trim();
  const activeRangeBtn = document.querySelector("[data-hist-range].active");
  const range = activeRangeBtn?.dataset.histRange || "today";

  const source = Array.isArray(CURRENT_ENTRIES) && CURRENT_ENTRIES.length
    ? CURRENT_ENTRIES
    : normalizeEntries(Array.isArray(window.STATE?.entries) ? window.STATE.entries : []);

  const all = filterEntriesByEmp(source, empId)
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  let slice = all;
  if (q) {
    // searching always spans all time so you don't miss anything
    slice = all.filter(e => matchSearch(e, q));
  } else if (range === "today") {
    const dk = selectedHistoryDayKey();
    slice = all.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dk);
  } else if (range === "week") {
    const ws = dateKey(startOfWeekLocal(navRefDate()));
    const we = dateKey(endOfWeekLocal(navRefDate()));
    slice = all.filter(e => { const d = e.dayKey || dayKeyFromISO(e.createdAt); return d >= ws && d <= we; });
  } else if (range === "month") {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    slice = all.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)).startsWith(prefix));
  }

  const totals = computeTotals(slice);
  const avgJob = totals.count > 0 ? round2(totals.dollars / totals.count) : 0;

  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const rangeLabel = q ? `"${q}"` : range === "today" ? "Today" : range === "week" ? "This Week" : range === "month" ? "This Month" : "All Time";
  setText("historyMeta", `${slice.length} ${slice.length === 1 ? "entry" : "entries"} · ${rangeLabel}`);
  setText("histSumCount", String(totals.count));
  setText("histSumHours", formatHours(totals.hours));
  setText("histSumDollars", formatMoney(totals.dollars));
  setText("histSumAvg", totals.count > 0 ? formatMoney(avgJob) : "—");

  const box = $("historyList");
  if (!box) return;
  box.innerHTML = "";

  if (!slice.length) {
    box.innerHTML = `<div class="emptyState"><div class="emptyStateTitle">No entries found</div><div class="emptyStateSub">${q ? `No results for "${escapeHtml(q)}"` : "Nothing logged for this period"}</div></div>`;
    return;
  }

  const fmt = (iso) => {
    const d = new Date(iso + "T00:00:00");
    const today = todayKeyLocal();
    const yest = (() => { const x = new Date(); x.setDate(x.getDate() - 1); return dateKey(x); })();
    if (iso === today) return "Today";
    if (iso === yest) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const groups = groupByDay(slice);
  for (const g of groups) {
    const t = computeTotals(g.entries);
    const dayHdr = document.createElement("div");
    dayHdr.className = "histDayHeader";
    dayHdr.innerHTML = `
      <div class="histDayKey">${escapeHtml(fmt(g.dayKey))}</div>
      <div class="histDayTotals">${formatHours(t.hours)} hrs · <span class="histDayPay">${formatMoney(t.dollars)}</span> · ${t.count} job${t.count !== 1 ? "s" : ""}</div>
    `;
    box.appendChild(dayHdr);
    for (const e of g.entries) {
      box.appendChild(buildHistEntryRow(e));
    }
  }
}

// ── Shared photo URL cache ────────────────────────────────────────────────
// Every photo view — thumbnail, the tap-to-enlarge modal, the full gallery
// viewer — used to independently mint a brand-new signed URL (web) or
// re-download the full image through the SDK (native/Capacitor, the actual
// shipped app) on EVERY open, even to reopen a photo just viewed seconds
// ago. That's the real source of "pulling up a photo takes too long": on
// native there's no HTTP cache to fall back on at all, since .download()
// is a fresh programmatic fetch every time, not a cacheable <img src>.
// This cache is shared by every call site via getCachedPhotoUrl() below, so
// a thumbnail that already loaded a photo makes the full-size view (or a
// manager's job-detail drawer, which has its own copy of this pattern in
// team.html) come back instantly instead of re-fetching.
const _photoUrlCache = new Map(); // path -> { url, fetchedAt }
const _PHOTO_CACHE_TTL_MS = 25 * 60 * 1000; // signed URLs last 30 min server-side
const _PHOTO_CACHE_MAX = 60; // cap blob: URL accumulation on a long native session

async function getCachedPhotoUrl(path) {
  if (!path) return null;
  const cached = _photoUrlCache.get(path);
  if (cached && (Date.now() - cached.fetchedAt < _PHOTO_CACHE_TTL_MS)) {
    return cached.url;
  }
  const url = await getPhotoUrl(path);
  if (url) {
    if (_photoUrlCache.size >= _PHOTO_CACHE_MAX) {
      const oldestKey = _photoUrlCache.keys().next().value;
      const oldest = _photoUrlCache.get(oldestKey);
      if (oldest?.url?.startsWith("blob:")) URL.revokeObjectURL(oldest.url);
      _photoUrlCache.delete(oldestKey);
    }
    _photoUrlCache.set(path, { url, fetchedAt: Date.now() });
  }
  return url;
}

let _thumbObs = null;

function loadPhotoThumbs() {
  if (_thumbObs) { _thumbObs.disconnect(); _thumbObs = null; }
  const imgs = document.querySelectorAll('img.entryThumb[data-photo-path]');
  if (!imgs.length) return;

  const load = async (img) => {
    const path = img.getAttribute("data-photo-path");
    if (!path) return;
    if (img.src && _photoUrlCache.has(path)) return; // already showing the cached url
    try {
      const url = await getCachedPhotoUrl(path);
      if (url) {
        img.src = url;
        img.closest(".entryThumbWrap")?.classList.add("loaded");
      }
    } catch {}
  };

  if ("IntersectionObserver" in window) {
    _thumbObs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        _thumbObs.unobserve(entry.target);
        load(entry.target);
      }
    }, { rootMargin: "300px" });
    imgs.forEach(img => _thumbObs.observe(img));
  } else {
    imgs.forEach(load);
  }
}

async function shareDaySummary() {
  const empId = getEmpId();
  if (!empId) { toast("Employee # required"); return; }
  const dk = todayKeyLocal();
  const all = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  const today = all.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dk);
  if (!today.length) { toast("No entries today to share."); return; }

  const totals = computeTotals(today);
  const comebacks = today.filter(e => e.isComeback);
  const d = new Date();
  const dayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const lines = today.map(e => {
    const ref = e.ref || e.ro || "—";
    const type = e.type || e.typeText || "—";
    const cb = e.isComeback ? " ↩️" : "";
    const roPrefix = e.refType === "STOCK" ? "STK" : "RO";
    return `  ${type}${cb}  ·  ${roPrefix} ${ref}  ·  ${formatHours(e.hours)} hrs  ·  ${formatMoney(e.earnings)}`;
  });

  const effRate = totals.hours > 0 ? round2(totals.dollars / totals.hours) : 0;
  const cbCount = comebacks.length;
  const cbLine = cbCount ? `⚠️ ${cbCount} comeback${cbCount > 1 ? "s" : ""}` : "✅ No comebacks";
  const effLine = effRate > 0 ? `⚡ ${formatMoney(effRate)}/hr effective` : "";

  const text = [
    `📋 Flatrate Buddy — ${dayLabel}`,
    `Emp #${empId}`,
    `${"─".repeat(32)}`,
    ...lines,
    `${"─".repeat(32)}`,
    `🕐 ${formatHours(totals.hours)} hrs   💵 ${formatMoney(totals.dollars)}   📦 ${totals.count} job${totals.count !== 1 ? "s" : ""}`,
    ...(effLine ? [effLine] : []),
    cbLine,
  ].join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: `Shift Summary ${dk}`, text });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Summary copied to clipboard.");
  } catch {
    toast("Could not share or copy.");
  }
}

function updateShortPayBadge() {
  const badge = document.getElementById("shortPayBadge");
  if (!badge) return;
  const stubMap = loadPayStubMap?.() || {};
  const entries = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const empId = getEmpId();
  if (!empId) { badge.style.display = "none"; return; }
  const own = filterEntriesByEmp(entries, empId);
  let shortCount = 0;
  for (const stub of Object.values(stubMap)) {
    if (!stub?.weekStartKey || !stub?.amountPaid) continue;
    const ws = parseDateInputValue(stub.weekStartKey);
    if (!ws) continue;
    const we = endOfWeekLocal(ws);
    const loggedPay = round2(own
      .filter(e => e.dayKey && e.dayKey >= stub.weekStartKey && e.dayKey <= dateKey(we))
      .reduce((s, e) => s + Number(e.earnings || 0), 0));
    if (stub.amountPaid < loggedPay - 0.01) shortCount++;
  }
  if (shortCount > 0) {
    badge.textContent = String(shortCount);
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }

  // Surface short-pay alert on main page
  const alert = document.getElementById("shortPayAlert");
  if (alert) {
    if (shortCount > 0) {
      const span = alert.querySelector("span");
      if (span) span.textContent = `⚠️ ${shortCount} week${shortCount > 1 ? "s" : ""} with possible short-pay`;
      alert.removeAttribute("hidden");
      alert.style.display = "flex";
    } else {
      alert.setAttribute("hidden", "");
      alert.style.display = "none";
    }
  }
}

function maybeShowOnboarding() {
  const hasEmp = !!(localStorage.getItem("fr_emp_id") || "").trim();
  const hasDismissed = localStorage.getItem("fr_onboard_done");
  if (hasEmp || hasDismissed) return;

  const modal = document.getElementById("onboardingModal");
  if (!modal) return;
  modal.style.display = "flex";

  document.getElementById("onboardDoneBtn")?.addEventListener("click", () => {
    const empVal = (document.getElementById("onboardEmpId")?.value || "").trim();
    const rateVal = Number(document.getElementById("onboardRate")?.value || 0);
    if (empVal) {
      const empInput = document.getElementById("empId");
      if (empInput) { empInput.value = empVal; empInput.dispatchEvent(new Event("input")); }
      localStorage.setItem("fr_emp_id", empVal);
    }
    if (rateVal > 0) {
      saveSettings({ defaultRate: rateVal });
      // Sync the form's rate input — it was seeded with the old default at
      // boot, so without this the earnings preview keeps showing $15/hr
      // until the next reload.
      const rateInput = document.querySelector('input[name="rate"]');
      if (rateInput) {
        rateInput.value = String(rateVal);
        rateInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      updateEarningsPreview?.();
    }
    localStorage.setItem("fr_onboard_done", "1");
    modal.style.display = "none";
    setTimeout(() => startTour(), 400);
  });
}

function syncOfflineDot() {
  const dot = document.getElementById("offlineDot");
  if (!dot) return;
  const online = navigator.onLine;
  const pending = (getPendingQueue?.() || []).length;
  dot.classList.remove("offlineDot--offline", "offlineDot--pending", "offlineDot--synced");
  if (!online) {
    dot.className = "offlineDot offlineDot--offline";
    dot.title = "Offline — entries saved locally";
    dot.style.display = "";
  } else if (pending > 0) {
    dot.className = "offlineDot offlineDot--pending";
    dot.title = `${pending} entr${pending === 1 ? "y" : "ies"} syncing…`;
    dot.style.display = "";
  } else {
    dot.className = "offlineDot offlineDot--synced";
    dot.title = "All synced";
    dot.style.display = "";
  }
}

// ── Referral share ──────────────────────────────────────────────
async function shareReferral() {
  const url = "https://app.nellylabs.dev";
  const text = `I use Flatrate Buddy at work to log jobs and catch missing pay. Free to start — ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Flatrate Buddy", text, url }); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Referral link copied to clipboard!");
  } catch {
    toast("Share: " + url);
  }
}

// ── Week-over-week earnings chart (inline SVG) ───────────────────
function renderWeekChart(thisWeekDollars, lastWeekDollars) {
  const el = document.getElementById("weekChart");
  if (!el) return;
  const max = Math.max(thisWeekDollars, lastWeekDollars, 1);
  const BAR_H = 72;
  const thisH = Math.max(4, Math.round((thisWeekDollars / max) * BAR_H));
  const lastH = Math.max(4, Math.round((lastWeekDollars / max) * BAR_H));
  const diff = round2(thisWeekDollars - lastWeekDollars);
  const sign = diff > 0 ? "+" : "";
  const diffColor = diff >= 0 ? "#29d9a5" : "#ff6b6b";
  el.innerHTML = `
    <svg viewBox="0 0 160 110" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;display:block;margin:0 auto;">
      <rect x="18" y="${90 - lastH}" width="44" height="${lastH}" rx="5" fill="#1e2f4a"/>
      <rect x="98" y="${90 - thisH}" width="44" height="${thisH}" rx="5" fill="#0095f6"/>
      <text x="40" y="102" text-anchor="middle" font-size="9" fill="#7a8baa">Last Week</text>
      <text x="120" y="102" text-anchor="middle" font-size="9" fill="#7a8baa">This Week</text>
      <text x="40" y="${86 - lastH}" text-anchor="middle" font-size="8" fill="#7a8baa">${formatMoney(lastWeekDollars)}</text>
      <text x="120" y="${86 - thisH}" text-anchor="middle" font-size="8" fill="#0095f6">${formatMoney(thisWeekDollars)}</text>
      <text x="80" y="112" text-anchor="middle" font-size="9" fill="${diffColor}">${sign}${formatMoney(diff)} vs last week</text>
    </svg>`;
}

// ── Email / share week PDF ───────────────────────────────────────
async function shareWeekPDF() {
  const empId = getEmpId();
  if (!empId) { toast("Employee # required"); return; }

  const weekKey = dateKey(startOfWeekLocal(new Date()));
  const entries = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
    .filter(e => String(e.weekStartKey || "") === weekKey || String(e.dayKey || "").startsWith(weekKey));

  if (!entries.length) { toast("No entries this week to export"); return; }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("PDF not ready — refresh and try again"); return; }

  const doc = new jsPDF();
  const left = 20;
  const pageBottom = doc.internal.pageSize.getHeight() - 16;
  let y = 20;
  const nl = (step = 6) => { y += step; if (y > pageBottom) { doc.addPage(); y = 20; } };

  doc.setFontSize(16);
  doc.text("Flatrate Buddy — Weekly Report", left, y);
  nl(8);
  doc.setFontSize(10);
  doc.text(`Employee: ${empId}   Week: ${weekKey}`, left, y);
  nl(8);
  doc.setFontSize(11);
  doc.text(`${"RO / STK".padEnd(16)} ${"Type".padEnd(20)} ${"Hrs".padEnd(6)} Pay`, left, y);
  nl(2);
  doc.line(left, y, 190, y);
  nl(5);

  let totalHours = 0, totalPay = 0;
  for (const e of entries) {
    const ro = String(e.ref || e.ro || e.ro_number || "—").slice(0, 14);
    const type = String(e.type || e.typeText || "—").slice(0, 18);
    const hrs = round1(Number(e.hours || e.flat_hours || 0));
    const pay = round2(Number(e.earnings || e.cash_amount || 0));
    doc.setFontSize(10);
    doc.text(`${ro.padEnd(16)} ${type.padEnd(20)} ${String(hrs).padEnd(6)} $${pay.toFixed(2)}`, left, y);
    nl(6);
    totalHours += hrs;
    totalPay += pay;
  }

  nl(4);
  doc.line(left, y, 190, y);
  nl(6);
  doc.setFontSize(11);
  doc.text(`Total: ${round1(totalHours)} hrs   ${formatMoney(round2(totalPay))}`, left, y);

  const filename = `flat-rate-week-${weekKey}.pdf`;

  // Try Web Share API with file first (works on iOS/Android)
  try {
    const blob = doc.output("blob");
    const file = new File([blob], filename, { type: "application/pdf" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch {}

  // Fallback: download
  doc.save(filename);
  toast("PDF saved!");
}

window.__FR = window.__FR || {};
window.__FR.shareDaySummary = shareDaySummary;
window.__FR.updateShortPayBadge = updateShortPayBadge;
window.__FR.maybeShowOnboarding = maybeShowOnboarding;
window.__FR.maybeStartTour = maybeStartTour;
window.__FR.shareReferral = shareReferral;
window.__FR.shareWeekPDF = shareWeekPDF;
window.__FR.shareWeekCard = shareWeekCard;
window.__FR.requestPushPermission = requestPushPermission;
window.__FR.render8WeekChart = render8WeekChart;
window.__FR.renderComebackStats = renderComebackStats;

let _syncLock = false;
async function flushPendingSync() {
  if (_syncLock) return;
  _syncLock = true;
  try {
    const q = getPendingQueue();
    if (!q.length) return;

    if (!window.CURRENT_UID) { updatePendingBadge(); return; }

    // Drop stale items older than 14 days
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const stale = getPendingQueue().filter(x => x.queuedAt && x.queuedAt < cutoff);
    stale.forEach(x => removePendingById(x.id));
    if (stale.length) toast(`${stale.length} unsynced entr${stale.length === 1 ? "y" : "ies"} from 14+ days ago cleared`);

    let synced = 0;
    let alreadyExists = 0;
    for (const item of [...getPendingQueue()]) {
      item.retries = (item.retries || 0);
      if (item.retries >= 5) { removePendingById(item.id); continue; }
      try {
        await apiCreateLog(item.payload, item.entry);
        removePendingById(item.id);
        synced++;
      } catch (err) {
        const msg = String(err?.message || "");
        if (err?.code === "23505" || err?.status === 409 || msg.includes("duplicate")) {
          removePendingById(item.id);
          alreadyExists++;
          continue;
        }
        if (msg.includes("Sign in required") || msg.includes("sign in")) break;
        if (!navigator.onLine || msg.includes("fetch")) break;
        // Unexpected error — increment retry count and continue
        item.retries++;
        const queue = getPendingQueue().map(x => x.id === item.id ? item : x);
        setPendingQueue(queue);
      }
    }
    if (synced > 0) {
      toast(`${synced} offline entr${synced === 1 ? "y" : "ies"} synced`);
      await safeLoadEntries();
    }
    if (alreadyExists > 0) {
      toast(`${alreadyExists} duplicate${alreadyExists > 1 ? "s" : ""} cleared`);
    }
    updatePendingBadge();
  } finally {
    _syncLock = false;
  }
}

/* -------------------- Types: autocomplete + remembered defaults -------------------- */
const DEFAULT_TYPES = []; // no presets; the app learns from each employee

function cleanEmpId(empId){
  return String(empId ?? "").trim();
}

function normalizeTypeName(name){
  const raw = String(name || "").trim();
  // Merge aliases before storing (normalizeJobType is hoisted — safe to call here)
  return normalizeJobType(raw) || raw;
}

function normalizeTypeLower(name){
  return normalizeTypeName(name).toLowerCase();
}

async function ensureDefaultTypes(){
  const empId = cleanEmpId(getEmpId());
  const types = await loadTypesSorted(empId);
  if (types.length > 0) return;
  const targetEmp = empId || "";
  for (const t of DEFAULT_TYPES) {
    await put(STORES.types, {
      id: uuid(),
      empId: targetEmp,
      name: t.name,
      nameLower: normalizeTypeLower(t.name),
      lastHours: t.lastHours,
      lastRate: t.lastRate,
      updatedAt: nowISO()
    });
  }
}

async function loadTypesSorted(empId){
  const e = String(empId || "").trim();
  const types = (await getAll(STORES.types)).filter(t => String(t.empId || "").trim() === e);
  types.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.name.localeCompare(b.name));
  return types;
}

/* ── Deleted-type blocklist ─────────────────────────────────── */
// Tracks names the user explicitly deleted so syncTypesFromEntries
// doesn't re-add them from historical entries on next data load.
const LS_DELETED_TYPES = "fr_deleted_types_";

function getDeletedTypeNames(empId) {
  try {
    const raw = localStorage.getItem(LS_DELETED_TYPES + empId);
    return new Set(JSON.parse(raw) || []);
  } catch { return new Set(); }
}

function addDeletedTypeNames(empId, nameLowers) {
  if (!nameLowers?.length) return;
  try {
    const existing = getDeletedTypeNames(empId);
    nameLowers.forEach(n => existing.add(n));
    localStorage.setItem(LS_DELETED_TYPES + empId, JSON.stringify([...existing]));
  } catch {}
}

window.getDeletedTypeNames = getDeletedTypeNames;
window.addDeletedTypeNames = addDeletedTypeNames;

async function syncTypesFromEntries(entriesRaw, empIdRaw = getEmpId()) {
  const empId = cleanEmpId(empIdRaw);
  if (!empId) return 0;

  const entries = filterEntriesByEmp(normalizeEntries(entriesRaw), empId)
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  if (!entries.length) return 0;

  const existing = await loadTypesSorted(empId);
  const existingNames = new Set(existing.map((t) => normalizeTypeLower(t.name)));
  const deletedNames = getDeletedTypeNames(empId);
  let added = 0;

  for (const entry of entries) {
    const name = normalizeTypeName(entry.type || entry.typeText);
    const nameLower = normalizeTypeLower(name);
    if (!name || existingNames.has(nameLower) || deletedNames.has(nameLower)) continue;

    const hours = round1(Number(entry.hours ?? entry.flat_hours ?? 0) || 0.5);
    const pay = Number(entry.earnings ?? entry.cash_amount ?? 0);
    const fallbackRate = Number(entry.rate) > 0 ? Number(entry.rate) : getDefaultRate();
    const rate = hours > 0 && Number.isFinite(pay) && pay > 0
      ? round2(pay / hours)
      : round2(fallbackRate);

    await put(STORES.types, {
      id: uuid(),
      empId,
      name,
      nameLower,
      lastHours: hours,
      lastRate: rate,
      updatedAt: entry.updatedAt || entry.createdAt || nowISO(),
    });
    existingNames.add(nameLower);
    added++;
  }

  if (added > 0) {
    await renderTypeDatalist();
    await renderTypesListInMore();
  }

  return added;
}

let _typeRenderTimer = null;
function scheduleTypeRender() {
  clearTimeout(_typeRenderTimer);
  _typeRenderTimer = setTimeout(async () => {
    renderTypeDatalist().catch(() => {});
    renderTypesListInMore().catch(() => {});
    // Keep _savedTypes fresh so renderRecentTypeChips can show stored hours
    try {
      const empId = getEmpId();
      if (empId) _savedTypes = await loadTypesSorted(empId) || [];
    } catch {}
  }, 80);
}

async function renderTypeDatalist(){
  const list = $("typeList");
  const strip = $("typeSuggestStrip");
  const empId = getEmpId();
  const types = await loadTypesSorted(empId);

  if (list) {
    list.innerHTML = "";
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t.name;
      list.appendChild(opt);
    }
  }

  if (strip) {
    const shown = types.slice(0, 14);
    strip.innerHTML = "";
    if (shown.length === 0) {
      strip.innerHTML = `<span class="typeSuggestHint">Type anything — saved types appear here after you log entries</span>`;
      // Don't set hidden — focus handler controls visibility
      return;
    }
    // Don't set hidden here — focus handler controls visibility
    for (const t of shown) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "typeSuggestChip";
      chip.dataset.name = t.name.toLowerCase();
      // Meta line: show hours and use count if available
      const metaParts = [];
      if (t.lastHours) metaParts.push(`${t.lastHours}h`);
      if (t.useCount > 1) metaParts.push(`×${t.useCount}`);
      chip.innerHTML = `<span class="tscName">${escapeHtml(t.name)}</span>${metaParts.length ? `<span class="tscMeta">${metaParts.join(" · ")}</span>` : ""}`;
      const applyChip = (e) => {
        e.preventDefault();
        const typeEl = $("typeText");
        if (!typeEl) return;
        // No-op if already the same value
        if (typeEl.value.toLowerCase() === t.name.toLowerCase()) {
          strip.hidden = true;
          return;
        }
        typeEl.value = t.name;
        typeEl.dispatchEvent(new Event("input", { bubbles: true }));
        typeEl.dispatchEvent(new Event("change", { bubbles: true }));
        strip.hidden = true;
      };
      // pointerdown fires before blur (same as touchstart) but doesn't block
      // the WKWebView gesture pipeline the way passive:false touchstart does.
      chip.addEventListener("pointerdown", applyChip);
      strip.appendChild(chip);
    }
  }
}

async function findTypeByName(empId, name){
  const n = String(name || "").trim().toLowerCase();
  const e = String(empId || "").trim();
  if (!e || !n) return null;

  const types = await getAll(STORES.types);
  return types.find(t =>
    String(t.empId || "").trim() === e &&
    String(t.nameLower || "").trim() === n
  ) || null;
}

async function upsertTypeDefaults(nameRaw, hours, rate){
  const name = String(nameRaw || "").trim();
  if (!name) return;

  const empId = cleanEmpId(getEmpId());
  const nameLower = normalizeTypeLower(name);
  const existing = await findTypeByName(empId, name);
  const existingEmp = existing ? cleanEmpId(existing.empId) : null;
  const isSameEmp = existing && existingEmp === empId;
  const payload = {
    id: isSameEmp ? existing.id : uuid(),
    empId: isSameEmp ? existingEmp : empId,
    name: isSameEmp ? existing.name : name,
    nameLower,
    lastHours: Number(hours),
    lastRate: Number(rate),
    useCount: (existing?.useCount || 0) + 1,
    updatedAt: nowISO()
  };
  await put(STORES.types, payload);
  scheduleTypeRender();
}

async function maybeSaveTypeNameOnly(nameRaw){
  const name = String(nameRaw || "").trim();
  if (!name) return;
  const empId = cleanEmpId(getEmpId());
  const nameLower = normalizeTypeLower(name);
  const existing = await findTypeByName(empId, name);
  if (existing && cleanEmpId(existing.empId) === empId) return;
  await put(STORES.types, {
    id: uuid(),
    empId,
    name,
    nameLower,
    lastHours: 0.5,
    lastRate: 15,
    updatedAt: nowISO()
  });
  scheduleTypeRender();
}

async function saveTypeFromMoreForm(){
  const empId = cleanEmpId(getEmpId());
  if (!empId) { toast("Enter Employee # first."); return; }

  const nameEl = document.getElementById("savedTypeName");
  const hoursEl = document.getElementById("savedTypeHours");
  const rateEl = document.getElementById("savedTypeRate");

  const name = normalizeTypeName(nameEl?.value || "");
  const hours = Number(hoursEl?.value || 0);
  const rate = Number(rateEl?.value || getDefaultRate());

  if (!name) { toast("Type name required."); return; }
  if (!Number.isFinite(hours) || hours < 0) { toast("Default hours must be ≥ 0."); return; }
  if (!Number.isFinite(rate) || rate < 0) { toast("Rate must be ≥ 0."); return; }

  const existing = await findTypeByName(empId, name);
  await upsertTypeDefaults(name, hours, rate);

  if (nameEl) nameEl.value = "";
  if (hoursEl) hoursEl.value = "0.5";
  if (rateEl) rateEl.value = String(getDefaultRate());

  toast(`${name} ${existing ? "updated" : "added"}`);
  window.initJobTypeBulkDelete?.();
}

async function maybeAutofillFromType(nameRaw){
  const name = String(nameRaw || "").trim();
  if (!name) return;
  const t = await findTypeByName(cleanEmpId(getEmpId()), name);
  if (!t) return;

  const hoursEl = $("hours");
  const rateEl  = document.querySelector('input[name="rate"]');

  if (hoursEl && hoursEl.dataset.touched === "1") return;
  if (rateEl && rateEl.dataset.touched === "1") return;

  if (hoursEl && Number.isFinite(Number(t.lastHours))) hoursEl.value = String(t.lastHours);
  if (rateEl && Number.isFinite(Number(t.lastRate))) rateEl.value = String(t.lastRate);
}

async function renderTypesListInMore(){
  const box = $("savedTypesList");
  if (!box) return;
  const empId = getEmpId();
  const types = await loadTypesSorted(empId);
  box.innerHTML = "";
  if (types.length === 0) {
    box.innerHTML = `<div class="muted small" style="padding:12px 16px;">No saved types yet. Add one above or create them automatically when you log entries.</div>`;
    return;
  }
  // Update count label
  const countEl = document.getElementById("typeListCount");
  if (countEl) countEl.textContent = types.length > 0 ? `${types.length} saved` : "";

  for (const t of types) {
    const div = document.createElement("div");
    div.className = "typeRow";
    div.dataset.id = t.id;
    div.dataset.name = (t.nameLower || t.name || "").toLowerCase();
    const metaParts = [];
    if (t.lastHours) metaParts.push(`${round1(t.lastHours)} hrs`);
    if (t.lastRate) metaParts.push(`${formatMoney(t.lastRate)}/hr`);
    if (t.useCount > 1) metaParts.push(`×${t.useCount} used`);
    div.innerHTML = `
      <div class="typeRowMain">
        <label class="typeCheckWrap" style="display:none;flex-shrink:0;padding-right:4px;">
          <input type="checkbox" class="typeCheck" style="width:20px;height:20px;accent-color:var(--primary);cursor:pointer;" />
        </label>
        <div class="typeRowInfo">
          <div class="typeRowName">${escapeHtml(t.name)}</div>
          <div class="typeRowMeta">${metaParts.join(" · ") || "No defaults set"}</div>
        </div>
        <div class="typeRowActions">
          <button class="typeIconBtn typeEditBtn" type="button" aria-label="Edit ${escapeHtml(t.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="typeIconBtn typeIconBtn--del typeDelBtn" type="button" aria-label="Delete ${escapeHtml(t.name)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
      <div class="typeEditForm" style="display:none;">
        <div class="typeEditFields">
          <label class="typeEditLabel">Default hrs
            <input type="number" class="moreInput typeEditHours" inputmode="decimal" step="0.1" min="0" value="${round1(t.lastHours||0)}" />
          </label>
          <label class="typeEditLabel">Rate $/hr
            <input type="number" class="moreInput typeEditRate" inputmode="decimal" step="0.01" min="0" value="${round2(t.lastRate||0)}" />
          </label>
          <div class="typeEditActions">
            <button class="btn primary typeEditSaveBtn" type="button">Save</button>
            <button class="btn typeEditCancelBtn" type="button">Cancel</button>
          </div>
        </div>
      </div>
    `;

    const editBtn   = div.querySelector(".typeEditBtn");
    const delBtn    = div.querySelector(".typeDelBtn");
    const form      = div.querySelector(".typeEditForm");
    const saveBtn   = div.querySelector(".typeEditSaveBtn");
    const cancelBtn = div.querySelector(".typeEditCancelBtn");

    editBtn.addEventListener("click", () => {
      const open = form.style.display !== "none";
      form.style.display = open ? "none" : "block";
      editBtn.style.opacity = open ? "" : "1";
      editBtn.style.background = open ? "" : "rgba(37,99,235,.12)";
      editBtn.style.borderColor = open ? "" : "rgba(37,99,235,.35)";
      editBtn.style.color = open ? "" : "var(--primary)";
    });
    cancelBtn.addEventListener("click", () => {
      form.style.display = "none";
      editBtn.style.opacity = "";
      editBtn.style.background = "";
      editBtn.style.borderColor = "";
      editBtn.style.color = "";
    });
    saveBtn.addEventListener("click", async () => {
      const hrs  = Number(div.querySelector(".typeEditHours").value || 0);
      const rate = Number(div.querySelector(".typeEditRate").value || 0);
      if (!Number.isFinite(hrs) || hrs < 0) return;
      if (!Number.isFinite(rate) || rate < 0) return;
      await upsertTypeDefaults(t.name, hrs, rate);
      form.style.display = "none";
      editBtn.style.opacity = "";
      editBtn.style.background = "";
      editBtn.style.borderColor = "";
      editBtn.style.color = "";
      div.querySelector(".typeRowMeta").textContent = `${round1(hrs)} hrs · ${formatMoney(rate)}/hr`;
      toast?.(`${t.name} updated`);
    });
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await showActionSheet({ title: `Delete "${t.name}"?`, confirmLabel: "Delete", danger: true });
      if (!ok) return;
      addDeletedTypeNames(getEmpId(), [normalizeTypeLower(t.name)]);
      await del(STORES.types, t.id);
      await renderTypeDatalist();
      await renderTypesListInMore();
      window.initJobTypeBulkDelete?.();
    });

    box.appendChild(div);
  }
}

/* -------------------- Entries / Summary -------------------- */
function computeToday(entries, dayKey){
  const today = entries.filter(e => e.dayKey === dayKey);
  const hours = today.reduce((s, e) => s + Number(e.hours || 0), 0);
  const dollars = today.reduce((s, e) => s + Number(e.earnings || 0), 0);
  return { hours: round1(hours), dollars: round2(dollars), count: today.length };
}

function computeWeek(entries, weekStart){
  const weekEntries = entries.filter(e => inWeek(payDayKeyFor(e), weekStart));
  const hours = weekEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const dollars = weekEntries.reduce((s, e) => s + Number(e.earnings || 0), 0);
  return { hours: round1(hours), dollars: round2(dollars), count: weekEntries.length, entries: weekEntries };
}

function navRefDate() {
  const offset = Number(window.__NAV_OFFSET__ || 0);
  if (!offset) return new Date();
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function selectedHistoryDayKey() {
  const mode = window.__RANGE_MODE__ || rangeMode || "day";
  if (mode === "week" && window.__WEEK_DAY_PICK__) return String(window.__WEEK_DAY_PICK__);
  if (mode === "day") return dateKey(navRefDate());
  return todayKeyLocal();
}

function selectedListWeekRange() {
  const mode = window.__RANGE_MODE__ || rangeMode || "day";
  const anchor = (mode === "day" || mode === "week") ? navRefDate() : new Date();
  return {
    start: dateKey(startOfWeekLocal(anchor)),
    end: dateKey(endOfWeekLocal(anchor)),
  };
}

function filterByMode(entries, mode){
  const now = navRefDate();
  if (mode === "day") {
    const dk = dateKey(now);
    return entries.filter(e => e.dayKey === dk);
  }
  if (mode === "week") {
    const ws = startOfWeekLocal(now);
    return entries.filter(e => inWeek(payDayKeyFor(e), ws));
  }
  if (mode === "month") {
    const ms = startOfMonthLocal(now);
    return entries.filter(e => inMonth(e.dayKey, ms));
  }
  if (mode === "year") {
    const yr = now.getFullYear().toString();
    return entries.filter(e => (e.dayKey || "").startsWith(yr));
  }
  return entries;
}

function computeTotals(entries){
  const hours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const dollars = entries.reduce((s, e) => s + Number(e.earnings || 0), 0);
  const count = entries.length;
  const avgHrs = count ? (hours / count) : 0;
  return {
    hours: round1(hours),
    dollars: round2(dollars),
    count,
    avgHrs
  };
}

function computeWeekComparison(entries, now = new Date()){
  const { thisWeekKey, lastWeekKey } = getThisAndLastWeekKeys(now);

  const thisWeekEntries = filterByWeekStartKey(entries, thisWeekKey);
  const lastWeekEntries = filterByWeekStartKey(entries, lastWeekKey);

  const thisTotals = computeTotals(thisWeekEntries);
  const lastTotals = computeTotals(lastWeekEntries);

  return {
    keys: { thisWeekKey, lastWeekKey },
    entries: { thisWeekEntries, lastWeekEntries },
    totals: { thisTotals, lastTotals },
    diff: {
      hours: round1(thisTotals.hours - lastTotals.hours),
      dollars: round2(thisTotals.dollars - lastTotals.dollars),
      count: thisTotals.count - lastTotals.count,
      avgHrs: round1(thisTotals.avgHrs - lastTotals.avgHrs)
    }
  };
}

function weekStartKeyForDate(d){
  // uses your existing helpers
  return dateKey(startOfWeekLocal(d));
}

function getThisAndLastWeekKeys(now = new Date()){
  const thisStart = startOfWeekLocal(now);
  const lastStart = addDays(thisStart, -7);
  return {
    thisWeekKey: dateKey(thisStart),
    lastWeekKey: dateKey(lastStart)
  };
}

function filterByWeekStartKey(entries, weekStartKey){
  return entries.filter(e => e && e.weekStartKey === weekStartKey);
}

function sumHours(entries) {
  return entries.reduce((acc, e) => acc + (Number(e.hours) || 0), 0);
}

function getWeekStats(allEntries, now = new Date()) {
  const entries = normalizeEntries(allEntries);

  const rThis = weekRangeFor("thisWeek", now);
  const rLast = weekRangeFor("lastWeek", now);

  const thisWeekEntries = entries.filter(e => inRange(e.createdAtMs, rThis.start, rThis.end));
  const lastWeekEntries = entries.filter(e => inRange(e.createdAtMs, rLast.start, rLast.end));

  const thisHours = sumHours(thisWeekEntries);
  const lastHours = sumHours(lastWeekEntries);
  const diff = thisHours - lastHours;

  return {
    ranges: { this: rThis, last: rLast },
    thisWeekEntries,
    lastWeekEntries,
    thisHours,
    lastHours,
    diff,
  };
}

function renderEntriesList(entries) {
  renderList(entries, "all");
}

function renderWeekHeader(allEntries) {
  const stats = getWeekStats(allEntries);

  const mainHours = summaryRange === "thisWeek" ? stats.thisHours : stats.lastHours;
  const otherHours = summaryRange === "thisWeek" ? stats.lastHours : stats.thisHours;
  const diff = stats.thisHours - stats.lastHours; // always this - last

  const paidThis = getPaidHoursForWeekStart(stats.ranges.this.start);
  const payrollDiff = stats.thisHours - paidThis;

  const hoursMain = document.getElementById("hoursMain");
  if (hoursMain) hoursMain.textContent = `${formatHours(mainHours)} hrs`;

  const hoursCompare = document.getElementById("hoursCompare");
  if (hoursCompare) hoursCompare.textContent = `Last Week: ${formatHours(otherHours)} hrs`;

  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const hoursDiff = document.getElementById("hoursDiff");
  if (hoursDiff) hoursDiff.textContent = `Diff: ${sign}${formatHours(Math.abs(diff))} hrs`;

  const paidHours = document.getElementById("paidHours");
  if (paidHours) paidHours.textContent = `Paid: ${formatHours(paidThis)} hrs`;

  const payrollSign = payrollDiff > 0 ? "+" : payrollDiff < 0 ? "−" : "";
  const payrollDiffEl = document.getElementById("payrollDiff");
  if (payrollDiffEl) {
    payrollDiffEl.textContent =
      `Payroll Diff: ${payrollSign}${formatHours(Math.abs(payrollDiff))} hrs`;
  }

  // Also render the list for the selected range
  const list = summaryRange === "thisWeek" ? stats.thisWeekEntries : stats.lastWeekEntries;
  renderEntriesList(list);

  // Optional: show the date range string
  const range = summaryRange === "thisWeek" ? stats.ranges.this : stats.ranges.last;
  const rangeLabel = document.getElementById("rangeLabel");
  if (rangeLabel) {
    rangeLabel.textContent =
      `${range.start.toLocaleDateString()} – ${addDays(range.end, -1).toLocaleDateString()}`;
  }
}

function filterEntriesByEmp(entries, empId, allowAll = false){
  const id = String(empId ?? getEmpId() ?? "").trim();
  if (!id) return allowAll ? (entries || []) : [];
  return (entries || []).filter(e => String(e.empId || "").trim() === id);
}

async function requireAdmin() {
  // Was a hardcoded passcode ("0231") sitting in plain text in the client
  // bundle — visible to anyone who opened DevTools, not a real gate. Now
  // tied to the actual signed-in account via isAdminAccount() (same
  // allowlist used for the Pro bypass), so it's a real identity check
  // instead of a guessable string.
  return typeof isAdminAccount === "function" && isAdminAccount();
}

function rangeSubLabel(mode){
  const now = navRefDate();
  if (mode === "day") return dateKey(now);
  if (mode === "week") {
    const ws = startOfWeekLocal(now);
    const we = endOfWeekLocal(now);
    return `${dateKey(ws)} → ${dateKey(we)}`;
  }
  if (mode === "month") {
    const ms = startOfMonthLocal(now);
    const me = endOfMonthLocal(now);
    return `${dateKey(ms)} → ${dateKey(me)}`;
  }
  const entries = (window.__RANGE_FILTERED__ || window.__RANGE_ENTRIES__ || []);
  if (!entries.length) return "—";
  const keys = entries.map(e => e.dayKey).filter(Boolean).sort();
  return keys.length ? `${keys[0]} → ${keys[keys.length - 1]}` : "—";
}

function toCSV(entries, includeEmp = false){
  const header = includeEmp
    ? ["empId","createdAt","updatedAt","dayKey","refType","ref","vin8","type","hours","rate","earnings","notes","hasPhoto","photoPath"]
    : ["createdAt","updatedAt","dayKey","refType","ref","vin8","type","hours","rate","earnings","notes","hasPhoto","photoPath"];

  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = (entries || []).map(e => {
    const hasPhoto = e.photo_path || e.photoDataUrl ? "yes" : "no";
    const row = includeEmp
      ? [e.empId, e.createdAt, e.updatedAt || e.updated_at || e.createdAt, e.dayKey, e.refType || "RO", e.ref || e.ro || e.stock, e.vin8 || "", e.type, e.hours, e.rate, e.earnings, e.notes, hasPhoto, e.photo_path || ""]
      : [e.createdAt, e.updatedAt || e.updated_at || e.createdAt, e.dayKey, e.refType || "RO", e.ref || e.ro || e.stock, e.vin8 || "", e.type, e.hours, e.rate, e.earnings, e.notes, hasPhoto, e.photo_path || ""];
    return row.map(escape).join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

async function downloadText(filename, text, mime="text/plain"){
  // iOS-friendly: try Share Sheet first
  try{
    const blob = new Blob([text], { type: mime });
    const file = new File([blob], filename, { type: mime });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch {}

  // fallback: normal download
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setEntrySelectedById(id, selected) {
  const key = String(id ?? "").trim();
  if (!key) return;
  const next = !!selected;

  const apply = (rows) => {
    if (!Array.isArray(rows)) return;
    const hit = rows.find((row) => String(row?.id ?? "").trim() === key);
    if (hit) hit.selected = next;
  };

  apply(CURRENT_ENTRIES);
  apply(window.STATE?.entries);
  apply(window.__RANGE_ENTRIES__);
  apply(window.__RANGE_FILTERED__);
  syncSelectionUI();
}

function syncSelectionUI() {
  const selected = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []).filter(e => e.selected);
  const hasSelection = selected.length > 0;
  const listCard = document.getElementById("entryList")?.closest?.(".card");
  listCard?.classList.toggle("has-selection", hasSelection);

  const bulkBar = document.getElementById("bulkBar");
  const bulkCount = document.getElementById("bulkCount");
  if (bulkBar) bulkBar.style.display = hasSelection ? "" : "none";
  if (bulkCount) bulkCount.textContent = `${selected.length} selected`;
}

async function bulkEditRate() {
  const selected = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []).filter(e => e.selected);
  if (!selected.length) return;
  const rateEl = document.getElementById("bulkRateInput");
  const rateVal = parseFloat(rateEl?.value);
  if (!Number.isFinite(rateVal) || rateVal < 0) { toast("Enter a valid rate first."); return; }

  let updated = 0;
  for (const e of selected) {
    try {
      const newEarnings = round2(Number(e.hours) * rateVal);
      await saveEditedLog(e.id, { cash_amount: newEarnings, hourly_rate: rateVal });
      const idx = (window.CURRENT_ENTRIES || []).findIndex(x => String(x.id) === String(e.id));
      if (idx >= 0) {
        window.CURRENT_ENTRIES[idx] = { ...window.CURRENT_ENTRIES[idx], rate: rateVal, earnings: newEarnings, selected: false };
        CURRENT_ENTRIES = window.CURRENT_ENTRIES;
      }
      updated++;
    } catch {}
  }
  if (rateEl) rateEl.value = "";
  toast(`Rate updated on ${updated} entr${updated === 1 ? "y" : "ies"}`);
  await refreshUI(CURRENT_ENTRIES);
}

function renderList(entries, mode){
  const list = $("entryList");
  if (!list) return;
  list.innerHTML = "";
  // Staggered entrance: each row's CSS animation-delay ticks up a little so
  // the list flows in on every render (including pull-to-refresh) instead of
  // popping in all at once. Capped so a long list doesn't feel sluggish.
  let __rowStagger = 0;

  const dayKey = selectedHistoryDayKey();
  const { start: weekStart, end: weekEnd } = selectedListWeekRange();
  const byRange = mode === "today" ? entries.filter(e => e.dayKey === dayKey)
    : mode === "week" ? entries.filter(e => e.dayKey >= weekStart && e.dayKey <= weekEnd)
    : entries;

  const pickedDay = (mode === "week") ? (window.__WEEK_DAY_PICK__ || "") : "";
  const ranged = pickedDay ? byRange.filter(e => e.dayKey === pickedDay) : byRange;

  const searchInput = document.getElementById("searchInput");
  const q = (searchInput?.value || "").trim().toLowerCase();

  const visible = applySearch(ranged, q).slice();
  const isWeekRange = (window.__RANGE_MODE__ || rangeMode) === "week";
  visible.sort((a, b) => {
    const aTs = Date.parse(a.work_date || a.createdAt || "") || 0;
    const bTs = Date.parse(b.work_date || b.createdAt || "") || 0;
    return bTs - aTs;
  });
  const capped = visible.slice(0, mode === "all" ? 500 : 60);

  if (capped.length === 0) {
    list.innerHTML = q
      ? `<div class="emptyWrap"><div class="emptyIcon">🔍</div><div class="emptyTitle">No results for "${escapeHtml(q)}"</div><div class="emptySub">Try a different RO, VIN, or work type</div></div>`
      : `<div class="emptyWrap"><div class="emptyIcon">🛠️</div><div class="emptyTitle">No entries yet</div><div class="emptySub">Pick your hours above and tap Save — your first job will show up here instantly</div></div>`;
    return;
  }

  const hlQ = q.length >= 2 ? q : "";
  const hl = (text) => {
    if (!hlQ) return escapeHtml(text);
    const safe = escapeHtml(text);
    const idx = safe.toLowerCase().indexOf(hlQ);
    if (idx < 0) return safe;
    return safe.slice(0, idx) + `<mark class="srchHl">${safe.slice(idx, idx + hlQ.length)}</mark>` + safe.slice(idx + hlQ.length);
  };

  const buildEntry = (e) => {
    const row = document.createElement("div");
    row.className = (hlQ ? "item" : "item collapsed") + " entryPopIn";
    row.style.animationDelay = (Math.min(__rowStagger++, 10) * 26) + "ms";
    const tc = (e.type || e.typeText || "").toLowerCase().replace(/\s+/g, "");
    const tcMap = { sold: "sold", warranty: "warranty", fpf: "fpf", preowned: "preowned", "pre-owned": "preowned" };
    row.dataset.tc = tcMap[tc] || "default";
    if (checkShortPay(e, entries)) row.dataset.short = "1";
    const refLabel = e.refType === "STOCK" ? "STK" : "RO";
    const refVal = hl(e.ref || e.ro || "—");
    const entryId = escapeHtml(String(e.id ?? ""));
    const hasPhoto = entryHasPhoto(e);
    const photoPath = e.photo_path || e.photoPath || "";

    row.innerHTML = `
      <div class="swipeEditZone swipeZone"><span>✏️</span>Edit</div>
      <div class="swipeDeleteZone swipeZone"><span>🗑</span>Delete</div>
      <div class="itemInner">
        <div class="itemTop">
          <div class="itemLeft">
            <div class="itemHeadline">
              <input type="checkbox" data-select-id="${entryId}" ${e.selected ? "checked" : ""} class="itemCheck" />
              ${typeBadgeHtml(e.type || e.typeText || "—")}
              ${e.isComeback ? `<span class="comebackBadge">CB</span>` : ""}
              ${checkShortPay(e, entries) ? `<span class="shortPayFlag" data-action="review-pay" title="Possible short pay — tap to review">⚠ LOW</span>` : ""}
              <span class="itemRef mono">${refLabel}: ${refVal}</span>
            </div>
            ${buildEntryMetaHtml(e)}
            ${e.notes ? `<div class="itemNotes">${hl(e.notes)}</div>` : ""}
            ${hasPhoto ? `<div class="entryThumbWrap"><img class="entryThumb" decoding="async" data-photo-path="${escapeHtml(photoPath)}" alt="Proof" /></div>` : ""}
          </div>
          <div class="itemRight">
            <div class="itemPay">${formatMoney(e.earnings)}</div>
            <div class="itemHrs">${formatHours(e.hours)} hrs</div>
            <div class="itemChevron"></div>
          </div>
        </div>
        <div class="itemActions">
          <button class="iBtn" data-action="edit">Edit</button>
          <button class="iBtn${e.isComeback ? " iBtn--active" : ""}" data-action="toggle-cb">${e.isComeback ? "CB ✓" : "CB"}</button>
          ${(e.ref || e.ro) ? `<button class="iBtn iBtn--sameRO" data-action="same-ro" title="New job on same RO">+RO</button>` : ""}
          <button class="iBtn" data-action="dispute" title="Ask your manager about this job">🚩 Flag</button>
          <button class="iBtn iBtn--danger" data-del="${e.id}">Delete</button>
          ${hasPhoto ? `<button class="iBtn" data-action="view-photo" data-id="${e.id}">Photo</button>` : ""}
        </div>
      </div>
    `;

    const inner = row.querySelector(".itemInner");

    // ── Collapse toggle ──────────────────────────────────────────
    inner.querySelector(".itemTop")?.addEventListener("click", (ev) => {
      if (ev.target?.closest(".itemCheck") || ev.target?.closest(".itemRef")) return;
      row.classList.toggle("collapsed");
    });

    // ── Tap RO to copy ───────────────────────────────────────────
    inner.querySelector(".itemRef")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const val = e.ref || e.ro || "";
      if (!val) return;
      navigator.clipboard?.writeText(val)
        .then(() => toast(`Copied ${val}`))
        .catch(() => {});
    });

    // ── ⚠ LOW badge → review pay stub ───────────────────────────
    inner.querySelector('[data-action="review-pay"]')?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      window.__FR?.showSpaPage?.("more");
      setTimeout(() => {
        document.querySelector('.moreTab[data-tab="settings"]')?.click();
        const det = document.getElementById("payStubDetails");
        if (det) { det.open = true; det.scrollIntoView({ behavior: "smooth", block: "start" }); }
      }, 300);
    });

    // ── +RO: new job on same RO ──────────────────────────────────
    inner.querySelector('[data-action="same-ro"]')?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handleClear(null, { preserveType: false });
      const refEl  = document.getElementById("ref");
      const typeEl = document.getElementById("typeText");
      if (refEl) {
        refEl.value = e.ref || e.ro || "";
        setRefType?.(e.refType || "RO");
      }
      if (typeEl) typeEl.value = "";
      document.getElementById("hours")?.focus();
      document.querySelector(".fr26Wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast(`RO ${e.ref || e.ro} loaded — add next job`);
    });

    // ── 🚩 Flag: send this exact job to the manager, prefilled ────
    inner.querySelector('[data-action="dispute"]')?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const typeLabel = e.type || e.typeText || "";
      const refLbl = e.refType === "STOCK" ? "STK" : "RO";
      const refVal = e.ref || e.ro || "";
      const subjectParts = [];
      if (refVal) subjectParts.push(`${refLbl} ${refVal}`);
      if (typeLabel) subjectParts.push(typeLabel);
      window.__FR?.openRequestModal?.({
        kind: "short_pay",
        subject: (subjectParts.join(" — ") || "Possible short pay").slice(0, 140),
        ro: refVal,
        date: e.work_date || "",
        hours: e.hours != null ? String(e.hours) : "",
        amount: e.earnings != null ? Number(e.earnings).toFixed(2) : "",
      });
    });

    // ── Action buttons ───────────────────────────────────────────
    inner.querySelector('[data-action="edit"]')?.addEventListener("click", () => startEditEntry(e));
    inner.querySelector('[data-action="toggle-cb"]')?.addEventListener("click", async () => {
      const next = !e.isComeback;
      try {
        await saveEditedLog(e.id, { is_comeback: next });
        const idx = (window.CURRENT_ENTRIES || []).findIndex(x => String(x.id) === String(e.id));
        if (idx >= 0) {
          window.CURRENT_ENTRIES[idx] = { ...window.CURRENT_ENTRIES[idx], isComeback: next, is_comeback: next };
          CURRENT_ENTRIES = window.CURRENT_ENTRIES;
        }
        await refreshUI(CURRENT_ENTRIES);
      } catch (err) { toast("Failed to update entry"); }
    });
    inner.querySelector('input[data-select-id]')?.addEventListener("change", (ev) => {
      setEntrySelectedById(e.id, !!ev.target?.checked);
    });
    if (hasPhoto) {
      inner.querySelector('[data-action="view-photo"]')?.addEventListener("click", () => openPhoto(e));
    }

    // ── Swipe gestures ───────────────────────────────────────────
    let sx = 0, sy = 0, lx = 0, tracking = false, swiping = false, dir = null;

    inner.addEventListener("touchstart", ev => {
      // A touch that starts on a real button/checkbox/link is a tap on that
      // control, full stop — never let the swipe state machine grab it (that
      // was the source of buttons occasionally "not being the one that fired").
      if (ev.target?.closest?.("button, input, .itemActions, .itemRef, .itemCheck, [data-action]")) {
        tracking = false;
        return;
      }
      sx = lx = ev.touches[0].clientX;
      sy = ev.touches[0].clientY;
      tracking = true; swiping = false; dir = null;
    }, { passive: true });

    inner.addEventListener("touchmove", ev => {
      if (!tracking) return;
      lx = ev.touches[0].clientX;
      const dx = lx - sx, dy = ev.touches[0].clientY - sy;
      if (!swiping) {
        // Require a deliberate, clearly-horizontal drag before hijacking the
        // touch as a swipe — a plain tap on a button always has a little
        // finger jitter, and treating that jitter as "swiping" was
        // preventDefault()-ing the tap out from under whatever button it
        // started on.
        if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiping = true; dir = dx < 0 ? "left" : "right";
          row.classList.add("swiping");
        } else if (Math.abs(dy) > 12 || Math.abs(dx) > 16) { tracking = false; return; }
      }
      if (swiping) {
        ev.preventDefault();
        const clamped = dir === "left" ? Math.max(-90, Math.min(0, dx)) : Math.max(0, Math.min(90, dx));
        inner.style.transform = `translateX(${clamped}px)`;
      }
    }, { passive: false });

    const resetSwipe = () => {
      inner.style.transition = "transform 200ms ease";
      inner.style.transform = "translateX(0)";
      row.classList.remove("swiping");
    };

    inner.addEventListener("touchend", () => {
      if (!tracking) return;
      tracking = false;
      const dx = lx - sx;
      if (swiping && dir === "left" && dx < -70) {
        resetSwipe(); onDeleteClicked(null, e.id);
      } else if (swiping && dir === "right" && dx > 70) {
        resetSwipe(); startEditEntry(e);
      } else {
        resetSwipe();
      }
      swiping = false;
    });

    return row;
  };

  // "All" mode: group by week → group by day within each week
  if (mode === "all") {
    const weekMap = new Map();
    for (const e of capped) {
      const dk = e.dayKey || dayKeyFromISO(e.createdAt) || "?";
      const wk = e.weekStartKey || (dk !== "?" ? dateKey(startOfWeekFromDateKey(dk)) : "?");
      if (!weekMap.has(wk)) weekMap.set(wk, new Map());
      const dayMap = weekMap.get(wk);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk).push(e);
    }

    const weekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));
    for (const wk of weekKeys) {
      const dayMap = weekMap.get(wk);
      const allWeekEntries = Array.from(dayMap.values()).flat();
      const wTotals = computeTotals(allWeekEntries);
      const ws2 = parseDateInputValue(wk);
      const we2 = ws2 ? dateKey(endOfWeekLocal(ws2)) : "";

      const whdr = document.createElement("div");
      whdr.className = "weekGroupHdr";
      whdr.innerHTML = `
        <div class="weekGroupRange">${escapeHtml(wk)}${we2 ? ` → ${escapeHtml(we2)}` : ""}</div>
        <div class="weekGroupTotals">${formatHours(wTotals.hours)} hrs · ${formatMoney(wTotals.dollars)} · ${wTotals.count} jobs</div>
      `;
      list.appendChild(whdr);

      const dayKeys = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));
      for (const dk of dayKeys) {
        const dEntries = dayMap.get(dk) || [];
        const dTotals = computeTotals(dEntries);

        const dhdr = document.createElement("div");
        dhdr.className = "dayGroupHeader";
        dhdr.innerHTML = `
          <div class="mono">${escapeHtml(dk)}</div>
          <div class="muted small">${formatHours(dTotals.hours)} hrs · ${formatMoney(dTotals.dollars)}</div>
        `;
        list.appendChild(dhdr);
        for (const e of dEntries) {
          try { list.appendChild(buildEntry(e)); } catch {}
        }
      }
    }
    return;
  }

  // "Today" / week-range mode: group by day if isWeekRange, else flat
  if (isWeekRange) {
    const groups = new Map();
    for (const e of capped) {
      const key = e.dayKey || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const dayKeys = Array.from(groups.keys()).sort((a, b) => (b || "").localeCompare(a || ""));
    for (const key of dayKeys) {
      const bucket = groups.get(key) || [];
      const header = document.createElement("div");
      header.className = "dayGroupHeader";
      header.innerHTML = `
        <div class="mono">${escapeHtml(key || "Unknown")}</div>
        <div class="muted small">${formatDayLabel(key)}</div>
      `;
      list.appendChild(header);
      for (const e of bucket) {
        try { list.appendChild(buildEntry(e)); } catch {}
      }
    }
    return;
  }

  for (const e of capped) {
    try { list.appendChild(buildEntry(e)); } catch {}
  }
}

async function refreshUI(entriesOverride){
  if (!entriesOverride && !window.STATE?.entries?.length) {
    console.warn("refreshUI skipped — no data yet");
    return;
  }

  const allEntries = Array.isArray(entriesOverride)
    ? normalizeEntries(entriesOverride)
    : normalizeEntries(window.STATE.entries);

  const setText = (id, val) => { 
    const el = document.getElementById(id); 
    if (el) el.textContent = val; 
  };

  const empId = getEmpId();

  const entries = filterEntriesByEmp(allEntries, empId);
  entries.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  window.__RANGE_ENTRIES__ = entries;

  const mode = window.__RANGE_MODE__ || rangeMode || "day";
  rangeMode = mode;

  const navNow = navRefDate();
  const dayKey = todayKeyLocal();
  let ws = startOfWeekLocal(navNow);
  let we = endOfWeekLocal(navNow);

  // Show nav arrows only in day and week modes; use visibility so they always reserve space
  const navPrev = document.getElementById("rangeNavPrev");
  const navNext = document.getElementById("rangeNavNext");
  const navOffset = Number(window.__NAV_OFFSET__ || 0);
  const showNav = mode === "day" || mode === "week";
  if (navPrev) { navPrev.style.visibility = showNav ? "" : "hidden"; navPrev.style.display = ""; }
  if (navNext) {
    const atPresent = navOffset >= 0;
    navNext.style.visibility = showNav ? "" : "hidden";
    navNext.style.display = "";
    navNext.disabled = atPresent;
    navNext.style.opacity = atPresent ? "0.3" : "";
  }

  // Week-which row: only show when in week mode AND no nav offset (offset handled by nav buttons)
  const weekWhichRow = document.getElementById("weekWhichRow");
  if (weekWhichRow) weekWhichRow.style.display = (mode === "week" && navOffset === 0) ? "inline-flex" : "none";

  // When nav offset active in week mode, ignore summaryRange for filtering
  const useNavWeek = mode === "week" && navOffset !== 0;

  let filtered = filterByMode(entries, mode);

  let wc = null;
  let shownEntries = filtered;
  let shownTotals = null;
  if (mode === "week" && !useNavWeek) {
    wc = computeWeekComparison(entries, new Date());
    shownEntries = summaryRange === "lastWeek" ? wc.entries.lastWeekEntries : wc.entries.thisWeekEntries;
    shownTotals = summaryRange === "lastWeek" ? wc.totals.lastTotals : wc.totals.thisTotals;
  }

  if (mode === "week") {
    // optional day filter inside week
    const pick = window.__WEEK_DAY_PICK__ || "";
    if (pick) shownEntries = shownEntries.filter(e => e.dayKey === pick);

    // render week breakdown (always uses full week, not the picked day)
    const days = computeWeekBreakdown(entries.filter(e => inWeek(payDayKeyFor(e), ws)), ws);
    renderWeekBreakdown(days);

    // render week-over-week earnings chart
    if (wc) {
      renderWeekChart(wc.totals.thisTotals.dollars, wc.totals.lastTotals.dollars);
      const chartCard = document.getElementById("weekChartCard");
      if (chartCard) chartCard.style.display = "";
    }
  } else {
    // hide week breakdown and chart when not in week mode
    const card = document.getElementById("weekBreakdownCard");
    if (card) card.style.display = "none";
    const chartCard = document.getElementById("weekChartCard");
    if (chartCard) chartCard.style.display = "none";
    window.__WEEK_DAY_PICK__ = ""; // reset when leaving week mode
  }

  const searchInput = document.getElementById("searchInput");
  const q = searchInput?.value || "";
  const searched = applySearch(shownEntries, q);

  window.__RANGE_FILTERED__ = searched; // replace for list + totals
  let totals = computeTotals(searched);
  let diffStr = "";
  if (mode === "week" && wc && shownTotals) {
    totals = shownTotals;
    const diffHrs = wc.diff.hours;
    diffStr = diffHrs > 0 ? `+${diffHrs}` : `${diffHrs}`;
  }

  const r1 = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

  const navOff = Number(window.__NAV_OFFSET__ || 0);
  const mo = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const moLabel = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const title =
    mode === "day"   ? (navOff === 0 ? "Today" : mo(navNow)) :
    mode === "week"  ? (navOff === 0 ? "This Week" : `Week of ${dateKey(ws)}`) :
    mode === "month" ? moLabel(navNow) :
    mode === "year"  ? String(navNow.getFullYear()) : "All Time";

  setText("rangeTitle", title);
  setText("rangeHours", r1(totals.hours));
  setText("rangeDollars", formatMoney(totals.dollars));
  setText("rangeCount", String(totals.count));
  setText("rangeAvgHrs", r1(totals.avgHrs));
  setText("rangeEffRate", totals.hours > 0 ? formatMoney(round2(totals.dollars / totals.hours)) : "—");
  setText("rangeSub", rangeSubLabel(mode));
  setText("statsSummaryHours", `${r1(totals.hours)} hrs`);
  setText("statsSummaryDollars", formatMoney(totals.dollars));

  // ── Unified chart card stats ──
  {
    const hcAvg = totals.count > 0 ? formatMoney(round2(totals.dollars / totals.count)) : "—";
    setText("hcsHours", r1(totals.hours));
    setText("hcsJobs", String(totals.count));
    setText("hcsPay", formatMoney(totals.dollars));
    setText("hcsAvg", hcAvg);
    setText("hcRangeLabel", title);
    // Sync tab active state
    document.querySelectorAll("[data-hc-range]").forEach(t =>
      t.classList.toggle("hcTab--active", t.getAttribute("data-hc-range") === mode)
    );
    // Nav buttons: show in day and week mode
    const showNav = mode === "day" || mode === "week";
    const navPrevEl = document.getElementById("rangeNavPrev");
    const navNextEl = document.getElementById("rangeNavNext");
    if (navPrevEl) navPrevEl.style.display = showNav ? "" : "none";
    if (navNextEl) {
      navNextEl.style.display = showNav ? "" : "none";
      navNextEl.disabled = navOff >= 0;
      navNextEl.style.opacity = navOff >= 0 ? "0.3" : "";
    }
    // Render entries list for current range
    renderRangeEntries(searched.length > 0 ? searched : shownEntries, mode);
  }

  // Today
  const today = computeToday(entries, dayKey);
  setText("todayHours", round1(today.hours));
  setText("todayDollars", formatMoney(today.dollars));
  setText("todayCount", String(today.count));
  setText("stripTodayHours", r1(today.hours));
  setText("stripTodayCount", String(today.count));
  setText("stripTodayDollars", formatMoney(today.dollars));
  updateHeaderTodayTotal(today.dollars);

  // Week
  const week = computeWeek(entries, ws);
  // Hero chart (needs week data, render early)
  renderHeroChart(entries, ws);

  // ── Month vs last month comparison ─────────────────────────────────────
  if (mode === "month") {
    const navNow2 = navRefDate();
    const thisMonStart = startOfMonthLocal(navNow2);
    const thisMonEnd   = endOfMonthLocal(navNow2);
    const prevMonStart = new Date(thisMonStart.getFullYear(), thisMonStart.getMonth() - 1, 1);
    const prevMonEnd   = endOfMonthLocal(prevMonStart);
    const thisMon = entries
      .filter(e => e.dayKey >= dateKey(thisMonStart) && e.dayKey <= dateKey(thisMonEnd))
      .reduce((s, e) => s + (Number(e.earnings || 0)), 0);
    const prevMon = entries
      .filter(e => e.dayKey >= dateKey(prevMonStart) && e.dayKey <= dateKey(prevMonEnd))
      .reduce((s, e) => s + (Number(e.earnings || 0)), 0);
    const paceEl2 = document.getElementById("heroPaceLine");
    if (paceEl2) {
      if (prevMon > 0) {
        const diff = round2(thisMon - prevMon);
        const sign = diff >= 0 ? "+" : "";
        const arrow = diff >= 0 ? "↑" : "↓";
        paceEl2.textContent = `vs last month: ${sign}${formatMoney(diff)} ${arrow}`;
        paceEl2.style.display = "";
      } else if (thisMon > 0) {
        paceEl2.textContent = `${formatMoney(thisMon)} this month`;
        paceEl2.style.display = "";
      } else {
        paceEl2.style.display = "none";
      }
    }
  }

  setText("weekHours", round1(week.hours));
  setText("weekDollars", formatMoney(week.dollars));
  setText("stripWeekDollars", formatMoney(week.dollars));
  setText("weekRange", `${dateKey(ws)} → ${dateKey(we)}`);
  if (diffStr) setText("weekDelta", `Diff: ${diffStr} hrs`);

  const flag = await getThisWeekFlag();
  const flagged = flag ? Number(flag.flaggedHours || 0) : 0;
  let delta = null; // ALWAYS defined

  if (!flagged || flagged <= 0) {
    setText("weekDelta", "—");
    setText("weekDeltaHint", "Set flagged hours in More");
  } else {
    delta = round1(flagged - week.hours);
    setText("weekDelta", String(delta));
    setText("weekDeltaHint", "");
  }

  // Hero section update (needs flaggedHours + week data)
  {
    const daysWorked = new Set(entries.filter(e => inWeek(payDayKeyFor(e), ws)).map(e => e.dayKey).filter(Boolean)).size;
    updateHeroSection(today.dollars, week.hours, flagged, today.count, daysWorked, week.dollars, entries);
  }

  // Pace projection + daily avg/job
  const paceEl = document.getElementById("paceLine");
  if (paceEl) {
    const daysWorked = new Set(entries.filter(e => inWeek(payDayKeyFor(e), ws)).map(e => e.dayKey).filter(Boolean)).size;
    const avgJobToday = today.count > 0 ? `Avg/job: ${formatMoney(round2(today.dollars / today.count))}` : "";
    if (daysWorked > 0 && week.dollars > 0) {
      const proj = round2((week.dollars / daysWorked) * 5);
      paceEl.textContent = `On pace for ${formatMoney(proj)} this week${avgJobToday ? ` · ${avgJobToday}` : ""}`;
      paceEl.style.display = "";
    } else if (avgJobToday) {
      paceEl.textContent = avgJobToday;
      paceEl.style.display = "";
    } else {
      paceEl.style.display = "none";
    }
  }

  // Comeback count for today
  const todayComebacks = entries.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dayKey && e.isComeback).length;
  const cbHint = document.getElementById("stripComebackHint");
  if (cbHint) {
    cbHint.style.display = todayComebacks > 0 ? "" : "none";
    cbHint.textContent = `${todayComebacks} comeback${todayComebacks !== 1 ? "s" : ""}`;
  }

  // More panel input value
  const fh = document.getElementById("flaggedHours");
  if (fh && flag) fh.value = String(flagged);

  await refreshPayrollUI();

  const fs = document.getElementById("filterSelect");
  const listFilter = fs ? fs.value : "today";
  const listMode = listFilter === "today" ? "today" : listFilter === "week" ? "week" : "all";

  const status = document.getElementById("filterStatus");
  if (status) {
    const rangeLabel = title;
    const qtxt = q.trim() ? ` • Search: "${q.trim()}"` : "";
    status.textContent = `Showing: ${rangeLabel}${qtxt} • ${searched.length} entries`;
  }

  const hasWeekHeader =
    !!document.getElementById("hoursMain") ||
    !!document.getElementById("hoursCompare") ||
    !!document.getElementById("hoursDiff") ||
    !!document.getElementById("rangeLabel");
  if (hasWeekHeader) renderWeekHeader(entries);
  else renderList(entries, listMode);

  syncSelectionUI();
  loadPhotoThumbs();

  // More page extras (no-op if elements don't exist on main page)
  render8WeekChart(allEntries);
  renderComebackStats(allEntries);
  renderLostTimeCard();

  // stash last week calc for export (delta always set)
  window.__WEEK_STATE__ = { ws, we, week, flagged, delta };
}

/* -------------------- Onboarding tour -------------------- */

const TOUR_STEPS = [
  {
    el: null,
    title: "Hey, I'm FR Buddy! 👋",
    body: "I'll be your guide on the shop floor. I'm here to help you log every job, track your flat hours, and make sure you never miss a dollar. Let me show you around!",
  },
  {
    el: "#clockInBtn",
    title: "Clock In & Out",
    body: "Hit Clock In when your shift starts — I'll track how long you're on the clock. Clock Out at the end, and I'll show your efficiency: flat hours earned vs. time clocked. Short pay loves hiding in that gap.",
  },
  {
    el: ".heroGoalRingWrap",
    title: "Your Weekly Goal Ring",
    body: "Tap the ring to set a weekly target — hours or pay. Watch it fill up as you grind through the week. Tap again any time to raise the bar.",
  },
  {
    el: ".heroAmt",
    title: "Today's Pay",
    body: "This is your money, right now — based on flat hours logged today and your rate. It updates the second you save a job, so you always know where you stand.",
  },
  {
    el: ".heroChartCard",
    title: "Week at a Glance",
    body: "Each bar is a day this week. Tap any bar to dig into that day's jobs, hours, and pay. Switch between Day / Week / Month / Year with the tabs above.",
  },
  {
    el: ".fr26QuickHours",
    title: "Smart Hour Chips",
    body: "These chips are your most-used flat hour values — tap one to fill the hours field instantly. The more you log, the smarter they get. No typing needed.",
  },
  {
    el: "#typeText",
    title: "What'd You Work On?",
    body: "Type the job here. Suggestions pop up as you type based on your history — tap one to fill it in. I learn your most common jobs and surface them first.",
  },
  {
    el: "#repeatLastBtn",
    title: "Repeat Last Job",
    body: "Back-to-back same job? Tap Repeat Last to pre-fill the same type and hours. One tap and you're done.",
  },
  {
    el: "#ref",
    title: "RO / STK Number",
    body: "Drop the repair order or stock number here. Optional, but when pay day doesn't match up, having the RO number is everything.",
  },
  {
    el: ".fr26QuickTools",
    title: "Add Details",
    body: "Tap Add Details to unlock extra fields — VIN, a custom rate override, notes, and a comeback flag. Fill these in on any job you'd want receipts for.",
    action: "open-details",
  },
  {
    el: "#vin8",
    title: "VIN & Rate Override",
    body: "Last 8 of the VIN ties the job to a specific vehicle. Rate Override lets you log jobs that pay differently than your base rate. Comeback flag marks return visits.",
  },
  {
    el: null,
    title: "Scan an RO 📷",
    body: "Tap the camera icon to scan a repair order or Get Ready sheet. I'll pull the RO number, VIN, STK, and job list automatically — and highlight the job most likely for your role.",
  },
  {
    el: "#saveBtn",
    title: "Save & Log It",
    body: "Hit Save and the job is locked in instantly — even offline. It queues on your device and syncs to the cloud the moment you're back online. Nothing gets lost.",
  },
  {
    el: '.tabItem[data-spa-page="stats"]',
    title: "Stats → Your Breakdown",
    body: "Tap Stats to see exactly how your hours and pay split across every job type — PDI, Pre-Owned, Sold, Re-Clean, and more. Filter by today, this week, pay period, or any custom range. Scroll down to the Job Scorecard to see which job types actually pay best.",
  },
  {
    el: '.tabItem[data-spa-page="more"]',
    title: "One More Thing →",
    body: "Swing over to More — that's where your Job Types library, full History, Owe Me tracker, and Settings live. Let's go there now.",
    action: "goto-more",
  },
  {
    el: "#vinSearchInput",
    title: "Search Your Full History",
    body: "Type a job name, RO number, VIN, or date — your full log filters in real time. Great for pulling up a specific car or disputing a flagged job.",
  },
  {
    el: ".hcEntriesList",
    title: "Tap & Swipe",
    body: "Tap any entry to edit it — the form scrolls up pre-filled. Swipe left to reveal Delete. That's the whole app. Go get paid. 🛠️",
  },
  {
    el: null,
    title: "Add Me to Your Home Screen 📱",
    body: "Last thing — install Flatrate Buddy so it opens like a real app, works offline, and stays on your home screen. Tap the install banner or use your browser's 'Add to Home Screen' option.",
    last: true,
  },
];

// ── Goal Setter (tap hero ring) ──────────────────────────
(function initGoalSetter() {
  const ringWrap  = document.querySelector(".heroGoalRingWrap");
  const popover   = document.getElementById("goalPopover");
  if (!ringWrap || !popover) return;

  const LS_TYPE = "fr_goal_type";
  const LS_VAL  = "fr_goal_value";

  function getGoalType()  { return localStorage.getItem(LS_TYPE) || "hours"; }
  function getGoalValue() { return Number(localStorage.getItem(LS_VAL) || 0); }

  function syncTypeUI() {
    const t = getGoalType();
    document.getElementById("goalTypeHours")?.classList.toggle("active", t === "hours");
    document.getElementById("goalTypePay")?.classList.toggle("active", t === "pay");
    const hint = document.getElementById("goalPopoverHint");
    if (hint) hint.textContent = t === "pay" ? "Target pay per week (e.g. 1500)" : "Target hours per week (e.g. 40)";
    const input = document.getElementById("goalValueInput");
    if (input) input.placeholder = t === "pay" ? "1500" : "40";
  }

  function openPopover() {
    const input = document.getElementById("goalValueInput");
    if (input) { input.value = getGoalValue() || ""; }
    syncTypeUI();
    popover.style.display = "flex";
    requestAnimationFrame(() => document.getElementById("goalValueInput")?.focus());
  }

  function closePopover() { popover.style.display = "none"; }

  ringWrap.addEventListener("click", openPopover);

  document.getElementById("goalTypeHours")?.addEventListener("click", () => {
    localStorage.setItem(LS_TYPE, "hours");
    syncTypeUI();
  });
  document.getElementById("goalTypePay")?.addEventListener("click", () => {
    localStorage.setItem(LS_TYPE, "pay");
    syncTypeUI();
  });

  document.getElementById("goalSaveBtn")?.addEventListener("click", () => {
    const val = Number(document.getElementById("goalValueInput")?.value || 0);
    if (val <= 0) { toast("Enter a goal greater than 0"); return; }
    localStorage.setItem(LS_VAL, String(val));
    const type = getGoalType();
    if (type === "hours") {
      // Also persist as flaggedHours for backward compat
      const fhEl = document.getElementById("flaggedHours");
      if (fhEl) { fhEl.value = String(val); fhEl.dispatchEvent(new Event("change")); }
      saveSettings?.({ flaggedHours: val });
    }
    toast(`Goal set: ${type === "pay" ? formatMoney(val) : val + "h"} / week`);
    closePopover();
    refreshUI(CURRENT_ENTRIES);
  });

  document.getElementById("goalCancelBtn")?.addEventListener("click", closePopover);
  popover.addEventListener("click", e => { if (e.target === popover) closePopover(); });
})();

// ── Best records ─────────────────────────────────────────
function computeBestRecords(entries) {
  if (!entries?.length) return null;
  const byDay = new Map();
  const byWeek = new Map();
  for (const e of entries) {
    const dk = e.dayKey || dayKeyFromISO(e.createdAt);
    const wk = e.weekStartKey || "";
    if (dk) {
      const d = byDay.get(dk) || { dollars: 0, hours: 0 };
      d.dollars += Number(e.earnings || 0);
      d.hours   += Number(e.hours || 0);
      byDay.set(dk, d);
    }
    if (wk) {
      const w = byWeek.get(wk) || { dollars: 0, hours: 0 };
      w.dollars += Number(e.earnings || 0);
      w.hours   += Number(e.hours || 0);
      byWeek.set(wk, w);
    }
  }
  let bestDay = null, bestWeek = null;
  for (const [dk, d] of byDay) if (!bestDay || d.dollars > bestDay.dollars) bestDay = { dk, ...d };
  for (const [wk, w] of byWeek) if (!bestWeek || w.dollars > bestWeek.dollars) bestWeek = { wk, ...w };
  return { bestDay, bestWeek };
}

function updateHeroRecords(allEntries) {
  const el = document.getElementById("heroRecords");
  if (!el) return;
  const empId = getEmpId();
  if (!empId) { el.style.display = "none"; return; }
  const own = filterEntriesByEmp(normalizeEntries(allEntries), empId);
  const records = computeBestRecords(own);
  const parts = [];
  if (records?.bestDay?.dollars > 0) parts.push(`🏆 Best day ${formatMoney(round2(records.bestDay.dollars))}`);
  if (records?.bestWeek?.dollars > 0) parts.push(`📅 Best week ${formatMoney(round2(records.bestWeek.dollars))}`);
  if (parts.length) {
    el.textContent = parts.join("  ·  ");
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

// ── Share Week card (Canvas → PNG) ───────────────────────
async function shareWeekCard() {
  const empId = getEmpId();
  if (!empId) { toast("Employee # required"); return; }

  const now = new Date();
  const ws  = startOfWeekLocal(now);
  const we  = endOfWeekLocal(now);
  const wk  = dateKey(ws);

  const all = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  const entries = all.filter(e => {
    const dk = e.dayKey || dayKeyFromISO(e.createdAt);
    return dk >= wk && dk <= dateKey(we);
  });

  const totals = computeTotals(entries);
  const comebacks = entries.filter(e => e.isComeback).length;

  const W = 560, H = 310;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  ctx.scale(2, 2);

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d1f14");
  bg.addColorStop(1, "#07070f");
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, W, H, 18);
  else ctx.rect(0, 0, W, H);
  ctx.fill();

  // Green top bar
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, "#2563EB");
  bar.addColorStop(1, "#1d4ed8");
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, W, 3);

  // Header
  ctx.fillStyle = "rgba(37,99,235,.9)";
  ctx.font = "bold 13px -apple-system,system-ui,sans-serif";
  ctx.fillText("FLAT-RATE TRACKER", 24, 30);

  ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.font = "12px -apple-system,system-ui,sans-serif";
  const dateLabel = `${ws.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${we.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;
  ctx.fillText(dateLabel, 24, 48);

  // Big earnings number
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 54px -apple-system,system-ui,sans-serif`;
  ctx.fillText(formatMoney(totals.dollars), 22, 112);

  // Stats row
  const stats = [
    { v: String(round1(totals.hours)), l: "hrs" },
    { v: String(totals.count), l: "jobs" },
    { v: totals.count > 0 ? formatMoney(round2(totals.dollars / totals.count)) : "—", l: "avg/job" },
    ...(comebacks > 0 ? [{ v: String(comebacks), l: "comebacks" }] : []),
  ];
  let sx = 24;
  for (const s of stats) {
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = `bold 17px -apple-system,system-ui,sans-serif`;
    ctx.fillText(s.v, sx, 148);
    ctx.fillStyle = "rgba(255,255,255,.38)";
    ctx.font = `11px -apple-system,system-ui,sans-serif`;
    ctx.fillText(s.l, sx, 163);
    sx += 110;
  }

  // Mini day bars
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const barData = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws); d.setDate(d.getDate() + i);
    const dk = dateKey(d);
    const dayEntries = entries.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dk);
    barData.push({ label: days[d.getDay()], dollars: dayEntries.reduce((s, e) => s + Number(e.earnings || 0), 0) });
  }
  const maxBar = Math.max(...barData.map(b => b.dollars), 1);
  const bH = 65, bW = 52, bGap = (W - 48 - 7 * bW) / 6;
  barData.forEach((b, i) => {
    const x = 24 + i * (bW + bGap);
    const h = Math.max(3, (b.dollars / maxBar) * bH);
    const y = 175 + bH - h;
    ctx.fillStyle = b.dollars > 0 ? "rgba(37,99,235,.7)" : "rgba(255,255,255,.08)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bW, h, 4);
    else ctx.rect(x, y, bW, h);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.38)";
    ctx.font = "10px -apple-system,system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(b.label, x + bW / 2, 254);
  });
  ctx.textAlign = "left";

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.font = "10px -apple-system,system-ui,sans-serif";
  ctx.fillText("nellylabs.dev", W - 90, H - 12);

  try {
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    const file = new File([blob], `flat-rate-week-${wk}.png`, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `Week of ${wk}` });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `flat-rate-week-${wk}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Week card saved!");
    }
  } catch { toast("Couldn't share — try Email PDF instead"); }
}

// ── Push notification helper (delegates to more-page.js schedulers) ──
async function requestPushPermission() {
  if (!("Notification" in window)) {
    toast("Notifications not supported on this browser");
    return;
  }
  if (Notification.permission === "denied") {
    toast("Notifications blocked — go to Settings → Notifications and allow this site");
    return;
  }
  let perm = Notification.permission;
  if (perm !== "granted") {
    perm = await Notification.requestPermission().catch(() => "denied");
  }
  if (perm === "granted") {
    // Enable shift reminder if not already set
    const ls = (() => { try { return JSON.parse(localStorage.getItem("fr_reminder") || "{}"); } catch { return {}; } })();
    if (!ls.enabled) {
      localStorage.setItem("fr_reminder", JSON.stringify({ ...ls, enabled: true, time: "16:30" }));
    }
    window.scheduleShiftReminder?.();
    toast("🔔 Reminders on — go to More → Settings to adjust the time");
  } else {
    toast("Notifications not enabled");
  }
}

// ── 8-week earnings chart (More > History) ───────────────
function render8WeekChart(allEntries) {
  const el = document.getElementById("eightWeekChartCard");
  if (!el) return;
  const empId = getEmpId();
  const own = filterEntriesByEmp(normalizeEntries(allEntries || []), empId);

  if (!own.length) {
    el.innerHTML = `<div class="eightWkEmptyState">Log a few weeks of jobs to see trends here.</div>`;
    return;
  }

  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const anchor = new Date(now);
    anchor.setDate(anchor.getDate() - i * 7);
    const ws2 = startOfWeekLocal(anchor);
    const we2 = endOfWeekLocal(anchor);
    const wk2 = dateKey(ws2), wkEnd = dateKey(we2);
    const wEntries = own.filter(e => {
      const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
      return dk >= wk2 && dk <= wkEnd;
    });
    const dollars = round2(wEntries.reduce((s, e) => s + Number(e.earnings || 0), 0));
    const label = ws2.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    weeks.push({ dollars, label, isCurrent: i === 0 });
  }

  const maxD = Math.max(...weeks.map(w => w.dollars), 1);
  const W2 = 340, H2 = 80, bW2 = 30, gap2 = (W2 - 8 * bW2) / 9;
  const isLight = document.documentElement.dataset.theme === "light";
  const pastC = isLight ? "rgba(37,99,235,.30)" : "rgba(37,99,235,.28)";
  const emptyC = isLight ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)";

  let rects = "";
  weeks.forEach((w, i) => {
    const x = gap2 + i * (bW2 + gap2);
    const bH2 = Math.max(3, (w.dollars / maxD) * (H2 - 12));
    const y2 = H2 - bH2;
    const fill = w.isCurrent ? "#2563EB" : w.dollars > 0 ? pastC : emptyC;
    rects += `<rect class="eightWkBar" x="${x.toFixed(1)}" y="${y2.toFixed(1)}" width="${bW2}" height="${bH2.toFixed(1)}" rx="4" fill="${fill}" style="transform-origin:${(x+bW2/2).toFixed(1)}px ${H2}px;transform:scaleY(0);transition:transform 360ms cubic-bezier(.34,1.56,.64,1) ${i*40}ms"/>`;
    if (w.dollars > 0) {
      rects += `<text x="${(x+bW2/2).toFixed(1)}" y="${(y2-3).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="${w.isCurrent ? "#2563EB" : "rgba(255,255,255,.5)"}">${formatMoney(w.dollars)}</text>`;
    }
  });

  const labels = weeks.map((w, i) =>
    `<span class="eightWkLabel${w.isCurrent ? " eightWkLabel--now" : ""}">${w.label}</span>`
  ).join("");

  el.innerHTML = `<svg viewBox="0 0 ${W2} ${H2}" style="width:100%;display:block;overflow:visible" preserveAspectRatio="none">${rects}</svg><div class="eightWkLabels">${labels}</div>`;

  // Trigger bar animations
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.querySelectorAll(".eightWkBar").forEach(r => { r.style.transform = "scaleY(1)"; });
    });
  });
}

// ── Comeback stats (More > History) ──────────────────────
// NOTE: renderComebackStats() lives in more-page.js (the #comebackStatsCard element
// is part of the More page). An earlier duplicate definition here was dead code —
// it was always shadowed by the more-page version due to bundle order, so its layout
// never rendered. Removed to avoid a latent bug if bundle order ever changes.
// The call in refreshUI resolves to the more-page version via function hoisting.

// ── Job Timer ────────────────────────────────────────────
(function initJobTimer() {
  const btn = document.getElementById("timerBtn");
  if (!btn) return;
  let interval = null;

  function getStart() {
    const v = localStorage.getItem("fr_timer_start");
    return v ? parseInt(v, 10) : null;
  }

  function fmt(ms) {
    const totalS = Math.floor(ms / 1000);
    const h = Math.floor(totalS / 3600);
    const m = Math.floor((totalS % 3600) / 60);
    const s = totalS % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function tick() {
    const start = getStart();
    if (!start) return;
    btn.textContent = fmt(Date.now() - start);
  }

  function startTimer() {
    localStorage.setItem("fr_timer_start", String(Date.now()));
    btn.classList.add("fr26TimerBtn--running");
    clearInterval(interval);
    interval = setInterval(tick, 1000);
    tick();
    haptic?.("medium");
    toast("Timer started");
  }

  function stopTimer() {
    const start = getStart();
    clearInterval(interval);
    interval = null;
    btn.classList.remove("fr26TimerBtn--running");
    btn.textContent = "Start Timer";
    localStorage.removeItem("fr_timer_start");
    if (!start) return;
    const hrs = (Date.now() - start) / 3_600_000;
    const rounded = Math.max(0.1, Math.round(hrs * 10) / 10);
    const hoursEl = document.getElementById("hours");
    if (hoursEl) {
      hoursEl.value = String(rounded);
      hoursEl.dispatchEvent(new Event("input", { bubbles: true }));
      hoursEl.focus();
    }
    haptic?.("medium");
    toast(`Timer stopped — ${rounded}h logged`);
  }

  btn.addEventListener("click", () => {
    if (getStart()) stopTimer();
    else startTimer();
  });

  // Resume if timer was running before page reload
  if (getStart()) {
    btn.classList.add("fr26TimerBtn--running");
    tick();
    clearInterval(interval);
    interval = setInterval(tick, 1000);
  }
})();

// ── Comeback quick chip ───────────────────────────────────
(function initComebackChip() {
  const chip = document.getElementById("comebackChipBtn");
  const cb   = document.getElementById("isComeback");
  if (!chip || !cb) return;

  function syncChip() {
    chip.classList.toggle("fr26ChipComeback--active", !!cb.checked);
    chip.textContent = cb.checked ? "✓ Comeback" : "Comeback";
  }

  chip.addEventListener("click", () => {
    cb.checked = !cb.checked;
    const panel = document.getElementById("detailsPanel");
    if (cb.checked && panel) panel.style.display = "";
    syncChip();
  });

  cb.addEventListener("change", syncChip);
  syncChip();
})();

// ── Hero chart range tab wiring ──────────────────────────
document.addEventListener("click", ev => {
  const tab = ev.target?.closest?.("[data-hc-range]");
  if (!tab) return;
  const newMode = tab.getAttribute("data-hc-range");
  if (!newMode) return;
  // Clear VIN search when switching tabs
  const vinInput = document.getElementById("vinSearchInput");
  const vinClear = document.getElementById("vinSearchClear");
  if (vinInput) vinInput.value = "";
  if (vinClear) vinClear.style.display = "none";
  window.__RANGE_MODE__ = newMode;
  window.__NAV_OFFSET__ = 0;
  window.__WEEK_DAY_PICK__ = "";
  rangeMode = newMode;
  refreshUI(CURRENT_ENTRIES);
});

initVinSearch();

function maybeStartTour() {
  const forced = sessionStorage.getItem("fr_force_tour");
  if (forced) {
    sessionStorage.removeItem("fr_force_tour");
    startTour(true);
    return;
  }
  if (localStorage.getItem("fr_tour_done")) return;
  // If the setup modal is still open, the tour will fire from the Get Started click handler
  const modal = document.getElementById("onboardingModal");
  if (modal && modal.style.display !== "none") return;
  startTour();
}

// ── Shared spotlight positioning (used by the main tour and the More tour) ──
// A fixed setTimeout guess for "has the smooth scroll finished" was the
// source of the highlight box landing on the wrong spot: on a slow scroll,
// a tab switch, or a details panel popping open, the guessed delay could
// fire before layout actually settled, so the box got measured and locked
// in mid-transition — a step or two off from the real element underneath.
// This instead redraws every frame and only "locks in" (adds the pulse)
// once the target's position holds steady for a few frames in a row, then
// keeps tracking live so a later layout shift (keyboard, resize) doesn't
// leave it stranded.
function stopSpotlightTracking(spotlight) {
  if (spotlight._rafId) { cancelAnimationFrame(spotlight._rafId); spotlight._rafId = null; }
  spotlight._trackCleanup?.();
  spotlight._trackCleanup = null;
}

function trackSpotlight(spotlight, target) {
  const pad = 8;
  const draw = () => {
    const r = target.getBoundingClientRect();
    spotlight.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
  };

  let stableFrames = 0, lastTop = null, lastLeft = null, frames = 0;
  const MAX_FRAMES = 60; // ~1s safety cap at 60fps, in case it never truly settles

  function tick() {
    draw();
    const r = target.getBoundingClientRect();
    frames++;
    if (lastTop !== null && Math.abs(r.top - lastTop) < 0.5 && Math.abs(r.left - lastLeft) < 0.5) {
      stableFrames++;
    } else {
      stableFrames = 0;
    }
    lastTop = r.top; lastLeft = r.left;
    if (stableFrames >= 3 || frames >= MAX_FRAMES) {
      spotlight.classList.add("pulse");
      const onMove = () => draw();
      window.addEventListener("scroll", onMove, { passive: true, capture: true });
      window.addEventListener("resize", onMove);
      spotlight._trackCleanup = () => {
        window.removeEventListener("scroll", onMove, { capture: true });
        window.removeEventListener("resize", onMove);
      };
      return;
    }
    spotlight._rafId = requestAnimationFrame(tick);
  }
  spotlight._rafId = requestAnimationFrame(tick);
}

function startTour(force = false) {
  if (!force && localStorage.getItem("fr_tour_done")) return;
  const overlay  = document.getElementById("tourOverlay");
  const nextBtn  = document.getElementById("tourNextBtn");
  const skipBtn  = document.getElementById("tourSkipBtn");
  if (!overlay || !nextBtn || !skipBtn) return;

  let step = 0;

  function buildDots() {
    const container = document.getElementById("tourDots");
    if (!container) return;
    container.innerHTML = "";
    TOUR_STEPS.forEach((_, i) => {
      const d = document.createElement("div");
      d.className = "tourDot" + (i === step ? " tourDot--active" : "");
      container.appendChild(d);
    });
  }

  function positionSpotlight(elSel) {
    const spotlight = document.getElementById("tourSpotlight");
    if (!spotlight) return;
    stopSpotlightTracking(spotlight);
    if (!elSel) {
      spotlight.style.display = "none";
      spotlight.classList.remove("pulse");
      overlay.style.background = "rgba(0,0,0,0.72)";
      overlay.classList.remove("tour-has-target");
      return;
    }
    const target = document.querySelector(elSel);
    if (!target) {
      spotlight.style.display = "none";
      overlay.style.background = "rgba(0,0,0,0.72)";
      overlay.classList.remove("tour-has-target");
      return;
    }
    overlay.style.background = "transparent";
    overlay.classList.add("tour-has-target");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    trackSpotlight(spotlight, target);
  }

  function show(idx) {
    const s = TOUR_STEPS[idx];
    const stepLabel = document.getElementById("tourStep");
    const titleEl   = document.getElementById("tourTitle");
    const bodyEl    = document.getElementById("tourBody");
    const tooltip   = document.getElementById("tourTooltip");
    if (stepLabel) stepLabel.textContent = `${idx + 1} of ${TOUR_STEPS.length}`;
    if (titleEl)   titleEl.textContent = s.title;
    if (bodyEl)    bodyEl.textContent  = s.body;
    nextBtn.textContent = idx === TOUR_STEPS.length - 1 ? "Done" : "Next →";
    overlay.style.display = "block";
    buildDots();
    positionSpotlight(s.el);
    // Restart content animation on every step
    if (tooltip) {
      tooltip.classList.remove("step-enter");
      void tooltip.offsetWidth; // force reflow
      tooltip.classList.add("step-enter");
    }
  }

  function endTour() {
    overlay.style.display = "none";
    overlay.style.background = "";
    overlay.classList.remove("tour-has-target");
    const spotlight = document.getElementById("tourSpotlight");
    if (spotlight) {
      stopSpotlightTracking(spotlight);
      spotlight.style.cssText = "display:none;";
      spotlight.classList.remove("pulse");
    }
    localStorage.setItem("fr_tour_done", "1");
    // Nudge PWA install if not yet installed
    if (window.__FR?.canInstall?.()) {
      const banner = document.getElementById("installBanner");
      if (banner) banner.style.display = "";
    }
  }

  nextBtn.onclick = () => {
    const current = TOUR_STEPS[step];
    if (current?.action === "goto-more") {
      localStorage.setItem("fr_tour_more", "1");
      endTour();
      window.__FR?.showSpaPage?.("more");
      return;
    }
    if (current?.action === "open-details") {
      // Open the details panel so the next step can highlight fields inside it
      const panel = document.getElementById("detailsPanel");
      const btn   = document.getElementById("toggleDetailsBtn");
      if (panel && panel.style.display === "none") {
        panel.style.display = "block";
        if (btn) btn.textContent = "Less";
      }
    }
    step++;
    if (step >= TOUR_STEPS.length) endTour();
    else show(step);
  };
  skipBtn.onclick = endTour;

  show(0);
}

// ═══════════════════════════════════════════════════════════════
// SHIFT EFFICIENCY RATIO
// ═══════════════════════════════════════════════════════════════
const LS_CLOCKIN = "fr_clockin_";

// A shift longer than this almost certainly means the user forgot to clock out.
// Chosen to comfortably allow long days and overnight shifts, while still
// catching a clock-in left running for days.
const MAX_SHIFT_MS = 16 * 3600000; // 16 hours

function getClockInMs(empId) {
  try {
    const ms = Number(localStorage.getItem(LS_CLOCKIN + empId) || 0) || 0;
    if (!ms) return 0;
    // Guard against a forgotten clock-out. Without this, a stale clock-in keeps
    // accumulating and gets compared against a *later* day's flat hours, showing
    // a nonsense efficiency (e.g. a 30-hour "shift" vs. 2 flat hours).
    // Uses elapsed time rather than a calendar-day check so genuine overnight
    // shifts still work correctly.
    if (Date.now() - ms > MAX_SHIFT_MS) {
      clearClockIn(empId);
      return 0;
    }
    return ms;
  } catch { return 0; }
}
function setClockInMs(empId, ms) {
  try { localStorage.setItem(LS_CLOCKIN + empId, String(ms)); } catch {}
}
function clearClockIn(empId) {
  try { localStorage.removeItem(LS_CLOCKIN + empId); } catch {}
}

function updateClockInDisplay() {
  const btn   = document.getElementById("clockInBtn");
  const effEl = document.getElementById("heroEfficiency");
  if (!btn) return;
  const empId = getEmpId();
  const ms    = getClockInMs(empId);
  if (ms > 0) {
    btn.textContent = "Clock Out";
    btn.classList.add("clockInBtn--active");
    const shiftHrs = (Date.now() - ms) / 3600000;
    const todayKey = todayKeyLocal?.();
    const flatHrs  = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
      .filter(e => (e.dayKey || dayKeyFromISO?.(e.createdAt)) === todayKey)
      .reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const ratio = shiftHrs > 0.05 ? flatHrs / shiftHrs : 0;
    if (effEl) {
      const color = ratio >= 1 ? "var(--primary)" : ratio >= 0.7 ? "#f59e0b" : "var(--danger)";
      effEl.style.display = "";
      effEl.innerHTML = `<span style="color:${color};font-weight:700;">${ratio.toFixed(2)}×</span><span class="effLabel"> eff · ${flatHrs.toFixed(1)}f / ${shiftHrs.toFixed(1)}h shift</span>`;
    }
  } else {
    btn.textContent = "Clock In";
    btn.classList.remove("clockInBtn--active");
    if (effEl) effEl.style.display = "none";
  }
}

/* ── Pro gating helpers ───────────────────────────────────────────────────────
 * Free keeps the daily habit AND the hook: logging, pay totals, and short-pay
 * alerts. Pro is the stuff that recovers money (dispute PDFs, exports) or costs
 * real money to run (cloud sync, photo storage) — plus the deeper analytics.
 *
 * Deliberately NOT gated: a user's own job history. This app is someone's pay
 * record and their evidence in a dispute; holding that hostage would be wrong.
 *
 * While billing is off (beta) this returns false, so nothing is locked.
 *
 * Admin accounts (the app owner's own account, for testing) always see
 * everything unlocked, regardless of billing state — so testing never gets
 * blocked by the paywall it's testing around.
 */
const ADMIN_EMAILS = ["eamnelsonmalloy@icloud.com"];
function isAdminAccount() {
  const email = (typeof window !== "undefined" && window.CURRENT_USER_EMAIL) || "";
  return ADMIN_EMAILS.includes(String(email).toLowerCase());
}
function proLocked() {
  try {
    if (isAdminAccount()) return false;
    if (typeof billingLive !== "function") return false;
    if (!billingLive()) return false;
    return !(typeof isPro === "function" && isPro());
  } catch { return false; }
}

function renderProLock(el, title, text) {
  if (!el) return;
  el.innerHTML = `
    <div class="proLock">
      <div class="proLockIcon">⚡</div>
      <div class="proLockTitle">${escapeHtml(title)}</div>
      <div class="proLockText">${escapeHtml(text)}</div>
      <button type="button" class="fr26BtnPrimary proLockBtn" data-open-upgrade>Unlock with Pro</button>
    </div>`;
}

// Renders the Lost Time breakdown (More → History). Period follows the same
// 30-day default as other trend cards; the point is the running total you can
// take to a service manager.
function renderLostTimeCard(days = 30) {
  const el = document.getElementById("lostTimeCard");
  if (!el) return;

  if (proLocked()) {
    return renderProLock(el, "See what downtime costs you",
      "Track unpaid hours lost to parts delays and dead dispatch, priced at your rate — proof you can take to your service manager.");
  }

  const empId = getEmpId();
  if (!empId) {
    el.innerHTML = `<div class="muted small" style="padding:8px 0;">Set your Employee # to track lost time.</div>`;
    return;
  }

  const to   = todayKeyLocal();
  const from = dateKey(new Date(Date.now() - days * 86400000));
  const rate = Number(getDefaultRate?.()) || 0;
  const s    = summarizeLostTime(empId, from, to, rate);

  if (!s.totalHours) {
    el.innerHTML = `
      <div class="ltEmpty">
        <div class="ltEmptyTitle">Nothing logged yet</div>
        <div class="ltEmptySub">Clock in and out, and when your flat hours don't
        cover your clocked time, Buddy will ask where it went.</div>
      </div>`;
    return;
  }

  const worst = s.byCategory[0];
  const bars = s.byCategory.map(c => `
    <div class="ltBarRow">
      <div class="ltBarTop">
        <span class="ltBarName">${c.emoji} ${escapeHtml(c.label)}</span>
        <span class="ltBarVal">${c.hours.toFixed(1)}h${rate > 0 ? ` · ${formatMoney(c.dollars)}` : ""}</span>
      </div>
      <div class="ltBarTrack"><div class="ltBarFill" style="width:${Math.max(3, c.pct)}%"></div></div>
    </div>`).join("");

  el.innerHTML = `
    <div class="ltHeadline">
      <div class="ltHeadlineNum">${s.totalHours.toFixed(1)}<span class="ltHeadlineUnit">h</span></div>
      <div class="ltHeadlineMeta">
        unpaid in the last ${days} days${rate > 0 ? `<br><strong>${formatMoney(s.dollars)}</strong> of your time` : ""}
      </div>
    </div>
    <div class="ltCallout">Biggest drain: <strong>${escapeHtml(worst.label)}</strong> — ${worst.hours.toFixed(1)}h (${worst.pct}%)</div>
    <div class="ltBars">${bars}</div>
    <div class="ltFootnote">Flat rate only pays turned hours. This is time you were at work but couldn't bill.</div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// LOST TIME CAPTURE
// ═══════════════════════════════════════════════════════════════
// Shown once at clock-out when clocked hours exceed flat hours. Ten seconds of
// tapping turns an invisible loss into something you can put in front of a
// service manager.

// Below this the gap is noise (rounding, a short break) — don't nag.
const LOST_TIME_MIN_GAP = 0.5;

function openLostTimeModal(gapHours, dayKey) {
  const modal = document.getElementById("lostTimeModal");
  if (!modal) return;
  const chipsEl  = document.getElementById("ltChips");
  const rowsEl   = document.getElementById("ltRows");
  const remainEl = document.getElementById("ltRemain");
  const subEl    = document.getElementById("ltSub");
  const saveBtn  = document.getElementById("ltSaveBtn");
  const skipBtn  = document.getElementById("ltSkipBtn");
  if (!chipsEl || !rowsEl || !remainEl || !saveBtn || !skipBtn) return;

  const gap = round1(Math.max(0, gapHours));
  const picked = new Map(); // categoryId -> hours

  if (subEl) {
    const rate = Number(getDefaultRate?.()) || 0;
    subEl.textContent = rate > 0
      ? `${gap.toFixed(1)} unpaid hours — about ${formatMoney(gap * rate)}`
      : `${gap.toFixed(1)} unpaid hours`;
  }

  const remaining = () => round1(gap - Array.from(picked.values()).reduce((a, b) => a + b, 0));

  const renderRemain = () => {
    const r = remaining();
    remainEl.textContent = `${r.toFixed(1)}h`;
    remainEl.classList.toggle("ltRemainVal--done", r <= 0.04);
  };

  const renderRows = () => {
    rowsEl.innerHTML = "";
    for (const [id, hrs] of picked) {
      const cat = lostTimeCategory(id);
      if (!cat) continue;
      const row = document.createElement("div");
      row.className = "ltRow";
      row.innerHTML = `
        <span class="ltRowName">${cat.emoji} ${escapeHtml(cat.label)}</span>
        <span class="ltStepper">
          <button type="button" class="ltStep" data-lt-dec="${id}" aria-label="Less">−</button>
          <span class="ltRowHrs">${hrs.toFixed(1)}h</span>
          <button type="button" class="ltStep" data-lt-inc="${id}" aria-label="More">+</button>
        </span>`;
      rowsEl.appendChild(row);
    }
    renderRemain();
    // Chips already chosen get a selected look
    chipsEl.querySelectorAll("[data-lt-cat]").forEach(b => {
      b.classList.toggle("ltChip--on", picked.has(b.dataset.ltCat));
    });
  };

  // Build category chips
  chipsEl.innerHTML = "";
  for (const cat of LOST_TIME_CATEGORIES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ltChip";
    b.dataset.ltCat = cat.id;
    b.textContent = `${cat.emoji} ${cat.label}`;
    chipsEl.appendChild(b);
  }

  chipsEl.onclick = (e) => {
    const btn = e.target.closest("[data-lt-cat]");
    if (!btn) return;
    const id = btn.dataset.ltCat;
    if (picked.has(id)) { picked.delete(id); }
    else {
      // Default the first pick to the whole gap — usually one thing ate it.
      const rest = remaining();
      picked.set(id, rest > 0 ? rest : 0.5);
    }
    renderRows();
  };

  rowsEl.onclick = (e) => {
    const inc = e.target.closest("[data-lt-inc]");
    const dec = e.target.closest("[data-lt-dec]");
    if (!inc && !dec) return;
    const id = (inc || dec).dataset.ltInc || (inc || dec).dataset.ltDec;
    const cur = picked.get(id) || 0;
    const next = round1(cur + (inc ? 0.5 : -0.5));
    if (next <= 0) picked.delete(id);
    else picked.set(id, next);
    renderRows();
  };

  const close = () => {
    modal.style.display = "none";
    unlockBodyScroll();
    chipsEl.onclick = null;
    rowsEl.onclick = null;
    saveBtn.onclick = null;
    skipBtn.onclick = null;
  };

  saveBtn.onclick = () => {
    const items = Array.from(picked.entries()).map(([category, hours]) => ({ category, hours }));
    if (!items.length) { close(); return; }
    const n = addLostTime(getEmpId(), items, dayKey);
    close();
    if (n > 0) {
      haptic?.("success");
      const total = round1(items.reduce((a, i) => a + i.hours, 0));
      toast(`Logged ${total.toFixed(1)}h of lost time`, 3000);
      renderLostTimeCard?.();
    }
  };
  skipBtn.onclick = close;

  renderRows();
  modal.style.display = "flex";
  lockBodyScroll();
}

function initClockIn() {
  const btn = document.getElementById("clockInBtn");
  if (!btn) return;
  updateClockInDisplay();
  setInterval(() => { if (getClockInMs(getEmpId()) > 0) updateClockInDisplay(); }, 60000);
  btn.addEventListener("click", () => {
    const empId = getEmpId();
    const ms    = getClockInMs(empId);
    if (ms > 0) {
      const shiftHrs = round2((Date.now() - ms) / 3600000);
      const todayKey = todayKeyLocal?.();
      const flatHrs  = round2((Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
        .filter(e => (e.dayKey || dayKeyFromISO?.(e.createdAt)) === todayKey)
        .reduce((s, e) => s + (Number(e.hours) || 0), 0));
      const ratio = shiftHrs > 0 ? round2(flatHrs / shiftHrs) : 0;
      clearClockIn(empId);
      toast(`Shift ended · ${shiftHrs.toFixed(1)} hrs · ${flatHrs.toFixed(1)} flat · Eff ${ratio.toFixed(2)}×`, 5000);
      // Any clocked time you didn't get paid flat hours for is unpaid time.
      // Capture where it went while the shift is still fresh.
      const gap = round1(shiftHrs - flatHrs);
      if (gap >= LOST_TIME_MIN_GAP) {
        setTimeout(() => openLostTimeModal(gap, todayKey), 600);
      }
    } else {
      setClockInMs(empId, Date.now());
      toast("Clocked in ✓");
    }
    updateClockInDisplay();
  });
}
window.updateClockInDisplay = updateClockInDisplay;
window.initClockIn = initClockIn;

// ═══════════════════════════════════════════════════════════════
// TAP-TO-REPEAT LAST JOB
// ═══════════════════════════════════════════════════════════════
const LS_LAST_JOB = "fr_last_job_";

function storeLastJob(empId, entry) {
  try {
    localStorage.setItem(LS_LAST_JOB + empId, JSON.stringify({
      type:  entry.type || entry.typeText || "",
      hours: entry.hours || 0,
      rate:  entry.rate  || 0,
    }));
  } catch {}
}

function getLastJob(empId) {
  try { return JSON.parse(localStorage.getItem(LS_LAST_JOB + empId) || "null"); } catch { return null; }
}

function updateRepeatChip() {
  const chip = document.getElementById("repeatChip");
  if (!chip) return;
  const empId = getEmpId();
  const last  = getLastJob(empId);
  const formEmpty = !document.getElementById("hours")?.value && !document.getElementById("typeText")?.value;
  if (!last?.type || !formEmpty || EDITING_ID) { chip.style.display = "none"; return; }
  chip.style.display = "";
  chip.textContent = `↺ ${last.type} · ${formatHours(last.hours)} hrs`;
}

function initRepeatChip() {
  const chip = document.getElementById("repeatChip");
  if (!chip) return;
  updateRepeatChip();
  chip.addEventListener("click", () => {
    const empId = getEmpId();
    const last  = getLastJob(empId);
    if (!last) return;
    const typeEl  = document.getElementById("typeText");
    const hoursEl = document.getElementById("hours");
    const rateEl  = document.querySelector('input[name="rate"]');
    if (typeEl)  typeEl.value  = last.type;
    if (hoursEl) { hoursEl.value = String(last.hours); hoursEl.dataset.touched = "1"; }
    if (rateEl && last.rate) { rateEl.value = String(last.rate); rateEl.dataset.touched = "1"; }
    updateEarningsPreview?.();
    ["hours", "typeText"].forEach(id =>
      document.getElementById(id)?.dispatchEvent(new Event("input", { bubbles: true }))
    );
    chip.style.display = "none";
    document.getElementById("ref")?.focus();
    toast(`${last.type} loaded — add RO and save`);
  });
}
window.updateRepeatChip = updateRepeatChip;
window.initRepeatChip = initRepeatChip;
window.storeLastJob = storeLastJob;

// ═══════════════════════════════════════════════════════════════
// COMBO SUGGESTIONS
// ═══════════════════════════════════════════════════════════════
function buildComboMap(entries) {
  const byDay = {};
  for (const e of entries) {
    const dk = e.dayKey || dayKeyFromISO?.(e.createdAt) || "";
    if (!byDay[dk]) byDay[dk] = [];
    byDay[dk].push(e);
  }
  const map = {};
  for (const day of Object.values(byDay)) {
    day.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    for (let i = 0; i < day.length - 1; i++) {
      const a = (day[i].type || day[i].typeText || "").toLowerCase().trim();
      const b = (day[i+1].type || day[i+1].typeText || "").toLowerCase().trim();
      if (!a || !b || a === b) continue;
      if (!map[a]) map[a] = {};
      map[a][b] = (map[a][b] || 0) + 1;
    }
  }
  return map;
}

function showComboSuggestion(savedType, entries) {
  if (!savedType || !entries?.length) return;
  const map  = buildComboMap(entries);
  const key  = savedType.toLowerCase().trim();
  const combos = map[key];
  if (!combos) return;
  const total = Object.values(combos).reduce((s, n) => s + n, 0);
  const [topType, topCount] = Object.entries(combos).sort((a, b) => b[1] - a[1])[0] || [];
  if (!topType || !topCount || total < 3 || topCount / total < 0.5) return;
  const chip = document.getElementById("comboSuggestChip");
  if (!chip) return;
  const label = topType.charAt(0).toUpperCase() + topType.slice(1);
  chip.textContent = `Often paired: ${label} →`;
  chip.dataset.suggest = label;
  chip.style.display = "";
  clearTimeout(window.__comboHideT__);
  window.__comboHideT__ = setTimeout(() => { chip.style.display = "none"; }, 14000);
}

function initComboChip() {
  const chip = document.getElementById("comboSuggestChip");
  if (!chip) return;
  chip.addEventListener("click", () => {
    const suggest = chip.dataset.suggest;
    if (!suggest) return;
    const typeEl = document.getElementById("typeText");
    if (typeEl) {
      typeEl.value = suggest;
      typeEl.dispatchEvent(new Event("input", { bubbles: true }));
      typeEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    chip.style.display = "none";
    document.getElementById("hours")?.focus();
    toast(`${suggest} prefilled — add hours & RO`);
  });
}
window.showComboSuggestion = showComboSuggestion;
window.initComboChip = initComboChip;

// ═══════════════════════════════════════════════════════════════
// PERSONAL RECORDS
// ═══════════════════════════════════════════════════════════════
const LS_RECORDS = "fr_personal_records_";

function getPersonalRecords(empId) {
  try { return JSON.parse(localStorage.getItem(LS_RECORDS + empId) || "{}"); } catch { return {}; }
}
function savePersonalRecords(empId, rec) {
  try { localStorage.setItem(LS_RECORDS + empId, JSON.stringify(rec)); } catch {}
}

function checkPersonalRecords(allEntries, newEntry) {
  if (!newEntry) return;
  const empId = getEmpId();
  const rec   = getPersonalRecords(empId);
  const todayKey2 = todayKeyLocal?.();
  const weekStart = dateKey?.(startOfWeekLocal?.(new Date())) || "";

  const todayAll = (Array.isArray(allEntries) ? allEntries : [])
    .filter(e => (e.dayKey || dayKeyFromISO?.(e.createdAt)) === todayKey2);
  const todayPay  = todayAll.reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0)
    + (Number(newEntry.earnings) || 0);
  const todayJobs = todayAll.length + 1;

  const weekPay = (Array.isArray(allEntries) ? allEntries : [])
    .filter(e => { const dk = e.dayKey || dayKeyFromISO?.(e.createdAt) || ""; return dk >= weekStart; })
    .reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0)
    + (Number(newEntry.earnings) || 0);

  let newRecord = null;
  if (rec.bestDay  != null && todayPay  > rec.bestDay)  newRecord = `🏆 New best day! ${formatMoney(todayPay)}`;
  if (rec.bestWeek != null && weekPay   > rec.bestWeek) newRecord = `🏆 New best week! ${formatMoney(weekPay)}`;
  if (rec.mostJobs != null && todayJobs > rec.mostJobs) newRecord = `🏆 Most jobs in a day! ${todayJobs}`;
  // Update regardless (first save initialises the records)
  if (rec.bestDay  == null || todayPay  > rec.bestDay)  rec.bestDay  = todayPay;
  if (rec.bestWeek == null || weekPay   > rec.bestWeek) rec.bestWeek = weekPay;
  if (rec.mostJobs == null || todayJobs > rec.mostJobs) rec.mostJobs = todayJobs;
  savePersonalRecords(empId, rec);
  if (newRecord) setTimeout(() => toast(newRecord, 4500), 1800);
}
window.checkPersonalRecords = checkPersonalRecords;

// ── Type Breakdown (Stats page) ──────────────────────────────────────────────
const BREAKDOWN_COLORS = [
  "#2563EB","#0095f6","#f59e0b","#a855f7",
  "#ef4444","#14b8a6","#f97316","#e879f9","#64748b",
];

// Normalise free-text job types into canonical buckets.
// Each entry: [canonical label, ...RegExp patterns that map to it].
// Patterns are tested in order — first match wins.
const JOB_TYPE_ALIASES = [
  // ── New-car inspections / prep ───────────────────────────────
  ["PDI",           /\bpdi\b/i,            /pdi[\s-]*clean/i,      /wash[\s&+]*wax/i],
  // ── Pre-owned / used-car full detail ─────────────────────────
  ["Pre-Owned",     /pre[\s-]*owned?/i,    /preowned/i,
                    /\bpo\b.*detail/i,      /detail.*\bpo\b/i],
  // ── Re-clean / redelivery ────────────────────────────────────
  ["Re-Clean",      /re[\s-]*clean/i],
  // ── Customer-pay mini detail ──────────────────────────────────
  ["Customer Mini", /customer[\s-]*mini/i, /mini[\s-]*detail/i,
                    /detail[\s-]*mini/i,   /\bmini\b/i],
  // ── Customer-pay full detail ─────────────────────────────────
  ["Customer Full", /customer[\s-]*full/i, /customer[\s-]*detail/i,
                    /customer[\s-]*pay/i,  /detail[\s-]*customer/i,
                    /full[\s-]*detail/i,
                    /detail.*complete/i,   /complete.*detail/i],
  // ── Sold / delivery detail (incl. FPF & no-FPF packages) ────
  ["Sold",          /\bsold\b/i,          /\bfpf\b/i,
                    /no[\s-]*fpf/i,        /detail.*fpf/i],
  // ── Dealer trade ─────────────────────────────────────────────
  ["Dealer Trade",  /dealer[\s-]*trade/i,  /\bdt\b/i],
  // ── Reclaim / SPF / Delivery ─────────────────────────────────
  ["Reclaim",       /\breclaim\b/i],
  ["SPF",           /\bspf\b/i],
  ["Delivery",      /\bdelivery\b/i],
  // ── Misc ─────────────────────────────────────────────────────
  ["Misc",          /\bmisc\b/i],
];

// A few canonicals are known by a short code that isn't just their label with
// punctuation stripped (e.g. "Dealer Trade" -> "DT"). PDI/SPF already equal
// their own compact label, so they don't need an entry here.
const JOB_TYPE_SHORT_CODES = { dt: "Dealer Trade" };

// Aliases this tech has explicitly confirmed via the "Clean up job types"
// tool (Settings). Keyed by _compactTypeKey(), populated from Supabase at
// boot by loadCustomTypeAliases() in more-page.js. Checked before anything
// else, since these are confirmed merges rather than guesses.
let CUSTOM_TYPE_ALIASES = new Map();

// Strip everything but letters/digits and lowercase, so "P.D.I.", "pdi", and
// "P-D-I" all collapse to the same "pdi" key.
function _compactTypeKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// First letter of each significant word: "Pre Delivery Insp" -> "pdi". Catches
// spelled-out abbreviations that share no literal substring with their acronym.
const _ACRONYM_STOPWORDS = new Set(["a", "an", "the", "of", "and", "for", "to", "on"]);
function _acronymKey(s) {
  const words = String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !_ACRONYM_STOPWORDS.has(w));
  if (words.length < 2) return "";
  return words.map(w => w[0]).join("");
}

function normalizeJobType(raw) {
  const s = (raw || "").trim();
  if (!s) return "Unknown";
  const compact = _compactTypeKey(s);
  const acronym = _acronymKey(s);

  // 1. Confirmed merges from this tech — most authoritative.
  if (CUSTOM_TYPE_ALIASES.has(compact)) return CUSTOM_TYPE_ALIASES.get(compact);

  // 2. High-precision matches: exact compact label, known short code, or a
  //    spelled-out acronym. These run BEFORE the loose substring regexes below
  //    because a precise match should never lose to a broad one — e.g.
  //    "pre delivery insp" contains the literal substring "delivery" and would
  //    otherwise get misfiled under the "Delivery" bucket instead of "PDI".
  if (JOB_TYPE_SHORT_CODES[compact]) return JOB_TYPE_SHORT_CODES[compact];
  for (const [canonical] of JOB_TYPE_ALIASES) {
    const canonCompact = _compactTypeKey(canonical);
    if (compact === canonCompact || (acronym && acronym === canonCompact)) return canonical;
  }

  // 3. Loose substring regex table (original behavior).
  for (const [canonical, ...patterns] of JOB_TYPE_ALIASES) {
    if (patterns.some(p => p.test(s))) return canonical;
  }

  // Fallback: return as-is but with consistent title casing
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function computeTypeBreakdown(entries) {
  const map = new Map();
  for (const e of entries) {
    const t = normalizeJobType((e.typeText || e.type || "").trim());
    const cur = map.get(t) || { count: 0, hours: 0, earnings: 0 };
    map.set(t, {
      count:    cur.count    + 1,
      hours:    round1(cur.hours    + Number(e.hours    || 0)),
      earnings: round2(cur.earnings + Number(e.earnings || 0)),
    });
  }
  return Array.from(map.entries())
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.count - a.count);
}

/** Count a number up from 0 on screen. `fmt` renders each frame's value. */
function animateCount(el, to, fmt = (v) => String(Math.round(v)), ms = 620) {
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce || !Number.isFinite(to) || to === 0) { el.textContent = fmt(to || 0); return; }
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    // easeOutCubic — fast start, gentle settle
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(to * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

function renderDonutSVG(types, total) {
  const r = 36, C = 2 * Math.PI * r;
  if (!total) {
    return `<svg viewBox="0 0 100 100" width="140" height="140" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--surface2,#1e2d42)" stroke-width="14"/>
      <text x="50" y="54" text-anchor="middle" font-size="10" fill="var(--muted,#6b7280)">No data</text>
    </svg>`;
  }
  // 2px visual gap between segments
  const GAP = types.length > 1 ? Math.min(3, C * 0.008) : 0;
  let arcs = "";
  let cum = 0;
  types.forEach((t, i) => {
    const color  = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
    // `share` is the segment's true slice of the circle; `segLen` is what we
    // actually draw, trimmed by GAP to leave a hairline between segments.
    // The cursor must advance by the FULL share — advancing by the trimmed
    // length instead made every segment start where the last one ended (so no
    // visible gaps at all) and left the accumulated slack as one ugly notch at
    // the top of the ring.
    const share  = (t.count / total) * C;
    const segLen = Math.max(0, share - GAP);
    // Rendered collapsed (0-length) and expanded to its real length on the next
    // frame — that's what produces the sweep-in. data-dash carries the target.
    arcs += `<circle class="brkArc" cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="14"
      data-type="${escapeHtml(t.name)}"
      data-dash="${segLen.toFixed(2)} ${(C - segLen).toFixed(2)}"
      stroke-dasharray="0 ${C.toFixed(2)}"
      stroke-dashoffset="${(-(cum + GAP / 2)).toFixed(2)}"
      style="transition-delay:${i * 70}ms"
      transform="rotate(-90 50 50)"/>`;
    cum += share;
  });
  return `<svg viewBox="0 0 100 100" width="140" height="140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--surface2,#1e2d42)" stroke-width="14"/>
    ${arcs}
    <text x="50" y="46" text-anchor="middle" font-size="18" font-weight="700" fill="var(--fg,#e8eaf0)">${total}</text>
    <text x="50" y="58" text-anchor="middle" font-size="9" fill="var(--muted,#6b7280)">${total === 1 ? "job" : "jobs"}</text>
  </svg>`;
}

// ── Period label (shown as subtitle in Stats header) ────────────────────────
function _statsPeriodLabel(period, customFrom, customTo) {
  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const now = new Date();
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  switch (period) {
    case "today":         return "Today · " + fmt(dateKey(now));
    case "yesterday":     return "Yesterday · " + fmt(dateKey(addDays(now, -1)));
    case "week":          return "This Week";
    case "lastWeek":      return "Last Week";
    case "payPeriod":     { const [f, t] = _statsPayPeriodRange(0);  return `Pay Period · ${fmt(f)} – ${fmt(t)}`; }
    case "lastPayPeriod": { const [f, t] = _statsPayPeriodRange(-1); return `Last Pay Period · ${fmt(f)} – ${fmt(t)}`; }
    case "month":         return now.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "lastMonth":     return addDays(new Date(now.getFullYear(), now.getMonth() - 1, 1), 0).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "last30":        return "Last 30 Days";
    case "last90":        return "Last 90 Days";
    case "year":          return String(now.getFullYear());
    case "all":           return "All Time";
    case "custom":        return customFrom && customTo ? `${fmt(customFrom)} – ${fmt(customTo)}` : customFrom ? `From ${fmt(customFrom)}` : "Custom Range";
    default:              return "";
  }
}

// ── Period date-range helpers ────────────────────────────────────────────────
// Returns [fromKey, toKey] where null means "no bound".
// fromKey / toKey are "YYYY-MM-DD" strings comparable with < / >.
function _statsPayPeriodRange(offset) {
  // Bi-weekly anchor: Jan 6 2025 (Monday). Adjust if your shop uses a different start.
  const ANCHOR   = new Date("2025-01-06T00:00:00");
  const MS_PERIOD = 14 * 86400000;
  const now       = new Date();
  const periods   = Math.floor((now - ANCHOR) / MS_PERIOD) + offset;
  const start     = new Date(ANCHOR.getTime() + periods * MS_PERIOD);
  const end       = new Date(start.getTime() + 13 * 86400000);
  return [dateKey(start), dateKey(end)];
}

function _statsDateRange(period, customFrom, customTo) {
  const now    = new Date();
  const todayK = dateKey(now);
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  switch (period) {
    case "today":         return [todayK, todayK];
    case "yesterday": {   const y = addDays(now, -1); const yk = dateKey(y); return [yk, yk]; }
    case "week":          return [dateKey(startOfWeekLocal(now)), null];
    case "lastWeek": {
      const ws = startOfWeekLocal(addDays(now, -7));
      return [dateKey(ws), dateKey(addDays(ws, 6))];
    }
    case "payPeriod":     return _statsPayPeriodRange(0);
    case "lastPayPeriod": return _statsPayPeriodRange(-1);
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return [dateKey(s), null];
    }
    case "lastMonth": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return [dateKey(s), dateKey(e)];
    }
    case "last30":        return [dateKey(addDays(now, -29)), todayK];
    case "last90":        return [dateKey(addDays(now, -89)), todayK];
    case "year":          return [dateKey(new Date(now.getFullYear(), 0, 1)), null];
    case "all":           return [null, null];
    case "custom":        return [customFrom || null, customTo || null];
    default:              return [null, null];
  }
}

function _statsFilterByRange(entries, from, to) {
  return entries.filter(e => {
    const dk = e.dayKey || dayKeyFromISO(e.createdAt) || "";
    if (from && dk < from) return false;
    if (to   && dk > to)   return false;
    return true;
  });
}

// ── Monthly trend bar chart ───────────────────────────────────────────────────
function _renderMonthlyTrendHtml(entries) {
  const bucketMap = new Map();
  entries.forEach(e => {
    if (!e.dayKey || e.dayKey.length < 7) return;
    const mo = e.dayKey.slice(0, 7); // "YYYY-MM"
    const cur = bucketMap.get(mo) || { key: mo, dollars: 0, count: 0 };
    cur.dollars += Number(e.earnings || 0);
    cur.count++;
    bucketMap.set(mo, cur);
  });
  const buckets = [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      ...v,
      label: (() => {
        const d = new Date(k + "-15");
        return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      })(),
    }));
  if (buckets.length < 2) return ""; // no chart for single month
  const maxD = Math.max(...buckets.map(b => b.dollars), 1);
  const H = 64; // bar area height in px
  const bars = buckets.map(b => {
    const barH = b.dollars > 0 ? Math.max(4, Math.round((b.dollars / maxD) * H)) : 4;
    return `<div class="mnthBarCol">
      <div class="mnthBarAmt">${formatMoney(Math.round(b.dollars))}</div>
      <div class="mnthBar" style="height:${barH}px;"></div>
      <div class="mnthBarLabel">${b.label}</div>
    </div>`;
  }).join("");
  return `<div class="mnthTrend">
    <div class="mnthTrendTitle">Monthly Earnings</div>
    <div class="mnthBarsScroll"><div class="mnthBarsWrap">${bars}</div></div>
  </div>`;
}

// ── Main render ──────────────────────────────────────────────────────────────
/* ── Efficiency ───────────────────────────────────────────────────────────────
 * Flat-rate techs get judged on hours turned versus hours available. The usual
 * version of this compares flagged hours to a flat 8-hour day, which punishes
 * anyone whose shop runs 9s or 4x10s — so the baseline is the user's own
 * Standard Day setting.
 *
 * Days worked counts days that actually have logged work, not calendar days:
 * a week off shouldn't read as 0% efficiency, it should read as "no data".
 */
function computeEfficiency(entries, standardDay) {
  const days = new Set();
  let flatHours = 0;
  for (const e of entries) {
    const k = e.dayKey || dayKeyFromISO(e.createdAt || "");
    if (k) days.add(k);
    flatHours += Number(e.hours) || 0;
  }
  const daysWorked = days.size;
  const available  = daysWorked * standardDay;
  return {
    daysWorked,
    flatHours: round1(flatHours),
    available: round1(available),
    pct: available > 0 ? Math.round((flatHours / available) * 100) : null,
  };
}

/** The equivalent stretch immediately before [from, to], for trend comparison. */
function _previousRange(from, to) {
  const d = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
  const a = d(from), b = d(to);
  const span = Math.max(1, Math.round((b - a) / 86400000) + 1);
  const prevEnd   = new Date(a); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (span - 1));
  return [dateKey(prevStart), dateKey(prevEnd)];
}

function renderEfficiencyCard(entries, period, from, to, allOwnEntries) {
  const el = document.getElementById("breakdownEfficiency");
  if (!el) return;

  const standardDay = getStandardDayHours();
  const cur = computeEfficiency(entries, standardDay);

  if (!cur.daysWorked || cur.pct === null) { el.style.display = "none"; return; }

  // Trend against the previous equal-length stretch — only when both have data,
  // otherwise a first week would show a meaningless +100%.
  let trendHtml = "";
  if (from && to) {
    const [pf, pt] = _previousRange(from, to);
    const prev = computeEfficiency(_statsFilterByRange(allOwnEntries || [], pf, pt), standardDay);
    if (prev.pct !== null && prev.daysWorked > 0) {
      const delta = cur.pct - prev.pct;
      const cls = delta > 0 ? "effTrend--up" : delta < 0 ? "effTrend--down" : "";
      const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
      trendHtml = `<div class="effTrend ${cls}">${arrow} ${Math.abs(delta)} pts vs previous</div>`;
    }
  }

  const pct = cur.pct;
  const tone = pct >= 100 ? "eff--strong" : pct >= 75 ? "eff--ok" : "eff--low";
  const verdict = pct >= 100
    ? "Turning more than you're clocking"
    : pct >= 75
      ? "Solid — most of your day is billable"
      : "A lot of your day isn't turning hours";

  el.className = `effCard ${tone}`;
  el.innerHTML = `
    <div class="effTop">
      <div class="effPctWrap">
        <span class="effPct">${pct}%</span>
        <span class="effPctLabel">efficiency</span>
      </div>
      ${trendHtml}
    </div>
    <div class="effBar"><span style="width:${Math.min(100, pct)}%"></span></div>
    <div class="effMath">${cur.flatHours} flat hrs / ${cur.daysWorked} day${cur.daysWorked === 1 ? "" : "s"} × ${standardDay}h = ${cur.available} available</div>
    <div class="effVerdict">${verdict}</div>
  `;
  el.style.display = "";
}

function renderBreakdownPage(period, customFrom, customTo) {
  period = period || window.__STATS_PERIOD__ || "week";
  window.__STATS_PERIOD__      = period;
  window.__STATS_CUSTOM_FROM__ = customFrom || window.__STATS_CUSTOM_FROM__;
  window.__STATS_CUSTOM_TO__   = customTo   || window.__STATS_CUSTOM_TO__;

  // Update header subtitle
  const subEl = document.getElementById("statsHeaderSub");
  if (subEl) subEl.textContent = _statsPeriodLabel(period, window.__STATS_CUSTOM_FROM__, window.__STATS_CUSTOM_TO__);

  const empId = getEmpId();
  const own   = filterEntriesByEmp(normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []), empId);

  const [from, to] = _statsDateRange(period, window.__STATS_CUSTOM_FROM__, window.__STATS_CUSTOM_TO__);
  const entries    = _statsFilterByRange(own, from, to);

  const types         = computeTypeBreakdown(entries);
  const totalCount    = entries.length;
  const totalHours    = round1(entries.reduce((s, e) => s + Number(e.hours    || 0), 0));
  const totalEarnings = round2(entries.reduce((s, e) => s + Number(e.earnings || 0), 0));

  const chartEl    = document.getElementById("breakdownChart");
  const summaryEl  = document.getElementById("breakdownSummary");
  const listEl     = document.getElementById("breakdownList");
  const monthlyEl  = document.getElementById("breakdownMonthly");
  if (!chartEl || !listEl) return;

  // ── Monthly trend (multi-month periods only) ─────────────────────────
  const showMonthly = ["year", "all", "last90", "last30", "custom"].includes(period);
  if (monthlyEl) {
    if (showMonthly && entries.length > 0) {
      monthlyEl.innerHTML = _renderMonthlyTrendHtml(entries);
      monthlyEl.style.display = "";
    } else {
      monthlyEl.innerHTML = "";
      monthlyEl.style.display = "none";
    }
  }

  // Donut + legend
  const legendHtml = types.slice(0, 7).map((t, i) => `
    <div class="brkLegendItem" data-brk-type="${escapeHtml(t.name)}" role="button" tabindex="0">
      <span class="brkDot" style="background:${BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length]}"></span>
      <span class="brkLegendName">${escapeHtml(t.name)}</span>
    </div>`).join("");

  chartEl.innerHTML = `
    <div class="brkDonutWrap">${renderDonutSVG(types, totalCount)}</div>
    <div class="brkLegend">${legendHtml || '<span class="muted small">No entries</span>'}</div>
  `;

  // Sweep the donut segments open on the next frame (see renderDonutSVG).
  requestAnimationFrame(() => {
    chartEl.querySelectorAll(".brkArc").forEach(arc => {
      if (arc.dataset.dash) arc.setAttribute("stroke-dasharray", arc.dataset.dash);
    });
  });

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="brkSumCell"><div class="brkSumVal" id="brkSumJobs">0</div><div class="brkSumLabel">${totalCount === 1 ? "Job" : "Jobs"}</div></div>
      <div class="brkSumCell"><div class="brkSumVal" id="brkSumHours">0h</div><div class="brkSumLabel">Hours</div></div>
      <div class="brkSumCell"><div class="brkSumVal" id="brkSumPay">$0</div><div class="brkSumLabel">Pay</div></div>
    `;
    animateCount(document.getElementById("brkSumJobs"),  totalCount);
    animateCount(document.getElementById("brkSumHours"), totalHours,    v => `${(Math.round(v * 10) / 10).toFixed(1)}h`);
    animateCount(document.getElementById("brkSumPay"),   totalEarnings, v => formatMoney(v));
  }

  renderEfficiencyCard(entries, period, from, to, own);

  renderJobScorecard(entries);

  if (!types.length) {
    listEl.innerHTML = '<div class="muted small" style="text-align:center;padding:32px 0;">No entries for this period.</div>';
    return;
  }
  // Indexed by type, so the click wiring below can look a tapped job row
  // back up to its real entry object without re-deriving it from the DOM.
  const jobsByType = [];
  listEl.innerHTML = types.map((t, i) => {
    const color = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
    const pct   = totalCount > 0 ? Math.round((t.count / totalCount) * 100) : 0;
    // Each row is tappable: it opens the actual jobs behind the number, so the
    // chart is a way into the work rather than a dead end.
    const jobs = entries
      .filter(e => normalizeJobType((e.typeText || e.type || "").trim()) === t.name)
      .sort((a, b) => String(b.dayKey || "").localeCompare(String(a.dayKey || "")));
    jobsByType[i] = jobs;
    const jobsHtml = jobs.map((e, ji) => {
      const refLbl = e.refType === "STOCK" ? "STK" : "RO";
      const ref = e.ref || e.ro || "—";
      return `<div class="brkJob" data-brk-job-idx="${ji}" role="button" tabindex="0">
        <div class="brkJobLeft">
          <span class="brkJobRef mono">${escapeHtml(refLbl)} ${escapeHtml(String(ref))}</span>
          <span class="brkJobDate">${escapeHtml(formatDayLabel(e.dayKey) || e.dayKey || "")}</span>
        </div>
        <div class="brkJobRight">
          <span class="brkJobPay">${formatMoney(e.earnings)}</span>
          <span class="brkJobHrs">${formatHours(e.hours)}h</span>
        </div>
      </div>`;
    }).join("");
    return `<div class="brkRowWrap" data-brk-type-idx="${i}">
      <button type="button" class="brkRow" data-brk-type="${escapeHtml(t.name)}" aria-expanded="false">
        <span class="brkDot" style="background:${color};margin-top:3px;flex-shrink:0;"></span>
        <div class="brkRowBody">
          <div class="brkRowName">${escapeHtml(t.name)}</div>
          <div class="brkRowCount">${t.count} of ${totalCount} jobs · ${pct}%</div>
          <div class="brkRowBar"><span style="width:${pct}%;background:${color};"></span></div>
        </div>
        <div class="brkRowRight">
          <div class="brkRowEarnings">${formatMoney(t.earnings)}</div>
          <div class="brkRowHours">${t.hours.toFixed(1)} hrs</div>
        </div>
        <span class="brkRowChev" aria-hidden="true"></span>
      </button>
      <div class="brkRowJobs">${jobsHtml}</div>
    </div>`;
  }).join("");

  // Expand/collapse a type to reveal the jobs inside it (one open at a time).
  listEl.querySelectorAll("[data-brk-type]").forEach(btn => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".brkRowWrap");
      const open = wrap?.classList.contains("open");
      listEl.querySelectorAll(".brkRowWrap.open").forEach(w => {
        w.classList.remove("open");
        w.querySelector("[data-brk-type]")?.setAttribute("aria-expanded", "false");
      });
      if (!open && wrap) {
        wrap.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
      haptic?.("selection");
    });
  });

  // Tapping an individual job (once its type row is expanded) shows the same
  // read-only detail sheet as the Log tab — "what did I actually do here",
  // not just a number in a breakdown.
  listEl.querySelectorAll(".brkJob").forEach(jobEl => {
    jobEl.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't also collapse the parent row
      const wrap = jobEl.closest(".brkRowWrap");
      const typeIdx = Number(wrap?.dataset.brkTypeIdx);
      const jobIdx = Number(jobEl.dataset.brkJobIdx);
      const entry = jobsByType[typeIdx]?.[jobIdx];
      if (entry) openEntryDetail(entry);
    });
  });

  // Donut slices and legend dots already carry the job-type name — wire them
  // to open (and scroll to) the matching row's job list, so tapping the
  // chart itself is a way into the work, not just a picture of it.
  const openBrkType = (name) => {
    const btn = listEl.querySelector(`[data-brk-type="${CSS.escape(name)}"].brkRow`);
    const wrap = btn?.closest(".brkRowWrap");
    if (!btn || !wrap) return;
    if (!wrap.classList.contains("open")) btn.click();
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  chartEl.querySelectorAll(".brkArc, .brkLegendItem").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => openBrkType(el.dataset.type || el.getAttribute("data-brk-type")));
  });
}

// ═══════════════════════════════════════════════════════════════
// JOB SCORECARD — which job types actually pay best
// ═══════════════════════════════════════════════════════════════
// For a flat-rate tech the key question isn't "what did I make the most on"
// (that's just whatever you did most often) — it's "which jobs pay best for
// the time they eat." This ranks job types by effective $/hr so you know what
// to chase and what to avoid, and flags types with a high comeback rate since
// comebacks are unpaid time.

// Below this many jobs a type's average is too noisy to call a trend.
const SCORECARD_MIN_SAMPLE = 3;

// How far apart two job types' $/hr need to be (in dollars) before we treat
// the difference as real signal rather than rounding noise.
const SCORECARD_RATE_EPSILON = 0.5;

function computeJobScorecard(entries) {
  const map = new Map();
  for (const e of (entries || [])) {
    const name = normalizeJobType(e.type || e.typeText || "") || "Other";
    const cur = map.get(name) || { name, count: 0, hours: 0, earnings: 0, comebacks: 0 };
    cur.count    += 1;
    cur.hours    += Number(e.hours    || 0);
    cur.earnings += Number(e.earnings || 0);
    if (e.isComeback) cur.comebacks += 1;
    map.set(name, cur);
  }

  const rows = Array.from(map.values()).map(t => {
    const hours = round1(t.hours);
    const earnings = round2(t.earnings);
    return {
      ...t,
      hours,
      earnings,
      perHour:     hours   > 0 ? round2(earnings / hours) : 0,
      perJob:      t.count > 0 ? round2(earnings / t.count) : 0,
      avgHours:    t.count > 0 ? round1(hours / t.count)    : 0,
      comebackPct: t.count > 0 ? Math.round((t.comebacks / t.count) * 100) : 0,
      reliable:    t.count >= SCORECARD_MIN_SAMPLE,
    };
  });

  // Most flat-rate techs are paid one personal rate per flag/book hour — pay
  // is *calculated* as hours × that one rate, not measured independently. That
  // makes $/hr mathematically identical across every job type by construction;
  // it can never tell you anything. $/hr only carries real signal for techs
  // whose effective rate genuinely differs by job (bonus/premium job types,
  // manual per-entry rate overrides, etc). So: detect which case this is and
  // rank + headline off whichever number actually varies.
  const withHours = rows.filter(r => r.hours > 0);
  const rates = withHours.map(r => r.perHour);
  const rateVaries = rates.length >= 2 &&
    (Math.max(...rates) - Math.min(...rates)) > SCORECARD_RATE_EPSILON;

  const sortKey = rateVaries ? "perHour" : "perJob";
  rows.sort((a, b) => b[sortKey] - a[sortKey] || b.earnings - a.earnings);

  return { rows, rateVaries, sortKey };
}

function renderJobScorecard(entries) {
  const el = document.getElementById("jobScorecard");
  if (!el) return;

  if (proLocked()) {
    return renderProLock(el, "Know which jobs actually pay",
      "Rank every job type by real dollars-per-hour so you know what to chase and what's quietly costing you.");
  }

  const { rows, rateVaries, sortKey } = computeJobScorecard(entries);
  // Scorecard's whole point is comparing job types against each other — with
  // only one type logged this period there's nothing to rank, so a "low data"
  // stub here is just noise on top of what the donut/summary already show.
  if (rows.length < 2) { el.innerHTML = ""; return; }
  const totalCount = entries.length;

  // Only crown a "best" when there's enough data to mean something, and when
  // there's actually something to compare it against.
  const reliable = rows.filter(r => r.reliable);
  const best  = reliable.length >= 2 ? reliable[0] : null;
  const worst = reliable.length >= 3 ? reliable[reliable.length - 1] : null;

  const headline = best
    ? (rateVaries
        ? `<div class="jsHeadline">💡 <strong>${escapeHtml(best.name)}</strong> is your best earner at
             <strong>${formatMoney(best.perHour)}/hr</strong>${
               worst && worst.perHour > 0 && worst.name !== best.name
                 ? ` — that's ${(best.perHour / worst.perHour).toFixed(1)}× what ${escapeHtml(worst.name)} pays.`
                 : "."
             }</div>`
        : `<div class="jsHeadline">💡 <strong>${escapeHtml(best.name)}</strong> pays the most per job at
             <strong>${formatMoney(best.perJob)}</strong>${
               worst && worst.perJob > 0 && worst.name !== best.name
                 ? ` — ${(best.perJob / worst.perJob).toFixed(1)}× what ${escapeHtml(worst.name)} pays.`
                 : "."
             } Your $/hr is the same across job types since it's flag hours × your flat rate — this is what actually varies.</div>`)
    : `<div class="jsHeadline jsHeadline--muted">Log at least ${SCORECARD_MIN_SAMPLE} of a job type to see which pays best.</div>`;

  const rowsHtml = rows.map(r => {
    const isBest = best && r.name === best.name;
    const hotCb  = r.comebackPct >= 20 && r.count >= SCORECARD_MIN_SAMPLE;
    const rateVal = r[sortKey];
    const pct = totalCount > 0 ? Math.round((r.count / totalCount) * 100) : 0;
    return `
      <div class="jsRow${isBest ? " jsRow--best" : ""}">
        <div class="jsRowMain">
          <div class="jsRowName">
            ${escapeHtml(r.name)}
            ${isBest ? '<span class="jsBadge jsBadge--best">TOP</span>' : ""}
            ${hotCb ? `<span class="jsBadge jsBadge--warn">${r.comebackPct}% CB</span>` : ""}
            ${!r.reliable ? '<span class="jsBadge jsBadge--thin">low data</span>' : ""}
          </div>
          <div class="jsRowSub">${r.count} job${r.count === 1 ? "" : "s"} (${pct}%) · ${r.avgHours}h avg · ${
            rateVaries ? `${formatMoney(r.perJob)}/job` : `${formatMoney(r.perHour)}/hr`
          }</div>
        </div>
        <div class="jsRowRate">
          <div class="jsRateVal">${rateVal > 0 ? formatMoney(rateVal) : "—"}</div>
          <div class="jsRateLbl">${rateVaries ? "per hour" : "per job"}</div>
        </div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="jsHeader">
      <span class="jsTitle">🏆 Job Scorecard</span>
      <span class="jsSubtitle">${rateVaries ? "ranked by real $/hr" : "ranked by $/job"}</span>
    </div>
    ${headline}
    <div class="jsRows">${rowsHtml}</div>
  `;
}

function initBreakdownPage() {
  let period = "week";
  const seg        = document.getElementById("statsPeriodSeg");
  const customWrap = document.getElementById("statsCustomRange");
  const fromEl     = document.getElementById("statsFromDate");
  const toEl       = document.getElementById("statsToDate");
  const applyBtn   = document.getElementById("statsDateApply");

  // Keep the selected period visible even if the row hasn't been scrolled —
  // there are 13 chips and only ~4 fit, so the active one is often off-screen.
  const revealActiveChip = () => {
    const active = seg?.querySelector(".statsChip.active");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  if (seg) {
    seg.querySelectorAll(".statsChip[data-period]").forEach(btn => {
      btn.addEventListener("click", () => {
        seg.querySelectorAll(".statsChip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        revealActiveChip();
        period = btn.dataset.period;
        // Show/hide custom range picker
        if (customWrap) customWrap.style.display = period === "custom" ? "flex" : "none";
        if (period !== "custom") renderBreakdownPage(period);
      });
    });
  }

  if (applyBtn && fromEl && toEl) {
    applyBtn.addEventListener("click", () => {
      renderBreakdownPage("custom", fromEl.value, toEl.value);
    });
  }

  renderBreakdownPage(period);
  setTimeout(revealActiveChip, 260);
}

window.__FR.initBreakdownPage   = initBreakdownPage;
window.__FR.renderBreakdownPage = renderBreakdownPage;
