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
    toast("PDF not ready — refresh and try again.");
    return;
  }

  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    toast("No entries to export.");
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
  doc.text("Flatrate Buddy Report", left, y);

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
    toast("No entries selected");
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
    toast(`No entries found for week: ${key}`);
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

function billingLive() {
  return !!window.__BILLING__?.live;
}

function showUpgradeModal() {
  const modal = document.getElementById("upgradeModal");
  if (!modal) return;
  const beta    = document.getElementById("upgradeBetaContent");
  const pricing = document.getElementById("upgradePricingContent");
  if (beta)    beta.style.display    = billingLive() ? "none" : "";
  if (pricing) pricing.style.display = billingLive() ? "" : "none";
  if (billingLive()) {
    const m = document.getElementById("upgradeMonthlyBtn");
    const y = document.getElementById("upgradeYearlyBtn");
    if (m) m.textContent = window.__BILLING__?.monthlyLabel || "Monthly";
    if (y) y.textContent = window.__BILLING__?.yearlyLabel || "Yearly";
  }
  modal.style.display = "flex";
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
  // Beta (__BILLING__.live === false): all features free — never gate.
  if (!billingLive()) return true;
  if (isPro()) return true;
  showUpgradeModal();
  return false;
}

// Back from Stripe Checkout (?upgraded=1): refresh plan, confirm, clean URL.
async function handleCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get("upgraded") !== "1") return;
  params.delete("upgraded");
  const qs = params.toString();
  history.replaceState({}, "", location.pathname + (qs ? `?${qs}` : ""));
  try {
    // Webhook can lag a moment behind the redirect — retry briefly.
    for (let i = 0; i < 5; i++) {
      await window.__FR?.loadSubscription?.();
      if (isPro()) break;
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch {}
  toast?.(isPro() ? "⚡ Welcome to Pro — you're all set!" : "Payment received — Pro unlocks in a moment.");
}
(window.__FR = window.__FR || {}).handleCheckoutReturn = handleCheckoutReturn;

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
  if (!Number.isFinite(val) || val < 0) { toast("Flagged hours must be a number ≥ 0."); return; }
  await setThisWeekFlag(val);
  toast("Flagged hours saved for this week.");
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
  const confirmed = await showActionSheet({ title: `Delete pay stub for ${weekLabel}?`, message: extra || undefined, confirmLabel: "Delete", danger: true });
  if (!confirmed) return;

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

  // Format date key (YYYY-MM-DD) as friendly "Jun 29" style
  const fmtPeriodDate = (key) => {
    const d = parseDateInputValue(key);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : key;
  };
  const periodLabel = ctx.biweekly
    ? `${fmtPeriodDate(ctx.weekStartKey)} – ${fmtPeriodDate(ctx.weekEnd)} (2 wks)`
    : ctx.weekEnd
      ? `${fmtPeriodDate(ctx.weekStartKey)} – ${fmtPeriodDate(ctx.weekEnd)}`
      : fmtPeriodDate(ctx.weekStartKey);
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
    toast("PDF not ready — refresh and try again.");
    return;
  }

  const ctx = getPayStubAuditContext();
  if (ctx.error) {
    toast(ctx.error);
    return;
  }

  const doc = new jsPDF();
  const left = 20;
  let y = 20;
  const emp = getEmpId() || "N/A";

  doc.setFontSize(16);
  doc.text("Flatrate Buddy — Audit Report", left, y);
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

  if (!weekEnding) { toast("Week ending is required."); return; }
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) { toast("Enter a check amount greater than $0."); return; }

  const weekStartKey = weekStartKeyFromDateInput(weekEnding);
  if (!weekStartKey) { toast("Week ending date is invalid."); return; }

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
    container.innerHTML = `<div class="muted small" style="padding:14px 16px;">Set your Employee # in <button type="button" class="linkBtn" onclick="document.querySelector('.moreTab[data-tab=\\'settings\\']')?.click()">Settings →</button></div>`;
    return;
  }

  const stubMap = loadPayStubMap();
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  // Build week set from all worked entries, plus any saved stubs
  const weekKeys = new Set();
  own.forEach(e => {
    const wsk = e.weekStartKey || (e.dayKey ? dateKey(startOfWeekFromDateKey(e.dayKey)) : null);
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
  renderComebackStats?.();
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
  const scanBtn = document.getElementById("scanCheckLibBtn");
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
  if (!(await requireAdmin())) { toast("Access denied."); return; }

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
  if (!jsPDF) { toast("PDF not ready — refresh and try again."); return; }

  const empId = getEmpId();
  if (!empId) { toast("Enter Employee # first."); return; }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);
  if (!own.length) { toast("No logged entries found."); return; }

  const singleWeek = typeof weekKey === "string" && weekKey.length === 10;

  // For single-week mode, compute the exact date range so we don't rely on
  // stored weekStartKey values (which can be stale, missing, or use a different
  // week-start convention than the filter key).
  let rangeStart = "";
  let rangeEnd = "";
  if (singleWeek) {
    const ws = parseDateInputValue(weekKey);
    if (!ws) { toast("Invalid week key."); return; }
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
      : (e.weekStartKey || dateKey(startOfWeekFromDateKey(entryDay)));
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk).push(e);
  }

  if (singleWeek && !weekMap.size) {
    toast(`No entries found for ${rangeStart} → ${rangeEnd}.`);
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
  if (!weekEnding) { toast("Set a Week Ending date in the Pay Stub section first."); return; }
  const weekStartKey = weekStartKeyFromDateInput(weekEnding);
  if (!weekStartKey) { toast("Invalid week ending date."); return; }
  await exportDisputeReport(weekStartKey);
}

