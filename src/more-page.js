/* -------------------- Payroll flagged hours (per week) -------------------- */
async function getThisWeekFlag(){
  const ws = startOfWeekLocal(new Date());
  const key = dateKey(ws);
  const stored = await get(STORES.weekflags, key);
  if (stored && Number.isFinite(Number(stored.flaggedHours))) return stored;

  const paid = getPaidRecordForWeekStart(ws);
  if (paid != null) {
    return { weekStartKey: key, flaggedHours: Number(paid || 0), updatedAt: null };
  }

  const stub = getPayStubForWeekKey(key);
  if (stub) {
    return { weekStartKey: key, flaggedHours: Number(stub.hoursPaid || 0), updatedAt: stub.updatedAt || null };
  }

  return null;
}
async function setThisWeekFlag(flaggedHours){
  const ws = startOfWeekLocal(new Date());
  const key = dateKey(ws);
  const value = Number(flaggedHours || 0);
  await put(STORES.weekflags, { weekStartKey: key, flaggedHours: value, updatedAt: nowISO() });
  setPaidHoursForWeekKey(key, value);
}

/* -------------------- Payroll scans (per week) -------------------- */
async function getWeekPayroll(){
  const ws = startOfWeekLocal(new Date());
  const key = dateKey(ws);
  return await get(STORES.payroll, key);
}

async function saveWeekPayroll({ photoDataUrl }){
  const ws = startOfWeekLocal(new Date());
  const key = dateKey(ws);
  await put(STORES.payroll, { weekStartKey: key, photoDataUrl: photoDataUrl || null, updatedAt: nowISO() });
}

function rateForPdfEntry(entry, hours) {
  const directRate = Number(entry?.rate);
  if (Number.isFinite(directRate) && directRate >= 0) return directRate;

  const earnings = Number(entry?.earnings);
  if (Number.isFinite(earnings) && hours > 0) return earnings / hours;

  return 0;
}

function payForPdfEntry(entry, hours, rate) {
  const earnings = Number(entry?.earnings);
  if (Number.isFinite(earnings)) return round2(earnings);
  return round2(hours * rate);
}

async function exportEntriesToPDF(entries) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF export is not ready yet. Refresh and try again.");
    return;
  }

  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    alert("No entries to export.");
    return;
  }

  const doc = new jsPDF();
  const left = 20;
  const pageBottom = doc.internal.pageSize.getHeight() - 16;
  let y = 20;

  const nextLine = (step = 6) => {
    y += step;
    if (y > pageBottom) {
      doc.addPage();
      y = 20;
    }
  };

  doc.setFontSize(16);
  doc.text("Flat Rate Tracker Report", left, y);

  nextLine(10);

  const emp = getEmpId() || "N/A";
  doc.setFontSize(11);
  doc.text(`Employee: ${emp}`, left, y);

  nextLine(10);
  doc.text("RO      Type      Hours      Pay", left, y);
  nextLine(6);

  let totalHours = 0;
  let totalPay = 0;

  for (const e of rows) {
    const ro = e?.ro_number || e?.ref || e?.ro || "-";
    const type = e?.type || e?.typeText || e?.category || "-";
    const hours = Number(e?.hours ?? e?.flat_hours ?? 0) || 0;
    const rate = rateForPdfEntry(e, hours);
    const pay = payForPdfEntry(e, hours, rate);

    doc.text(
      `${String(ro).slice(0, 14)}   ${String(type).slice(0, 18)}   ${round1(hours)}   $${pay.toFixed(2)}`,
      left,
      y
    );
    nextLine(6);

    totalHours += hours;
    totalPay += pay;
  }

  nextLine(4);
  doc.text(`Total Hours: ${round1(totalHours)}`, left, y);
  nextLine(6);
  doc.text(`Total Pay: $${round2(totalPay).toFixed(2)}`, left, y);

  doc.save(`flat-rate-report-${todayKeyLocal()}.pdf`);
}

function exportSelected() {
  const selected = (window.STATE?.entries || []).filter((entry) => entry?.selected);

  if (!selected.length) {
    alert("No entries selected");
    return;
  }

  exportEntriesToPDF(selected);
}

function exportWeek(weekKey) {
  const currentWeekKey = dateKey(startOfWeekLocal(new Date()));
  const key = String(weekKey || currentWeekKey).trim();

  const entries = (window.STATE?.entries || []).filter((entry) => (
    String(entry?.weekStartKey || "") === key
    || String(entry?.dayKey || "").startsWith(key)
  ));

  if (!entries.length) {
    alert(`No entries found for week: ${key}`);
    return;
  }

  exportEntriesToPDF(entries);
}

window.exportEntriesToPDF = exportEntriesToPDF;
window.exportSelected = exportSelected;
window.exportWeek = exportWeek;

async function exportCSV(){
  const all = await getAll(STORES.entries);
  const entries = filterEntriesByEmp(all, getEmpId(), true);
  entries.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  downloadText(`flat_rate_log_${todayKeyLocal()}.csv`, toCSV(entries, true), "text/csv");
}

async function exportJSON(){
  const all = await getAll(STORES.entries);
  const entries = filterEntriesByEmp(all, getEmpId(), true);
  entries.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  downloadText(`flat_rate_log_${todayKeyLocal()}.json`, JSON.stringify(entries, null, 2), "application/json");
}

async function saveFlaggedHours(){
  const fh = document.getElementById("flaggedHours");
  const val = fh ? Number(fh.value || 0) : 0;
  if (!Number.isFinite(val) || val < 0) return alert("Flagged hours must be a number >= 0.");
  await setThisWeekFlag(val);
  alert("Flagged hours saved for this week.");
}

function expectedTotalsForWeekKey(weekStartKey, empId = getEmpId()) {
  const dt = parseDateInputValue(weekStartKey);
  if (!dt) return { totals: computeTotals([]), entries: [] };

  const source = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const ownEntries = filterEntriesByEmp(source, empId);
  const weekEntries = ownEntries.filter((entry) => {
    const day = entry?.dayKey || dayKeyFromISO(entry?.createdAt);
    return day ? inWeek(day, dt) : false;
  });

  return { totals: computeTotals(weekEntries), entries: weekEntries };
}

function signedHoursLabel(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${formatHours(Math.abs(n))}`;
}

function signedMoneyLabel(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${formatMoney(Math.abs(n))}`;
}

function comparePayroll(expected, actual){
  const expHours = Number(expected?.hours || 0);
  const expPay = Number(expected?.pay || 0);
  const actHours = Number(actual?.hours || 0);
  const actPay = Number(actual?.pay || 0);

  return {
    missingHours: round1(expHours - actHours),
    missingPay: round2(expPay - actPay),
  };
}

function isBiweeklyMode() {
  return document.getElementById("payPeriodBiweekly")?.classList.contains("active");
}

function getWeek2StartKey(week1StartKey) {
  const d = parseDateInputValue(week1StartKey);
  if (!d) return null;
  d.setDate(d.getDate() + 7);
  return dateKey(d);
}

