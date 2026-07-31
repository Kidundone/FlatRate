/* ── Requests to manager (claims) ─────────────────────────────────────────────
 * A tech raises an issue — missing work, short pay, needing hours — and it
 * lands in their service manager's inbox with a timestamp and a message thread.
 * Backed by public.claims / public.claim_messages (see the 20260729 migration).
 *
 * Everything degrades quietly: if the user isn't signed in or isn't in a shop,
 * the section shows a join prompt instead of erroring.
 */

const CLAIM_KINDS = Object.freeze([
  { id: "missing_work", label: "Missing work", emoji: "🔍",
    hint: "A job I did isn't showing up or wasn't paid." },
  { id: "short_pay",    label: "Short pay",    emoji: "💸",
    hint: "I was paid less time than I turned." },
  { id: "need_hours",   label: "Need hours",   emoji: "🕐",
    hint: "I'm out of work — send me something." },
  { id: "other",        label: "Other",        emoji: "💬",
    hint: "Anything else for the manager." },
]);

const CLAIM_STATUS = Object.freeze({
  open:         { label: "Open",         cls: "reqSt--open" },
  acknowledged: { label: "Seen",         cls: "reqSt--ack" },
  resolved:     { label: "Resolved",     cls: "reqSt--done" },
  declined:     { label: "Declined",     cls: "reqSt--declined" },
});

function claimKind(id)   { return CLAIM_KINDS.find(k => k.id === id) || CLAIM_KINDS[3]; }
function claimStatus(id) { return CLAIM_STATUS[id] || CLAIM_STATUS.open; }

let MY_CLAIMS   = [];
let ACTIVE_CLAIM = null;
let REQ_KIND    = "missing_work";
let IN_SHOP     = false;

/** Short relative time: "3m", "2h", "5d", else a date. */
function claimAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** One-line summary of whatever evidence the tech attached. */
function claimEvidence(c) {
  const bits = [];
  if (c.ro_number)                 bits.push(`RO ${c.ro_number}`);
  if (c.work_date)                 bits.push(c.work_date);
  if (Number(c.claimed_hours) > 0) bits.push(`${Number(c.claimed_hours).toFixed(1)}h`);
  if (Number(c.claimed_amount) > 0) bits.push(formatMoney(c.claimed_amount));
  return bits.join(" · ");
}

async function isInShop() {
  try {
    const { data } = await sb().from("shop_members").select("shop_id").limit(1).maybeSingle();
    return !!data?.shop_id;
  } catch { return false; }
}

async function loadMyClaims() {
  const { data, error } = await sb()
    .from("claims")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  MY_CLAIMS = data || [];
  return MY_CLAIMS;
}

async function renderRequests() {
  const gate = document.getElementById("reqGate");
  const body = document.getElementById("reqBody");
  const list = document.getElementById("reqList");
  const badge = document.getElementById("reqBadge");
  if (!gate || !body || !list) return;

  // Not signed in → the join prompt covers it (team.html handles auth).
  if (!window.CURRENT_UID) {
    gate.style.display = ""; body.style.display = "none";
    if (badge) badge.style.display = "none";
    return;
  }

  IN_SHOP = await isInShop();
  if (!IN_SHOP) {
    gate.style.display = ""; body.style.display = "none";
    if (badge) badge.style.display = "none";
    return;
  }
  gate.style.display = "none"; body.style.display = "";

  try { await loadMyClaims(); }
  catch (e) {
    list.innerHTML = `<div class="muted small">Couldn't load requests — ${escapeHtml(e.message || "try again")}</div>`;
    return;
  }

  // Badge counts anything the manager hasn't closed out yet.
  const openCount = MY_CLAIMS.filter(c => c.status === "open" || c.status === "acknowledged").length;
  if (badge) {
    badge.textContent = String(openCount);
    badge.style.display = openCount ? "" : "none";
  }

  if (!MY_CLAIMS.length) {
    list.innerHTML = `<div class="reqEmpty">Nothing sent yet. Use “New request” when work goes missing or you need hours.</div>`;
    return;
  }

  list.innerHTML = MY_CLAIMS.map(c => {
    const k = claimKind(c.kind), s = claimStatus(c.status);
    const ev = claimEvidence(c);
    return `
      <button type="button" class="reqItem" data-claim="${escapeHtml(c.id)}">
        <div class="reqItemTop">
          <span class="reqItemSubject">${k.emoji} ${escapeHtml(c.subject)}</span>
          <span class="reqSt ${s.cls}">${s.label}</span>
        </div>
        <div class="reqItemMeta">${ev ? escapeHtml(ev) + " · " : ""}${claimAgo(c.created_at)}</div>
        ${c.resolution_note ? `<div class="reqItemNote">Manager: ${escapeHtml(c.resolution_note)}</div>` : ""}
      </button>`;
  }).join("");
}

/* ── Compose ─────────────────────────────────────────────────────────────── */