// Dispute PDF scoped to the current bi-weekly pay period
async function exportDisputePayPeriod() {
  if (!requirePro()) return;
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("PDF not ready — refresh and try again."); return; }
  const empId = getEmpId();
  if (!empId) { toast("Enter Employee # first."); return; }

  // Determine current pay period range
  const ANCHOR     = new Date("2025-01-06T00:00:00");
  const MS_PERIOD  = 14 * 86400000;
  const now        = new Date();
  const periods    = Math.floor((now - ANCHOR) / MS_PERIOD);
  const ppStart    = new Date(ANCHOR.getTime() + periods * MS_PERIOD);
  const ppEnd      = new Date(ppStart.getTime() + 13 * 86400000);
  const ppStartKey = dateKey(ppStart);
  const ppEndKey   = dateKey(ppEnd);

  const all  = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own  = filterEntriesByEmp(all, empId).filter(e => {
    const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
    return dk >= ppStartKey && dk <= ppEndKey;
  });
  if (!own.length) { toast(`No entries for pay period ${ppStartKey} → ${ppEndKey}.`); return; }

  const doc = new jsPDF();
  const left = 20;
  const pageBottom = doc.internal.pageSize.getHeight() - 16;
  let y = 20;
  const nl = (step = 6) => { y += step; if (y > pageBottom) { doc.addPage(); y = 20; } };
  const write = (text, size = 11, bold = false) => {
    doc.setFontSize(size); doc.setFont(undefined, bold ? "bold" : "normal");
    doc.text(String(text), left, y);
  };

  write("Flatrate Buddy — Pay Period Dispute Record", 15, true); nl(10);
  write(`Employee: ${empId}`, 11); nl(7);
  write(`Pay Period: ${ppStartKey}  →  ${ppEndKey}`, 11); nl(7);
  write(`Generated: ${new Date().toLocaleDateString()}`, 11); nl(12);

  // Table header
  doc.setFillColor(240, 240, 240);
  doc.rect(left - 2, y - 5, 170, 8, "F");
  write("Date         RO#           Type                   Hrs    Pay", 10, true); nl(9);

  let totalHrs = 0, totalPay = 0;
  const sorted = [...own].sort((a, b) => (a.dayKey || "").localeCompare(b.dayKey || ""));
  for (const e of sorted) {
    const day  = e.dayKey || dayKeyFromISO(e.createdAt || "") || "-";
    const ro   = String(e.ref || e.ro_number || e.ro || "-").slice(0, 12);
    const type = String(e.type || e.typeText || "-").slice(0, 20);
    const hrs  = Number(e.hours || 0);
    const rate = Number(e.rate || e.hourlyRate || getDefaultRate?.() || 15);
    const pay  = Number(e.earnings) || round2(hrs * rate);
    totalHrs += hrs; totalPay += pay;
    write(`${day}   ${ro.padEnd(12)}   ${type.padEnd(20)}   ${round1(hrs).toFixed(1).padStart(4)}   $${pay.toFixed(2)}`, 9);
    nl(6);
  }

  nl(4);
  doc.setDrawColor(0); doc.line(left, y - 2, left + 170, y - 2);
  nl(4);
  write(`TOTAL:  ${round1(totalHrs).toFixed(1)} hrs   $${totalPay.toFixed(2)}`, 11, true); nl(12);
  write("This record was generated by Flatrate Buddy. Keep a copy for your records.", 9);
  doc.save(`dispute-pay-period-${ppStartKey}.pdf`);
  toast("Dispute PDF saved.");
}

window.exportDisputeReport = exportDisputeReport;
window.exportDisputeThisWeek = exportDisputeThisWeek;
window.exportDisputePayPeriod = exportDisputePayPeriod;

function renderInsights() {
  const card = document.getElementById("insightsCard");
  if (!card) return;

  const empId = getEmpId();
  if (!empId) {
    card.innerHTML = `<div class="muted small" style="padding:12px 0;">Set your Employee # in <a href="#" style="color:var(--primary);" onclick="event.preventDefault();document.querySelector('[data-tab=settings]')?.click()">Settings</a> to see insights.</div>`;
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
    const t = normalizeJobType(e.type || e.typeText || "");
    const cur = typeMap.get(t) || { earnings: 0, count: 0 };
    typeMap.set(t, { earnings: round2(cur.earnings + (e.earnings || 0)), count: cur.count + 1 });
  }
  const topType = Array.from(typeMap.entries()).sort((a, b) => b[1].earnings - a[1].earnings)[0];

  // Comeback breakdown by job type (all-time)
  const allOwn = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const allComebacks = filterEntriesByEmp(allOwn, empId).filter(e => e.isComeback);
  const cbTypeMap = new Map();
  for (const e of allComebacks) {
    const t = normalizeJobType(e.type || e.typeText || "");
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
  const container = document.getElementById("eightWeekChartCard");
  if (!container) return;

  const empId = getEmpId();
  if (!empId) { container.innerHTML = `<div class="muted small" style="padding:8px 0;">Enter Employee # to see chart.</div>`; return; }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
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

function renderComebackStats() {
  const container = document.getElementById("comebackStatsCard");
  if (!container) return;

  const empId = getEmpId();
  if (!empId) {
    container.innerHTML = `<div class="muted small" style="padding:8px 0;">Enter Employee # to see comeback stats.</div>`;
    return;
  }

  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);
  const comebacks = own.filter(e => e.isComeback);
  const total = own.length;

  if (!total) {
    container.innerHTML = `<div class="muted small" style="padding:8px 0;">No entries yet.</div>`;
    return;
  }

  const rate = Math.round((comebacks.length / total) * 100);
  const cbHours = round1(comebacks.reduce((s, e) => s + Number(e.hours || 0), 0));
  const cbEarnings = round2(comebacks.reduce((s, e) => s + Number(e.earnings || 0), 0));

  const typeMap = new Map();
  for (const e of comebacks) {
    const t = normalizeJobType(e.type || e.typeText || "");
    typeMap.set(t, (typeMap.get(t) || 0) + 1);
  }
  const topTypes = Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const rateColor = rate > 10 ? "var(--danger)" : rate > 5 ? "var(--warn, #f59e0b)" : "var(--ok, var(--primary))";

  container.innerHTML = `
    <div class="insightGrid" style="margin-bottom:8px;">
      <div class="insightCell">
        <div class="insightLabel">Total</div>
        <div class="insightValue" style="color:${comebacks.length > 0 ? "var(--danger)" : "var(--primary)"}">${comebacks.length}</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Rate</div>
        <div class="insightValue" style="color:${rateColor}">${rate}%</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Hours Lost</div>
        <div class="insightValue">${formatHours(cbHours)}</div>
      </div>
      <div class="insightCell">
        <div class="insightLabel">Pay Lost</div>
        <div class="insightValue">${formatMoney(cbEarnings)}</div>
      </div>
    </div>
    ${topTypes.length ? `<div class="insightTopEarner" style="color:var(--danger);">Top types: ${topTypes.map(([t, n]) => `<strong>${escapeHtml(t)}</strong> ×${n}`).join(" · ")}</div>` : ""}
    ${!comebacks.length ? `<div class="muted small" style="margin-top:4px;">No comebacks logged. Keep it up! ✓</div>` : ""}
  `;
}
window.renderComebackStats = renderComebackStats;

/* ── Payday reminder ──────────────────────────────── */
const LS_PAYDAY = "fr_payday_reminder";

function getPaydaySettings() {
  try { return JSON.parse(localStorage.getItem(LS_PAYDAY) || "{}"); } catch { return {}; }
}

function savePaydaySettings(patch) {
  localStorage.setItem(LS_PAYDAY, JSON.stringify({ ...getPaydaySettings(), ...patch }));
}

/* ── Shared notification helper ──────────────────── */
async function sendNotification(title, body, tag = "fr-note", extra = {}) {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag,
      renotify: true,
      data: extra.data || {},
    });
    return true;
  } catch {
    try { new Notification(title, { body, icon: "./icon-192.png" }); return true; } catch {}
  }
  return false;
}
window.__FR = window.__FR || {};
window.__FR.sendNotification = sendNotification;