function getPayStubAuditContext() {
  const weekEl = document.getElementById("payStubWeekEnding");
  const amountEl = document.getElementById("payStubAmountPaid");
  if (!weekEl || !amountEl) {
    return { error: "Pay stub fields are not available on this page." };
  }

  const weekEnding = String(weekEl.value || "").trim();
  if (!weekEnding) return { error: "Week ending is required." };

  const weekStartKey = weekStartKeyFromDateInput(weekEnding);
  if (!weekStartKey) return { error: "Week ending date is invalid." };

  const amountPaid = Number(amountEl.value || 0);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return { error: "Check amount must be a number >= 0." };

  const biweekly = isBiweeklyMode();
  const { totals: t1, entries: e1 } = expectedTotalsForWeekKey(weekStartKey);
  let allEntries = Array.isArray(e1) ? [...e1] : [];
  let totalHours = Number(t1?.hours || 0);
  let totalPay   = Number(t1?.dollars || 0);
  let weekEnd    = "";
  let week2StartKey = null;

  if (biweekly) {
    week2StartKey = getWeek2StartKey(weekStartKey);
    if (week2StartKey) {
      const { totals: t2, entries: e2 } = expectedTotalsForWeekKey(week2StartKey);
      allEntries = [...allEntries, ...(Array.isArray(e2) ? e2 : [])];
      totalHours = round1(totalHours + Number(t2?.hours || 0));
      totalPay   = round2(totalPay   + Number(t2?.dollars || 0));
      const ws2 = parseDateInputValue(week2StartKey);
      weekEnd = ws2 ? dateKey(endOfWeekLocal(ws2)) : "";
    }
  } else {
    const ws = parseDateInputValue(weekStartKey);
    weekEnd = ws ? dateKey(endOfWeekLocal(ws)) : "";
  }

  const expected = { hours: totalHours, pay: totalPay };
  const actual   = { hours: totalHours, pay: amountPaid };
  const comparison = comparePayroll(expected, actual);

  return {
    weekEnding,
    weekStartKey,
    week2StartKey,
    weekEnd,
    biweekly,
    expected,
    actual,
    comparison,
    entries: allEntries,
  };
}

function hydratePayStubFormForWeek(weekStartKey) {
  const weekEl = document.getElementById("payStubWeekEnding");
  const amountEl = document.getElementById("payStubAmountPaid");
  if (!weekEl || !amountEl) return;

  const key = String(weekStartKey || "").trim();
  const stub = getPayStubForWeekKey(key);
  if (stub) {
    applyPayStubPeriodMode(!!stub.biweekly);
    weekEl.value = stub.weekEnding || weekEndingForWeekStartKey(key);
    amountEl.value = stub.amountPaid > 0 ? String(Number(stub.amountPaid)) : "";
    return;
  }

  const weekEnd = weekEndingForWeekStartKey(key);
  if (weekEnd) weekEl.value = weekEnd;
  amountEl.value = "";
}

function applyPayStubPeriodMode(biweekly) {
  const weeklyBtn = document.getElementById("payPeriodWeekly");
  const biweeklyBtn = document.getElementById("payPeriodBiweekly");
  const week2Row = document.getElementById("payStubWeek2Row");
  const useBiweekly = !!biweekly;

  weeklyBtn?.classList.toggle("active", !useBiweekly);
  biweeklyBtn?.classList.toggle("active", useBiweekly);
  if (week2Row) week2Row.style.display = useBiweekly ? "" : "none";
}

function loadPayStubIntoForm(weekStartKey) {
  const key = String(weekStartKey || "").trim();
  if (!key) return;
  const stub = getPayStubForWeekKey(key);

  applyPayStubPeriodMode(!!(stub?.biweekly));
  hydratePayStubFormForWeek(key);
  renderPayStubComparison();
  renderMissingWorkReview?.();

  document.getElementById("payStubWeekEnding")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const weekLabel = stub?.weekEnding || weekEndingForWeekStartKey(key) || key;
  toast(stub ? `Loaded ${weekLabel}` : `Week of ${weekLabel} — enter check amount above`);
}

async function deletePayStubFromTrend(weekStartKey) {
  const key = String(weekStartKey || "").trim();
  if (!key) return;
  const stub = getPayStubForWeekKey(key);
  if (!stub) return;

  const weekLabel = stub.weekEnding || weekEndingForWeekStartKey(key) || key;
  const extra = stub.biweekly && stub.linkedWeek ? " This will remove both linked weeks." : "";
  if (!confirm(`Delete saved pay stub for ${weekLabel}?${extra}`)) return;

  const removed = removePayStubEntry(key, { includeLinked: true });
  const selectedWeekEl = document.getElementById("payStubWeekEnding");
  const selectedKey = selectedWeekEl ? weekStartKeyFromDateInput(selectedWeekEl.value) : "";
  if (selectedKey) hydratePayStubFormForWeek(selectedKey);
  renderPayStubComparison();
  renderMissingWorkReview?.();
  renderPayTrend();
  if (typeof refreshUI === "function") await refreshUI(CURRENT_ENTRIES);
  toast(`Removed ${removed} pay stub entr${removed === 1 ? "y" : "ies"}`);
}

function renderPayStubComparison() {
  const weekEl = document.getElementById("payStubWeekEnding");
  const summaryEl = document.getElementById("payStubSummary");
  const detailsEl = document.getElementById("payStubExpected");
  if (!weekEl || !summaryEl || !detailsEl) return;

  if (!weekEl.value) {
    weekEl.value = dateKey(endOfWeekLocal(new Date()));
  }

  const ctx = getPayStubAuditContext();
  if (ctx.error) {
    summaryEl.textContent = ctx.error;
    detailsEl.textContent = "";
    return;
  }

  const checkAmt = ctx.actual.pay;
  const loggedPay = ctx.expected.pay;
  const loggedHrs = ctx.expected.hours;
  const delta = round2(checkAmt - loggedPay);

  const periodLabel = ctx.biweekly
    ? `${ctx.weekStartKey} → ${ctx.weekEnd} (2 weeks)`
    : `${ctx.weekStartKey}${ctx.weekEnd ? ` → ${ctx.weekEnd}` : ""}`;
  summaryEl.textContent = `Period: ${periodLabel}`;

  // Update week 2 label if biweekly
  const w2label = document.getElementById("payStubWeek2Label");
  if (w2label) {
    if (ctx.biweekly && ctx.week2StartKey) {
      const ws2 = parseDateInputValue(ctx.week2StartKey);
      const we2 = ws2 ? dateKey(endOfWeekLocal(ws2)) : "";
      w2label.textContent = `${ctx.week2StartKey}${we2 ? ` → ${we2}` : ""}`;
    } else {
      w2label.textContent = "";
    }
  }

  if (checkAmt <= 0) {
    detailsEl.textContent = `Logged: ${formatHours(loggedHrs)} hrs • ${formatMoney(loggedPay)}`;
    return;
  }

  const deltaLabel = delta > 0.01
    ? `+${formatMoney(delta)} (overpaid)`
    : delta < -0.01
      ? `−${formatMoney(Math.abs(delta))} short`
      : "Even";

  detailsEl.textContent =
    `Logged: ${formatHours(loggedHrs)} hrs • ${formatMoney(loggedPay)} | Check: ${formatMoney(checkAmt)} | ${deltaLabel}`;
}

