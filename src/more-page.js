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

/* ── Paywall ─────────────────────────────────────────────────────── */

function isPro() {
  return window.CURRENT_PLAN === "pro";
}

function showUpgradeModal() {
  const modal = document.getElementById("upgradeModal");
  if (modal) modal.style.display = "flex";
}

function hideUpgradeModal() {
  const modal = document.getElementById("upgradeModal");
  if (modal) modal.style.display = "none";
}

async function startCheckout(plan) {
  const btn = plan === "yearly"
    ? document.getElementById("upgradeYearlyBtn")
    : document.getElementById("upgradeMonthlyBtn");
  const orig = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

  try {
    const session = await sb().auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) { toast?.("Sign in first"); return; }

    const res = await fetch(
      `${window.__SUPABASE_CONFIG__.url}/functions/v1/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, returnUrl: window.location.href }),
      }
    );
    const { url, error } = await res.json();
    if (error) throw new Error(error);
    window.location.href = url;
  } catch (e) {
    toast?.("Checkout failed — " + (e?.message || "try again"));
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
}

function requirePro(action) {
  if (isPro()) return true;
  showUpgradeModal();
  return false;
}

/* ── Exports (pro-gated) ─────────────────────────────────────────── */

async function exportCSV(){
  if (!requirePro()) return;
  const all = await getAll(STORES.entries);
  const entries = filterEntriesByEmp(all, getEmpId(), true);
  entries.sort((a,b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  downloadText(`flat_rate_log_${todayKeyLocal()}.csv`, toCSV(entries, true), "text/csv");
}

async function exportJSON(){
  if (!requirePro()) return;
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
  if (!requirePro()) return;
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

  // Restore collapse state
  const details = document.getElementById("payStubDetails");
  if (details) {
    if (localStorage.getItem("fr_paystub_open") !== "0") details.open = true;
    details.addEventListener("toggle", () => {
      localStorage.setItem("fr_paystub_open", details.open ? "1" : "0");
    });
  }

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

async function initFeedbackUI() {
  const btn    = document.getElementById("submitFeedbackBtn");
  const msgEl  = document.getElementById("feedbackMessage");
  const catEl  = document.getElementById("feedbackCategory");
  const status = document.getElementById("feedbackStatus");
  if (!btn || !msgEl || !catEl) return;

  btn.addEventListener("click", async () => {
    const message = (msgEl.value || "").trim();
    if (!message) { msgEl.focus(); return; }

    const client = window.__FR?.sb;
    if (!client) { toast("App not ready — try again."); return; }

    const uid = window.CURRENT_UID;
    if (!uid) {
      toast("Sign in to send feedback.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";
    if (status) { status.textContent = ""; status.style.display = "none"; }

    try {
      const { error } = await client.from("user_feedback").insert({
        user_id: uid,
        user_email: window.CURRENT_USER_EMAIL || null,
        employee_number: getEmpId() || null,
        category: catEl.value,
        message,
        app_version: window.BUILD || null,
      });
      if (error) throw error;
      msgEl.value = "";
      if (status) { status.textContent = "Thanks! Feedback sent."; status.style.display = ""; }
      toast("Feedback sent — thank you!");
    } catch (e) {
      toast("Failed to send feedback — try again.");
      console.error("[feedback]", e);
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit";
    }
  });
}
window.__FR = window.__FR || {};
window.__FR.initFeedbackUI = initFeedbackUI;

function initSettingsUI() {
  const rateInput     = document.getElementById("settingsDefaultRate");
  const compactToggle = document.getElementById("settingsCompactList");
  const hapticToggle  = document.getElementById("hapticEnabled");
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
  // Haptic defaults ON; only off if explicitly saved as false
  if (hapticToggle) hapticToggle.checked  = s.haptic !== false;
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
      saveSettings({ darkMode: activeDarkMode }); // persist + apply immediately
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
    const haptic  = hapticToggle?.checked ?? true;
    saveSettings({ defaultRate: rate, accentColor: color, compactList: compact, darkMode: activeDarkMode, haptic });
  };
  rateInput?.addEventListener("blur", autosave);
  compactToggle?.addEventListener("change", autosave);
  hapticToggle?.addEventListener("change", autosave);
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
    if (enabled) {
      const perm = await requestNotifPermission();
      if (perm === "denied") {
        reminderEnabled.checked = false;
        toast("Notifications blocked. Go to your browser/phone Settings → Notifications and allow this site.");
        return;
      }
      if (perm === "unsupported") {
        reminderEnabled.checked = false;
        toast("Notifications not supported on this browser.");
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
    if (enabled) {
      const perm = await requestNotifPermission();
      if (perm === "denied") {
        paydayEnabled.checked = false;
        toast("Notifications blocked. Go to your browser/phone Settings → Notifications and allow this site.");
        return;
      }
      if (perm === "unsupported") {
        paydayEnabled.checked = false;
        toast("Notifications not supported on this browser.");
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
  if (!requirePro()) return;
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

/* ── Shared notification helper ──────────────────── */
async function sendNotification(title, body, tag = "fr-note") {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    // Use SW registration.showNotification — works backgrounded on Android/desktop
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag,
      renotify: true,
    });
    return true;
  } catch {
    try { new Notification(title, { body, icon: "./icon-192.png" }); return true; } catch {}
  }
  return false;
}
window.__FR = window.__FR || {};
window.__FR.sendNotification = sendNotification;

async function requestNotifPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission().catch(() => "denied");
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

  let daysUntil = ((targetDay - d.getDay()) + 7) % 7;
  if (daysUntil === 0) {
    // It's payday today — fire now if time hasn't passed, else next week
    const todayTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
    if (todayTarget <= now) daysUntil = 7;
  }
  d.setDate(d.getDate() + daysUntil);
  d.setHours(h, m, 0, 0);

  window.__FR_PAYDAY__ = setTimeout(() => {
    sendNotification("Flat-Rate", "Payday! Remember to log your pay stub.", "payday-reminder");
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

  const [h, m] = String(s.time).split(":").map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  // If today's time already passed, schedule for tomorrow
  if (target <= now) target.setDate(target.getDate() + 1);
  const msUntil = target.getTime() - now.getTime();

  // On native iOS/Android, use Capacitor Local Notifications
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.LocalNotifications) {
    const LN = window.Capacitor.Plugins.LocalNotifications;
    LN.requestPermissions().then(({ display }) => {
      if (display !== "granted") return;
      LN.cancel({ notifications: [{ id: 1001 }] }).catch(() => {});
      LN.schedule({
        notifications: [{
          id: 1001,
          title: "Flat-Rate",
          body: "End of shift — log your hours before you leave!",
          schedule: { at: new Date(target.getTime()) },
          sound: null,
          smallIcon: "ic_stat_icon",
        }],
      }).catch(console.error);
    });
    return;
  }

  // Web fallback: setTimeout + Web Notification API
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  window.__FR_REMINDER__ = setTimeout(() => {
    sendNotification("Flat-Rate", "End of shift — log your hours before you leave!", "shift-reminder");
    scheduleShiftReminder(); // reschedule for same time tomorrow
  }, msUntil);
}

window.scheduleShiftReminder = scheduleShiftReminder;

/* ── More-page inner tab switching ───────────────── */
function initMoreTabs() {
  const tabs = document.querySelectorAll(".moreTab[data-tab]");
  if (!tabs.length) return;

  function switchTab(name) {
    tabs.forEach(t => {
      const active = t.dataset.tab === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".moreTabPanel").forEach(p => {
      p.classList.toggle("active", p.id === `mPanel-${name}`);
    });
    localStorage.setItem("fr_more_tab", name);
    if (name === "history") renderBulkEntryList?.();
  }

  tabs.forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  const saved = localStorage.getItem("fr_more_tab") || "jobs";
  const valid = ["jobs", "history", "settings"];
  switchTab(valid.includes(saved) ? saved : "jobs");
}

/* ── Bulk entry delete (History tab) ─────────────── */
let _bulkSelectMode = false;

async function renderBulkEntryList() {
  const container = document.getElementById("bulkEntryList");
  if (!container) return;

  const empId = getEmpId();
  if (!empId) {
    container.innerHTML = `<div class="muted small" style="padding:12px 16px;">Enter Employee # in Settings to view entries.</div>`;
    return;
  }

  const all = await getAll(STORES.entries);
  const entries = filterEntriesByEmp(all, empId);
  entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!entries.length) {
    container.innerHTML = `<div class="muted small" style="padding:12px 16px;">No entries yet.</div>`;
    return;
  }

  container.innerHTML = "";
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "bulkEntryRow";
    row.dataset.id = String(e.id ?? "");
    const ref = e.ro || e.ref || "";
    const refDisplay = ref ? escapeHtml(ref) : "<span class='bulkEntryNoRef'>no RO#</span>";
    row.innerHTML = `
      <label class="bulkEntryCheck" style="${_bulkSelectMode ? "" : "display:none;"}">
        <input type="checkbox" class="bulkCheck" />
      </label>
      <div class="bulkEntryInfo">
        <div class="bulkEntryRef">${refDisplay} <span class="bulkEntryType">${escapeHtml(e.type || e.typeText || "—")}</span></div>
        <div class="bulkEntryMeta">${formatMoney(Number(e.earnings ?? e.dollars ?? 0))} · ${round1(Number(e.hours || 0))} hrs · ${e.dayKey || ""}</div>
      </div>
    `;
    // Tap entire row to toggle checkbox in select mode
    row.addEventListener("click", (ev) => {
      if (!_bulkSelectMode) return;
      const cb = row.querySelector(".bulkCheck");
      if (ev.target === cb || ev.target.closest("label")) return; // let label handle it natively
      if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    container.appendChild(row);
  }
}