/* ── Payday week summary ─────────────────────────── */
async function buildWeekSummary() {
  const empId = getEmpId();
  if (!empId) return null;
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : await getAll(STORES.entries));
  const own = filterEntriesByEmp(all, empId);
  const ws = startOfWeekLocal(new Date());
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const weekEntries = own.filter(e => inWeek(e.dayKey || dayKeyFromISO(e.createdAt), ws));
  const totals = computeTotals(weekEntries);
  const daysWorked = new Set(weekEntries.map(e => e.dayKey || dayKeyFromISO(e.createdAt)).filter(Boolean)).size;
  const comebacks = weekEntries.filter(e => e.isComeback).length;
  const typeMap = new Map();
  for (const e of weekEntries) {
    const t = normalizeJobType(e.type || e.typeText || "");
    const cur = typeMap.get(t) || { earnings: 0, count: 0 };
    typeMap.set(t, { earnings: round2(cur.earnings + (e.earnings || 0)), count: cur.count + 1 });
  }
  const topType = Array.from(typeMap.entries()).sort((a, b) => b[1].earnings - a[1].earnings)[0];
  const fmtDate = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { totals, daysWorked, comebacks, topType, weekEntries, wsLabel: `Week of ${fmtDate(ws)} – ${fmtDate(we)}`, ws };
}

async function showPaydaySummary() {
  const modal = document.getElementById("paydaySummaryModal");
  if (!modal) return;
  const s = await buildWeekSummary();
  if (!s) { modal.classList.add("open"); return; } // show blank if no emp

  const weekLbl = document.getElementById("paydaySummaryWeek");
  const statsEl = document.getElementById("paydaySummaryStats");
  const topJobEl = document.getElementById("paydaySummaryTopJob");

  if (weekLbl) weekLbl.textContent = s.wsLabel;
  if (statsEl) statsEl.innerHTML = `
    <div class="insightCell"><div class="insightLabel">Hours</div><div class="insightValue">${s.totals.hours.toFixed(1)}</div></div>
    <div class="insightCell"><div class="insightLabel">Pay Logged</div><div class="insightValue">${formatMoney(s.totals.dollars)}</div></div>
    <div class="insightCell"><div class="insightLabel">Jobs</div><div class="insightValue">${s.totals.count}</div></div>
    <div class="insightCell"><div class="insightLabel">Comebacks</div><div class="insightValue ${s.comebacks > 0 ? "insightValue--warn" : ""}">${s.comebacks > 0 ? s.comebacks : "None ✓"}</div></div>
  `;
  if (topJobEl) {
    if (s.topType) {
      topJobEl.textContent = `Top earner: ${s.topType[0]} · ${formatMoney(s.topType[1].earnings)} · ${s.topType[1].count} job${s.topType[1].count !== 1 ? "s" : ""}`;
      topJobEl.style.display = "";
    } else {
      topJobEl.style.display = "none";
    }
  }

  // Wire email button
  const emailBtn = document.getElementById("paydayEmailBtn");
  if (emailBtn) {
    emailBtn.onclick = () => {
      const empId = getEmpId();
      const lines = [
        `Flatrate Buddy — ${s.wsLabel}`,
        `Employee #: ${empId || "—"}`,
        ``,
        `Hours Logged: ${s.totals.hours.toFixed(1)}`,
        `Pay Logged:   ${formatMoney(s.totals.dollars)}`,
        `Jobs:         ${s.totals.count}`,
        `Days Worked:  ${s.daysWorked}`,
        `Comebacks:    ${s.comebacks}`,
        s.topType ? `Top Earner:   ${s.topType[0]} (${formatMoney(s.topType[1].earnings)})` : "",
      ].filter(l => l !== undefined).join("\n");
      const subject = encodeURIComponent(`Flatrate Buddy — ${s.wsLabel}`);
      const body = encodeURIComponent(lines);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    };
  }

  // Wire PDF button
  const pdfBtn = document.getElementById("paydayPdfBtn");
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      modal.classList.remove("open");
      await exportEntriesToPDF(s.weekEntries);
    };
  }

  modal.classList.add("open");
}