function drawAuditLines(doc, rows, left, startY) {
  const pageBottom = doc.internal.pageSize.getHeight() - 16;
  let y = startY;

  for (const row of rows) {
    const line = String(row || "");
    doc.text(line, left, y);
    y += 6;
    if (y > pageBottom) {
      doc.addPage();
      y = 20;
    }
  }

  return y;
}

async function exportAuditReport() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF export is not ready yet. Refresh and try again.");
    return;
  }

  const ctx = getPayStubAuditContext();
  if (ctx.error) {
    alert(ctx.error);
    return;
  }

  const doc = new jsPDF();
  const left = 20;
  let y = 20;
  const emp = getEmpId() || "N/A";

  doc.setFontSize(16);
  doc.text("Flat Rate Audit Report", left, y);
  y += 10;

  doc.setFontSize(11);
  y = drawAuditLines(doc, [
    `Employee: ${emp}`,
    `Week Ending: ${ctx.weekEnding}`,
    `Week Range: ${ctx.weekStartKey}${ctx.weekEnd ? ` -> ${ctx.weekEnd}` : ""}`,
    "",
    `Check Amount: ${ctx.actual.pay > 0 ? formatMoney(ctx.actual.pay) : "Not entered"}`,
    `Logged Hours: ${formatHours(ctx.expected.hours)}`,
    `Logged Pay: ${formatMoney(ctx.expected.pay)}`,
    `Delta (check - logged): ${signedMoneyLabel(ctx.comparison.missingPay * -1)}`,
    "",
    `Entries used in expected totals: ${ctx.entries.length}`,
    "RO      Type      Day      Hours      Pay",
  ], left, y);

  const entryRows = ctx.entries.map((e) => {
    const ro = e?.ro_number || e?.ref || e?.ro || "-";
    const type = e?.type || e?.typeText || e?.category || "-";
    const day = e?.dayKey || dayKeyFromISO(e?.createdAt) || "-";
    const hours = Number(e?.hours ?? e?.flat_hours ?? 0) || 0;
    const rate = rateForPdfEntry(e, hours);
    const pay = payForPdfEntry(e, hours, rate);
    return `${String(ro).slice(0, 10)}   ${String(type).slice(0, 14)}   ${day}   ${round1(hours)}   $${pay.toFixed(2)}`;
  });

  if (entryRows.length) {
    y = drawAuditLines(doc, entryRows, left, y + 2);
  } else {
    y = drawAuditLines(doc, ["No entries found for that week."], left, y + 2);
  }

  y = drawAuditLines(doc, [
    "",
    `Totals: ${formatHours(ctx.expected.hours)} hrs • ${formatMoney(ctx.expected.pay)}`,
  ], left, y + 2);

  doc.save(`flat-rate-audit-${ctx.weekStartKey}.pdf`);
}

async function savePayStubEntry() {
  const weekEl = document.getElementById("payStubWeekEnding");
  const amountEl = document.getElementById("payStubAmountPaid");
  if (!weekEl || !amountEl) return;

  const weekEnding = String(weekEl.value || "").trim();
  const amountPaid = Number(amountEl.value || 0);

  if (!weekEnding) return alert("Week ending is required.");
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) return alert("Enter a check amount greater than 0.");

  const weekStartKey = weekStartKeyFromDateInput(weekEnding);
  if (!weekStartKey) return alert("Week ending date is invalid.");

  const biweekly = isBiweeklyMode();
  const week2StartKey = biweekly ? getWeek2StartKey(weekStartKey) : null;

  if (biweekly && week2StartKey) {
    // Split the check amount evenly across both weeks for per-week tracking
    const ctx = getPayStubAuditContext();
    const w1Pay = round2(Number(ctx.expected?.pay || 0));
    const total = round2(Number(ctx.actual?.pay || 0));
    const w2Pay = round2(total - w1Pay > 0 ? total - w1Pay : total / 2);
    const w1Amt = round2(total - w2Pay);
    upsertPayStubEntry({ weekStartKey, weekEnding, hoursPaid: 0, amountPaid: w1Amt, biweekly: true, linkedWeek: week2StartKey });
    const ws2 = parseDateInputValue(week2StartKey);
    const we2 = ws2 ? dateKey(endOfWeekLocal(ws2)) : weekEnding;
    upsertPayStubEntry({ weekStartKey: week2StartKey, weekEnding: we2, hoursPaid: 0, amountPaid: w2Pay, biweekly: true, linkedWeek: weekStartKey });
  } else {
    upsertPayStubEntry({ weekStartKey, weekEnding, hoursPaid: 0, amountPaid });
  }

  renderPayStubComparison();
  renderPayTrend();
  if (typeof refreshUI === "function") await refreshUI(CURRENT_ENTRIES);
  toast("Pay stub saved.");
}

