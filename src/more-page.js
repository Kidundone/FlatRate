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
  // Admin (app owner's own testing account): never gated.
  if (typeof isAdminAccount === "function" && isAdminAccount()) return true;
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

  // Hours paid used to be copied straight from logged hours, which made the
  // hours gap permanently zero and hid half the discrepancy — a stub can pay
  // the right dollars on the wrong hours, or vice versa. Blank means "the stub
  // doesn't show hours", and we fall back to the logged figure so the dollar
  // comparison still works exactly as before.
  const hoursEl = document.getElementById("payStubHoursPaid");
  const rawHours = String(hoursEl?.value ?? "").trim();
  const parsedHours = rawHours === "" ? null : Number(rawHours);
  const hoursPaid = Number.isFinite(parsedHours) && parsedHours >= 0 ? parsedHours : null;

  const expected = { hours: totalHours, pay: totalPay };
  const actual   = { hours: hoursPaid == null ? totalHours : hoursPaid, pay: amountPaid };
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
    const hEl = document.getElementById("payStubHoursPaid");
    if (hEl) hEl.value = Number(stub.hoursPaid) > 0 ? String(Number(stub.hoursPaid)) : "";
    return;
  }

  const weekEnd = weekEndingForWeekStartKey(key);
  if (weekEnd) weekEl.value = weekEnd;
  amountEl.value = "";
  const hEl2 = document.getElementById("payStubHoursPaid");
  if (hEl2) hEl2.value = "";
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

  // Hours paid was always stored as 0, so every dispute report claimed "0 hrs
  // paid" no matter what the stub said. Persist what the tech actually entered.
  const hoursEl = document.getElementById("payStubHoursPaid");
  const rawHrs = String(hoursEl?.value ?? "").trim();
  const parsedHrs = rawHrs === "" ? 0 : Number(rawHrs);
  const hoursPaid = Number.isFinite(parsedHrs) && parsedHrs >= 0 ? round1(parsedHrs) : 0;

  const biweekly = isBiweeklyMode();
  const week2StartKey = biweekly ? getWeek2StartKey(weekStartKey) : null;

  if (biweekly && week2StartKey) {
    // Split the check amount evenly across both weeks for per-week tracking
    const ctx = getPayStubAuditContext();
    const w1Pay = round2(Number(ctx.expected?.pay || 0));
    const total = round2(Number(ctx.actual?.pay || 0));
    const w2Pay = round2(total - w1Pay > 0 ? total - w1Pay : total / 2);
    const w1Amt = round2(total - w2Pay);
    const h1 = round1(hoursPaid / 2), h2 = round1(hoursPaid - round1(hoursPaid / 2));
    upsertPayStubEntry({ weekStartKey, weekEnding, hoursPaid: h1, amountPaid: w1Amt, biweekly: true, linkedWeek: week2StartKey });
    const ws2 = parseDateInputValue(week2StartKey);
    const we2 = ws2 ? dateKey(endOfWeekLocal(ws2)) : weekEnding;
    upsertPayStubEntry({ weekStartKey: week2StartKey, weekEnding: we2, hoursPaid: h2, amountPaid: w2Pay, biweekly: true, linkedWeek: weekStartKey });
  } else {
    upsertPayStubEntry({ weekStartKey, weekEnding, hoursPaid, amountPaid });
  }

  renderPayStubComparison();
  renderMissingWorkReview?.();   // Save is the moment the gap changes — redraw it.
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
  renderPayrollReportReconciliation?.();
  await renderTypesListInMore?.();
  await refreshPayrollUI?.();
  if (document.getElementById("reviewList")) await renderReview?.();
}

window.refreshMorePagePanels = refreshMorePagePanels;

async function _callScanPayStub(base64, mediaType = "image/jpeg", mode = "auto") {
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
    body: JSON.stringify({ imageBase64: base64, mediaType, mode }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Scan failed (${res.status}): ${txt}`);
  }
  return res.json();
}

/* ── Payroll Report (Shop Technician Payroll Report) ─────────────────────── */

const PAYROLL_REPORT_KEY = "fr_payroll_report";

function savePayrollReport(data) {
  try { localStorage.setItem(PAYROLL_REPORT_KEY, JSON.stringify(data)); } catch {}
}
function loadPayrollReport() {
  try { return JSON.parse(localStorage.getItem(PAYROLL_REPORT_KEY) || "null"); } catch { return null; }
}
function clearPayrollReport() {
  localStorage.removeItem(PAYROLL_REPORT_KEY);
  renderPayrollReportReconciliation();
  toast("Payroll report cleared.");
}
window.clearPayrollReport = clearPayrollReport;

async function scanPayrollReport(file) {
  const btn = document.getElementById("scanPayrollReportBtn");
  const origText = btn?.textContent || "Scan Report";
  if (btn) { btn.textContent = "Scanning…"; btn.disabled = true; }

  try {
    const dataUrl = await compressImageFileToDataUrl(file, 1400, 0.80);
    const base64 = dataUrl.split(",")[1];
    const mediaType = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    // Call edge function with payroll_report mode
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
      body: JSON.stringify({ imageBase64: base64, mediaType, mode: "payroll_report" }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Scan failed (${res.status}): ${txt}`);
    }

    const result = await res.json();

    if (result.error) {
      toast(`Scan error: ${result.error}`);
      return;
    }

    if (result.type !== "payroll_report" || !Array.isArray(result.rows)) {
      toast("Couldn't read payroll report — try again or use a clearer photo.");
      return;
    }

    savePayrollReport(result);
    renderPayrollReportReconciliation();
    const hrs = Number(result.totalSoldHours || 0);
    toast(`Payroll report scanned — ${formatHours(hrs)} sold hrs found.`);
  } catch (e) {
    console.warn("[scanPayrollReport]", e?.message || e);
    toast(`Scan failed: ${e?.message || "try again"}`);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

function renderPayrollReportReconciliation() {
  const el = document.getElementById("payrollReportReconcile");
  if (!el) return;

  const report = loadPayrollReport();
  if (!report || !Array.isArray(report.rows) || !report.rows.length) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:4px 0 8px;">Photograph your shop's Technician Payroll Report to find missing hours day-by-day.</div>`;
    return;
  }

  // Group sold hours by closedDate
  const byDate = {};
  const descsByDate = {};
  for (const row of report.rows) {
    if (!row.closedDate || !Number.isFinite(Number(row.soldHours))) continue;
    byDate[row.closedDate] = round2((byDate[row.closedDate] || 0) + Number(row.soldHours));
    descsByDate[row.closedDate] = descsByDate[row.closedDate] || [];
    if (row.description) descsByDate[row.closedDate].push(`${row.description} (${formatHours(Number(row.soldHours))} hrs)`);
  }

  // App entries for the period
  const empId = getEmpId();
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  const dates = Object.keys(byDate).sort();
  let html = "";
  let totalPayroll = 0;
  let totalApp = 0;
  let totalMissing = 0;

  for (const dk of dates) {
    const payrollHrs = byDate[dk];
    const dayEntries = own.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dk);
    const appHrs = round2(dayEntries.reduce((s, e) => s + Number(e.hours || 0), 0));
    const diff = round2(payrollHrs - appHrs);
    totalPayroll = round2(totalPayroll + payrollHrs);
    totalApp = round2(totalApp + appHrs);
    if (diff > 0.05) totalMissing = round2(totalMissing + diff);

    const label = formatDayLabel(dk) || dk;
    const diffColor = diff > 0.09 ? "var(--danger)" : diff < -0.09 ? "var(--warn,#f59e0b)" : "var(--ok,var(--primary,#2563EB))";
    const diffLabel = diff > 0.09 ? `⚠️ −${formatHours(diff)}` : diff < -0.09 ? `+${formatHours(Math.abs(diff))}` : "✓";
    const descs = (descsByDate[dk] || []).slice(0, 4).join(" · ");

    html += `<div style="padding:7px 0;border-bottom:1px solid var(--stroke);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(label)}</div>
        <div style="display:flex;gap:14px;font-size:12px;align-items:center;">
          <span style="color:var(--muted);">shop <b style="color:var(--fg)">${formatHours(payrollHrs)}</b></span>
          <span style="color:var(--muted);">app <b style="color:var(--fg)">${formatHours(appHrs)}</b></span>
          <b style="color:${diffColor};">${diffLabel}</b>
        </div>
      </div>
      ${descs ? `<div style="font-size:11px;color:var(--muted2,var(--muted));margin-top:2px;">${escapeHtml(descs)}</div>` : ""}
    </div>`;
  }

  const periodLabel = report.period?.from && report.period?.to
    ? `${report.period.from} – ${report.period.to}`
    : "Scanned period";

  const totalSummary = totalMissing > 0.05
    ? `<div style="font-size:15px;font-weight:700;color:var(--danger);margin-bottom:4px;">⚠️ ${formatHours(totalMissing)} hrs on shop report not in your app</div>`
    : `<div style="font-size:14px;font-weight:700;color:var(--ok,var(--primary,#2563EB));margin-bottom:4px;">✓ App matches shop payroll report</div>`;

  el.innerHTML = `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Period: ${escapeHtml(periodLabel)} · ${formatHours(totalPayroll)} shop hrs · ${formatHours(totalApp)} app hrs</div>
      ${totalSummary}
    </div>
    ${html}
    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;padding:8px 0 4px;border-top:1px solid var(--stroke);margin-top:4px;">
      <span>Total</span>
      <span style="display:flex;gap:14px;">
        <span>${formatHours(totalPayroll)} shop</span>
        <span>${formatHours(totalApp)} app</span>
        <span style="color:${totalMissing > 0.05 ? "var(--danger)" : "var(--ok,var(--primary,#2563EB))"};">${totalMissing > 0.05 ? "−" + formatHours(totalMissing) : "✓"}</span>
      </span>
    </div>
    <button onclick="clearPayrollReport()" class="btn" style="margin-top:10px;width:100%;font-size:12px;color:var(--muted);padding:8px;">Clear &amp; Scan New Report</button>
  `;
}
window.renderPayrollReportReconciliation = renderPayrollReportReconciliation;