function initBulkDelete() {
  const toggle     = document.getElementById("bulkSelectToggle");
  const delBtn     = document.getElementById("bulkDeleteBtn");
  const selectAll  = document.getElementById("bulkSelectAllBtn");
  const bar        = document.getElementById("bulkDeleteBar");
  const countEl    = document.getElementById("bulkSelectedCount");
  const list       = document.getElementById("bulkEntryList");
  if (!toggle) return;

  const syncBar = () => {
    const total   = list?.querySelectorAll(".bulkCheck").length ?? 0;
    const checked = list?.querySelectorAll(".bulkCheck:checked").length ?? 0;
    if (bar) bar.style.display = _bulkSelectMode ? "flex" : "none";
    if (countEl) countEl.textContent = checked > 0 ? `${checked} of ${total}` : `${total} entries`;
    if (selectAll) selectAll.textContent = (checked === total && total > 0) ? "None" : "All";
    if (delBtn) delBtn.disabled = checked === 0;
  };

  toggle.addEventListener("click", () => {
    _bulkSelectMode = !_bulkSelectMode;
    toggle.textContent = _bulkSelectMode ? "Done" : "Select";
    toggle.classList.toggle("active", _bulkSelectMode);
    list?.querySelectorAll(".bulkEntryCheck").forEach(el => {
      el.style.display = _bulkSelectMode ? "" : "none";
    });
    list?.querySelectorAll(".bulkCheck").forEach(cb => { cb.checked = false; });
    list?.querySelectorAll(".bulkEntryRow").forEach(r => r.classList.remove("is-selected"));
    syncBar();
  });

  selectAll?.addEventListener("click", () => {
    const cbs = [...(list?.querySelectorAll(".bulkCheck") ?? [])];
    const allChecked = cbs.every(cb => cb.checked);
    cbs.forEach(cb => {
      cb.checked = !allChecked;
      cb.closest(".bulkEntryRow")?.classList.toggle("is-selected", !allChecked);
    });
    syncBar();
  });

  list?.addEventListener("change", (e) => {
    if (e.target?.classList.contains("bulkCheck")) {
      e.target.closest(".bulkEntryRow")?.classList.toggle("is-selected", e.target.checked);
      syncBar();
    }
  });

  delBtn?.addEventListener("click", async () => {
    const checked = [...(list?.querySelectorAll(".bulkCheck:checked") ?? [])];
    if (!checked.length) return;
    const n = checked.length;
    if (!confirm(`Delete ${n} entr${n === 1 ? "y" : "ies"}? This cannot be undone.`)) return;

    const ids = checked.map(cb => cb.closest(".bulkEntryRow")?.dataset.id).filter(Boolean);
    for (const id of ids) {
      await del(STORES.entries, id).catch(console.warn);
    }

    toast?.(`Deleted ${ids.length} entr${ids.length === 1 ? "y" : "ies"}`);
    _bulkSelectMode = false;
    if (toggle) { toggle.textContent = "Select"; toggle.classList.remove("active"); }
    if (bar) bar.style.display = "none";

    await renderBulkEntryList();
    await renderPayTrend?.();
    await renderInsights?.();
  });
}