function renderPayTrend() {
  const container = document.getElementById("payTrendCard");
  if (!container) return;

  const empId = getEmpId();
  if (!empId) {
    container.innerHTML = `<div class="muted small" style="padding:14px 16px;">Enter Employee # to see pay trend.</div>`;
    return;
  }

  const stubMap = loadPayStubMap();
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  // Build week set from all worked entries, plus any saved stubs
  const weekKeys = new Set();
  own.forEach(e => {
    const wsk = e.weekStartKey || (e.dayKey ? dateKey(startOfWeekLocal(new Date(e.dayKey))) : null);
    if (wsk) weekKeys.add(wsk);
  });
  Object.keys(stubMap).forEach(k => weekKeys.add(k));

  if (!weekKeys.size) {
    container.innerHTML = `<div class="muted small" style="padding:14px 16px;">No entries logged yet.</div>`;
    return;
  }

  const sortedWeeks = [...weekKeys].sort((a, b) => b.localeCompare(a));

  let totalShort = 0;
  let weeksShort = 0;
  let savedCount = 0;

  const rows = sortedWeeks.map(wsKey => {
    const ws = parseDateInputValue(wsKey);
    if (!ws) return null;
    const we = endOfWeekLocal(ws);
    const weKey = dateKey(we);

    const weekEntries = own.filter(e => e.dayKey && e.dayKey >= wsKey && e.dayKey <= weKey);
    if (!weekEntries.length && !stubMap[wsKey]) return null;

    const loggedPay = round2(weekEntries.reduce((s, e) => s + Number(e.earnings || 0), 0));
    const loggedHrs = round1(weekEntries.reduce((s, e) => s + Number(e.hours   || 0), 0));
    const stub      = stubMap[wsKey];
    const paidAmt   = stub ? round2(Number(stub.amountPaid || 0)) : null;
    const hasPaid   = paidAmt !== null && paidAmt > 0;
    const delta     = hasPaid ? round2(paidAmt - loggedPay) : null;

    if (stub) savedCount++;
    if (delta !== null && delta < -0.01) { weeksShort++; totalShort = round2(totalShort + Math.abs(delta)); }

    const mo = (d) => d.toLocaleDateString("en-US", { month: "short" });
    const dy = (d) => d.getDate();
    const weekLabel = mo(ws) === mo(we)
      ? `${mo(ws)} ${dy(ws)}–${dy(we)}`
      : `${mo(ws)} ${dy(ws)} – ${mo(we)} ${dy(we)}`;

    return { weekStartKey: wsKey, loggedPay, loggedHrs, paidAmt, hasPaid, delta, weekLabel, hasStub: !!stub, isShort: delta !== null && delta < -0.01, isOver: delta !== null && delta > 0.01 };
  }).filter(Boolean);

  if (!rows.length) {
    container.innerHTML = `<div class="muted small" style="padding:14px 16px;">No entries logged yet.</div>`;
    return;
  }

  const summaryText = savedCount === 0
    ? `${rows.length} week${rows.length !== 1 ? "s" : ""} worked — load a week above to enter your check amount`
    : weeksShort === 0
      ? `All ${savedCount} recorded week${savedCount !== 1 ? "s" : ""} paid correctly ✓`
      : `Underpaid ${weeksShort} of ${savedCount} week${savedCount !== 1 ? "s" : ""} · ${formatMoney(totalShort)} short total`;

  const rowsHtml = rows.map(r => {
    const deltaText  = r.delta === null ? "—" : r.isShort ? `−${formatMoney(Math.abs(r.delta))}` : r.isOver ? `+${formatMoney(r.delta)}` : "Even";
    const deltaClass = r.delta === null ? "" : r.isShort ? "ptDeltaShort" : r.isOver ? "ptDeltaOver" : "ptDeltaEven";
    return `
      <div class="ptRow${r.isShort ? " ptRow--short" : ""}" data-paystub-week="${escapeHtml(r.weekStartKey)}">
        <div class="ptWeek">${r.weekLabel}</div>
        <div class="ptCols">
          <div class="ptCol">
            <div class="ptColLabel">Logged</div>
            <div class="ptColVal">${formatMoney(r.loggedPay)}</div>
            <div class="ptColSub">${r.loggedHrs} hrs</div>
          </div>
          <div class="ptCol">
            <div class="ptColLabel">Check</div>
            <div class="ptColVal">${r.hasPaid ? formatMoney(r.paidAmt) : "—"}</div>
          </div>
          <div class="ptCol ptColRight">
            <div class="ptColLabel">Delta</div>
            <div class="ptColVal ${deltaClass}">${deltaText}</div>
          </div>
        </div>
        <div class="ptActions">
          <button class="btn ptActionBtn" type="button" data-paystub-load="${escapeHtml(r.weekStartKey)}">Load</button>
          ${r.hasStub ? `<button class="btn danger-ghost ptActionBtn" type="button" data-paystub-del="${escapeHtml(r.weekStartKey)}">Delete</button>` : ""}
        </div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="ptSummary ${weeksShort > 0 ? "ptSummaryWarn" : savedCount > 0 ? "ptSummaryOk" : ""}">${summaryText}</div>
    <div class="ptList">${rowsHtml}</div>`;

  container.querySelectorAll("[data-paystub-load]").forEach((btn) => {
    btn.addEventListener("click", () => loadPayStubIntoForm(btn.getAttribute("data-paystub-load")));
  });
  container.querySelectorAll("[data-paystub-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deletePayStubFromTrend(btn.getAttribute("data-paystub-del"));
    });
  });
}

window.renderPayTrend = renderPayTrend;

async function refreshMorePagePanels() {
  if (window.__PAGE__ !== "more") return;

  renderInsights?.();
  renderEarningsChart?.();
  renderPayTrend?.();
  renderPayStubComparison?.();
  renderMissingWorkReview?.();
  await renderTypesListInMore?.();
  await refreshPayrollUI?.();
  if (document.getElementById("reviewList")) await renderReview?.();
}

window.refreshMorePagePanels = refreshMorePagePanels;