function initPayrollReportUI() {
  const libBtn    = document.getElementById("scanPayrollReportBtn");
  const camBtn    = document.getElementById("scanPayrollReportCamBtn");
  const picker    = document.getElementById("payrollReportPicker");
  const camPicker = document.getElementById("payrollReportCamera");
  if (!libBtn && !camBtn) return;

  const onFile = (input) => () => {
    const file = input.files?.[0];
    if (file) scanPayrollReport(file);
    input.value = "";
  };

  libBtn?.addEventListener("click", () => picker?.click());
  camBtn?.addEventListener("click", () => camPicker?.click());
  picker?.addEventListener("change", onFile(picker));
  camPicker?.addEventListener("change", onFile(camPicker));

  renderPayrollReportReconciliation();
}

/**
 * Photograph the shop's payroll report and reconcile it against the log.
 * The edge function already understands mode:"payroll_report" and hands back
 * structured rows; this just maps them onto the shape reconcilePayroll wants.
 */
async function scanPayrollForReconcile(file) {
  const status = document.getElementById("payrollScanStatus");
  const camBtn = document.getElementById("scanPayrollCamBtn");
  const libBtn = document.getElementById("scanPayrollLibBtn");
  const setBusy = (b) => {
    if (camBtn) camBtn.disabled = b;
    if (libBtn) libBtn.disabled = b;
  };
  const say = (msg) => {
    if (!status) return;
    status.textContent = msg;
    status.style.display = msg ? "" : "none";
  };

  setBusy(true);
  say("Reading the report…");
  haptic?.("light");

  try {
    // Larger + higher quality than the check-stub scan: this page is dense
    // small type and every RO number has to survive compression.
    const dataUrl = await compressImageFileToDataUrl(file, 2000, 0.9);
    const base64 = dataUrl.split(",")[1];
    const mediaType = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";

    const result = await _callScanPayStub(base64, mediaType, "payroll_report");
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    if (!rows.length) {
      say(result?.error ? `Couldn't read it: ${result.error}` : "Couldn't find any RO lines — try a straighter, closer photo.");
      return;
    }

    const paidLines = rows.map(r => ({
      ro: String(r.ro ?? ""),
      hours: Number(r.soldHours) || 0,
      cost: Number(r.laborCost) || 0,
      bookedDate: r.bookedDate || r.closedDate || "",
      closedDate: r.closedDate || r.bookedDate || "",
      opCode: r.opCode || "",
      description: r.description || "",
    })).filter(r => r.ro);

    // Self-check: if the report printed its own totals, confirm we read it right.
    const readHours = round2(paidLines.reduce((s, p) => s + p.hours, 0));
    const stated = Number(result?.totalSoldHours);
    let warn = "";
    if (Number.isFinite(stated) && stated > 0 && Math.abs(stated - readHours) > 0.05) {
      warn = `Read ${formatHours(readHours)} hrs but the report totals ${formatHours(stated)} — some lines may have been missed. Check the photo or paste the text.`;
    }

    say(`Read ${paidLines.length} lines · ${formatHours(readHours)} hrs.`);
    _lastPayrollLines = paidLines;
    renderPayrollReconciliation(paidLines, warn);
    // One scan feeds both views: the per-RO list here and the existing
    // day-by-day totals card further down the page.
    try { savePayrollReport?.(result); renderPayrollReportReconciliation?.(); } catch {}
    haptic?.("success");
  } catch (e) {
    console.warn("[scanPayrollReport]", e?.message || e);
    say(`Scan failed: ${e?.message || "try again"}`);
  } finally {
    setBusy(false);
  }
}
let _lastPayrollLines = null;