/* ── Job type bulk delete ─────────────────────────── */
let _typeBulkSelectMode = false;

function initJobTypeBulkDelete() {
  const toggle     = document.getElementById("typeSelectToggle");
  const delBtn     = document.getElementById("typeDeleteBtn");
  const selectAll  = document.getElementById("typeSelectAllBtn");
  const bar        = document.getElementById("typeDeleteBar");
  const countEl    = document.getElementById("typeSelectedCount");
  const list       = document.getElementById("savedTypesList");
  if (!toggle) return;

  const syncBar = () => {
    const total   = list?.querySelectorAll(".typeCheck").length ?? 0;
    const checked = list?.querySelectorAll(".typeCheck:checked").length ?? 0;
    if (bar) bar.style.display = _typeBulkSelectMode ? "flex" : "none";
    if (countEl) countEl.textContent = checked > 0 ? `${checked} of ${total}` : `${total} types`;
    if (selectAll) selectAll.textContent = (checked === total && total > 0) ? "None" : "All";
    if (delBtn) delBtn.disabled = checked === 0;
    // update count in header
    const countHeader = document.getElementById("typeListCount");
    if (countHeader) countHeader.textContent = total > 0 ? `${total} saved` : "";
  };

  toggle.addEventListener("click", () => {
    _typeBulkSelectMode = !_typeBulkSelectMode;
    toggle.textContent = _typeBulkSelectMode ? "Done" : "Select";
    toggle.classList.toggle("active", _typeBulkSelectMode);
    list?.querySelectorAll(".typeCheckWrap").forEach(el => {
      el.style.display = _typeBulkSelectMode ? "" : "none";
    });
    list?.querySelectorAll(".typeCheck").forEach(cb => { cb.checked = false; });
    list?.querySelectorAll(".typeRow").forEach(r => r.classList.remove("is-selected"));
    syncBar();
  });

  selectAll?.addEventListener("click", () => {
    const cbs = [...(list?.querySelectorAll(".typeCheck") ?? [])];
    const allChecked = cbs.every(cb => cb.checked);
    cbs.forEach(cb => {
      cb.checked = !allChecked;
      cb.closest(".typeRow")?.classList.toggle("is-selected", !allChecked);
    });
    syncBar();
  });

  list?.addEventListener("change", (e) => {
    if (e.target?.classList.contains("typeCheck")) {
      e.target.closest(".typeRow")?.classList.toggle("is-selected", e.target.checked);
      syncBar();
    }
  });

  list?.addEventListener("click", (e) => {
    if (!_typeBulkSelectMode) return;
    const row = e.target.closest(".typeRow");
    if (!row) return;
    if (e.target.closest(".typeCheckWrap") || e.target.closest(".typeRowActions") || e.target.closest(".typeEditForm")) return;
    const cb = row.querySelector(".typeCheck");
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
  });

  delBtn?.addEventListener("click", async () => {
    const checked = [...(list?.querySelectorAll(".typeCheck:checked") ?? [])];
    if (!checked.length) return;
    const n = checked.length;
    if (!confirm(`Delete ${n} job type${n === 1 ? "" : "s"}? This cannot be undone.`)) return;

    const rows = checked.map(cb => cb.closest(".typeRow")).filter(Boolean);
    const ids = rows.map(r => r.dataset.id).filter(Boolean);
    const names = rows.map(r => (r.dataset.name || r.querySelector(".typeRowName")?.textContent || "").toLowerCase().trim()).filter(Boolean);
    window.addDeletedTypeNames?.(getEmpId?.() || localStorage.getItem("fr_emp_id") || "", names);
    for (const id of ids) {
      await del(STORES.types, id).catch(console.warn);
    }

    toast?.(`Deleted ${ids.length} type${ids.length === 1 ? "" : "s"}`);
    _typeBulkSelectMode = false;
    if (toggle) { toggle.textContent = "Select"; toggle.classList.remove("active"); }
    if (bar) bar.style.display = "none";
    await renderTypesListInMore?.();
    await renderTypeDatalist?.();
    // re-init so event listeners attach to new rows
    initJobTypeBulkDelete();
  });

  // Wire up syncBar for initial count
  syncBar();
}