async function _callScanPayStub(base64, mediaType = "image/jpeg") {
  const sbInstance = window.__FR?.sb;
  const { data: { session } } = await sbInstance.auth.getSession();
  const token = session?.access_token || window.__SUPABASE_CONFIG__.anonKey;
  const fnUrl = `${window.__SUPABASE_CONFIG__.url}/functions/v1/scan-paystub`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": window.__SUPABASE_CONFIG__.anonKey,
    },
    body: JSON.stringify({ imageBase64: base64, mediaType }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Scan failed (${res.status}): ${txt}`);
  }
  return res.json();
}

async function scanPayStub(file) {
  const amountEl = document.getElementById("payStubAmountPaid");
  const scanBtn = document.getElementById("scanCheckBtn");
  if (!amountEl || !scanBtn) return;

  const origText = scanBtn.textContent;
  scanBtn.textContent = "Scanning…";
  scanBtn.disabled = true;

  try {
    const dataUrl = await compressImageFileToDataUrl(file, 1200, 0.75);
    const base64 = dataUrl.split(",")[1];
    const mediaType = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    const result = await _callScanPayStub(base64, mediaType);

    if (result.gross != null && result.gross > 0) {
      amountEl.value = String(result.gross);
      amountEl.dispatchEvent(new Event("input"));
      toast(`Found: ${formatMoney(result.gross)}`);
    } else if (result.error) {
      toast(`Scan: ${result.error}`);
    } else {
      toast("Could not find gross pay — enter manually.");
    }
  } catch (e) {
    console.warn("[scanPayStub]", e?.message || e);
    toast(`Scan failed: ${e?.message || "try again"}`);
  } finally {
    scanBtn.textContent = origText;
    scanBtn.disabled = false;
  }
}

function initPayStubUI() {
  const weekEl = document.getElementById("payStubWeekEnding");
  const amountEl = document.getElementById("payStubAmountPaid");
  if (!weekEl || !amountEl) return;

  if (!weekEl.value) weekEl.value = dateKey(endOfWeekLocal(new Date()));

  const startKey = weekStartKeyFromDateInput(weekEl.value);
  if (startKey) hydratePayStubFormForWeek(startKey);
  renderPayStubComparison();

  weekEl.addEventListener("change", () => {
    const key = weekStartKeyFromDateInput(weekEl.value);
    if (key) hydratePayStubFormForWeek(key);
    renderPayStubComparison();
  });
  amountEl.addEventListener("input", renderPayStubComparison);

  const libBtn    = document.getElementById("scanCheckLibBtn");
  const camBtn    = document.getElementById("scanCheckCamBtn");
  const picker    = document.getElementById("checkStubPicker");
  const camPicker = document.getElementById("checkStubCamera");

  const onPickerChange = (input) => () => {
    const file = input.files?.[0];
    if (file) scanPayStub(file);
    input.value = "";
  };

  libBtn?.addEventListener("click", () => picker?.click());
  camBtn?.addEventListener("click", () => camPicker?.click());
  picker?.addEventListener("change", onPickerChange(picker));
  camPicker?.addEventListener("change", onPickerChange(camPicker));

  // Biweekly toggle
  const weeklyBtn    = document.getElementById("payPeriodWeekly");
  const biweeklyBtn  = document.getElementById("payPeriodBiweekly");
  const syncPeriodUI = () => {
    applyPayStubPeriodMode(isBiweeklyMode());
    renderPayStubComparison();
  };
  weeklyBtn?.addEventListener("click", () => {
    biweeklyBtn?.classList.remove("active");
    weeklyBtn?.classList.add("active");
    syncPeriodUI();
  });
  biweeklyBtn?.addEventListener("click", () => {
    weeklyBtn?.classList.remove("active");
    biweeklyBtn?.classList.add("active");
    syncPeriodUI();
  });
  syncPeriodUI();
}

window.comparePayroll = comparePayroll;
window.exportAuditReport = exportAuditReport;

async function wipeLocalOnly(){
  await clearStore(STORES.entries);
  await clearStore(STORES.types);
  localStorage.removeItem(PAY_STUBS_KEY);
  localStorage.removeItem("paidHoursByWeek");
  if (_photosRequested) await renderPhotoGrid(true, { updateStatus: true });
  else clearPhotoGallery();
  await ensureDefaultTypes();
}

async function refreshPayrollUI(){
  const preview = $("payrollPreview");
  if (preview) { preview.style.display = "none"; preview.removeAttribute("src"); }
  setPayrollStatus("");

  const data = await getWeekPayroll();
  if (!data) return;

  if (preview && data.photoDataUrl) {
    preview.src = data.photoDataUrl;
    preview.style.display = "block";
  }
}

async function wipeAllData(){
  const phrase = prompt('Type WIPE to delete ALL local data.');
  if (phrase !== "WIPE") return;
  await clearStore(STORES.entries);
  await clearStore(STORES.types);
  await clearStore(STORES.weekflags);
  await clearStore(STORES.payroll);
  localStorage.removeItem(PAY_STUBS_KEY);
  localStorage.removeItem("paidHoursByWeek");
  if (_photosRequested) await renderPhotoGrid(true, { updateStatus: true });
  else clearPhotoGallery();
}

function reviewFocusMatches(entry, focus) {
  const review = getEntryReviewState(entry);
  switch (focus) {
    case "with-photo":
      return review.hasPhoto;
    case "needs-review":
      return review.needsReview;
    case "all":
    default:
      return true;
  }
}

function buildReviewEntryRow(entry) {
  const facts = getEntryRecordFacts(entry);
  const review = facts.review;
  const refLabel = entry.refType === "STOCK" ? "STK" : "RO";
  const row = document.createElement("div");
  row.className = "item";
  row.innerHTML = `
    <div class="itemTop">
      <div>
        <div class="mono">${escapeHtml(refLabel)}: ${escapeHtml(entry.ref || entry.ro || "-")} <span class="muted">(${escapeHtml(entry.type || entry.typeText || "")})</span></div>
        <div class="small">Date: <span class="mono">${escapeHtml(facts.dayKey)}</span> • VIN8: <span class="mono">${escapeHtml(facts.vin8)}</span> • Photo: ${escapeHtml(facts.photoText)}</div>
        <div class="small">Created: ${escapeHtml(facts.createdText)} • Updated: ${escapeHtml(facts.updatedText)}</div>
        ${entry.notes ? `<div class="small" style="margin-top:6px;">${escapeHtml(entry.notes)}</div>` : ""}
      </div>
      <div class="right">
        <div class="mono">${String(entry.hours)} hrs @ ${formatMoney(entry.rate)}</div>
        <div style="margin-top:6px;font-size:16px;">${formatMoney(entry.earnings)}</div>
        <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          ${review.hasPhoto ? `<button class="btn" type="button" data-review-photo="${escapeHtml(String(entry.id ?? ""))}">View Photo</button>` : ""}
          <button class="btn danger" data-del="${entry.id}">Delete</button>
        </div>
      </div>
    </div>
  `;

  if (review.hasPhoto) {
    const photoBtn = row.querySelector("button[data-review-photo]");
    photoBtn?.addEventListener("click", () => openPhotoViewer(entry));
  }

  return row;
}

function scoreMissingWorkCandidate(entry) {
  const review = getEntryReviewState(entry);
  let score = 0;
  if (review.hasPhoto) score += 30;
  if (entry.notes) score += 8;
  score += Math.floor((Date.parse(entry.updatedAt || entry.createdAt || "") || 0) / 86400000);
  return score;
}

function getMissingWorkCandidates(ctx) {
  const missingHours = Number(ctx?.comparison?.missingHours || 0);
  const missingPay = Number(ctx?.comparison?.missingPay || 0);
  if (missingHours <= 0 && missingPay <= 0) return [];

  const remaining = {
    hours: missingHours,
    pay: missingPay,
  };

  const sorted = (ctx?.entries || []).slice().sort((a, b) => scoreMissingWorkCandidate(b) - scoreMissingWorkCandidate(a));
  const picks = [];

  for (const entry of sorted) {
    if (remaining.hours <= 0 && remaining.pay <= 0) break;
    const hours = Number(entry?.hours || 0);
    const pay = Number(entry?.earnings || 0);
    picks.push(entry);
    remaining.hours = round1(remaining.hours - hours);
    remaining.pay = round2(remaining.pay - pay);
  }

  return picks;
}

function renderMissingWorkReview() {
  const summaryEl = document.getElementById("missingWorkSummary");
  const listEl = document.getElementById("missingWorkList");
  if (!summaryEl || !listEl) return;

  const ctx = getPayStubAuditContext();
  listEl.innerHTML = "";

  if (ctx.error) {
    summaryEl.textContent = "";
    return;
  }

  const missingHours = Number(ctx.comparison?.missingHours || 0);
  const missingPay = Number(ctx.comparison?.missingPay || 0);
  if (missingHours <= 0 && missingPay <= 0) {
    summaryEl.textContent = `Logged ${ctx.entries.length} entries for the selected pay week. Paid totals currently cover the logged totals.`;
    return;
  }

  summaryEl.textContent =
    `Potential missing work based on logged entries for ${ctx.weekStartKey}${ctx.weekEnd ? ` -> ${ctx.weekEnd}` : ""}. This is a heuristic because the pay stub only contains totals.`;

  const picks = getMissingWorkCandidates(ctx);
  if (!picks.length) {
    listEl.innerHTML = `<div class="muted">No logged entries are available to explain the shortfall yet.</div>`;
    return;
  }

  for (const entry of picks) {
    listEl.appendChild(buildReviewEntryRow(entry));
  }
}

async function renderReview(){
  const empId = getEmpId();
  if (!empId) { setStatusMsg("Enter Employee # to review work."); return; }

  const range = document.getElementById("reviewRange")?.value || "week";
  const focus = document.getElementById("reviewFocus")?.value || "needs-review";
  const group = document.getElementById("reviewGroup")?.value || "day";
  const q = (document.getElementById("reviewSearch")?.value || "").trim().toLowerCase();

  const all = sortEntriesByRo(filterEntriesByEmp(await getAll(STORES.entries), empId));

  let slice = all;
  if (range === "week") {
    const ws = startOfWeekLocal(new Date());
    slice = all.filter(e => inWeek(e.dayKey || dayKeyFromISO(e.createdAt), ws));
  } else if (range === "lastweek") {
    const { ws } = getLastWeekRange();
    slice = all.filter(e => inWeek(e.dayKey || dayKeyFromISO(e.createdAt), ws));
  } else if (range === "month") {
    const ms = startOfMonthLocal(new Date());
    slice = all.filter(e => inMonth(e.dayKey || dayKeyFromISO(e.createdAt), ms));
  }

  slice = slice.filter((entry) => reviewFocusMatches(entry, focus));
  if (q) slice = slice.filter(e => matchSearch(e, q));

  const totals = computeTotals(slice);
  const meta = document.getElementById("reviewMeta");
  if (meta) {
    meta.textContent = `${slice.length} entries • ${formatHours(totals.hours)} hrs • ${formatMoney(totals.dollars)}`;
  }

  const list = document.getElementById("reviewList");
  if (!list) return;

  list.innerHTML = "";
  if (!slice.length) { list.innerHTML = `<div class="muted">No entries match.</div>`; return; }

  if (group === "day" || group === "dealer") {
    const groups = group === "dealer" ? groupByDealer(slice) : groupByDay(slice);
    for (const g of groups) {
      const t = computeTotals(g.entries);
      const head = document.createElement("div");
      head.className = "item";
      head.innerHTML = `
        <div class="itemTop">
          <div class="mono">${group === "dealer" ? escapeHtml(g.dealer) : g.dayKey}</div>
          <div class="right mono">${formatHours(t.hours)} hrs • ${formatMoney(t.dollars)}</div>
        </div>`;
      list.appendChild(head);

      for (const e of g.entries) {
        list.appendChild(buildReviewEntryRow(e));
      }
    }
    return;
  }

  // no group
  for (const e of slice.slice(0, 200)) {
    list.appendChild(buildReviewEntryRow(e));
  }
}

async function exportAllCsvAdmin() {
  if (!(await requireAdmin())) return alert("Denied.");

  const entries = await getAll(STORES.entries);
  entries.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  downloadText(`flat_rate_log_ALL_${todayKeyLocal()}.csv`, toCSV(entries), "text/csv");
}

function initSettingsUI() {
  const rateInput     = document.getElementById("settingsDefaultRate");
  const compactToggle = document.getElementById("settingsCompactList");
  const colorPicker   = document.getElementById("accentColorInput");
  const colorPreview  = document.getElementById("accentColorPreview");
  const saveBtn       = document.getElementById("settingsSaveBtn");

  const s = getSettings();
  let activeDarkMode = s.darkMode ?? "auto";
  // Normalize legacy boolean values
  if (activeDarkMode === true) activeDarkMode = "dark";
  if (activeDarkMode === false) activeDarkMode = "light";

  if (rateInput)   rateInput.value        = String(s.defaultRate || 15);
  if (compactToggle) compactToggle.checked = !!s.compactList;
  if (colorPicker) colorPicker.value      = s.accentColor || "#0095f6";
  if (colorPreview) colorPreview.style.background = s.accentColor || "#0095f6";

  const syncDmBtns = () => {
    ["dmAuto", "dmLight", "dmDark"].forEach(id => {
      const mode = id === "dmAuto" ? "auto" : id === "dmLight" ? "light" : "dark";
      document.getElementById(id)?.classList.toggle("active", activeDarkMode === mode);
    });
  };
  syncDmBtns();

  ["dmAuto", "dmLight", "dmDark"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => {
      activeDarkMode = id === "dmAuto" ? "auto" : id === "dmLight" ? "light" : "dark";
      syncDmBtns();
      applySettings({ ...getSettings(), darkMode: activeDarkMode });
    });
  });

  // Live color preview
  colorPicker?.addEventListener("input", (e) => {
    const c = e.target.value;
    if (colorPreview) colorPreview.style.background = c;
    document.documentElement.style.setProperty("--primary", c);
    document.documentElement.style.setProperty("--accent", c);
  });

  const autosave = () => {
    const color   = colorPicker?.value   || s.accentColor;
    const rate    = parseFloat(rateInput?.value) || 15;
    const compact = compactToggle?.checked ?? false;
    saveSettings({ defaultRate: rate, accentColor: color, compactList: compact, darkMode: activeDarkMode });
  };
  rateInput?.addEventListener("blur", autosave);
  compactToggle?.addEventListener("change", autosave);
  colorPicker?.addEventListener("change", autosave);

  // ── Shift reminder ──
  const reminderEnabled = document.getElementById("reminderEnabled");
  const reminderTimeRow = document.getElementById("reminderTimeRow");
  const reminderTimeEl  = document.getElementById("reminderTime");
  const rs = getReminderSettings();
  if (reminderEnabled) reminderEnabled.checked = !!rs.enabled;
  if (reminderTimeEl && rs.time) reminderTimeEl.value = rs.time;
  if (reminderTimeRow) reminderTimeRow.style.display = rs.enabled ? "" : "none";

  reminderEnabled?.addEventListener("change", async () => {
    const enabled = !!reminderEnabled.checked;
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        reminderEnabled.checked = false;
        toast("Notifications blocked — enable them in browser settings.");
        return;
      }
    }
    if (reminderTimeRow) reminderTimeRow.style.display = enabled ? "" : "none";
    saveReminderSettings({ enabled, time: reminderTimeEl?.value || "16:30" });
    scheduleShiftReminder();
  });

  reminderTimeEl?.addEventListener("change", () => {
    saveReminderSettings({ enabled: !!reminderEnabled?.checked, time: reminderTimeEl.value });
    scheduleShiftReminder();
  });

  // ── Payday reminder ──
  const paydayEnabled  = document.getElementById("paydayReminderEnabled");
  const paydayRow      = document.getElementById("paydayReminderRow");
  const paydayDayEl    = document.getElementById("paydayDay");
  const paydayTimeEl   = document.getElementById("paydayTime");
  const ps = getPaydaySettings();
  if (paydayEnabled) paydayEnabled.checked = !!ps.enabled;
  if (paydayDayEl && ps.day != null) paydayDayEl.value = String(ps.day);
  if (paydayTimeEl && ps.time) paydayTimeEl.value = ps.time;
  if (paydayRow) paydayRow.style.display = ps.enabled ? "" : "none";

  paydayEnabled?.addEventListener("change", async () => {
    const enabled = !!paydayEnabled.checked;
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        paydayEnabled.checked = false;
        toast("Notifications blocked — enable them in browser settings.");
        return;
      }
    }
    if (paydayRow) paydayRow.style.display = enabled ? "" : "none";
    savePaydaySettings({ enabled, day: Number(paydayDayEl?.value ?? 5), time: paydayTimeEl?.value || "09:00" });
    schedulePaydayReminder();
  });

  const syncPaydayTime = () => {
    savePaydaySettings({ enabled: !!paydayEnabled?.checked, day: Number(paydayDayEl?.value ?? 5), time: paydayTimeEl?.value || "09:00" });
    schedulePaydayReminder();
  };
  paydayDayEl?.addEventListener("change", syncPaydayTime);
  paydayTimeEl?.addEventListener("change", syncPaydayTime);
}

// weekKey: optional "YYYY-MM-DD" week start. When provided, report covers that week only.
// When omitted, covers all weeks with logged entries.
async function exportDisputeReport(weekKey) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { alert("PDF export is not ready. Refresh and try again."); return; }

  const empId = getEmpId();
  if (!empId) { alert("Enter Employee # first."); return; }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);
  if (!own.length) { alert("No logged entries found."); return; }

  const singleWeek = typeof weekKey === "string" && weekKey.length === 10;

  // For single-week mode, compute the exact date range so we don't rely on
  // stored weekStartKey values (which can be stale, missing, or use a different
  // week-start convention than the filter key).
  let rangeStart = "";
  let rangeEnd = "";
  if (singleWeek) {
    const ws = parseDateInputValue(weekKey);
    if (!ws) { alert("Invalid week key."); return; }
    rangeStart = weekKey; // "YYYY-MM-DD"
    rangeEnd = dateKey(endOfWeekLocal(ws));
  }

  // Build week map — bucket each entry by its week-start key
  const weekMap = new Map();
  for (const e of own) {
    const entryDay = e.dayKey || dayKeyFromISO(e.createdAt || "");
    if (!entryDay) continue;
    if (singleWeek && (entryDay < rangeStart || entryDay > rangeEnd)) continue;
    // Bucket by week-start derived from the entry's actual day
    const wk = singleWeek
      ? weekKey
      : (e.weekStartKey || dateKey(startOfWeekLocal(new Date(entryDay))));
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk).push(e);
  }

  if (singleWeek && !weekMap.size) {
    alert(`No entries found for ${rangeStart} → ${rangeEnd}.`);
    return;
  }

  const weekKeys = Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));

  const doc = new jsPDF();
  const left = 20;
  const pageBottom = doc.internal.pageSize.getHeight() - 16;
  let y = 20;

  const nl = (step = 6) => {
    y += step;
    if (y > pageBottom) { doc.addPage(); y = 20; }
  };

  const write = (text, size = 11, opts = {}) => {
    doc.setFontSize(size);
    doc.setFont(undefined, opts.bold ? "bold" : "normal");
    doc.text(text, left, y);
    nl(opts.step || 6);
  };

  const title = singleWeek
    ? `Flat Rate Dispute Report — Week of ${weekKey}`
    : "Flat Rate Dispute Report — All Weeks";
  write(title, 15, { bold: true, step: 8 });
  write(`Employee: ${empId}`, 11, { step: 5 });
  write(`Generated: ${todayKeyLocal()}`, 10, { step: 10 });

  let grandMissingHours = 0;
  let grandMissingPay = 0;

  for (const wk of weekKeys) {
    const entries = weekMap.get(wk);
    const totals = computeTotals(entries);
    const stub = getPayStubForWeekKey(wk);
    const hoursPaid = stub ? Number(stub.hoursPaid || 0) : 0;
    const amountPaid = stub ? Number(stub.amountPaid || 0) : 0;
    const weekEnd = stub?.weekEnding || weekEndingForWeekStartKey(wk) || "";
    const missingHours = round1(totals.hours - hoursPaid);
    const missingPay = round2(totals.dollars - amountPaid);

    grandMissingHours = round1(grandMissingHours + missingHours);
    grandMissingPay = round2(grandMissingPay + missingPay);

    write(`Week: ${wk}${weekEnd ? ` → ${weekEnd}` : ""}`, 12, { bold: true, step: 7 });
    write(`  Logged: ${formatHours(totals.hours)} hrs | ${formatMoney(totals.dollars)} | ${totals.count} jobs`, 10, { step: 5 });
    write(`  Paid:   ${formatHours(hoursPaid)} hrs | ${formatMoney(amountPaid)}`, 10, { step: 5 });

    const gapLabel = missingHours > 0
      ? `⚠ ${signedHoursLabel(missingHours)} hrs | ${signedMoneyLabel(missingPay)} owed`
      : `OK — paid totals cover logged work`;
    write(`  Gap:    ${gapLabel}`, 10, { step: 6 });

    // Per-day grouping
    const dayMap = new Map();
    for (const e of entries) {
      const d = e.dayKey || dayKeyFromISO(e.createdAt) || "?";
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d).push(e);
    }
    const dayKeys = Array.from(dayMap.keys()).sort((a, b) => a.localeCompare(b));
    for (const d of dayKeys) {
      const dayEntries = dayMap.get(d);
      const dt = computeTotals(dayEntries);
      write(`  ${d}  (${formatHours(dt.hours)} hrs | ${formatMoney(dt.dollars)})`, 10, { step: 5 });
      for (const e of dayEntries) {
        const ro = e.ref || e.ro || "—";
        const type = (e.type || e.typeText || "—").slice(0, 18);
        const comeback = e.isComeback ? " [CB]" : "";
        write(`      ${String(ro).padEnd(10)}  ${type}${comeback}  ${e.hours}h  ${formatMoney(e.earnings)}`, 9, { step: 5 });
      }
    }
    nl(5);
  }

  nl(3);
  doc.setFont(undefined, "bold");
  doc.setFontSize(12);
  const totalLabel = grandMissingHours > 0
    ? `TOTAL MISSING: ${signedHoursLabel(grandMissingHours)} hrs | ${signedMoneyLabel(grandMissingPay)}`
    : `All weeks accounted for — no missing pay detected`;
  doc.text(totalLabel, left, y);

  const filename = singleWeek
    ? `dispute-${empId}-${weekKey}.pdf`
    : `dispute-${empId}-all-${todayKeyLocal()}.pdf`;
  doc.save(filename);
}

async function exportDisputeThisWeek() {
  const weekEl = document.getElementById("payStubWeekEnding");
  const weekEnding = String(weekEl?.value || "").trim();
  if (!weekEnding) { alert("Set a Week Ending date in the Pay Stub section first."); return; }
  const weekStartKey = weekStartKeyFromDateInput(weekEnding);
  if (!weekStartKey) { alert("Invalid week ending date."); return; }
  await exportDisputeReport(weekStartKey);
}

window.exportDisputeReport = exportDisputeReport;
window.exportDisputeThisWeek = exportDisputeThisWeek;

function renderInsights() {
  const card = document.getElementById("insightsCard");
  if (!card) return;

  const empId = getEmpId();
  if (!empId) {
    card.innerHTML = `<div class="muted small" style="padding:12px 0;">Enter Employee # to see insights.</div>`;
    return;
  }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);
  const ws = startOfWeekLocal(new Date());
  const weekEntries = own.filter(e => inWeek(e.dayKey || dayKeyFromISO(e.createdAt), ws));
  const totals = computeTotals(weekEntries);

  const effRate = totals.hours > 0 ? round2(totals.dollars / totals.hours) : 0;

  const daysWorked = new Set(weekEntries.map(e => e.dayKey || dayKeyFromISO(e.createdAt)).filter(Boolean)).size;
  const avgPerDay = daysWorked > 0 ? round2(totals.dollars / daysWorked) : 0;
  const projected = daysWorked > 0 ? round2((totals.dollars / daysWorked) * 5) : 0;

  const comebacks = weekEntries.filter(e => e.isComeback).length;
  const comebackRate = totals.count > 0 ? Math.round((comebacks / totals.count) * 100) : 0;

  const typeMap = new Map();
  for (const e of weekEntries) {
    const t = e.type || e.typeText || "Unknown";
    const cur = typeMap.get(t) || { earnings: 0, count: 0 };
    typeMap.set(t, { earnings: round2(cur.earnings + (e.earnings || 0)), count: cur.count + 1 });
  }
  const topType = Array.from(typeMap.entries()).sort((a, b) => b[1].earnings - a[1].earnings)[0];

  // Comeback breakdown by job type (all-time)
  const allOwn = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const allComebacks = filterEntriesByEmp(allOwn, empId).filter(e => e.isComeback);
  const cbTypeMap = new Map();
  for (const e of allComebacks) {
    const t = e.type || e.typeText || "Unknown";
    cbTypeMap.set(t, (cbTypeMap.get(t) || 0) + 1);
  }
  const topCbType = Array.from(cbTypeMap.entries()).sort((a, b) => b[1] - a[1])[0];

  const comebackClass = comebacks > 0 ? "insightValue--warn" : "";

  card.innerHTML = `
    <div class="insightGrid">
      <div class="insightCell">
        <div class="insightLabel">Eff. $/hr</div>
        <div class="insightValue">${effRate > 0 ? formatMoney(effRate) : "—"}</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Avg / Day</div>
        <div class="insightValue">${avgPerDay > 0 ? formatMoney(avgPerDay) : "—"}</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Comebacks</div>
        <div class="insightValue ${comebackClass}">${comebacks > 0 ? `${comebacks} (${comebackRate}%)` : "None ✓"}</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Wk Pace</div>
        <div class="insightValue">${projected > 0 ? formatMoney(projected) : "—"}</div>
      </div>
    </div>
    ${topType ? `<div class="insightTopEarner">Top earner: <strong>${escapeHtml(topType[0])}</strong> · ${formatMoney(topType[1].earnings)} · ${topType[1].count} job${topType[1].count !== 1 ? "s" : ""}</div>` : ""}
    ${topCbType ? `<div class="insightTopEarner" style="color:var(--danger);margin-top:4px;">Most comebacks: <strong>${escapeHtml(topCbType[0])}</strong> · ${topCbType[1]}× all-time</div>` : ""}
    ${!weekEntries.length ? `<div class="muted small" style="margin-top:8px;">No entries this week yet.</div>` : ""}
  `;
}