/** Render the per-RO reconciliation. Shared by the photo scan and the paste box. */
function renderPayrollReconciliation(paidLines, warn = "") {
  const out = document.getElementById("payrollReconcileOut");
  if (!out) return;

  const ctx = getPayStubAuditContext();
  const entries = ctx?.entries || [];
  if (!entries.length) {
    out.innerHTML = `<div class="muted small">No logged jobs for this pay period to compare against. Set the Week of date above to the period this report covers.</div>`;
    return;
  }

  const knownGap = Number(ctx?.comparison?.missingHours || 0);
  const r = reconcilePayroll(entries, paidLines, knownGap > 0 ? knownGap : null, getEmpId());
  const t = r.totals;

  let h = "";
  if (warn) h += `<div class="reconNote" style="color:var(--warn,#f59e0b);margin-bottom:8px;">${escapeHtml(warn)}</div>`;
  if (r.reconcileWarning) h += `<div class="reconNote" style="color:var(--warn,#f59e0b);margin-bottom:8px;">${escapeHtml(r.reconcileWarning)}</div>`;

  h += `<div class="reconSummary">
    <div class="reconLine">Their report: <strong>${t.paidLines} lines · ${formatHours(t.paidHours)} hrs · ${formatMoney(t.paidCost)}</strong></div>
    <div class="reconLine">Matched: <strong>${t.matchedRo}</strong> by RO${t.matchedEv ? `, <strong>${t.matchedEv}</strong> by date + hours + description` : ""}</div>
  </div>`;

  if (!r.unpaid.length) {
    h += `<div class="reconOk">✓ Every job you logged appears on their report.</div>`;
  } else {
    h += `<div class="reconHit">
      <div class="reconHitVal">${formatHours(t.unpaidHours)} hrs · ${formatMoney(t.unpaidPay)}</div>
      <div class="reconHitLabel">logged by you, not on their report</div>
    </div>`;
    for (const u of r.unpaid) {
      const e = u.entries[0] || {};
      const hasPhoto = getEntryReviewState(e).hasPhoto;
      const pPath = e.photo_path || e.photoPath || "";
      h += `<div class="reconRow">
        ${hasPhoto ? `<img class="reconThumb" data-recon-photo="${escapeHtml(String(e.id ?? ""))}" data-photo-path="${escapeHtml(pPath)}" alt="Proof" />` : ""}
        <div>
          <div class="reconRowTop">${escapeHtml(e.type || e.typeText || "Job")}</div>
          <div class="reconRowSub mono">${escapeHtml(String(e.ref || e.ro || u.key))} · ${escapeHtml(formatDayLabel(e.dayKey) || e.dayKey || "")}${hasPhoto ? " · 📷" : ""}${u.partial ? ` · part-paid, ${formatHours(u.loggedHours)} logged` : ""}</div>
          ${u.badRef ? `<div class="reconRowSub" style="color:var(--warn,#f59e0b);">That's your employee number, not an RO — fix the RO on this entry so it can be matched.</div>` : ""}
        </div>
        <div class="reconRowRight">
          <div class="reconRowPay">${formatMoney(u.pay)}</div>
          <div class="reconRowHrs">${formatHours(u.hours)} hrs</div>
        </div>
      </div>`;
    }
    h += `<div class="reconNote">These RO/stock numbers don't appear anywhere on their report, and nothing on it matches their hours and date. That's the list to hand your manager.</div>`;
  }

  if (r.unlogged.length) {
    h += `<div class="reconNote" style="margin-top:8px;">They paid ${r.unlogged.length} line${r.unlogged.length === 1 ? "" : "s"} (${formatHours(t.unloggedHours)} hrs) you didn't log — worth checking you're not missing entries.</div>`;
  }

  out.innerHTML = h;

  // Fill the thumbnails and make them open full-screen. Seeing the car next to
  // the RO is the whole point — a manager shouldn't need it described to them.
  const byId = new Map(r.unpaid.map(u => [String(u.entries[0]?.id ?? ""), u.entries[0]]));
  out.querySelectorAll("[data-recon-photo]").forEach(async (img) => {
    const path = img.dataset.photoPath;
    const entry = byId.get(img.dataset.reconPhoto);
    if (path) {
      try {
        const url = await getCachedPhotoUrl(path);
        if (url) img.src = url;
        else img.remove();
      } catch { img.remove(); }
    } else if (entry?.photoDataUrl) {
      img.src = entry.photoDataUrl;
    } else {
      img.remove();
      return;
    }
    img.addEventListener("click", () => {
      if (entry) { haptic?.("light"); openPhotoViewer(entry); }
    });
  });
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

  // The missing-work list has to redraw everywhere the comparison does.
  // It didn't, which is why it only appeared after bouncing to Log and back —
  // that round trip was the only thing re-running it.
  const redrawPayStub = () => {
    renderPayStubComparison();
    renderMissingWorkReview?.();
  };

  const startKey = weekStartKeyFromDateInput(weekEl.value);
  if (startKey) hydratePayStubFormForWeek(startKey);
  redrawPayStub();

  weekEl.addEventListener("change", () => {
    const key = weekStartKeyFromDateInput(weekEl.value);
    if (key) hydratePayStubFormForWeek(key);
    redrawPayStub();
  });
  amountEl.addEventListener("input", redrawPayStub);
  document.getElementById("payStubHoursPaid")?.addEventListener("input", redrawPayStub);

  // ── Payroll report reconciliation ──
  document.getElementById("scanPayrollCamBtn")?.addEventListener("click", () => document.getElementById("payrollCamera")?.click());
  document.getElementById("scanPayrollLibBtn")?.addEventListener("click", () => document.getElementById("payrollPicker")?.click());
  const onPayrollFile = (input) => () => {
    const f = input.files?.[0];
    if (f) scanPayrollForReconcile(f);
    input.value = "";
  };
  const pPick = document.getElementById("payrollPicker");
  const pCam  = document.getElementById("payrollCamera");
  pPick?.addEventListener("change", onPayrollFile(pPick));
  pCam?.addEventListener("change", onPayrollFile(pCam));

  document.getElementById("reconcilePayrollBtn")?.addEventListener("click", () => {
    const txt = document.getElementById("payrollReportText")?.value || "";
    haptic?.("light");
    const paidLines = parsePayrollReport(txt);
    if (!paidLines.length) {
      const out = document.getElementById("payrollReconcileOut");
      if (out) out.innerHTML = `<div class="muted small">Couldn't read any RO lines from that text.</div>`;
      return;
    }
    _lastPayrollLines = paidLines;
    renderPayrollReconciliation(paidLines);
  });

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
    redrawPayStub();
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
  const typeLabel = entry.type || entry.typeText || "";
  const dateLabel = formatDayLabel(facts.dayKey) || facts.dayKey;
  const metaBits = [dateLabel];
  if (facts.vin8 && facts.vin8 !== "-") metaBits.push(`VIN ${facts.vin8}`);
  if (review.hasPhoto) metaBits.push("📷 photo attached");

  const row = document.createElement("div");
  row.className = "reviewItem";
  row.innerHTML = `
    <div class="reviewItemTop">
      <div class="reviewItemLeft">
        <div class="reviewItemHead">
          ${typeLabel ? typeBadgeHtml(typeLabel) : ""}
          <span class="reviewItemRef mono">${escapeHtml(refLabel)}: ${escapeHtml(entry.ref || entry.ro || "-")}</span>
        </div>
        <div class="reviewItemMeta">${escapeHtml(metaBits.join(" · "))}</div>
        ${entry.notes ? `<div class="reviewItemNotes">${escapeHtml(entry.notes)}</div>` : ""}
      </div>
      <div class="reviewItemRight">
        <div class="reviewItemPay">${formatMoney(entry.earnings)}</div>
        <div class="reviewItemHrs">${formatHours(entry.hours)} hrs @ ${formatMoney(entry.rate)}</div>
      </div>
    </div>
    <div class="reviewItemActions">
      ${review.hasPhoto ? `<button class="iBtn" type="button" data-review-photo="${escapeHtml(String(entry.id ?? ""))}">📷 View Photo</button>` : ""}
      <button class="iBtn iBtn--danger" data-del="${entry.id}">🗑 Delete</button>
    </div>
  `;

  if (review.hasPhoto) {
    const photoBtn = row.querySelector("button[data-review-photo]");
    photoBtn?.addEventListener("click", () => openPhotoViewer(entry));
  }

  return row;
}

/**
 * How much proof this entry carries, if it turns out to be the missing work.
 * Photos are what actually win a dispute, so they dominate. Recency is a
 * tiebreak worth a fraction of a point — the old version added days-since-epoch
 * (~20,700) to this score, which buried every evidence signal and silently
 * turned the whole thing into "sort by most recently touched".
 */
function scoreEvidence(entry) {
  const review = getEntryReviewState(entry);
  let s = 0;
  if (review.hasPhoto)            s += 50;
  if (entry?.notes)               s += 15;
  if (entry?.ref || entry?.ro)    s += 10;
  if (entry?.vin8)                s += 5;
  const ts = Date.parse(entry?.updatedAt || entry?.createdAt || "") || 0;
  return s + (ts / 1e13); // < 1 point: orders equals, never outranks evidence
}

/**
 * Which logged jobs best explain the money that's missing.
 *
 * A pay stub only gives totals, so the honest question is: "which combination
 * of the jobs I logged adds up to the gap?" That's subset-sum, and it's a far
 * better guess than grabbing recent jobs until the running total passes the
 * shortfall (which is what this used to do, and why the picks looked random).
 *
 * Entries are fed in strongest-evidence-first and each reachable total is
 * claimed by the first combination that gets there, so when several subsets hit
 * the same dollar figure the one backed by photos wins.
 *
 * Returns { picks, sum, exact, off } — `off` is how far from the gap we landed.
 */
