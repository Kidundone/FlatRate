let EDITING_ID = null; // null = creating new
let EDITING_ENTRY = null;
let isSaving = false;

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
    notes: document.querySelector('textarea[name="notes"]')?.value || "",
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
    const notesEl = document.querySelector('textarea[name="notes"]');
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
    btn.classList.toggle("selected", btn.getAttribute("data-hours-quick") === next);
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
  const notesEl = document.querySelector('textarea[name="notes"]');

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
  clearPickedPhoto();
  setPhotoLabelFromEntry(entry);

  setRefType(entry.refType || "RO");

  const detailsPanel = document.getElementById("detailsPanel");
  const detailsBtn = document.getElementById("toggleDetailsBtn");
  if (detailsPanel && detailsBtn) {
    detailsPanel.style.display = "block";
    detailsBtn.textContent = "Less";
  }

  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.disabled = false;
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

  await onDeleteClicked(ev?.currentTarget, entry.id);
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
  const notesEl = document.querySelector('textarea[name="notes"]');

  if (refEl) refEl.value = "";
  if (vinEl) vinEl.value = "";
  if (typeEl) typeEl.value = preservedType;
  if (hoursEl) { hoursEl.value = ""; hoursEl.dataset.touched = ""; }
  if (rateEl) { rateEl.value = String(getDefaultRate()); rateEl.dataset.touched = ""; }
  if (notesEl) notesEl.value = "";
  clearPickedPhoto();
  if (empInputEl) empInputEl.value = getEmpId();
  setRefType("RO");
  const detailsPanel = document.getElementById("detailsPanel");
  const detailsBtn = document.getElementById("toggleDetailsBtn");
  if (detailsPanel) detailsPanel.style.display = "none";
  if (detailsBtn) detailsBtn.textContent = "Add Details";
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.disabled = true;
  const dw = document.getElementById("dupWarnGlobal");
  if (dw) { dw.style.display = "none"; dw.dataset.level = ""; }
  const ep = document.getElementById("earningsPreview");
  if (ep) { ep.textContent = ""; ep.classList.remove("hasValue"); }
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
  if (vin8) parts.push(`VIN ${escapeHtml(vin8)}`);
  if (entryHasPhoto(entry)) parts.push("Photo");
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

  const ref = String(document.getElementById("ref")?.value || "").trim().toUpperCase();
  const type = String(document.getElementById("typeText")?.value || "").trim().toLowerCase();
  const hours = round1(num(document.getElementById("hours")?.value));
  const dayKey = todayKeyLocal();

  const pool = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
    .filter(e => e.dayKey === dayKey && String(e.id ?? "") !== String(EDITING_ID ?? ""));

  // Strong: same RO on same day
  if (ref.length >= 2) {
    const hit = pool.find(e => String(e.ref || e.ro || "").trim().toUpperCase() === ref);
    if (hit) {
      warn.dataset.level = "strong";
      warn.style.display = "";
      warn.textContent = `⛔ RO ${ref} already logged today — ${hit.type || hit.typeText || "?"} · ${hit.hours} hrs · ${formatMoney(hit.earnings)}`;
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
    el.textContent = `= ${formatMoney(round2(hours * rate))}`;
    el.classList.add("hasValue");
  } else {
    el.textContent = "";
    el.classList.remove("hasValue");
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

function updateHeroSection(todayDollars, weekHours, flaggedHours, todayCount, daysWorked, weekDollars) {
  // Big pay number
  const payEl = document.getElementById("heroPayAmt");
  if (payEl) payEl.textContent = formatMoney(todayDollars);

  // Goal ring
  const arcEl = document.getElementById("heroGoalArc");
  const pctEl = document.getElementById("heroGoalPct");
  const circ = 188.5;
  if (arcEl && pctEl) {
    if (flaggedHours > 0) {
      const pct = Math.min(1, weekHours / flaggedHours);
      arcEl.style.strokeDashoffset = String(circ - pct * circ);
      pctEl.textContent = Math.round(pct * 100) + "%";
    } else {
      arcEl.style.strokeDashoffset = String(circ);
      pctEl.textContent = "—";
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
}

function renderHeroChart(entries, weekStart) {
  const svg = document.getElementById("heroChartSvg");
  const labelsRow = document.getElementById("heroChartLabels");
  if (!svg || !labelsRow) return;

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
    const dollars = dayEntries.reduce((s, e) => s + (Number(e.dollars) || 0), 0);
    buckets.push({ label: days[d.getDay()], key: k, dollars, isToday: k === todayKey });
  }

  const max = Math.max(...buckets.map(b => b.dollars), 1);
  const W = 300, H = 52, barW = 30, gap = (W - 7 * barW) / 8;

  let svgContent = "";
  buckets.forEach((b, i) => {
    const x = gap + i * (barW + gap);
    const barH = Math.max(3, (b.dollars / max) * (H - 6));
    const y = H - barH;
    const color = b.isToday ? "#22c55e" : b.dollars > 0 ? "rgba(34,197,94,.28)" : "rgba(255,255,255,.06)";
    svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" rx="4" fill="${color}"/>`;
  });
  svg.innerHTML = svgContent;

  labelsRow.innerHTML = buckets.map(b =>
    `<span class="heroChartLabel${b.isToday ? " heroChartLabel--now" : ""}">${b.label}</span>`
  ).join("");
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
  if (!confirm(`Delete ${selected.length} selected ${word}? This cannot be undone.`)) return;
  let failed = 0;
  for (const e of selected) {
    try { await onDeleteClicked(null, e.id); } catch { failed++; }
  }
  if (failed > 0) toast(`${failed} entr${failed === 1 ? "y" : "ies"} failed to delete — try again`);
  await safeLoadEntries();
}

window.__FR = window.__FR || {};
window.__FR.updateEarningsPreview = updateEarningsPreview;
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
      if (isTimeout || isNetworkErr) {
        const localEntry = { ...entry, _pending: true };
        CURRENT_ENTRIES = syncStateEntries([localEntry, ...(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])]);
        queuePendingEntry(entry, payload);
        setEditingEntry(null);
        toast(isTimeout ? "Connection slow — saved locally, will sync" : "Saved offline — syncs when back online");
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
  if (photoStatus === "fail") toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr} (photo failed)`);
  else if (photoStatus === "ok") toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr} + Photo`);
  else toast(`${isEdit ? "Updated" : "Saved"} · ${earningsStr}`);
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
    const notesEl = document.querySelector('textarea[name="notes"]');

    const ref = (refEl?.value || "").trim();
    const vin8 = (vinEl?.value || "").trim().toUpperCase();
    const typeName = (typeEl?.value || "").trim();
    const hoursVal = num(hoursEl?.value);
    const rateVal = num(rateEl?.value) || getDefaultRate();
    const notes = (notesEl?.value || "").trim();
    const keepLastWork = shouldKeepLastWork() && !isEditing;

    if (!typeName) { toast("Type required"); return; }
    if (!hoursVal || hoursVal <= 0) { toast("Hours must be > 0"); return; }
    if (hoursVal > 24 && !confirm(`${hoursVal} hours is unusually high — save anyway?`)) return;

    if (!isEditing) {
      const todayKey = dayKeyFromISO(nowISO());
      const pool = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []).filter(e => e.dayKey === todayKey);

      // Strong block: same RO on same day
      if (ref) {
        const refUp = ref.toUpperCase();
        const hit = pool.find(e => String(e.ref || e.ro || "").trim().toUpperCase() === refUp);
        if (hit) {
          const ok = confirm(`⛔ Duplicate RO detected!\n\n${ref} was already logged today:\n${hit.type || hit.typeText || "?"} · ${hit.hours} hrs · ${formatMoney(hit.earnings)}\n\nSave anyway?`);
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
          const ok = confirm(`⚠️ Possible duplicate!\n\nSame type + hours already logged today:\n${hit.type || "?"} · ${hit.hours} hrs · ${formatTimeAgo(hit.updatedAt || hit.createdAt)}\n\nSave anyway?`);
          if (!ok) return;
        }
      }
    }

    const createdAt = (isEditing && baseEntry.createdAt) ? baseEntry.createdAt : nowISO();
    const createdAtMs = (isEditing && Number.isFinite(baseEntry.createdAtMs)) ? baseEntry.createdAtMs : Date.now();
    const dayKey = (isEditing && baseEntry.dayKey) ? baseEntry.dayKey : dayKeyFromISO(createdAt);
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
    navigator.vibrate?.(30);
    // Optimistic update: show the new entry immediately using the server-returned ID,
    // then resync in the background to pick up any server-side fields we don't have locally.
    if (!isEditing && savedEntry) {
      CURRENT_ENTRIES = syncStateEntries([savedEntry, ...(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])]);
      setCachedEntries(empId, CURRENT_ENTRIES);
    }
    refreshUI(CURRENT_ENTRIES);
    safeLoadEntries().catch(console.error);
    document.getElementById("entryList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSelectedPhotoFile(null);
    document.getElementById("photoPicker") && (document.getElementById("photoPicker").value = "");
    document.getElementById("photoCamera") && (document.getElementById("photoCamera").value = "");
    document.getElementById("photoFile") && (document.getElementById("photoFile").value = "");
    focusHoursInput();
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
  row.innerHTML = `
    <div class="histEntryLeft">
      <div class="histEntryTopLine">
        <span class="histEntryRefNum">${refLabel} ${escapeHtml(refVal)}</span>
        ${e.isComeback ? `<span class="comebackBadge">CB</span>` : ""}
        ${hasPhoto ? `<span class="histPhotoTag">📷</span>` : ""}
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
        ${hasPhoto ? `<button class="iBtn" data-action="view-photo" data-id="${e.id}">Photo</button>` : ""}
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
    const photoBtn = row.querySelector('[data-action="view-photo"]');
    if (photoBtn) photoBtn.addEventListener("click", () => openPhoto(e));
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

// Cache signed URLs. Supabase URLs expire at 30 min so we treat anything
// older than 25 min as stale and re-fetch before the browser sees a 403.
const _thumbCache = new Map();
const _THUMB_TTL_MS = 25 * 60 * 1000;
let _thumbObs = null;

function loadPhotoThumbs() {
  if (_thumbObs) { _thumbObs.disconnect(); _thumbObs = null; }
  const imgs = document.querySelectorAll('img.entryThumb[data-photo-path]');
  if (!imgs.length) return;

  const load = async (img) => {
    const path = img.getAttribute("data-photo-path");
    if (!path) return;
    const cached = _thumbCache.get(path);
    const fresh = cached && (Date.now() - cached.fetchedAt < _THUMB_TTL_MS);
    if (fresh && img.src) return; // still valid and already shown
    try {
      let url = fresh ? cached.url : null;
      if (!url) {
        url = await getPhotoUrl(path);
        if (url) _thumbCache.set(path, { url, fetchedAt: Date.now() });
      }
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
    return `  ${type}${cb}  ·  ${e.refType === "STOCK" ? "STK" : "RO"} ${ref}  ·  ${e.hours} hrs  ·  ${formatMoney(e.earnings)}`;
  });

  const cbLine = comebacks.length
    ? `⚠️ ${comebacks.length} comeback${comebacks.length > 1 ? "s" : ""} today`
    : "";

  const text = [
    `📋 Flat-Rate Summary — ${dayLabel}`,
    `Emp #${empId}`,
    "",
    ...lines,
    "",
    `🕐 ${formatHours(totals.hours)} hrs   💵 ${formatMoney(totals.dollars)}   📦 ${totals.count} job${totals.count !== 1 ? "s" : ""}`,
    ...(cbLine ? ["", cbLine] : []),
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
    if (rateVal > 0) saveSettings({ defaultRate: rateVal });
    localStorage.setItem("fr_onboard_done", "1");
    modal.style.display = "none";
    setTimeout(() => startTour(), 400);
  });
}