document.getElementById("paydaySummaryCloseBtn")?.addEventListener("click", () => {
  document.getElementById("paydaySummaryModal")?.classList.remove("open");
});
document.getElementById("paydaySummaryModal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});

window.__FR.showPaydaySummary = showPaydaySummary;

async function requestNotifPermission() {
  // Native iOS/Android — use Capacitor Local Notifications
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.LocalNotifications) {
    const { display } = await window.Capacitor.Plugins.LocalNotifications.requestPermissions().catch(() => ({ display: "denied" }));
    return display === "granted" ? "granted" : "denied";
  }
  // Web fallback
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission().catch(() => "denied");
}

function schedulePaydayReminder() {
  clearTimeout(window.__FR_PAYDAY__);
  const s = getPaydaySettings();
  if (!s.enabled) return;

  const [h, m] = String(s.time || "09:00").split(":").map(Number);
  const targetDay = Number(s.day ?? 5);
  const now = new Date();
  const d = new Date(now);

  let daysUntil = ((targetDay - d.getDay()) + 7) % 7;
  if (daysUntil === 0) {
    const todayTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
    if (todayTarget <= now) daysUntil = 7;
  }
  d.setDate(d.getDate() + daysUntil);
  d.setHours(h, m, 0, 0);

  // Native iOS/Android — schedule via Capacitor Local Notifications
  if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.LocalNotifications) {
    const LN = window.Capacitor.Plugins.LocalNotifications;
    LN.requestPermissions().then(({ display }) => {
      if (display !== "granted") return;
      LN.cancel({ notifications: [{ id: 1002 }] }).catch(() => {});
      let nativeBody = "Tap to enter your check amount and verify you weren't short-paid.";
      try {
        const _ANCHOR = new Date("2025-01-06T00:00:00");
        const _periods = Math.floor((new Date() - _ANCHOR) / (14 * 86400000));
        const _ppStart = new Date(_ANCHOR.getTime() + _periods * 14 * 86400000);
        const _ppEnd   = new Date(_ppStart.getTime() + 13 * 86400000);
        const _empId   = getEmpId();
        const _all     = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
        const _pp      = filterEntriesByEmp(_all, _empId).filter(e => {
          const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
          return dk >= dateKey(_ppStart) && dk <= dateKey(_ppEnd);
        });
        if (_pp.length) {
          const _earned = _pp.reduce((s, e) => s + Number(e.earnings || 0), 0);
          const _hrs    = _pp.reduce((s, e) => s + Number(e.hours || 0), 0);
          nativeBody = `You logged ${formatHours(_hrs)} · ${formatMoney(_earned)} this pay period. Does your check match?`;
        }
      } catch {}
      LN.schedule({
        notifications: [{
          id: 1002,
          title: "Flatrate Buddy — Payday 💰",
          body: nativeBody,
          schedule: { at: d },
          smallIcon: "ic_stat_icon",
        }],
      }).catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[LN.schedule]", e); });
    });
    return;
  }

  // Web fallback: setTimeout + Web Notification API
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  window.__FR_PAYDAY__ = setTimeout(() => {
    // Build a summary from the current pay period's entries
    let body = "Tap to enter your check amount and verify you weren't short-paid.";
    try {
      const ANCHOR    = new Date("2025-01-06T00:00:00");
      const MS_PERIOD = 14 * 86400000;
      const nowTs     = new Date();
      const periods   = Math.floor((nowTs - ANCHOR) / MS_PERIOD);
      const ppStart   = new Date(ANCHOR.getTime() + periods * MS_PERIOD);
      const ppEnd     = new Date(ppStart.getTime() + 13 * 86400000);
      const ppStartKey = dateKey(ppStart);
      const ppEndKey   = dateKey(ppEnd);
      const empId = getEmpId();
      const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
      const ppEntries = filterEntriesByEmp(all, empId).filter(e => {
        const dk = e.dayKey || dayKeyFromISO(e.createdAt || "");
        return dk >= ppStartKey && dk <= ppEndKey;
      });
      if (ppEntries.length) {
        const earned = ppEntries.reduce((s, e) => s + Number(e.earnings || 0), 0);
        const hrs    = ppEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
        body = `You logged ${formatHours(hrs)} · ${formatMoney(earned)} this pay period. Does your check match?`;
      }
    } catch {}
    sendNotification("Flatrate Buddy — Payday 💰", body, "payday-reminder", { data: { url: "./index.html?paystub=1" } });
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
      }).catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[LN.schedule2]", e); });
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
  // Guard: called early in runOnce (before any await), so double-call is impossible
  // but guard is kept for safety.
  if (tabs[0]._moreTabInited) return;
  tabs[0]._moreTabInited = true;

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

  tabs.forEach(t => {
    // Plain click works reliably now that #spa-more is never display:none
    // (touch-action:manipulation in CSS eliminates the 300ms tap delay)
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });

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
    container.innerHTML = `<div class="muted small" style="padding:12px 16px;">No Employee # set. <button type="button" class="linkBtn" onclick="document.querySelector('.moreTab[data-tab=\\'settings\\']')?.click()">Go to Settings →</button></div>`;
    return;
  }

  const all = await getAll(STORES.entries);
  const entries = filterEntriesByEmp(all, empId);
  entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!entries.length) {
    container.innerHTML = `<div class="muted small" style="padding:12px 16px;">No entries yet.</div>`;
    const bar = document.getElementById("histWeekSummary");
    if (bar) bar.style.display = "none";
    return;
  }

  // ── Week summary bar ───────────────────────────
  const nowKey = new Date().toISOString().slice(0, 10);
  const weekStart = (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10);
  })();
  const weekEntries = entries.filter(e => (e.dayKey || "") >= weekStart);
  const wkJobs = weekEntries.length;
  const wkHours = weekEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const wkPay   = weekEntries.reduce((s, e) => s + (Number(e.earnings ?? e.dollars ?? 0) || 0), 0);
  const bar = document.getElementById("histWeekSummary");
  if (bar && wkJobs > 0) {
    bar.style.display = "flex";
    const jEl = document.getElementById("histWeekJobs");
    const hEl = document.getElementById("histWeekHours");
    const pEl = document.getElementById("histWeekPay");
    if (jEl) jEl.textContent = `${wkJobs} job${wkJobs !== 1 ? "s" : ""}`;
    if (hEl) hEl.textContent = `${Math.round(wkHours * 10) / 10} hrs`;
    if (pEl) pEl.textContent = `$${wkPay.toFixed(2)}`;
  } else if (bar) {
    bar.style.display = "none";
  }

  // Keep the full list in memory so search can filter the DATA, not the DOM.
  // (Searching rendered text meant VIN and notes — which weren't displayed —
  //  were impossible to find. That's how a logged car could go missing.)
  _HISTORY_ENTRIES = entries;
  drawHistoryRows(entries);
}