/* ── Entry search filter ──────────────────────────── */
function initEntrySearch() {
  const input = document.getElementById("entrySearchInput");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    document.querySelectorAll(".bulkEntryRow").forEach(row => {
      if (!q) { row.hidden = false; return; }
      const text = row.textContent.toLowerCase();
      row.hidden = !text.includes(q);
    });
  });
  // Clear on tab switch (reset search)
  document.querySelectorAll(".moreTab").forEach(tab => {
    tab.addEventListener("click", () => { input.value = ""; });
  });
}

window.initMoreTabs = initMoreTabs;
window.renderBulkEntryList = renderBulkEntryList;
window.initBulkDelete = initBulkDelete;
window.initJobTypeBulkDelete = initJobTypeBulkDelete;
window.initEntrySearch = initEntrySearch;

/* ── More-page continuation tour ─────────────────── */
const MORE_TOUR_STEPS = [
  /* ── Job Types tab ─────────────────────── */
  {
    el: "#moreTabBar",
    title: "Three Tabs",
    body: "Job Types manages your saved job templates. History shows your full entry list. Settings holds your rate, notifications, pay stub, and account. We'll walk through each one.",
    action: "switch-tab:jobs",
  },
  {
    el: "#savedTypeCreateForm",
    title: "Add a Job Type",
    body: "Type the job name, set the default hours and rate, then tap Save. That type is now available as a chip suggestion every time you log a job on the main page.",
    action: "switch-tab:jobs",
  },
  {
    el: "#savedTypesList",
    title: "Your Saved Types",
    body: "All your job templates appear here. Tap the pencil to edit the hours or rate. Tap trash to delete. Tap the Select button at the top right to check multiple types and delete them all at once.",
    action: "switch-tab:jobs",
  },
  /* ── History tab ───────────────────────── */
  {
    el: "#entrySearchInput",
    title: "Search Your History",
    body: "Filter your entries in real time — type a job name, RO number, or any keyword. Every entry you've ever logged is here.",
    action: "switch-tab:history",
  },
  {
    el: "#bulkSelectToggle",
    title: "Bulk Delete Entries",
    body: "Tap Select to enter selection mode. Tap any row to check it, or tap All to select everything. Then hit Delete to remove them. Great for clearing out test entries.",
    action: "switch-tab:history",
  },
  /* ── Settings tab ──────────────────────── */
  {
    el: "#settingsDefaultRate",
    title: "Default Hourly Rate",
    body: "This is the rate used to calculate earnings on every job you log. You can override it on a per-job basis in the More Details panel when logging.",
    action: "switch-tab:settings",
  },
  {
    el: "#authForm",
    title: "Sign In — Cloud Backup",
    body: "Sign in here to back up all your data to the cloud. Switch phones, reinstall — nothing is ever lost. Your entries are tied to your account, not your device.",
    action: "switch-tab:settings",
  },
  {
    el: "#payStubDetails",
    title: "Pay Stub — Catch Short Pay",
    body: "Enter your check amount each pay period and the app compares it against your logged hours. If the numbers don't match, it flags the difference so you know exactly what to dispute.",
    action: "open-paystub",
  },
  {
    el: null,
    title: "You're All Set ✓",
    body: "Log your first job and check back after payday. Restart this tour anytime from Settings → Help → Take Tour.",
    last: true,
  },
];