function syncOfflineDot() {
  const dot = document.getElementById("offlineDot");
  if (dot) dot.style.display = !navigator.onLine ? "" : "none";
  updatePendingBadge?.();
}

// ── Referral share ──────────────────────────────────────────────
async function shareReferral() {
  const url = "https://nellylabs.dev";
  const text = `I use Flat-Rate Tracker at work to log jobs and catch missing pay. Free to start — ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Flat-Rate Tracker", text, url }); return; } catch {}
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
  doc.text("Flat Rate — Weekly Report", left, y);
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
  return String(name || "").trim();
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

async function syncTypesFromEntries(entriesRaw, empIdRaw = getEmpId()) {
  const empId = cleanEmpId(empIdRaw);
  if (!empId) return 0;

  const entries = filterEntriesByEmp(normalizeEntries(entriesRaw), empId)
    .slice()
    .sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  if (!entries.length) return 0;

  const existing = await loadTypesSorted(empId);
  const existingNames = new Set(existing.map((t) => normalizeTypeLower(t.name)));
  let added = 0;

  for (const entry of entries) {
    const name = normalizeTypeName(entry.type || entry.typeText);
    const nameLower = normalizeTypeLower(name);
    if (!name || existingNames.has(nameLower)) continue;

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
  _typeRenderTimer = setTimeout(() => {
    renderTypeDatalist().catch(() => {});
    renderTypesListInMore().catch(() => {});
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
    const shown = types.slice(0, 8);
    strip.innerHTML = "";
    if (shown.length === 0) {
      strip.hidden = false;
      strip.innerHTML = `<span class="typeSuggestHint">Type anything — saved types appear here after you log entries</span>`;
      return;
    }
    strip.hidden = false;
    for (const t of shown) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "typeSuggestChip";
      chip.textContent = t.name;
      const applyChip = (e) => {
        e.preventDefault();
        const typeEl = $("typeText");
        if (!typeEl) return;
        typeEl.value = t.name;
        typeEl.dispatchEvent(new Event("input", { bubbles: true }));
        typeEl.dispatchEvent(new Event("change", { bubbles: true }));
        strip.hidden = true;
        typeEl.focus();
      };
      chip.addEventListener("mousedown", applyChip);
      chip.addEventListener("touchstart", applyChip, { passive: false });
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
  if (!empId) return alert("Enter Employee # first.");

  const nameEl = document.getElementById("savedTypeName");
  const hoursEl = document.getElementById("savedTypeHours");
  const rateEl = document.getElementById("savedTypeRate");

  const name = normalizeTypeName(nameEl?.value || "");
  const hours = Number(hoursEl?.value || 0);
  const rate = Number(rateEl?.value || getDefaultRate());

  if (!name) return alert("Type name required.");
  if (!Number.isFinite(hours) || hours < 0) return alert("Default hours must be a number >= 0.");
  if (!Number.isFinite(rate) || rate < 0) return alert("Rate must be a number >= 0.");

  const existing = await findTypeByName(empId, name);
  await upsertTypeDefaults(name, hours, rate);

  if (nameEl) nameEl.value = "";
  if (hoursEl) hoursEl.value = "0.5";
  if (rateEl) rateEl.value = String(getDefaultRate());

  toast(`${name} ${existing ? "updated" : "added"}`);
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
  for (const t of types) {
    const div = document.createElement("div");
    div.className = "typeRow";
    div.dataset.id = t.id;
    div.innerHTML = `
      <div class="typeRowMain">
        <div class="typeRowInfo">
          <div class="typeRowName">${escapeHtml(t.name)}</div>
          <div class="typeRowMeta">${round1(t.lastHours||0)} hrs · ${formatMoney(t.lastRate||0)}/hr</div>
        </div>
        <div class="typeRowActions">
          <button class="iBtn typeEditBtn" type="button">Edit</button>
          <button class="iBtn iBtn--danger typeDelBtn" type="button">Delete</button>
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
      editBtn.textContent = open ? "Edit" : "Close";
    });
    cancelBtn.addEventListener("click", () => {
      form.style.display = "none";
      editBtn.textContent = "Edit";
    });
    saveBtn.addEventListener("click", async () => {
      const hrs  = Number(div.querySelector(".typeEditHours").value || 0);
      const rate = Number(div.querySelector(".typeEditRate").value || 0);
      if (!Number.isFinite(hrs) || hrs < 0) return;
      if (!Number.isFinite(rate) || rate < 0) return;
      await upsertTypeDefaults(t.name, hrs, rate);
      form.style.display = "none";
      editBtn.textContent = "Edit";
      div.querySelector(".typeRowMeta").textContent = `${round1(hrs)} hrs · ${formatMoney(rate)}/hr`;
      toast?.(`${t.name} updated`);
    });
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete type "${t.name}"?`)) return;
      await del(STORES.types, t.id);
      await renderTypeDatalist();
      await renderTypesListInMore();
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
  const weekEntries = entries.filter(e => inWeek(e.dayKey, weekStart));
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
    return entries.filter(e => inWeek(e.dayKey, ws));
  }
  if (mode === "month") {
    const ms = startOfMonthLocal(now);
    return entries.filter(e => inMonth(e.dayKey, ms));
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
  const pass = prompt("Admin export. Enter passcode:");
  return pass === "0231"; // change this
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
      await saveEditedLog(e.id, { cash_amount: newEarnings });
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
      ? `<div class="emptyState">
           <div class="emptyStateTitle">No results for "${escapeHtml(q)}"</div>
           <div class="emptyStateSub">Try a different RO, VIN, or work type</div>
         </div>`
      : `<div class="emptyState">
           <div class="emptyStateTitle">No entries yet</div>
           <div class="emptyStateSub">Select hours above and tap Save to start logging</div>
         </div>`;
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
    row.className = hlQ ? "item" : "item collapsed";
    const tc = (e.type || e.typeText || "").toLowerCase().replace(/\s+/g, "");
    const tcMap = { sold: "sold", warranty: "warranty", fpf: "fpf", preowned: "preowned", "pre-owned": "preowned" };
    row.dataset.tc = tcMap[tc] || "default";
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
              ${typeBadgeHtml(escapeHtml(e.type || e.typeText || "—"))}
              ${e.isComeback ? `<span class="comebackBadge">CB</span>` : ""}
              <span class="itemRef mono">${refLabel}: ${refVal}</span>
            </div>
            ${buildEntryMetaHtml(e)}
            ${e.notes ? `<div class="itemNotes">${hl(e.notes)}</div>` : ""}
            ${hasPhoto ? `<div class="entryThumbWrap"><img class="entryThumb" data-photo-path="${escapeHtml(photoPath)}" alt="Proof" /></div>` : ""}
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
      sx = lx = ev.touches[0].clientX;
      sy = ev.touches[0].clientY;
      tracking = true; swiping = false; dir = null;
    }, { passive: true });

    inner.addEventListener("touchmove", ev => {
      if (!tracking) return;
      lx = ev.touches[0].clientX;
      const dx = lx - sx, dy = ev.touches[0].clientY - sy;
      if (!swiping) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          swiping = true; dir = dx < 0 ? "left" : "right";
          row.classList.add("swiping");
        } else if (Math.abs(dy) > 8) { tracking = false; return; }
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
      const wk = e.weekStartKey || dateKey(startOfWeekLocal(new Date(dk)));
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
    const days = computeWeekBreakdown(entries.filter(e => inWeek(e.dayKey, ws)), ws);
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
  const title =
    mode === "day"   ? (navOff === 0 ? "Today" : mo(navNow)) :
    mode === "week"  ? (navOff === 0 ? (summaryRange === "lastWeek" ? "Last Week" : "This Week") : `Week of ${dateKey(ws)}`) :
    mode === "month" ? "This Month" : "All Time";

  setText("rangeTitle", title);
  setText("rangeHours", r1(totals.hours));
  setText("rangeDollars", formatMoney(totals.dollars));
  setText("rangeCount", String(totals.count));
  setText("rangeAvgHrs", r1(totals.avgHrs));
  setText("rangeEffRate", totals.hours > 0 ? formatMoney(round2(totals.dollars / totals.hours)) : "—");
  setText("rangeSub", rangeSubLabel(mode));
  setText("statsSummaryHours", `${r1(totals.hours)} hrs`);
  setText("statsSummaryDollars", formatMoney(totals.dollars));

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
    const gc = document.getElementById("weekGoalCard");
    if (gc) gc.style.display = "none";
  } else {
    delta = round1(flagged - week.hours);
    setText("weekDelta", String(delta));
    setText("weekDeltaHint", "");

    const pct = Math.min(100, Math.round((week.hours / flagged) * 100));
    const gc = document.getElementById("weekGoalCard");
    const gf = document.getElementById("weekGoalFill");
    const gl = document.getElementById("weekGoalLabel");
    const gs = document.getElementById("weekGoalSub");
    if (gc) gc.style.display = "";
    if (gf) { gf.style.width = pct + "%"; gf.classList.toggle("complete", pct >= 100); }
    if (gl) gl.textContent = `${r1(week.hours)} / ${r1(flagged)} hrs`;
    if (gs) {
      const rem = round1(Math.max(0, flagged - week.hours));
      gs.textContent = pct >= 100
        ? `Goal reached! ${formatMoney(week.dollars)} earned this week`
        : `${rem} hrs to go • ${formatMoney(week.dollars)} earned so far`;
    }
  }

  // Hero section update (needs flaggedHours + week data)
  {
    const daysWorked = new Set(entries.filter(e => inWeek(e.dayKey, ws)).map(e => e.dayKey).filter(Boolean)).size;
    updateHeroSection(today.dollars, week.hours, flagged, today.count, daysWorked, week.dollars);
  }

  // Pace projection + daily avg/job
  const paceEl = document.getElementById("paceLine");
  if (paceEl) {
    const daysWorked = new Set(entries.filter(e => inWeek(e.dayKey, ws)).map(e => e.dayKey).filter(Boolean)).size;
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

  // stash last week calc for export (delta always set)
  window.__WEEK_STATE__ = { ws, we, week, flagged, delta };
}

/* -------------------- Onboarding tour -------------------- */

const TOUR_STEPS = [
  {
    el: null,
    title: "Welcome to Flat-Rate Log",
    body: "Built for flat-rate mechanics at Flow Motors WS. Log every job, track your hours and earnings, spot short pay, and keep proof photos — all offline-first. Tap Next for a quick walkthrough.",
  },
  {
    el: ".heroSection",
    title: "Your Pay Dashboard",
    body: "The top of the screen is your command center. The big number is today's pay. The green ring tracks your weekly hour goal. The bar chart below shows your earnings by day — today is highlighted green.",
  },
  {
    el: "#empId",
    title: "Employee Number",
    body: "Enter your employee number here. Every entry is tied to it so your data stays yours even on a shared device. It saves automatically — you only do this once.",
  },
  {
    el: ".fr26QuickHours",
    title: "Log Hours — Quick Buttons",
    body: "Tap a quick button for the hours the job paid — 0.5, 1.0, 1.5, up to 5.0. Or type any value directly in the Hours field above. Flat-rate doesn't care what the clock said, only what the job paid.",
  },
  {
    el: "#typeText",
    title: "Describe the Work",
    body: "Type what you did — 'Front brakes', 'Oil change', 'PDI', 'Engine mount'. The app remembers your job types and suggests them as you type, so logging gets faster every shift.",
  },
  {
    el: ".fr26QuickTools",
    title: "Add Details — RO, VIN, Photo",
    body: "Tap 'Add Details' for extra fields: RO number, stock number, last 8 of VIN, a per-job rate override, notes, and a proof photo. Optional but essential if you ever need to dispute short pay.",
  },
  {
    el: "#saveBtn",
    title: "Save the Entry",
    body: "Hit Save and the job is recorded instantly — even with no signal on the shop floor. Entries queue up offline and sync to the cloud automatically when you reconnect.",
  },
  {
    el: "#statsStrip",
    title: "Live Totals Strip",
    body: "Four tiles below the chart: today's hours, job count, today's pay, and this week's total pay. They update the moment you save a job — no refreshing needed.",
  },
  {
    el: "#statsPanel",
    title: "Stats — Day, Week, Month, All Time",
    body: "Tap the Stats card to expand it. Switch between Day, Week, Month, and All Time views. In Week mode you get a daily breakdown — tap any day to filter the list to just that day's jobs.",
  },
  {
    el: "#historyBtn",
    title: "History & Search",
    body: "Tap History to pull up all past entries. Search by RO number, stock number, VIN, or job type across any time range — fast way to find a specific job if you need to reference it.",
  },
  {
    el: ".tabItem:last-child",
    title: "Sign In for Cloud Backup →",
    body: "Last step: sign in so your data is backed up and syncs across all your devices. Tap Next and we'll go to the More tab to set that up.",
    action: "goto-more",
  },
];

function maybeStartTour() {
  if (localStorage.getItem("fr_tour_done")) return;
  // If the setup modal is still open, the tour will fire from the Get Started click handler
  const modal = document.getElementById("onboardingModal");
  if (modal && modal.style.display !== "none") return;
  startTour();
}

function startTour() {
  if (localStorage.getItem("fr_tour_done")) return;
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
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    overlay.style.background = "transparent";
    overlay.classList.add("tour-has-target");
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      const pad = 8;
      spotlight.style.cssText = `display:block;top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
      spotlight.classList.add("pulse");
    }, 260);
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
    if (spotlight) { spotlight.style.cssText = "display:none;"; spotlight.classList.remove("pulse"); }
    localStorage.setItem("fr_tour_done", "1");
  }

  nextBtn.onclick = () => {
    const current = TOUR_STEPS[step];
    if (current?.action === "goto-more") {
      // Mark tour as mid-flight so the More page continues it
      localStorage.setItem("fr_tour_more", "1");
      endTour();
      window.location.href = "./more.html";
      return;
    }
    step++;
    if (step >= TOUR_STEPS.length) endTour();
    else show(step);
  };
  skipBtn.onclick = endTour;

  show(0);
}