/** Everything about an entry a person might type into the search box. */
function entrySearchBlob(e) {
  return [
    e.ro, e.ref, e.roNumber, e.ro_number,
    e.vin8, e.vin,
    e.type, e.typeText,
    e.notes,
    e.dayKey, e.workDate,
    e.hours, e.earnings ?? e.dollars,
  ].filter(v => v !== null && v !== undefined && v !== "")
   .join(" ")
   .toLowerCase();
}

/**
 * Match every whitespace-separated term (AND), so "pdi 40534" narrows rather
 * than widens. Digit-only terms also match loosely against RO/VIN so a partial
 * VIN or the tail of an RO still finds the job.
 */
function entryMatchesQuery(e, q) {
  if (!q) return true;
  const blob = entrySearchBlob(e);
  return q.split(/\s+/).filter(Boolean).every(term => blob.includes(term));
}

let _HISTORY_ENTRIES = [];

function drawHistoryRows(entries) {
  const container = document.getElementById("bulkEntryList");
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `<div class="muted small" style="padding:16px;">No jobs match that search.</div>`;
    return;
  }

  container.innerHTML = "";
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "bulkEntryRow";
    row.dataset.id = String(e.id ?? "");
    const ref = e.ro || e.ref || "";
    const refDisplay = ref ? escapeHtml(ref) : "<span class='bulkEntryNoRef'>no RO#</span>";
    const vin   = (e.vin8 || e.vin || "").trim();
    const notes = (e.notes || "").trim();
    const hasPhoto = !!(e.photo_path || e.photoPath);
    row.innerHTML = `
      <label class="bulkEntryCheck" style="${_bulkSelectMode ? "" : "display:none;"}">
        <input type="checkbox" class="bulkCheck" />
      </label>
      <div class="bulkEntryInfo">
        <div class="bulkEntryRef">${refDisplay} <span class="bulkEntryType">${escapeHtml(e.type || e.typeText || "—")}</span></div>
        <div class="bulkEntryMeta">${formatMoney(Number(e.earnings ?? e.dollars ?? 0))} · ${round1(Number(e.hours || 0))} hrs · ${e.dayKey || ""}</div>
        ${vin ? `<div class="bulkEntryVin">VIN ${escapeHtml(vin)}</div>` : ""}
        ${notes ? `<div class="bulkEntryNotes">${escapeHtml(notes)}</div>` : ""}
      </div>
      ${hasPhoto ? `<button type="button" class="bulkEntryPhoto" data-photo-id="${escapeHtml(String(e.id ?? ""))}" aria-label="View photo">📷</button>` : ""}
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
    const confirmed = await showActionSheet({ title: `Delete ${n} entr${n === 1 ? "y" : "ies"}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!confirmed) return;

    const ids = checked.map(cb => cb.closest(".bulkEntryRow")?.dataset.id).filter(Boolean);
    for (const id of ids) {
      try {
        await softDeleteLog(sb(), id);
      } catch (e) {
        console.warn("[bulkDelete] Supabase delete failed, removing local only:", e);
        await del(STORES.entries, id).catch(console.warn);
      }
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
    const confirmed = await showActionSheet({ title: `Delete ${n} job type${n === 1 ? "" : "s"}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!confirmed) return;

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

  const countEl = document.getElementById("entrySearchCount");

  const runSearch = () => {
    const q = input.value.toLowerCase().trim();
    const hits = q ? _HISTORY_ENTRIES.filter(e => entryMatchesQuery(e, q)) : _HISTORY_ENTRIES;
    drawHistoryRows(hits);
    if (countEl) {
      if (!q) { countEl.style.display = "none"; }
      else {
        countEl.style.display = "";
        countEl.textContent = `${hits.length} of ${_HISTORY_ENTRIES.length} job${_HISTORY_ENTRIES.length === 1 ? "" : "s"}`;
      }
    }
  };

  input.addEventListener("input", runSearch);
  input.addEventListener("search", runSearch); // native clear (×) on type=search

  // Clear on tab switch (reset search)
  document.querySelectorAll(".moreTab").forEach(tab => {
    tab.addEventListener("click", () => {
      input.value = "";
      if (countEl) countEl.style.display = "none";
      if (_HISTORY_ENTRIES.length) drawHistoryRows(_HISTORY_ENTRIES);
    });
  });

  // Photo badge → open the proof photo for that job, from anywhere in history.
  document.getElementById("bulkEntryList")?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-photo-id]");
    if (!btn) return;
    ev.stopPropagation();               // don't toggle the bulk-select checkbox
    const id = btn.dataset.photoId;
    const entry = _HISTORY_ENTRIES.find(e => String(e.id) === String(id));
    if (!entry) return;
    try {
      haptic?.("light");
      await openPhotoViewer(entry);
    } catch (e) {
      toast?.("Couldn't open photo");
    }
  });
}

window.initMoreTabs = initMoreTabs;
window.renderBulkEntryList = renderBulkEntryList;
window.initBulkDelete = initBulkDelete;
window.initJobTypeBulkDelete = initJobTypeBulkDelete;
window.initEntrySearch = initEntrySearch;

/* ── Job type cleanup (AI-assisted merge) ─────────────────────────────────
 * Techs type the same job a dozen different ways ("pdi", "P.D.I.", "pre
 * delivery insp"), which fragments Job Scorecard / Type Breakdown data.
 * normalizeJobType() (main-page.js) already catches known patterns via a
 * hardcoded alias table plus punctuation/acronym matching. This tool handles
 * the long tail: it sends whatever's left unrecognized to a Gemini edge
 * function, which suggests groupings, and the tech approves per-group before
 * anything is saved. Nothing here ever rewrites a past entry's `type` field —
 * confirmed merges are stored as rows in job_type_aliases and consulted by
 * normalizeJobType() at display time, so it's fully reversible (delete the
 * row, the merge undoes itself).
 */

async function loadCustomTypeAliases() {
  if (!window.CURRENT_UID) return;
  try {
    const { data, error } = await sb()
      .from("job_type_aliases")
      .select("raw_text, canonical")
      .eq("user_id", window.CURRENT_UID);
    if (error) throw error;
    const map = new Map();
    for (const row of (data || [])) {
      map.set(_compactTypeKey(row.raw_text), row.canonical);
    }
    CUSTOM_TYPE_ALIASES = map;
  } catch (e) {
    console.warn("[job-type-aliases] load failed", e);
  }
}

// Mirrors normalizeJobType()'s matching steps (short codes, compact/acronym,
// regex table, confirmed aliases) WITHOUT the final title-case fallback —
// returns true if the string is already handled by something, false if it's
// a genuine candidate for the AI to look at.
function _typeIsAlreadyRecognized(raw) {
  const s = String(raw || "").trim();
  if (!s) return true;
  const compact = _compactTypeKey(s);
  const acronym = _acronymKey(s);
  if (CUSTOM_TYPE_ALIASES.has(compact)) return true;
  if (JOB_TYPE_SHORT_CODES[compact]) return true;
  for (const [canonical] of JOB_TYPE_ALIASES) {
    const canonCompact = _compactTypeKey(canonical);
    if (compact === canonCompact || (acronym && acronym === canonCompact)) return true;
  }
  for (const [, ...patterns] of JOB_TYPE_ALIASES) {
    if (patterns.some(p => p.test(s))) return true;
  }
  return false;
}

function gatherUnclusteredTypeCandidates() {
  const entries = Array.isArray(window.CURRENT_ENTRIES) ? window.CURRENT_ENTRIES : [];
  const counts = new Map();
  for (const e of entries) {
    const raw = String(e.typeText || e.type || "").trim();
    if (!raw || _typeIsAlreadyRecognized(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/** Same auth-token dance the other edge-function callers use. */
async function _callClusterJobTypes(payload, timeoutMs = 20000) {
  const sbInstance = window.__FR?.sb;
  const fnUrl = `${window.__SUPABASE_CONFIG__.url}/functions/v1/cluster-job-types`;

  const getToken = async () => {
    const refreshed = await sbInstance.auth.refreshSession().catch(() => null);
    const session = refreshed?.data?.session || (await sbInstance.auth.getSession()).data?.session;
    return session?.access_token || null;
  };

  const token = await getToken();
  if (!token) throw new Error("auth_expired");

  const doFetch = async (tok) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(fnUrl, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${tok}`,
          "apikey": window.__SUPABASE_CONFIG__.anonKey,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data?.error || `Scan failed (${res.status})`), { status: res.status });
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Taking too long — try again");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await doFetch(token);
  } catch (e) {
    if (e.status === 401) {
      const fresh = await getToken();
      if (fresh && fresh !== token) return await doFetch(fresh);
    }
    throw e;
  }
}