function findMissingWorkSubset(entries, targetValue, mode = "pay") {
  // Hours are the better matching key when we have them: the shop flags hours,
  // and dollars are derived from a rate that can change mid-period, so a
  // dollar-only match can finger the wrong jobs. Both are scaled to integers
  // (cents / hundredths of an hour) so the DP stays exact.
  const valueOf = (e) => mode === "hours"
    ? Math.round((Number(e?.hours) || 0) * 100)
    : Math.round((Number(e?.earnings) || 0) * 100);

  const items = (entries || [])
    .map(e => ({ e, cents: valueOf(e) }))
    .filter(x => x.cents > 0)
    .sort((a, b) => scoreEvidence(b.e) - scoreEvidence(a.e));

  const target = Math.round(targetValue * 100);
  if (!items.length || target <= 0) return { picks: [], sum: 0, exact: false, off: targetValue, mode };

  const maxItem = items.reduce((m, x) => Math.max(m, x.cents), 0);
  // Allow overshoot by one job so a near-miss above the gap is still findable.
  const cap = Math.min(target + maxItem, 2_000_00);
  if (cap <= 0) return { picks: [], sum: 0, exact: false, off: targetValue, mode };

  // reach[s] = index of the item used to land on s; prev[s] = the sum before it.
  const reach = new Int32Array(cap + 1).fill(-1);
  const prev  = new Int32Array(cap + 1).fill(-1);
  reach[0] = -2; // reachable with the empty set

  for (let i = 0; i < items.length; i++) {
    const c = items[i].cents;
    if (c > cap) continue;
    for (let s = cap; s >= c; s--) {
      if (reach[s] === -1 && reach[s - c] !== -1) { reach[s] = i; prev[s] = s - c; }
    }
  }

  // Closest reachable total to the gap; ties resolve toward the smaller sum so
  // we under-claim rather than over-claim.
  let best = -1, bestDist = Infinity;
  for (let s = 1; s <= cap; s++) {
    if (reach[s] === -1) continue;
    const d = Math.abs(s - target);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  if (best < 0) return { picks: [], sum: 0, exact: false, off: targetValue, mode };

  const picks = [];
  for (let s = best; s > 0; s = prev[s]) picks.push(items[reach[s]].e);
  picks.reverse();

  return {
    picks,
    sum: best / 100,
    exact: bestDist === 0,
    off: round2(bestDist / 100),
    mode,
  };
}

/**
 * Match on hours when the stub gave us hours, otherwise fall back to dollars.
 * Also reports what the picked jobs come to in the OTHER unit, so a mismatch
 * between the two is visible rather than hidden.
 */
function matchMissingWork(ctx) {
  const missingHours = Number(ctx?.comparison?.missingHours || 0);
  const missingPay   = Number(ctx?.comparison?.missingPay || 0);
  const entries      = ctx?.entries || [];

  const useHours = missingHours > 0.005;
  const res = useHours
    ? findMissingWorkSubset(entries, missingHours, "hours")
    : findMissingWorkSubset(entries, missingPay, "pay");

  res.pickedHours = round1(res.picks.reduce((s, e) => s + (Number(e.hours) || 0), 0));
  res.pickedPay   = round2(res.picks.reduce((s, e) => s + (Number(e.earnings) || 0), 0));
  res.targetHours = round1(missingHours);
  res.targetPay   = round2(missingPay);
  return res;
}

function getMissingWorkCandidates(ctx) {
  return matchMissingWork(ctx).picks;
}

/* ── Payroll report reconciliation ────────────────────────────────────────────
 * The dealer's "Report of Booked Repair Orders" lists every RO they actually
 * paid, line by line, with sold hours. That turns the whole dispute from a
 * guess into arithmetic: anything logged that ISN'T on their report is provably
 * unpaid, by RO number, and nobody has to be taken at their word.
 *
 * Format per line (columns are whitespace-aligned, not fixed-width):
 *   496740 12AUG26 12AUG26 S1 40534 C 3 ST ROP 0.00 4.00 60.00 DETAILPOC ...
 *          booked   closed      tech      actual^  sold^ cost^
 * Actual hours are 0.00 on flat-rate lines; the SOLD figure is what pays.
 */
const _MONTHS = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };

/** "12AUG26" -> "2026-08-12". Returns "" if it isn't a report date. */
function parseReportDate(s) {
  const m = String(s || "").trim().toUpperCase().match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m) return "";
  const mo = _MONTHS[m[2]];
  if (!mo) return "";
  const yr = 2000 + Number(m[3]);
  return `${yr}-${String(mo).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

function parsePayrollReport(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip headers/totals — they have no leading RO number.
    const m = line.match(/^(\d{5,9})\b(.*)$/);
    if (!m) continue;
    const ro = m[1];
    const rest = m[2];

    // Pull the numeric run: actual, sold, cost. Sold is the one that pays.
    const nums = rest.match(/\d+\.\d{2}/g);
    if (!nums || nums.length < 2) continue;
    const sold = Number(nums[1]);
    const cost = nums.length >= 3 ? Number(nums[2]) : null;
    if (!Number.isFinite(sold)) continue;

    // Dates: booked then closed, both in DDMMMYY.
    const dates = (rest.match(/\b\d{1,2}[A-Z]{3}\d{2}\b/gi) || []).map(parseReportDate).filter(Boolean);

    // Everything after the last decimal number is the op-code + description.
    const tailIdx = rest.lastIndexOf(nums[nums.length - 1]);
    const tail = tailIdx >= 0 ? rest.slice(tailIdx + nums[nums.length - 1].length).trim() : "";
    const tailParts = tail.split(/\s+/);
    const opCode = tailParts[0] || "";
    const description = tailParts.slice(1).join(" ").trim();

    out.push({
      ro,
      hours: sold,
      cost,
      bookedDate: dates[0] || "",
      closedDate: dates[1] || dates[0] || "",
      opCode,
      description,
    });
  }
  return out;
}

/** Words that carry meaning when comparing a logged job to a payroll line. */
function _descTokens(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !["THE","AND","ALL","FOR","ON","OF"].includes(w));
}

/** 0..1 overlap between two descriptions. */
function _descSimilarity(a, b) {
  const A = new Set(_descTokens(a)), B = new Set(_descTokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

function _daysApart(a, b) {
  if (!a || !b) return 999;
  const pa = parseDateInputValue(a), pb = parseDateInputValue(b);
  if (!pa || !pb) return 999;
  return Math.abs(Math.round((pa - pb) / 86400000));
}

/** Normalize an RO for comparison: digits only, so 497471/S14469A -> 497471. */
function roKey(v) {
  const s = String(v || "").trim().toUpperCase();
  const m = s.match(/\d{4,}/);
  return m ? m[0] : s.replace(/[^A-Z0-9]/g, "");
}

/**
 * Every identifier a logged ref might match on, best first.
 *
 * Techs write refs in a few shapes: "497471/S14469A" (RO + stock), a bare
 * stock number, and occasionally "40534/SLS13860" where 40534 is their own
 * EMPLOYEE number — that one can never match an RO, and taking the first
 * number blindly meant such jobs were always reported unpaid. The employee
 * number is filtered out and both halves are offered as candidates.
 */
function roCandidates(ref, empId = "") {
  const s = String(ref || "").trim().toUpperCase();
  if (!s) return [];
  const emp = String(empId || "").trim().toUpperCase();
  const parts = s.split(/[^A-Z0-9]+/).filter(Boolean);

  const out = [];
  const push = (v) => {
    if (!v || v === emp) return;            // never match on the tech's own number
    if (!out.includes(v)) out.push(v);
  };

  // RO-looking numbers first (5-8 digits), then anything else alphanumeric.
  for (const p of parts) if (/^\d{5,8}$/.test(p)) push(p);
  for (const p of parts) if (!/^\d{5,8}$/.test(p)) push(p);
  return out;
}

/** True when the ref is nothing but the tech's own employee number. */
function refIsOnlyEmpId(ref, empId) {
  const cands = roCandidates(ref, empId);
  const raw = String(ref || "").trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return raw.length > 0 && cands.length === 0;
}

/**
 * Diff what you logged against what they paid.
 *   unpaid    — logged, absent from their report entirely (the strong claim)
 *   short     — on both, but they paid fewer hours than you logged
 *   unlogged  — on their report, missing from your log (worth knowing about)
 */
function reconcilePayroll(loggedEntries, paidLines, knownGapHours = null, empId = "") {
  // Payroll lists ONE LINE PER OP. The app lets a tech merge several ops from
  // the same paper into a single entry ("Reclean+Fpf+Pdi", 5.4 hrs), which on
  // the report is 1.90 + 1.50 + ... across separate lines of the same RO.
  // Matching line-for-line therefore failed on every combined entry and
  // reported them as unpaid — inflating the total well past the real gap.
  // So: bucket the report by RO and match against the bucket's hours, letting
  // an entry draw from the pool rather than demanding one exact line.
  const buckets = new Map();
  for (const p of paidLines || []) {
    const k = roKey(p.ro);
    if (!k) continue;
    const b = buckets.get(k) || {
      key: k, ro: p.ro, hours: 0, cost: 0, lines: 0,
      remaining: 0, dates: new Set(), desc: [],
    };
    const h = Number(p.hours) || 0;
    b.hours = round2(b.hours + h);
    b.remaining = round2(b.remaining + h);
    b.cost = round2(b.cost + (Number(p.cost) || 0));
    b.lines++;
    if (p.closedDate) b.dates.add(p.closedDate);
    if (p.bookedDate) b.dates.add(p.bookedDate);
    b.desc.push(`${p.opCode || ""} ${p.description || ""}`);
    buckets.set(k, b);
  }
  const bucketList = Array.from(buckets.values());

  const paid = (paidLines || []).map((p, i) => ({ ...p, _i: i, _taken: false }));
  const logged = (loggedEntries || []).map(e => ({
    e,
    roK: roKey(e.ref || e.ro),
    roCands: roCandidates(e.ref || e.ro, empId),
    badRef: refIsOnlyEmpId(e.ref || e.ro, empId),
    hours: Number(e.hours) || 0,
    pay: Number(e.earnings) || 0,
    day: e.dayKey || dayKeyFromISO(e.createdAt || "") || "",
    desc: `${e.type || e.typeText || ""} ${e.notes || ""}`,
    matched: null,
    how: "",
  }));

  const bucketDates = (b) => Array.from(b.dates);
  const nearestDay = (day, b) => bucketDates(b).reduce((m, d) => Math.min(m, _daysApart(day, d)), 999);

  // How much of this entry the bucket can cover, and consume it.
  const draw = (L, b, how, conf) => {
    const take = Math.min(L.unmatchedHours, b.remaining);
    if (take <= 0.001) return false;
    b.remaining = round2(b.remaining - take);
    L.unmatchedHours = round2(L.unmatchedHours - take);
    L.coveredHours = round2((L.coveredHours || 0) + take);
    if (!L.how) { L.how = how; L.confidence = conf; L.matchedBucket = b; }
    return true;
  };

  for (const L of logged) L.unmatchedHours = round2(L.hours);

  // ── Pass 1: RO number ────────────────────────────────────────────────
  // Only works when the tech actually knows the RO. Get-ready work is booked
  // under an RO they never see, so those fall through to pass 2.
  for (const L of logged) {
    // Try every identifier in the ref — the RO, the stock number, either half
    // of an "RO/STOCK" pair — rather than only the first number found.
    for (const cand of L.roCands) {
      const b = buckets.get(cand);
      if (b && draw(L, b, "ro", 1)) break;
    }
  }

  // ── Pass 2: evidence ─────────────────────────────────────────────────
  // Anything still uncovered is scored against every RO bucket that still has
  // hours left, on what actually carries over: hours that fit, a close date and
  // overlapping wording. Scored globally, taken best-first, so a strong match
  // can't be stolen by a weaker one that happened to come first.
  const cands = [];
  for (const L of logged) {
    if (L.unmatchedHours <= 0.001) continue;
    for (const b of bucketList) {
      if (b.remaining <= 0.001) continue;
      // Closing date is NOT a filter. A shop can close an RO days or weeks
      // after the work was done, so requiring the dates to be close flagged
      // perfectly good jobs as unpaid. What actually identifies a job is the
      // work and the hours; the date only breaks ties between equal matches.
      const dayGap = nearestDay(L.day, b);
      // The bucket must be able to cover a meaningful part of the entry.
      const cover = Math.min(L.unmatchedHours, b.remaining);
      if (cover < Math.min(0.5, L.unmatchedHours)) continue;
      const sim = _descSimilarity(L.desc, b.desc.join(" "));
      // Description is the real signal, then hours fitting exactly. Require
      // one of them — otherwise any leftover bucket could absorb any job.
      const exact = Math.abs(b.remaining - L.unmatchedHours) < 0.011 ? 40 : 0;
      if (sim <= 0 && !exact) continue;
      const closeness = dayGap > 60 ? 0 : Math.max(0, 10 - dayGap * 0.5);
      cands.push({ L, b, sim, dayGap, score: sim * 100 + exact + closeness });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) {
    if (c.L.unmatchedHours <= 0.001 || c.b.remaining <= 0.001) continue;
    draw(c.L, c.b, c.sim > 0 ? "evidence" : "hours+date", c.sim);
  }

  // ── Results ──────────────────────────────────────────────────────────
  // An entry counts as unpaid only for the hours nothing covered. A partially
  // covered entry reports just the shortfall, not the whole job.
  const unpaid = logged
    .filter(L => L.unmatchedHours > 0.049)
    .map(L => {
      const frac = L.hours > 0 ? L.unmatchedHours / L.hours : 1;
      return {
        key: L.roK || "(no RO)",
        entries: [L.e],
        hours: round2(L.unmatchedHours),
        pay: round2(L.pay * frac),
        partial: L.unmatchedHours < L.hours - 0.001,
        loggedHours: round2(L.hours),
        badRef: L.badRef,
      };
    });

  const matchedByEvidence = logged
    .filter(L => L.how && L.how !== "ro")
    .map(L => ({ entry: L.e, paid: L.matchedBucket, how: L.how, confidence: L.confidence || 0 }));

  const unlogged = bucketList.filter(b => b.remaining > 0.049)
    .map(b => ({ ro: b.ro, hours: b.remaining, cost: b.cost }));

  const unpaidHours = round2(unpaid.reduce((s, x) => s + x.hours, 0));

  // Cross-check against arithmetic we already trust: logged hours minus paid
  // hours IS the gap, full stop. If the per-job list doesn't add up to it, the
  // matcher is off — say so instead of asserting a number that contradicts the
  // totals, which is exactly the kind of thing that gets a tech laughed out of
  // an office.
  let reconcileWarning = "";
  if (Number.isFinite(knownGapHours) && knownGapHours > 0) {
    const diff = round2(unpaidHours - knownGapHours);
    if (Math.abs(diff) > 0.15) {
      reconcileWarning = diff > 0
        ? `This list totals ${formatHours(unpaidHours)} hrs but your stub says only ${formatHours(knownGapHours)} hrs are missing. ${formatHours(Math.abs(diff))} hrs of it was probably paid under an RO the app couldn't match — treat the ${formatHours(knownGapHours)} hrs as the number to argue.`
        : `This list totals ${formatHours(unpaidHours)} hrs but your stub says ${formatHours(knownGapHours)} hrs are missing — ${formatHours(Math.abs(diff))} hrs unaccounted for. Check the report photo caught every page.`;
    }
  }

  return {
    unpaid: unpaid.sort((a, b) => b.hours - a.hours),
    matchedByEvidence,
    unlogged,
    reconcileWarning,
    totals: {
      unpaidHours,
      unpaidPay:   round2(unpaid.reduce((s, x) => s + x.pay, 0)),
      knownGapHours: Number.isFinite(knownGapHours) ? round2(knownGapHours) : null,
      matchedRo:   logged.filter(L => L.how === "ro").length,
      matchedEv:   matchedByEvidence.length,
      loggedCount: logged.length,
      paidHours:   round2(paid.reduce((s, p) => s + (Number(p.hours) || 0), 0)),
      paidCost:    round2(paid.reduce((s, p) => s + (Number(p.cost) || 0), 0)),
      paidLines:   paid.length,
      unloggedHours: round2(unlogged.reduce((s, p) => s + (Number(p.hours) || 0), 0)),
    },
  };
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
    summaryEl.innerHTML = `<span style="color:var(--ok,var(--primary))">✓ Paid totals cover your logged work for this period.</span> ${ctx.entries.length} entries logged.`;
    return;
  }

  // Build day-by-day breakdown across the pay period
  const empId = getEmpId();
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  const own = filterEntriesByEmp(all, empId);

  // Generate all days in the pay week range
  const ws = parseDateInputValue(ctx.weekStartKey);
  const days = [];
  if (ws) {
    for (let i = 0; i < (ctx.biweekly ? 14 : 7); i++) {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      const dk = dateKey(d);
      // Skip weekends
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const dayEntries = ctx.entries.filter(e => (e.dayKey || dayKeyFromISO(e.createdAt)) === dk);
      const hrs = round1(dayEntries.reduce((s, e) => s + Number(e.hours || 0), 0));
      const pay = round2(dayEntries.reduce((s, e) => s + Number(e.earnings || 0), 0));
      days.push({ dk, d, dayEntries, hrs, pay });
    }
  }

  // Historical avg hours per day (past 8 weeks, excluding current week)
  const now = new Date();
  const pastEntries = own.filter(e => {
    const ek = e.dayKey || dayKeyFromISO(e.createdAt);
    return ek && ek < ctx.weekStartKey;
  });
  const pastDayMap = new Map();
  for (const e of pastEntries) {
    const dk = e.dayKey || dayKeyFromISO(e.createdAt);
    if (!dk) continue;
    const d = parseDateInputValue(dk);
    if (!d) continue;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const hrs = pastDayMap.get(dk) || 0;
    pastDayMap.set(dk, hrs + Number(e.hours || 0));
  }
  const pastDays = Array.from(pastDayMap.values());
  const avgDayHrs = pastDays.length > 0 ? round1(pastDays.reduce((s, h) => s + h, 0) / pastDays.length) : 0;

  // Find common job types from history for suggestions
  const typeFreq = new Map();
  for (const e of own) {
    const t = e.type || e.typeText || "";
    if (!t) continue;
    const cur = typeFreq.get(t) || { count: 0, avgHours: 0, totalHours: 0 };
    cur.count++;
    cur.totalHours = round1(cur.totalHours + Number(e.hours || 0));
    cur.avgHours = round1(cur.totalHours / cur.count);
    typeFreq.set(t, cur);
  }
  const topTypes = Array.from(typeFreq.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  // Which of the logged jobs best explain the gap (subset-sum, see above).
  const match = matchMissingWork(ctx);

  summaryEl.innerHTML = `
    <span style="color:var(--danger);font-weight:700;">⚠️ ${missingHours > 0 ? `${formatHours(missingHours)} hrs` : formatMoney(missingPay)} unpaid.</span>
    You logged ${formatHours(ctx.expected?.hours || 0)} hrs / ${formatMoney(ctx.expected?.pay || 0)} and were paid ${formatHours(ctx.actual?.hours || 0)} hrs / ${formatMoney(ctx.actual?.pay || 0)}. That gap is the fact to take to your manager — everything below is the app narrowing down which jobs it came from.
    <span style="display:block;margin-top:6px;font-size:10.5px;color:var(--muted2,var(--muted));">build ${escapeHtml(String(window.BUILD || "?"))} · proof v3</span>
  `;

  let html = "";

  // ── Candidate jobs matching the gap ────────────────────────────────────
  if (match.picks.length) {
    const unit = match.mode === "hours" ? "hrs" : "";
    const fmt = (v) => match.mode === "hours" ? `${formatHours(v)} hrs` : formatMoney(v);
    const conf = match.exact
      ? { label: "Exact match", color: "var(--primary)" }
      : (match.mode === "hours" ? match.off <= 0.5 : match.off <= 5)
        ? { label: `Close match — off by ${fmt(match.off)}`, color: "var(--warn,#f59e0b)" }
        : { label: `Closest possible — off by ${fmt(match.off)}`, color: "var(--muted)" };
    const withPhoto = match.picks.filter(e => getEntryReviewState(e).hasPhoto).length;

    html += `<div style="margin-bottom:16px;">`;
    html += `<div style="font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px;">Jobs adding up to the gap</div>`;
    html += `<div style="font-size:12px;color:${conf.color};font-weight:700;margin-bottom:2px;">${conf.label} · ${match.picks.length} job${match.picks.length === 1 ? "" : "s"}</div>`;
    html += `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">These come to ${formatHours(match.pickedHours)} hrs / ${formatMoney(match.pickedPay)} against a gap of ${formatHours(match.targetHours)} hrs / ${formatMoney(match.targetPay)}${withPhoto ? ` · ${withPhoto} with photo proof` : ""}</div>`;
    // Each candidate is a full evidence card the tech can open in front of a
    // service manager: photo proof, VIN, notes, and the exact arithmetic.
    for (const e of match.picks) {
      const hasPhoto = getEntryReviewState(e).hasPhoto;
      const facts = getEntryRecordFacts(e);
      const ref = e.ref || e.ro || "—";
      const lbl = e.refType === "STOCK" ? "STK" : "RO";
      const eid = escapeHtml(String(e.id ?? ""));
      const meta = [formatDayLabel(e.dayKey) || e.dayKey || ""];
      if (facts.vin8 && facts.vin8 !== "-") meta.push(`VIN ${facts.vin8}`);
      // The whole card carries the photo id, so a tap anywhere on it opens the
      // proof — a small button is a small target when you're holding the phone
      // out for a service manager to look at.
      html += `<div class="mwCard${hasPhoto ? " mwCard--tappable" : ""}"${hasPhoto ? ` data-mw-photo="${eid}"` : ""}>
        <div class="mwTop">
          <div class="mwLeft">
            <div class="mwType">${escapeHtml(e.type || e.typeText || "Job")}</div>
            <div class="mwRef mono">${escapeHtml(lbl)} ${escapeHtml(String(ref))}</div>
            <div class="mwMeta">${escapeHtml(meta.join(" · "))}</div>
            ${e.notes ? `<div class="mwNotes">${escapeHtml(e.notes)}</div>` : ""}
          </div>
          <div class="mwRight">
            <div class="mwPay">${formatMoney(e.earnings)}</div>
            <div class="mwHrs">${formatHours(e.hours)} hrs @ ${formatMoney(e.rate)}</div>
          </div>
        </div>
        <div class="mwActions">
          ${hasPhoto
            ? `<button type="button" class="iBtn mwPhotoBtn" data-mw-photo="${eid}">📷 Show Photo Proof</button>`
            : `<span class="mwNoPhoto">No photo on this one</span>`}
          <button type="button" class="iBtn" data-mw-flag="${eid}">🚩 Send to Manager</button>
        </div>
      </div>`;
    }
    html += `<div style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-top:9px;">
      These are logged jobs whose totals happen to add up to what's missing. Other combinations can reach the same figure, so treat this as a place to start — the jobs with photo proof are the ones worth raising first.
    </div>`;
    html += `</div>`;
  }

  // Day breakdown
  if (days.length) {
    html += `<div style="margin-bottom:14px;">`;
    html += `<div style="font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px;">Day Breakdown</div>`;
    for (const { dk, d, dayEntries, hrs, pay } of days) {
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const isEmpty = dayEntries.length === 0;
      const isLight = !isEmpty && avgDayHrs > 0 && hrs < avgDayHrs * 0.5;
      const flag = isEmpty ? "🔴 No entries" : isLight ? `🟡 Only ${formatHours(hrs)} hrs (avg ${formatHours(avgDayHrs)})` : `✓ ${formatHours(hrs)} hrs`;
      const flagColor = isEmpty ? "var(--danger)" : isLight ? "var(--warn,#f59e0b)" : "var(--muted)";
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--stroke);">
        <span style="font-size:14px;">${label}</span>
        <span style="font-size:13px;color:${flagColor};font-weight:${isEmpty || isLight ? "700" : "400"};">${flag}</span>
      </div>`;
    }
    html += `</div>`;
  }

  // A "you're short 17 hrs, that's about 6× Re-Clean" line used to live here.
  // It was invented arithmetic about jobs that may never have existed — the
  // opposite of what you want in front of a manager. Real logged jobs with RO
  // numbers and photos (above) and genuinely empty days (below) are evidence;
  // that was noise.

  if (!html) {
    html = `<div class="muted small" style="padding:8px 0;">No entry history available to analyze. Start logging daily to get smarter suggestions.</div>`;
  }

  listEl.innerHTML = html;

  // Keep the matched entries reachable by id for the delegated handler below.
  _mwEntriesById = new Map((match.picks || []).map(e => [String(e.id ?? ""), e]));
  wireMissingWorkActions();
  // Start fetching these photos now, so the proof is already cached by the time
  // it's tapped in front of a manager.
  prewarmPhotoUrls?.(match.picks || []);
}

/* Entries behind the evidence cards, by id. */
let _mwEntriesById = new Map();

/**
 * One delegated listener for the whole app, wired once.
 *
 * These buttons were previously bound per-render, which meant any redraw of the
 * list (saving a stub, switching weeks) silently detached them and the proof
 * stopped opening. Delegation off document survives every re-render.
 */
function wireMissingWorkActions() {
  if (window.__mwActionsWired) return;
  window.__mwActionsWired = true;

  document.addEventListener("click", (ev) => {
    // Flag first: it sits INSIDE the card, and the card itself carries the
    // photo id, so checking photo first would swallow every flag tap.
    const flagBtn = ev.target?.closest?.("[data-mw-flag]");
    if (!flagBtn) {
      const photoBtn = ev.target?.closest?.("[data-mw-photo]");
      if (photoBtn) {
        ev.preventDefault();
        const e = _mwEntriesById.get(photoBtn.dataset.mwPhoto);
        if (!e) return toast?.("Couldn't find that job.");
        // Immediate acknowledgement. Fetching the photo can take a moment on
        // shop wifi, and with no feedback the tap read as broken.
        haptic?.("light");
        // The tap may land on the button itself or anywhere on the card, so
        // resolve the button from the card either way.
        const card = photoBtn.closest(".mwCard") || photoBtn;
        const btn = card.querySelector(".mwPhotoBtn");
        const prev = btn?.textContent;
        if (btn) { btn.textContent = "Opening…"; btn.disabled = true; }
        Promise.resolve(openPhotoViewer(e)).finally(() => {
          if (btn) { btn.textContent = prev || "📷 Show Photo Proof"; btn.disabled = false; }
        });
      }
      return;
    }

    {
      ev.preventDefault();
      const e = _mwEntriesById.get(flagBtn.dataset.mwFlag);
      if (!e) return toast?.("Couldn't find that job.");
      haptic?.("light");
      const refLbl = e.refType === "STOCK" ? "STK" : "RO";
      const refVal = e.ref || e.ro || "";
      const parts = [];
      if (refVal) parts.push(`${refLbl} ${refVal}`);
      if (e.type || e.typeText) parts.push(e.type || e.typeText);
      window.__FR?.openRequestModal?.({
        kind: "missing_work",
        subject: (parts.join(" — ") || "Job not on my check").slice(0, 140),
        ro: refVal,
        date: e.dayKey || e.work_date || "",
        hours: e.hours != null ? String(e.hours) : "",
        amount: e.earnings != null ? Number(e.earnings).toFixed(2) : "",
      });
    }
  });
}
window.renderMissingWorkReview = renderMissingWorkReview;

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
    slice = all.filter(e => inWeek(payDayKeyFor(e), ws));
  } else if (range === "lastweek") {
    const { ws } = getLastWeekRange();
    slice = all.filter(e => inWeek(payDayKeyFor(e), ws));
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
  const payDayEl      = document.getElementById("payWeekStartDay");
  const payCutoffEl   = document.getElementById("payWeekCutoff");
  const nameEl        = document.getElementById("settingsUserName");
  const stdDayEl      = document.getElementById("settingsStandardDay");
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

  // Blank when unset — the placeholder invites a value instead of asserting one.
  if (rateInput)   rateInput.value        = Number(s.defaultRate) > 0 ? String(s.defaultRate) : "";
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
    // Blank / invalid stays unset (0) rather than silently becoming $15.
    const parsed  = parseFloat(rateInput?.value);
    const rate    = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const compact = compactToggle?.checked ?? false;
    const haptic  = hapticToggle?.checked ?? true;
    saveSettings({ defaultRate: rate, accentColor: color, compactList: compact, darkMode: activeDarkMode, haptic });
    window.__FR?.refreshRateBanner?.();
  };
  // ── Name + standard day ──
  if (nameEl)   nameEl.value   = getUserName();
  if (stdDayEl) stdDayEl.value = Number(s.standardDay) > 0 ? String(s.standardDay) : "";

  nameEl?.addEventListener("blur", () => {
    saveSettings({ userName: String(nameEl.value || "").trim().slice(0, 40) });
    window.__FR?.refreshGreeting?.();
  });
  stdDayEl?.addEventListener("blur", () => {
    const v = parseFloat(stdDayEl.value);
    saveSettings({ standardDay: Number.isFinite(v) && v > 0 && v <= 24 ? v : 0 });
    window.__FR?.renderBreakdownPage?.(window.__STATS_PERIOD__ || "week");
  });

  // ── Pay week boundary ──
  const pw = getPayWeekConfig();
  if (payDayEl)    payDayEl.value    = String(pw.day);
  if (payCutoffEl) payCutoffEl.value = pw.cutoff;

  const savePayWeek = () => {
    saveSettings({
      payWeekStartDay: Number(payDayEl?.value ?? 1),
      payWeekCutoff:   payCutoffEl?.value || "00:00",
    });
    // Every week total in the app just moved — redraw what's on screen.
    refreshUI?.(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
    refreshMorePagePanels?.();
    toast?.("Pay week updated");
  };
  payDayEl?.addEventListener("change", savePayWeek);
  payCutoffEl?.addEventListener("change", savePayWeek);

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

  // ── Header ────────────────────────────────────────────────────────────
  // Plain ASCII throughout: jsPDF's built-in fonts use WinAnsi encoding, so
  // characters like the warning sign and em-dash the old version printed came
  // out as garbage glyphs on the page someone actually hands to a manager.
  const techName = typeof getUserName === "function" ? getUserName() : "";
  const rightEdge = doc.internal.pageSize.getWidth() - left;

  write("PAY DISCREPANCY REPORT", 16, { bold: true, step: 7 });
  write(singleWeek
    ? `Pay period: ${weekKey} to ${rangeEnd}`
    : "All logged weeks", 11, { step: 5 });
  write(`Technician: ${techName ? `${techName} (Emp #${empId})` : `Emp #${empId}`}`, 11, { step: 5 });
  write(`Prepared: ${todayKeyLocal()}`, 10, { step: 9 });

  // ── Totals across every week in scope ─────────────────────────────────
  let grandLoggedHours = 0, grandLoggedPay = 0, grandPaidHours = 0, grandPaidPay = 0;
  let anyStub = false;
  for (const wk of weekKeys) {
    const t = computeTotals(weekMap.get(wk));
    const stub = getPayStubForWeekKey(wk);
    grandLoggedHours = round1(grandLoggedHours + t.hours);
    grandLoggedPay   = round2(grandLoggedPay + t.dollars);
    if (stub) {
      anyStub = true;
      grandPaidHours = round1(grandPaidHours + Number(stub.hoursPaid || 0));
      grandPaidPay   = round2(grandPaidPay + Number(stub.amountPaid || 0));
    }
  }
  const grandMissingHours = round1(grandLoggedHours - grandPaidHours);
  const grandMissingPay   = round2(grandLoggedPay - grandPaidPay);

  // ── Bottom line, stated first ─────────────────────────────────────────
  // A manager should be able to read the claim without turning the page.
  const boxTop = y - 4;
  const boxH = anyStub ? 34 : 22;
  doc.setDrawColor(150); doc.setLineWidth(0.4);
  doc.rect(left - 4, boxTop, rightEdge - left + 8, boxH);
  nl(3);
  write(`Hours logged:  ${formatHours(grandLoggedHours)}      Earned: ${formatMoney(grandLoggedPay)}`, 11, { step: 6 });
  if (anyStub) {
    write(`Hours paid:    ${formatHours(grandPaidHours)}      Paid:   ${formatMoney(grandPaidPay)}`, 11, { step: 6 });
    doc.setFont(undefined, "bold"); doc.setFontSize(12);
    doc.text(grandMissingPay > 0
      ? `DIFFERENCE:    ${formatMoney(grandMissingPay)} not accounted for`
      : `DIFFERENCE:    none - paid totals cover logged work`, left, y);
    nl(10);
  } else {
    write("No pay stub entered for this period - amounts below are logged work only.", 10, { step: 8 });
  }
  nl(4);

  // ── How these numbers were produced ───────────────────────────────────
  // Credibility: says plainly what is recorded fact vs. what is inference.
  write("HOW THIS WAS PRODUCED", 11, { bold: true, step: 6 });
  const method = [
    "Each job below was recorded at the time it was completed, with the RO number,",
    "date, flat-rate hours and pay rate. Photo proof is noted where it was captured.",
    "Totals are the sum of those records. The paid figures come from the pay stub",
    "for this period. Nothing here is back-dated or estimated.",
  ];
  doc.setFontSize(9.5); doc.setFont(undefined, "normal");
  for (const line of method) { doc.text(line, left, y); nl(4.6); }
  nl(5);

  // ── Candidate jobs matching the gap ───────────────────────────────────
  if (grandMissingPay > 0.005 || grandMissingHours > 0.005) {
    const scopeEntries = weekKeys.flatMap(wk => weekMap.get(wk));
    const match = matchMissingWork({
      entries: scopeEntries,
      comparison: { missingHours: grandMissingHours, missingPay: grandMissingPay },
    });
    if (match.picks.length) {
      write("JOBS ACCOUNTING FOR THE DIFFERENCE", 11, { bold: true, step: 6 });
      doc.setFontSize(9.5); doc.setFont(undefined, "normal");
      const intro = `These ${match.picks.length} logged jobs total ${formatHours(match.pickedHours)} hrs / ${formatMoney(match.pickedPay)}, against a difference of ${formatHours(match.targetHours)} hrs / ${formatMoney(match.targetPay)}.`;
      doc.text(intro, left, y); nl(4.6);
      doc.text("Other combinations can reach the same total, so these are a starting point,", left, y); nl(4.6);
      doc.text("not a conclusion. Jobs marked PHOTO have image proof available on request.", left, y); nl(6.5);

      for (const e of match.picks) {
        const ro = String(e.ref || e.ro || "-").slice(0, 14);
        const type = String(e.type || e.typeText || "-").slice(0, 22);
        const photo = getEntryReviewState(e).hasPhoto ? "  PHOTO" : "";
        doc.setFontSize(9.5);
        doc.text(`  ${(e.dayKey || "").padEnd(11)} ${ro.padEnd(15)} ${type.padEnd(23)} ${String(formatHours(e.hours)).padStart(5)}h  ${formatMoney(e.earnings).padStart(9)}${photo}`, left, y);
        nl(5);
      }
      nl(6);
    }
  }

  // ── Full record ───────────────────────────────────────────────────────
  write("COMPLETE LOGGED RECORD", 11, { bold: true, step: 7 });

  for (const wk of weekKeys) {
    const entries = weekMap.get(wk);
    const totals = computeTotals(entries);
    const stub = getPayStubForWeekKey(wk);
    const weekEnd = stub?.weekEnding || weekEndingForWeekStartKey(wk) || "";

    write(`Week of ${wk}${weekEnd ? ` to ${weekEnd}` : ""}`, 11, { bold: true, step: 6 });
    write(`  Logged ${formatHours(totals.hours)} hrs / ${formatMoney(totals.dollars)} across ${totals.count} job${totals.count === 1 ? "" : "s"}`, 9.5, { step: 5 });
    if (stub) {
      write(`  Paid   ${formatHours(Number(stub.hoursPaid || 0))} hrs / ${formatMoney(Number(stub.amountPaid || 0))}`, 9.5, { step: 6 });
    } else {
      write(`  No pay stub on file for this week`, 9.5, { step: 6 });
    }

    const dayMap = new Map();
    for (const e of entries) {
      const d = e.dayKey || dayKeyFromISO(e.createdAt) || "?";
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d).push(e);
    }
    for (const d of Array.from(dayMap.keys()).sort((a, b) => a.localeCompare(b))) {
      const dayEntries = dayMap.get(d);
      const dt = computeTotals(dayEntries);
      write(`  ${formatDayLabel(d) || d}   ${formatHours(dt.hours)} hrs / ${formatMoney(dt.dollars)}`, 9.5, { bold: true, step: 5 });
      for (const e of dayEntries) {
        const ro = String(e.ref || e.ro || "-").slice(0, 14);
        const type = String(e.type || e.typeText || "-").slice(0, 22);
        const flags = `${e.isComeback ? "  COMEBACK" : ""}${getEntryReviewState(e).hasPhoto ? "  PHOTO" : ""}`;
        doc.setFontSize(9); doc.setFont(undefined, "normal");
        doc.text(`      ${ro.padEnd(15)} ${type.padEnd(23)} ${String(formatHours(e.hours)).padStart(5)}h  ${formatMoney(e.earnings).padStart(9)}${flags}`, left, y);
        nl(4.8);
      }
    }
    nl(5);
  }

  nl(2);
  doc.setDrawColor(150); doc.line(left, y, rightEdge, y); nl(6);
  doc.setFont(undefined, "normal"); doc.setFontSize(9);
  doc.text(`Prepared by ${techName || `Emp #${empId}`} using Flatrate Buddy.`, left, y);

  // ── Photo evidence ────────────────────────────────────────────────────
  // The proof has to be IN the document. "Available on request" is worth
  // nothing standing in an office — a manager should be able to see the car,
  // on the page, next to the RO it belongs to.
  const withPhotos = weekKeys
    .flatMap(wk => weekMap.get(wk))
    .filter(e => getEntryReviewState(e).hasPhoto);

  if (withPhotos.length) {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    let added = 0, failed = 0;

    for (const e of withPhotos) {
      const shot = await entryPhotoForPdf(e);
      if (!shot) { failed++; continue; }

      doc.addPage();
      y = 20;
      doc.setFont(undefined, "bold"); doc.setFontSize(12);
      doc.text("PHOTO EVIDENCE", left, y); y += 7;

      doc.setFont(undefined, "normal"); doc.setFontSize(10);
      const ro = String(e.ref || e.ro || "-");
      doc.text(`${e.refType === "STOCK" ? "STK" : "RO"} ${ro}   ${e.dayKey || ""}`, left, y); y += 5.5;
      doc.text(`${String(e.type || e.typeText || "-").slice(0, 60)}   ${formatHours(e.hours)} hrs   ${formatMoney(e.earnings)}`, left, y); y += 7;

      // Fit inside the margins without distorting the picture.
      const maxW = pageW - left * 2;
      const maxH = pageH - y - 20;
      let w = shot.width, h = shot.height;
      const scale = Math.min(maxW / w, maxH / h, 1);
      w = w * scale; h = h * scale;

      try {
        doc.addImage(shot.dataUrl, shot.format, left, y, w, h);
        added++;
      } catch (err) {
        console.warn("[dispute pdf] addImage failed", err);
        doc.setFontSize(9);
        doc.text("(photo could not be embedded)", left, y);
        failed++;
      }
    }

    if (failed) {
      doc.addPage(); y = 20;
      doc.setFontSize(9); doc.setFont(undefined, "normal");
      doc.text(`${failed} photo${failed === 1 ? "" : "s"} could not be loaded and ${failed === 1 ? "is" : "are"} not included here. They remain in the app.`, left, y);
    }
    console.info(`[dispute pdf] embedded ${added} photo(s), ${failed} failed`);
  }

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

window.exportDisputeReport = exportDisputeReport;
window.exportDisputeThisWeek = exportDisputeThisWeek;

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
  const weekEntries = own.filter(e => inWeek(payDayKeyFor(e), ws));
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
  const weekEntries = own.filter(e => inWeek(payDayKeyFor(e), ws));
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
    title: "Set Your Hourly Rate 💵",
    body: "Start here — this is your rate, and nothing gets priced until you set it. I won't guess a number for you, because a wrong pay figure is worse than none in an app built to catch short pays. Set it once, and you can still override any single job under Add Details.",
    action: "switch-tab:settings",
  },
  {
    el: "#requestsDetails",
    title: "Requests & Your Wins 🏆",
    body: "Send missing work, short pay, or 'I need hours' straight to your manager — with the RO, date, and hours attached. Once they resolve one, it lands in your win tracker so you can see exactly how much you've clawed back.",
  },
  {
    el: "#payWeekStartDay",
    title: "Match Your Shop's Pay Week 🗓",
    body: "If your totals never quite match your check, this is usually why. Set the day your pay week starts and the payroll cutoff time — say Saturday at 2pm. Anything you turn in after that counts toward the next check, exactly like payroll does it.",
    action: "switch-tab:settings",
  },
  {
    el: "#reminderEnabled",
    title: "Reminders So You Don't Forget 🔔",
    body: "Shift Reminder pings you at the end of your shift to log hours before you walk out — that's where most missing money starts. Payday Reminder nudges you to enter your check so short pays get caught the same week, not months later.",
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
    stopSpotlightTracking(spotlight);
    if (!sel) {
      spotlight.style.display = "none";
      spotlight.classList.remove("pulse");
      overlay.style.background = "rgba(0,0,0,0.72)";
      overlay.classList.remove("tour-has-target");
      return;
    }
    const target = document.querySelector(sel);
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

  nextBtn.onclick = () => { step++; if (step >= MORE_TOUR_STEPS.length) endTour(); else show(step); };
  skipBtn.onclick = endTour;

  // Small delay so the page has finished rendering
  setTimeout(() => show(0), 500);
}

window.__FR = window.__FR || {};
window.__FR.startMoreTour = startMoreTour;