function openRequestModal(prefill = {}) {
  const modal = document.getElementById("reqModal");
  const kinds = document.getElementById("reqKinds");
  if (!modal || !kinds) return;

  REQ_KIND = prefill.kind || "missing_work";
  kinds.innerHTML = CLAIM_KINDS.map(k => `
    <button type="button" class="reqKind${k.id === REQ_KIND ? " reqKind--on" : ""}" data-kind="${k.id}">
      <span class="reqKindEmoji">${k.emoji}</span>
      <span class="reqKindLabel">${k.label}</span>
    </button>`).join("");

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ""; };
  set("reqSubject", prefill.subject);
  set("reqDetails", prefill.details);
  set("reqRo",      prefill.ro);
  set("reqDate",    prefill.date);
  set("reqHours",   prefill.hours);
  set("reqAmount",  prefill.amount);
  const err = document.getElementById("reqErr");
  if (err) { err.style.display = "none"; err.textContent = ""; }
  const draftErr = document.getElementById("reqDraftErr");
  if (draftErr) { draftErr.style.display = "none"; draftErr.textContent = ""; }

  applyKindHint();
  modal.style.display = "flex";
  lockBodyScroll();
  setTimeout(() => document.getElementById("reqSubject")?.focus(), 80);
}

function applyKindHint() {
  const k = claimKind(REQ_KIND);
  const sub = document.querySelector("#reqModal .ltSub");
  if (sub) sub.textContent = k.hint;
  // "Need hours" isn't about a specific job — hide the evidence grid.
  const grid = document.querySelector("#reqModal .reqGrid");
  if (grid) grid.style.display = REQ_KIND === "need_hours" ? "none" : "";
}

function closeRequestModal() {
  const m = document.getElementById("reqModal");
  if (m) m.style.display = "none";
  unlockBodyScroll();
}