let _TYPE_CLEANUP_GROUPS = [];

async function scanForTypeCleanup() {
  const btn    = document.getElementById("typeCleanupScanBtn");
  const status = document.getElementById("typeCleanupStatus");
  const results = document.getElementById("typeCleanupResults");
  const setStatus = (msg) => { if (status) status.textContent = msg; };

  const candidates = gatherUnclusteredTypeCandidates();
  if (candidates.length < 2) {
    setStatus("Nothing to clean up — every job type you've logged is already recognized.");
    if (results) results.innerHTML = "";
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Scanning…"; }
  setStatus(`Checking ${candidates.length} unrecognized job type${candidates.length === 1 ? "" : "s"}…`);
  try {
    const { groups } = await _callClusterJobTypes({ items: candidates });
    _TYPE_CLEANUP_GROUPS = Array.isArray(groups) ? groups : [];
    if (!_TYPE_CLEANUP_GROUPS.length) {
      setStatus("No matching job types found to merge — they all look distinct.");
      if (results) results.innerHTML = "";
    } else {
      setStatus(`Found ${_TYPE_CLEANUP_GROUPS.length} group${_TYPE_CLEANUP_GROUPS.length === 1 ? "" : "s"} to review:`);
      renderTypeCleanupGroups();
    }
  } catch (e) {
    setStatus(e?.message === "auth_expired" ? "Sign back in to use this." : (e?.message || "Couldn't scan — try again."));
    if (results) results.innerHTML = "";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Scan my job types"; }
  }
}

function renderTypeCleanupGroups() {
  const results = document.getElementById("typeCleanupResults");
  if (!results) return;
  results.innerHTML = _TYPE_CLEANUP_GROUPS.map((g, gi) => `
    <div class="tcGroup" data-group="${gi}">
      <div class="tcGroupHead">
        <span class="tcGroupInto">Merge into</span>
        <input class="fr26Input tcCanonicalInput" value="${escapeHtml(g.canonical)}" maxlength="60" />
      </div>
      <div class="tcVariants">
        ${g.variants.map((v, vi) => `
          <label class="tcVariant">
            <input type="checkbox" checked data-variant="${vi}" />
            <span>${escapeHtml(v)}</span>
          </label>`).join("")}
      </div>
      <button type="button" class="btn primary tcApplyBtn" data-group="${gi}">Merge</button>
    </div>`).join("");
}

async function applyTypeCleanupGroup(groupIndex) {
  const card = document.querySelector(`.tcGroup[data-group="${groupIndex}"]`);
  const g = _TYPE_CLEANUP_GROUPS[groupIndex];
  if (!card || !g) return;

  const canonical = (card.querySelector(".tcCanonicalInput")?.value || "").trim();
  if (!canonical) { toast?.("Give it a name first."); return; }

  const checked = Array.from(card.querySelectorAll(".tcVariant input:checked"))
    .map(cb => g.variants[Number(cb.dataset.variant)])
    .filter(Boolean);
  if (checked.length < 1) { toast?.("Check at least one to merge."); return; }

  const btn = card.querySelector(".tcApplyBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Merging…"; }
  try {
    const rows = checked.map(raw_text => ({
      user_id: window.CURRENT_UID,
      raw_text,
      canonical,
    }));
    const { error } = await sb().from("job_type_aliases").upsert(rows, { onConflict: "user_id,raw_text" });
    if (error) throw error;

    for (const raw_text of checked) {
      CUSTOM_TYPE_ALIASES.set(_compactTypeKey(raw_text), canonical);
    }

    haptic?.("success");
    toast?.(`Merged ${checked.length} into "${canonical}" — check Job Scorecard next time you're on Stats`);
    card.remove();
  } catch (e) {
    toast?.(e?.message || "Couldn't save — try again.");
    if (btn) { btn.disabled = false; btn.textContent = "Merge"; }
  }
}

function initTypeCleanup() {
  document.getElementById("typeCleanupScanBtn")?.addEventListener("click", scanForTypeCleanup);
  document.getElementById("typeCleanupResults")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".tcApplyBtn");
    if (btn) applyTypeCleanupGroup(Number(btn.dataset.group));
  });
}