window.renderInsights = renderInsights;

function renderEarningsChart() {
  const container = document.getElementById("earningsChart");
  if (!container) return;

  const empId = getEmpId();
  if (!empId) { container.innerHTML = `<div class="muted small">Enter Employee # to see chart.</div>`; return; }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  const now = new Date();
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const ws = startOfWeekLocal(new Date());
    ws.setDate(ws.getDate() - i * 7);
    const we = endOfWeekLocal(ws);
    const wsKey = dateKey(ws);
    const weKey = dateKey(we);
    const weekEntries = own.filter(e => e.dayKey && e.dayKey >= wsKey && e.dayKey <= weKey);
    const pay = round2(weekEntries.reduce((s, e) => s + Number(e.earnings || 0), 0));
    const hrs = round1(weekEntries.reduce((s, e) => s + Number(e.hours || 0), 0));
    weeks.push({ wsKey, pay, hrs, isCurrent: i === 0 });
  }

  const maxPay = Math.max(...weeks.map(w => w.pay), 1);
  const chartH = 90;
  const barW = 18;
  const gap = 5;
  const totalW = weeks.length * (barW + gap) - gap;

  const bars = weeks.map((w, i) => {
    const x = i * (barW + gap);
    const barH = w.pay > 0 ? Math.max(Math.round((w.pay / maxPay) * chartH), 3) : 0;
    const y = chartH - barH;
    const fill = w.isCurrent ? "var(--primary)" : "var(--surface3)";
    const label = w.wsKey.slice(5).replace("-", "/");
    const valText = w.pay >= 1000 ? `$${Math.round(w.pay / 1000 * 10) / 10}k`
                  : w.pay > 0    ? `$${Math.round(w.pay)}` : "";
    return `<g>
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fill}"/>
      ${barH > 14 && valText ? `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="7" fill="${w.isCurrent ? "var(--primary)" : "var(--muted)"}" font-weight="700">${valText}</text>` : ""}
      <text x="${x + barW / 2}" y="${chartH + 11}" text-anchor="middle" font-size="7" fill="var(--muted2)">${label}</text>
    </g>`;
  }).join("");

  container.innerHTML = `
    <svg width="100%" viewBox="-2 -16 ${totalW + 4} ${chartH + 28}" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">${bars}</svg>
  `;
}