/** Same auth-token dance photo-service.js uses for scan-ro — fresh token, retry once on 401. */
async function _callDraftDispute(payload, timeoutMs = 15000) {
  const sbInstance = window.__FR?.sb;
  const fnUrl = `${window.__SUPABASE_CONFIG__.url}/functions/v1/draft-dispute`;

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
      if (!res.ok) throw Object.assign(new Error(data?.error || `Draft failed (${res.status})`), { status: res.status });
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

async function draftDisputeText() {
  const btn = document.getElementById("reqDraftBtn");
  const err = document.getElementById("reqDraftErr");
  const val = (id) => (document.getElementById(id)?.value || "").trim();
  if (err) { err.style.display = "none"; err.textContent = ""; }

  const payload = {
    kind:    REQ_KIND,
    subject: val("reqSubject"),
    ro:      REQ_KIND === "need_hours" ? "" : val("reqRo"),
    date:    REQ_KIND === "need_hours" ? "" : val("reqDate"),
    hours:   REQ_KIND === "need_hours" ? null : val("reqHours"),
    amount:  REQ_KIND === "need_hours" ? null : val("reqAmount"),
  };

  if (btn) { btn.disabled = true; btn.textContent = "Drafting…"; }
  try {
    const { text } = await _callDraftDispute(payload);
    const details = document.getElementById("reqDetails");
    if (details && text) {
      details.value = text;
      details.focus();
    }
    haptic?.("light");
  } catch (e) {
    if (err) {
      err.textContent = e?.message === "auth_expired"
        ? "Sign back in to use the drafting tool."
        : (e?.message || "Couldn't draft that — try again.");
      err.style.display = "";
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "✍️ Draft for me"; }
  }
}

async function submitRequest() {
  const btn = document.getElementById("reqSubmitBtn");
  const err = document.getElementById("reqErr");
  const val = (id) => (document.getElementById(id)?.value || "").trim();
  const num = (id) => { const v = parseFloat(val(id)); return Number.isFinite(v) && v > 0 ? v : null; };

  const subject = val("reqSubject");
  if (!subject) {
    if (err) { err.textContent = "Give it a short subject so your manager knows what it's about."; err.style.display = ""; }
    document.getElementById("reqSubject")?.focus();
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const { error } = await sb().rpc("submit_claim", {
      p_kind:           REQ_KIND,
      p_subject:        subject,
      p_details:        val("reqDetails") || null,
      p_ro_number:      REQ_KIND === "need_hours" ? null : (val("reqRo") || null),
      p_work_date:      REQ_KIND === "need_hours" ? null : (val("reqDate") || null),
      p_claimed_hours:  REQ_KIND === "need_hours" ? null : num("reqHours"),
      p_claimed_amount: REQ_KIND === "need_hours" ? null : num("reqAmount"),
    });
    if (error) throw error;
    closeRequestModal();
    haptic?.("success");
    toast("Sent to your manager");
    await renderRequests();
  } catch (e) {
    if (err) { err.textContent = e?.message || "Couldn't send — try again."; err.style.display = ""; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send"; }
  }
}

/* ── Thread ──────────────────────────────────────────────────────────────── */

async function openClaimThread(claimId) {
  const c = MY_CLAIMS.find(x => String(x.id) === String(claimId));
  if (!c) return;
  ACTIVE_CLAIM = c;

  const modal = document.getElementById("reqThreadModal");
  if (!modal) return;
  const k = claimKind(c.kind), s = claimStatus(c.status);

  document.getElementById("reqThreadTitle").textContent = `${k.emoji} ${c.subject}`;
  document.getElementById("reqThreadSub").textContent   = `${s.label} · sent ${claimAgo(c.created_at)}`;

  const ev = claimEvidence(c);
  document.getElementById("reqThreadMeta").innerHTML = `
    ${ev ? `<div class="reqMetaRow">${escapeHtml(ev)}</div>` : ""}
    ${c.details ? `<div class="reqMetaDetails">${escapeHtml(c.details)}</div>` : ""}
    ${c.resolution_note ? `<div class="reqMetaNote"><strong>Manager:</strong> ${escapeHtml(c.resolution_note)}</div>` : ""}`;

  // Only an untouched request can be pulled back.
  const wd = document.getElementById("reqWithdrawBtn");
  if (wd) wd.style.display = c.status === "open" ? "" : "none";

  modal.style.display = "flex";
  lockBodyScroll();
  await renderClaimMessages(c.id);
}

async function renderClaimMessages(claimId) {
  const box = document.getElementById("reqThreadMsgs");
  if (!box) return;
  box.innerHTML = `<div class="muted small">Loading…</div>`;
  try {
    const { data, error } = await sb()
      .from("claim_messages")
      .select("id, author_id, body, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!data?.length) {
      box.innerHTML = `<div class="reqNoMsgs">No replies yet.</div>`;
      return;
    }
    box.innerHTML = data.map(m => {
      const mine = m.author_id === window.CURRENT_UID;
      return `<div class="reqMsg ${mine ? "reqMsg--mine" : "reqMsg--them"}">
        <div class="reqMsgBody">${escapeHtml(m.body)}</div>
        <div class="reqMsgWho">${mine ? "You" : "Manager"} · ${claimAgo(m.created_at)}</div>
      </div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    box.innerHTML = `<div class="muted small">Couldn't load messages.</div>`;
  }
}

async function sendClaimReply() {
  const input = document.getElementById("reqReplyInput");
  const body  = (input?.value || "").trim();
  if (!body || !ACTIVE_CLAIM) return;
  const btn = document.getElementById("reqReplyBtn");
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb().from("claim_messages").insert({
      claim_id:  ACTIVE_CLAIM.id,
      author_id: window.CURRENT_UID,
      body,
    });
    if (error) throw error;
    if (input) input.value = "";
    haptic?.("light");
    await renderClaimMessages(ACTIVE_CLAIM.id);
  } catch (e) {
    toast(e?.message || "Couldn't send");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function withdrawClaim() {
  if (!ACTIVE_CLAIM) return;
  const yes = await showActionSheet({
    title: "Withdraw this request?",
    message: "It'll be removed from your manager's inbox.",
    confirmLabel: "Withdraw",
    danger: true,
  });
  if (!yes) return;
  try {
    const { error } = await sb().from("claims").delete().eq("id", ACTIVE_CLAIM.id);
    if (error) throw error;
    document.getElementById("reqThreadModal").style.display = "none";
    unlockBodyScroll();
    ACTIVE_CLAIM = null;
    toast("Request withdrawn");
    await renderRequests();
  } catch (e) {
    toast(e?.message || "Couldn't withdraw");
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

function initRequestsUI() {
  document.getElementById("newRequestBtn")?.addEventListener("click", () => openRequestModal());
  document.getElementById("reqCancelBtn")?.addEventListener("click", closeRequestModal);
  document.getElementById("reqSubmitBtn")?.addEventListener("click", submitRequest);
  document.getElementById("reqDraftBtn")?.addEventListener("click", draftDisputeText);

  document.getElementById("reqKinds")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    REQ_KIND = b.dataset.kind;
    document.querySelectorAll("#reqKinds .reqKind").forEach(x =>
      x.classList.toggle("reqKind--on", x.dataset.kind === REQ_KIND));
    applyKindHint();
  });

  document.getElementById("reqList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-claim]");
    if (b) openClaimThread(b.dataset.claim);
  });

  document.getElementById("reqReplyBtn")?.addEventListener("click", sendClaimReply);
  document.getElementById("reqReplyInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendClaimReply(); }
  });
  document.getElementById("reqWithdrawBtn")?.addEventListener("click", withdrawClaim);
  document.getElementById("reqThreadCloseBtn")?.addEventListener("click", () => {
    document.getElementById("reqThreadModal").style.display = "none";
    unlockBodyScroll();
    ACTIVE_CLAIM = null;
    renderRequests();
  });

  // Populate when the section is first opened, so we don't hit the network on boot.
  const det = document.getElementById("requestsDetails");
  det?.addEventListener("toggle", () => { if (det.open) renderRequests(); });
  if (det?.open) renderRequests();
}

window.__FR = window.__FR || {};
window.__FR.initRequestsUI = initRequestsUI;
window.__FR.renderRequests = renderRequests;
window.__FR.openRequestModal = openRequestModal;