window.__FR = window.__FR || {};
window.__FR.loadCustomTypeAliases = loadCustomTypeAliases;
window.__FR.initTypeCleanup = initTypeCleanup;

// ═══════════════════════════════════════════════════════════════
// OWE ME TRACKER
// ═══════════════════════════════════════════════════════════════
const LS_OWE_ME = "fr_owe_me_";

function getOweMeItems(empId) {
  try { return JSON.parse(localStorage.getItem(LS_OWE_ME + empId) || "[]"); } catch { return []; }
}
function saveOweMeItems(empId, items) {
  try { localStorage.setItem(LS_OWE_ME + empId, JSON.stringify(items)); } catch {}
}

function renderOweMeList() {
  const empId  = getEmpId?.() || localStorage.getItem("fr_emp_id") || "";
  const list   = document.getElementById("oweMeList");
  const badge  = document.getElementById("oweMeTotalBadge");
  if (!list) return;
  const items  = getOweMeItems(empId);
  const total  = items.reduce((s, i) => s + (Number(i.amt) || 0), 0);
  if (badge) {
    if (total > 0) { badge.textContent = `$${total.toFixed(2)} owed`; badge.style.display = ""; }
    else badge.style.display = "none";
  }
  if (!items.length) {
    list.innerHTML = `<p style="font-size:13px;color:var(--muted);padding:0 14px 12px;margin:0;">Nothing logged yet.</p>`;
    return;
  }
  list.innerHTML = items.map((item, idx) => `
    <div class="oweMeRow" data-idx="${idx}">
      <div class="oweMeDesc">${escapeHtml?.(item.desc) || ""}</div>
      <div class="oweMeRight">
        <span class="oweMeAmt">$${Number(item.amt || 0).toFixed(2)}</span>
        <span class="oweMeDate">${item.date || ""}</span>
        <button class="iBtn iBtn--danger oweMeDelBtn" data-idx="${idx}" type="button">✕</button>
      </div>
    </div>
  `).join("");
  list.querySelectorAll(".oweMeDelBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      const items2 = getOweMeItems(empId);
      items2.splice(i, 1);
      saveOweMeItems(empId, items2);
      renderOweMeList();
      toast?.("Removed");
    });
  });
}

function initOweMe() {
  const form    = document.getElementById("oweMeForm");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";
  renderOweMeList();
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const empId  = getEmpId?.() || localStorage.getItem("fr_emp_id") || "";
    const desc   = (document.getElementById("oweMeDesc")?.value || "").trim();
    const amt    = parseFloat(document.getElementById("oweMeAmt")?.value || "0") || 0;
    if (!desc) { toast?.("Enter a description"); return; }
    const items  = getOweMeItems(empId);
    items.unshift({ desc, amt, date: new Date().toLocaleDateString() });
    saveOweMeItems(empId, items);
    document.getElementById("oweMeDesc").value = "";
    document.getElementById("oweMeAmt").value  = "";
    renderOweMeList();
    toast?.(`Added · $${amt.toFixed(2)}`);
  });
}
window.initOweMe = initOweMe;