function startMoreTour() {
  if (!localStorage.getItem("fr_tour_more")) return;
  localStorage.removeItem("fr_tour_more");

  const overlay  = document.getElementById("tourOverlay");
  const nextBtn  = document.getElementById("tourNextBtn");
  const skipBtn  = document.getElementById("tourSkipBtn");
  if (!overlay || !nextBtn || !skipBtn) return;

  let step = 0;

  function buildDots() {
    const c = document.getElementById("tourDots");
    if (!c) return;
    c.innerHTML = "";
    MORE_TOUR_STEPS.forEach((_, i) => {
      const d = document.createElement("div");
      d.className = "tourDot" + (i === step ? " tourDot--active" : "");
      c.appendChild(d);
    });
  }

  function positionSpotlight(sel) {
    const spotlight = document.getElementById("tourSpotlight");
    if (!spotlight) return;
    if (!sel) {
      spotlight.style.display = "none";
      spotlight.classList.remove("pulse");
      overlay.style.background = "rgba(0,0,0,0.72)";
      overlay.classList.remove("tour-has-target");
      return;
    }
    const target = document.querySelector(sel);
    if (!target) { spotlight.style.display = "none"; return; }
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    overlay.style.background = "transparent";
    overlay.classList.add("tour-has-target");
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      const pad = 8;
      spotlight.style.cssText = `display:block;top:${r.top-pad}px;left:${r.left-pad}px;width:${r.width+pad*2}px;height:${r.height+pad*2}px;`;
      spotlight.classList.add("pulse");
    }, 300);
  }

  function runAction(action) {
    if (!action) return;
    if (action.startsWith("switch-tab:")) {
      const tabName = action.split(":")[1];
      document.querySelector(`.moreTab[data-tab="${tabName}"]`)?.click();
    }
    if (action === "open-paystub") {
      document.querySelector('.moreTab[data-tab="settings"]')?.click();
      const det = document.getElementById("payStubDetails");
      if (det && !det.open) det.open = true;
    }
  }

  function show(idx) {
    const s = MORE_TOUR_STEPS[idx];
    // Run the action BEFORE spotlighting so the tab panel / element is visible
    runAction(s.action);
    const stepLabel = document.getElementById("tourStep");
    const titleEl   = document.getElementById("tourTitle");
    const bodyEl    = document.getElementById("tourBody");
    const tooltip   = document.getElementById("tourTooltip");
    if (stepLabel) stepLabel.textContent = `${idx + 1} of ${MORE_TOUR_STEPS.length}`;
    if (titleEl)   titleEl.textContent = s.title;
    if (bodyEl)    bodyEl.textContent  = s.body;
    nextBtn.textContent = s.last ? "Finish ✓" : "Next →";
    overlay.style.display = "block";
    buildDots();
    // Small delay so tab panel has rendered before we measure spotlight position
    setTimeout(() => positionSpotlight(s.el), 120);
    if (tooltip) {
      tooltip.classList.remove("step-enter");
      void tooltip.offsetWidth;
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

  nextBtn.onclick = () => { step++; if (step >= MORE_TOUR_STEPS.length) endTour(); else show(step); };
  skipBtn.onclick = endTour;

  // Small delay so the page has finished rendering
  setTimeout(() => show(0), 500);
}

window.__FR = window.__FR || {};
window.__FR.startMoreTour = startMoreTour;