window.renderEarningsChart = renderEarningsChart;

/* ── Payday reminder ──────────────────────────────── */
const LS_PAYDAY = "fr_payday_reminder";

function getPaydaySettings() {
  try { return JSON.parse(localStorage.getItem(LS_PAYDAY) || "{}"); } catch { return {}; }
}

function savePaydaySettings(patch) {
  localStorage.setItem(LS_PAYDAY, JSON.stringify({ ...getPaydaySettings(), ...patch }));
}

function schedulePaydayReminder() {
  clearTimeout(window.__FR_PAYDAY__);
  const s = getPaydaySettings();
  if (!s.enabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const [h, m] = String(s.time || "09:00").split(":").map(Number);
  const targetDay = Number(s.day ?? 5);
  const now = new Date();
  const d = new Date(now);
  const daysUntil = ((targetDay - d.getDay()) + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntil);
  d.setHours(h, m, 0, 0);
  window.__FR_PAYDAY__ = setTimeout(() => {
    new Notification("Flat-Rate Tracker", {
      body: "Payday! Remember to log your pay stub.",
      icon: "/FlatRate/icon-192.png",
    });
    schedulePaydayReminder();
  }, d.getTime() - now.getTime());
}

window.schedulePaydayReminder = schedulePaydayReminder;

/* ── Shift reminder ──────────────────────────────── */
const LS_REMINDER = "fr_shift_reminder";

function getReminderSettings() {
  try { return JSON.parse(localStorage.getItem(LS_REMINDER) || "{}"); } catch { return {}; }
}

function saveReminderSettings(patch) {
  localStorage.setItem(LS_REMINDER, JSON.stringify({ ...getReminderSettings(), ...patch }));
}

function scheduleShiftReminder() {
  clearTimeout(window.__FR_REMINDER__);
  const s = getReminderSettings();
  if (!s.enabled || !s.time) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const [h, m] = String(s.time).split(":").map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (target <= now) return;
  window.__FR_REMINDER__ = setTimeout(() => {
    new Notification("Flat-Rate Tracker", {
      body: "End of shift — log your hours before you leave!",
      icon: "/FlatRate/icon-192.png",
    });
  }, target.getTime() - now.getTime());
}

window.scheduleShiftReminder = scheduleShiftReminder;

window.__FR = window.__FR || {};