/* ── More-page continuation tour ─────────────────── */
const MORE_TOUR_STEPS = [
  {
    el: ".teamEntryBanner",
    title: "Run a Shop, or on a Team? 🧑‍🔧",
    body: "Tap this any time — create a shop and get an invite code for your techs, or join one your manager already set up. Managers get a full dashboard: every tech's jobs, hours, and pay in one place.",
  },
  /* ── Job Types tab ─────────────────────── */
  {
    el: "#moreTabBar",
    title: "More → Three Sections",
    body: "Job Types is your template library. History is every job logged. Settings holds your rate, pay stub, and account. For earnings by job type, check the Stats tab in the bottom nav.",
    action: "switch-tab:jobs",
  },
  {
    el: "#savedTypeCreateForm",
    title: "Save Your Common Jobs",
    body: "Type a job name, how many flat hours it typically pays, and your rate. Hit Add — now that job shows up as a one-tap chip every time you log on the main page. Do this for your top 5 jobs and logging gets way faster.",
    action: "switch-tab:jobs",
  },
  {
    el: "#savedTypesList",
    title: "Your Job Type Library",
    body: "All your saved templates live here. Pencil icon edits hours or rate. Trash deletes it. Hit Select to pick multiples and wipe them in one shot.",
    action: "switch-tab:jobs",
  },
  {
    el: "#typeCleanupScanBtn",
    title: "Clean Up Messy Job Types 🧹",
    body: "Typed 'pdi', 'P.D.I.', and 'pre delivery insp' as three different jobs? Tap Scan and I'll spot the ones that mean the same thing and let you merge them — so your stats aren't split across duplicates.",
    action: "switch-tab:jobs;open-details:typeCleanupDetails",
  },
  /* ── History tab ───────────────────────── */
  {
    el: "#insightsCard",
    title: "Your Stats at a Glance",
    body: "Effective $/hr, average daily pay, comeback count, weekly pace — all auto-calculated from your logs. Check this every Friday before you clock out.",
    action: "switch-tab:history",
  },
  {
    el: "#entrySearchInput",
    title: "Search Every Job You've Logged",
    body: "Type a job name, RO number, STK number, VIN, date — anything. Your full history filters in real time, and every entry has its proof photo one tap away. Great for pulling up a specific car or disputing a flagged job.",
    action: "switch-tab:history",
  },
  {
    el: "#bulkSelectToggle",
    title: "Bulk Delete",
    body: "Tap Select to enter selection mode, check individual rows or tap All, then hit Delete. Good for clearing out test entries after setup.",
    action: "switch-tab:history",
  },
  {
    el: "#lostTimeCard",
    title: "Where'd the Time Go? ⏳",
    body: "Clock out with a gap between your shift and your flat hours, and I'll ask what ate it — parts chase, no work, a comeback. Track it here and you'll know exactly what's costing you real hours, not just guess.",
    action: "switch-tab:history;open-details:lostTimeDetails",
  },
  {
    el: "#requestsDetails",
    title: "Send It Straight to Your Manager 📮",
    body: "Missing work, short pay, or need more hours — file it here and it lands in your manager's inbox with a timestamp. Once you've picked the job, tap Draft for me and I'll write it up factual and ready to send.",
    action: "switch-tab:history;open-details:requestsDetails",
  },
  {
    el: "#oweMeForm",
    title: "Owe Me Tracker",
    body: "Shop owes you money? Log it here — warranty callbacks, goodwill, parts hold-ups. Add a description and dollar amount. The running total stays visible so you don't forget to chase it down.",
    action: "switch-tab:history",
  },
  /* ── Settings tab ──────────────────────── */
  {
    el: "#settingsDefaultRate",
    title: "Set Your Hourly Rate",
    body: "This is the rate I use to calculate your earnings on every job. Set it once, forget it. You can always override per job in the Add Details section when something pays differently.",
    action: "switch-tab:settings",
  },
  {
    el: "#authForm",
    title: "Back Up to the Cloud",
    body: "Sign in and I'll sync everything — switch phones, reinstall, doesn't matter. Your full history comes back instantly. Your data lives with your account, not your device.",
    action: "switch-tab:settings",
  },
  {
    el: "#payStubDetails",
    title: "Catch Short Pay 💰",
    body: "Enter your check amount each pay period. I compare it against every logged job and flag the gap automatically. If you're getting shorted, this is how you prove it.",
    action: "open-paystub",
  },
  {
    el: null,
    title: "Add Me to Your Home Screen 📱",
    body: "Almost done — install Flatrate Buddy so it opens like a real app, works offline, and stays on your home screen. Tap the banner that pops up or use your browser's 'Add to Home Screen' option. Replay this tour any time from More → Help → Take Tour.",
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

  function runAction(actionStr) {
    if (!actionStr) return;
    // A step can need more than one thing done before it's spotlight-ready
    // (switch to the right tab AND pop a collapsed section open) — semicolon
    // separates independent directives run in order.
    actionStr.split(";").forEach(runOneAction);
  }

  function runOneAction(action) {
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
    // Generic: force open a collapsed <details> section so its content has
    // real dimensions to spotlight — a closed <details> renders its children
    // with a zero-size box, which would otherwise leave the tour highlighting
    // nothing.
    if (action.startsWith("open-details:")) {
      const det = document.getElementById(action.split(":")[1]);
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
    // Nudge PWA install if not yet installed
    if (window.__FR?.canInstall?.()) {
      const banner = document.getElementById("installBanner");
      if (banner) banner.style.display = "";
    }
  }

  nextBtn.onclick = () => { step++; if (step >= MORE_TOUR_STEPS.length) endTour(); else show(step); };
  skipBtn.onclick = endTour;

  // Small delay so the page has finished rendering
  setTimeout(() => show(0), 500);
}

window.__FR = window.__FR || {};
window.__FR.startMoreTour = startMoreTour;
