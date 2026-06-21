function sb() {
  const cfg = window.__SUPABASE_CONFIG__;
  if (!cfg?.url || !cfg?.anonKey || !window.supabase) {
    throw new Error("Supabase config missing");
  }
  if (!window.__frtSupabase) {
    window.__frtSupabase = window.supabase.createClient(cfg.url, cfg.anonKey);
  }
  return window.__frtSupabase;
}

async function setUidFromSession(session) {
  window.CURRENT_UID = session?.user?.id || null;
  window.CURRENT_USER_EMAIL = session?.user?.email || null;

}

function setAuthMessage(text = "", isError = false) {
  const msgEl = document.getElementById("authMsg");
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.style.color = isError ? "var(--danger)" : "var(--muted)";
  msgEl.style.display = text ? "" : "none";
}

async function bootAuth() {
  let client;
  try { client = sb(); } catch (e) {
    console.error("Supabase not ready during bootAuth:", e);
    await initAuth();
    return;
  }
  const { data, error } = await client.auth.getSession();
  if (error) console.error("getSession error:", error);
  await setUidFromSession(data?.session || null);

  await initAuth();

  if (window.__AUTH_WIRED__) return;
  window.__AUTH_WIRED__ = true;

  let _visibilityTimer = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // App going to background — update the draft timestamp so the 15-min
      // window starts from when the user actually left, not when they typed.
      try {
        const raw = localStorage.getItem("fr_form_draft");
        if (raw) {
          const d = JSON.parse(raw);
          d.savedAt = Date.now();
          localStorage.setItem("fr_form_draft", JSON.stringify(d));
        }
      } catch {}
      return;
    }
    clearTimeout(_visibilityTimer);
    _visibilityTimer = setTimeout(async () => {
      // Skip the reload if data is still fresh (< 5 min old) — no point hammering
      // the server every time the user switches apps briefly.
      if (Date.now() - _lastLoadedAt < 5 * 60 * 1000) return;
      try {
        const { data } = await client.auth.getSession();
        await setUidFromSession(data?.session || null);
        if (window.CURRENT_UID && window.__PAGE__ === "main") {
          await safeLoadEntries();
        }
      } catch {}
    }, 300);
  });

  client.auth.onAuthStateChange(async (event, session) => {
    await setUidFromSession(session || null);
    await initAuth();

    if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && window.CURRENT_UID) {

      try {
        const rows = await safeLoadEntries();
        _lastLoadedAt = Date.now();
        loadSubscription().catch(() => {});

        if (window.__PAGE__ === "main") {
          await refreshUI(rows);
          // Flush any entries queued while offline — boot is the right moment
          // since the online event only fires on transitions, not on fresh loads.
          if (getPendingQueue().length > 0) {
            flushPendingSync?.().catch(() => {});
          }
        }
      } catch (e) {
        console.error("💥 LOAD FAILED:", e);
      }
    }
  });
}

async function initAuth() {
  const signedIn = !!window.CURRENT_UID;
  const statusEl  = document.getElementById("authStatus");
  const formEl    = document.getElementById("authForm");
  const signedInEl = document.getElementById("authSignedIn");
  const outBtn    = document.getElementById("authSignOut");

  if (statusEl) statusEl.textContent = signedIn
    ? (window.CURRENT_USER_EMAIL || "Signed in")
    : "";

  if (formEl)      formEl.style.display      = signedIn ? "none" : "";
  if (signedInEl)  signedInEl.style.display  = signedIn ? ""     : "none";
  if (outBtn)      outBtn.style.display       = signedIn ? ""     : "none";
  setAuthMessage("");

  const nudge = document.getElementById("cloudNudge");
  if (nudge) nudge.style.display = signedIn ? "none" : "";
}

function wireAuthUI() {
  const emailEl  = document.getElementById("authEmail");
  const passEl   = document.getElementById("authPassword");
  const signUpBtn = document.getElementById("authSignUp");
  const signInBtn = document.getElementById("authSignIn");
  const resetBtn  = document.getElementById("authReset");
  const outBtn    = document.getElementById("authSignOut");
  // only wire on the more page where these elements exist
  if (!signInBtn && !signUpBtn) return;

  // Lazy client getter — called at click time so wiring never fails even if
  // the Supabase library isn't loaded yet when the page first runs
  const getClient = () => {
    try { return sb(); }
    catch (e) {
      setAuthMessage("App not ready — please reload the page.", true);
      return null;
    }
  };

  const baseText = new Map(
    [signInBtn, signUpBtn, resetBtn]
      .filter(Boolean)
      .map((btn) => [btn, btn.textContent || ""])
  );

  const setBusy = (busy, mode = "") => {
    [signInBtn, signUpBtn, resetBtn].forEach((btn) => {
      if (!btn) return;
      btn.disabled = busy;
      const original = baseText.get(btn) || "";
      if (!busy) { btn.textContent = original; return; }
      if (btn === signInBtn) btn.textContent = mode === "signin" ? "Signing In..." : original;
      if (btn === signUpBtn) btn.textContent = mode === "signup" ? "Creating..." : original;
      if (btn === resetBtn)  btn.textContent = mode === "reset"  ? "Sending..."  : original;
    });
  };

  const runSignIn = async () => {
    const client = getClient();
    if (!client) return;
    const email    = (emailEl?.value || "").trim();
    const password = (passEl?.value  || "").trim();
    if (!email || !password) { setAuthMessage("Email and password required.", true); return; }
    setAuthMessage("Signing in...");
    setBusy(true, "signin");
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage(/not confirmed/i.test(error.message)
          ? "Check your email and click the confirmation link first."
          : error.message, true);
        return;
      }
      await setUidFromSession(data?.session || null);
      await initAuth();
      setAuthMessage("Signed in.");
      toast?.("Signed in");
    } catch (e) {
      setAuthMessage(e?.message || "Sign in failed.", true);
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    runSignIn().catch(e => { if (e && (e instanceof Error || Object.keys(e).length)) console.error("[runSignIn]", e); });
  };

  emailEl?.addEventListener("keydown", submitOnEnter);
  passEl?.addEventListener("keydown", submitOnEnter);

  // Use touchend + click for iOS PWA — touchend fires before the 300ms delay
  const onSignInTap = (e) => { e.preventDefault(); runSignIn().catch(console.error); };
  signInBtn?.addEventListener("touchend", onSignInTap, { passive: false });
  signInBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await runSignIn();
  });

  const runSignUp = async () => {
    const client = getClient();
    if (!client) return;
    const email    = (emailEl?.value || "").trim();
    const password = (passEl?.value  || "").trim();
    if (!email || !password) return setAuthMessage("Email and password required.", true);
    if (password.length < 6)  return setAuthMessage("Password must be at least 6 characters.", true);
    setAuthMessage("Creating account...");
    setBusy(true, "signup");
    try {
      const callbackUrl = new URL("./auth-callback.html", window.location.href).href;
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl } });
      if (error) return setAuthMessage(error.message, true);
      if (data?.session) {
        await setUidFromSession(data.session);
        await initAuth();
        setAuthMessage("Account created and signed in.");
        toast?.("Signed in");
        return;
      }
      setAuthMessage("Account created. Check your email for a confirmation link, then sign in.");
    } catch (e) {
      setAuthMessage(e?.message || "Sign up failed.", true);
    } finally {
      setBusy(false);
    }
  };
  const onSignUpTap = (e) => { e.preventDefault(); runSignUp().catch(console.error); };
  signUpBtn?.addEventListener("touchend", onSignUpTap, { passive: false });
  signUpBtn?.addEventListener("click", async (e) => { e.preventDefault(); await runSignUp(); });

  resetBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const client = getClient();
    if (!client) return;
    const email = (emailEl?.value || "").trim();
    if (!email) return setAuthMessage("Enter your email first.", true);
    setAuthMessage("Sending reset email...");
    setBusy(true, "reset");
    try {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) return setAuthMessage(error.message, true);
      setAuthMessage("Password reset email sent. Check your inbox.");
    } catch (e) {
      setAuthMessage(e?.message || "Reset failed.", true);
    } finally {
      setBusy(false);
    }
  });

  outBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const client = getClient();
    if (!client) return;
    await client.auth.signOut();
    await setUidFromSession(null);
    await initAuth();
  });
}

async function sbListRows(empId) {
  if (!empId) return [];
  const uid = await requireUserId(sb());
  if (!uid) return [];

  let q = sb()
    .from("work_logs")
    .select("*")
    .eq("user_id", uid)
    .eq("employee_number", empId)
    .or("is_deleted.is.null,is_deleted.eq.false");

  q = q
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });
  const { data, error } = await q;

  if (error) throw error;
  return data || [];
}

async function probeEmpHasRows(empId) {
  if (!empId) return false;
  const uid = await requireUserId(sb());
  if (!uid) return false;
  const { count, error } = await sb()
    .from("work_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .eq("employee_number", empId)
    .or("is_deleted.is.null,is_deleted.eq.false");
  if (error) return false;
  return Number(count || 0) > 0;
}

async function sbDeleteProofPhoto(photoPath) {
  if (!photoPath) return;
  const { error } = await sb().storage.from(PHOTO_BUCKET).remove([photoPath]);
  if (error) throw error;
}

async function attachPhotoToLog({ sb, logId, photoPath }) {
  const { data, error } = await sb
    .from("work_logs")
    .update({ photo_path: photoPath, updated_at: new Date().toISOString() })
    .eq("id", logId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

function isMissingColumnError(err, columnName) {
  const msg = `${err?.message || ""} ${err?.details || ""} ${err?.hint || ""}`.toLowerCase();
  return msg.includes(String(columnName || "").toLowerCase())
    && (msg.includes("column") || msg.includes("does not exist") || msg.includes("schema cache"));
}


async function updateWorkLogWithFallback(sbClient, logId, patch) {
  const body = { ...(patch || {}) };
  while (Object.keys(body).length > 0) {
    const { error } = await sbClient
      .from("work_logs")
      .update(body)
      .eq("id", logId);

    if (!error) return true;
    const missingField = Object.keys(body).find((k) => isMissingColumnError(error, k));
    if (!missingField) throw error;
    delete body[missingField];
  }
  return false;
}

async function saveEditedLog(logId, patch) {
  const empId = getEmpId();
  const file = getSelectedPhotoFile();
  if (file) {
    const uploaded = await uploadProofPhoto({
      sb: sb(),
      empId,
      logId,
      file,
      roNumber: patch.ro_number || null,
    });
    const newPath = uploaded?.path || null;
    patch.photo_path = newPath;
  }

  await updateWorkLogWithFallback(sb(), logId, patch);

  window.SELECTED_PHOTO_FILE = null;
  SELECTED_PHOTO_FILE = null;
  const input = document.querySelector("#photoInput, input[type=file][data-photo]");
  if (input) input.value = "";

  return { photo_path: patch.photo_path || null };
}

async function sbProofPhotoUrl(photoPath) {
  return getSignedPhotoUrl(photoPath);
}

async function getPhotoUrl(photoPath) {
  return getSignedPhotoUrl(photoPath);
}

async function listEntriesWithPhotos(limit = 100) {
  const { data, error } = await sb()
    .from("work_logs")
    .select("*")
    .not("photo_path", "is", null)
    .order("id", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}


async function getSignedPhotoUrl(photoPath, expiresIn = 1800) {
  const { data, error } = await sb()
    .storage
    .from("proofs")
    .createSignedUrl(photoPath, expiresIn);

  if (error) throw error;
  return data?.signedUrl || null;
}

const LS_EMP = "fr_emp_id";

function getEmpId() {
  const raw =
    (document.getElementById("empId")?.value || localStorage.getItem("fr_emp_id") || "")
      .trim();

  // digits only
  const digits = raw.replace(/\D/g, "");

  if (!digits) return "";

  // persist only when valid
  localStorage.setItem("fr_emp_id", digits);
  return digits;
}

function setEmpId(emp) {
  localStorage.setItem(LS_EMP, emp);
}

function mapEntryToRow(payload, userId) {
  return {
    user_id: userId,
    work_date: payload.work_date,
    category: payload.category || "work",
    ro_number: payload.ro_number || null,
    dealer: payload.dealer || null,
    description: payload.description || null,
    flat_hours: Number(payload.flat_hours || 0),
    cash_amount: Number(payload.cash_amount || 0),
    location: payload.location || null,
    vin8: payload.vin8 || null,
    photo_path: payload.photo_path || null,
  };
}

// LIST
async function apiListLogs(empId) {
  if (!empId) {
    empId = getEmpId();
    if (!empId) return [];
  }
  const uid = await requireUserId(sb());
  if (!uid) return [];
  return sbListRows(empId);
}

// CREATE
async function apiCreateLog(payload, sourceEntry = null) {
  const uid = await requireUserId(sb());
  if (!uid) throw new Error("Sign in required");
  const empId = String(document.getElementById("empId").value || "").trim();
  if (!empId) throw new Error("Employee # required");

  const insertRow = {
    user_id: uid,
    employee_number: empId,
    work_date: payload.work_date,
    category: payload.category || "work",
    ro_number: payload.ro_number || null,
    dealer: payload.dealer || null,
    description: payload.description || null,
    flat_hours: Number(payload.flat_hours || 0),
    cash_amount: Number(payload.cash_amount || 0),
    location: payload.location || null,
    vin8: payload.vin8 || null,
    is_deleted: false,
    photo_path: null,
  };

  // 1) Create row first (no photo_path yet)
  let created = null;
  let e1 = null;
  let insertBody = { ...insertRow };
  while (Object.keys(insertBody).length > 0) {
    ({ data: created, error: e1 } = await sb()
      .from("work_logs")
      .insert([insertBody])
      .select("id,photo_path")
      .maybeSingle());
    if (!e1) break;

    const missingField = Object.keys(insertBody).find((k) => isMissingColumnError(e1, k));
    if (!missingField) break;
    delete insertBody[missingField];
  }

  if (e1) throw e1;
  const createdRow = created ?? null;
  if (!createdRow) throw new Error("Create failed: no row returned");

  return createdRow;
}

// UPDATE
async function apiUpdateLog(id, payload) {
  const empId = getEmpId();
  if (!empId) return null;
  const uid = await requireUserId(sb());
  if (!uid) return null;

  const updateFields = {
    work_date: payload.work_date,
    category: payload.category || "work",
    ro_number: payload.ro_number || null,
    description: payload.description || null,
    flat_hours: Number(payload.flat_hours || 0),
    cash_amount: Number(payload.cash_amount || 0),
    hourly_rate: Number(payload.hourly_rate || 0),
    location: payload.location || null,
    vin8: payload.vin8 || null,
    updated_at: new Date().toISOString(),
  };

  // Update fields first
  let { data: updated, error: e1 } = await sb()
    .from("work_logs")
    .update(updateFields)
    .eq("id", id)
    .eq("user_id", uid)
    .eq("employee_number", empId)
    .select("*")
    .limit(1);

  if (e1) throw e1;
  const updatedRow = updated?.[0] ?? null;
  if (!updatedRow) throw new Error("Update failed: no row returned");

  return updatedRow;
}

// --- Soft delete helpers ---
async function softDeleteLog(sb, id) {
  const uid = window.CURRENT_UID;
  if (!uid) throw new Error("Not signed in");

  const { error } = await sb
    .from("work_logs")
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", uid); // makes RLS happy

  if (error) throw error;
}

async function undoSoftDeleteLog(sb, id) {
  const { data, error } = await sb
    .from("work_logs")
    .update({ is_deleted: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id,is_deleted")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Undo failed: row not found");
  return data;
}

let LAST_DELETED = null;

async function onDeleteClicked(btn, idOverride = null) {
  const id = String(
    idOverride
    || btn?.dataset?.del
    || btn?.getAttribute?.("data-del")
    || ""
  ).trim();
  if (!id) return;

  if (!confirm("Soft delete this entry?")) return;

  if (btn) {
    if (btn.dataset.busy === "1") return;
    btn.disabled = true;
    btn.dataset.busy = "1";
  }

  try {
    await softDeleteLog(sb(), id);
    LAST_DELETED = { id, at: Date.now() };

    const next = (Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [])
      .filter((x) => String(x.id) !== String(id));
    CURRENT_ENTRIES = syncStateEntries(next);
    setCachedEntries(getEmpId(), next);
    await renderLogs(next);

    showUndoBar({
      text: "Entry deleted.",
      onUndo: async () => {
        await undoSoftDeleteLog(sb(), id);
        await safeLoadEntries();
      },
      ttlMs: 8000
    });
  } catch (e) {
    console.error("DELETE FAILED", e);
    alert("Delete failed: " + (e?.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.dataset.busy = "0";
    }
  }
}

async function onUndoDelete() {
  if (!LAST_DELETED) return;

  try {
    await undoSoftDeleteLog(sb(), LAST_DELETED.id);
    LAST_DELETED = null;

    if (window.__FR?.safeLoadEntries) await window.__FR.safeLoadEntries();
    else await safeLoadEntries();
    const bar = document.getElementById("undoBar");
    if (bar) bar.style.display = "none";
  } catch (e) {
    console.error("UNDO FAILED", e);
    alert("Undo failed: " + (e?.message || e));
  }
}

let CURRENT_ENTRIES = [];
window.STATE = window.STATE || {};
if (!Array.isArray(window.STATE.entries)) window.STATE.entries = [];

function syncStateEntries(entries) {
  window.STATE = window.STATE || {};
  window.STATE.entries = normalizeEntries(Array.isArray(entries) ? entries : []);
  return window.STATE.entries;
}

function normalizeEntryForApi(entry) {
  const roNumber = entry.ro || entry.ro_number || entry.ref || null;
  // Map the UI entry object into the active Supabase work_logs schema.
  return {
    work_date: entry.dayKey || entry.date || entry.work_date || (entry.createdAt ? dayKeyFromISO(entry.createdAt) : null), // MUST be "YYYY-MM-DD"
    category: entry.typeText || entry.type || entry.category || "work",
    ro_number: roNumber,
    dealer: entry.dealer || null,
    description: entry.notes || entry.desc || entry.description || null,
    flat_hours: Number(entry.hours || entry.flat || entry.flat_hours || 0),
    cash_amount: Number(entry.earnings || entry.cash || entry.cash_amount || 0),
    location: entry.location || null,
    vin8: entry.vin8 || null,
    photo_path: entry.photo_path || entry.photoPath || null,
  };
}

function normalizeToken(value) {
  return String(value || "").trim().toUpperCase();
}

function inferRefTypeFromLog(log) {
  const explicit = normalizeToken(log?.refType || log?.ref_type);
  if (explicit === "STOCK") return "STOCK";

  const currentRef = normalizeToken(log?.ro_number || log?.ref || log?.ro);
  const liveStock = normalizeToken(log?.stock);
  if (!currentRef && liveStock) return "STOCK";

  return "RO";
}

function normalizeSupabaseLog(r) {
  const refType = inferRefTypeFromLog(r);
  const entry = {
    id: r.id,
    work_date: r.work_date,
    created_at: r.created_at,
    updated_at: r.updated_at,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,

    // UI expects these names (based on your form)
    refType,
    ref: r.ro_number ?? r.stock ?? "",
    ro_number: r.ro_number ?? "",
    ro: r.ro_number ?? "",
    stock: r.stock ?? "",
    dealer: r.dealer ?? null,
    brand: r.brand ?? "Unmapped",
    store: r.store ?? null,
    campus: r.campus ?? null,

    typeText: r.category ?? "",
    category: r.category ?? "",

    notes: r.description ?? "",
    description: r.description ?? "",

    // CRITICAL: map flat_hours -> hours (so existing UI math works)
    hours: Number(r.flat_hours ?? 0),
    flat_hours: Number(r.flat_hours ?? 0),

    cash: Number(r.cash_amount ?? 0),
    cash_amount: Number(r.cash_amount ?? 0),

    location: r.location ?? "",
    vin: r.vin ?? "",
    vin8: r.vin8 ?? "",
    photo_path: r.photo_path ?? null,

    owner_key: r.owner_key ?? null,
    employee_number: r.employee_number ?? null,
    is_deleted: r.is_deleted ?? false,
    isComeback: r.is_comeback ?? false,
  };

  return entry;
}

function mapServerLogToEntry(r) {
  const createdAt = r.created_at || new Date().toISOString();
  const dayKey = r.work_date; // already YYYY-MM-DD
  const hours = Number(r.flat_hours ?? r.hours ?? 0);
  const cashAmount = Number(r.cash_amount ?? r.earnings ?? 0);
  const rate = hours > 0 && Number.isFinite(cashAmount) && cashAmount > 0
    ? round2(cashAmount / hours)
    : getDefaultRate();
  const ref = r.ro_number || r.stock || r.ref || r.ro || "";
  const refType = inferRefTypeFromLog(r);

  return {
    id: r.id, // do NOT generate uuid() or local ID
    empId: getEmpId(),
    createdAt,
    updatedAt: r.updated_at || r.updatedAt || createdAt,
    createdAtMs: Date.parse(createdAt) || Date.now(),
    dayKey,
    weekStartKey: dateKey(startOfWeekLocal(new Date(dayKey))),
    refType,
    ref,
    ro: r.ro_number || "",
    ro_number: r.ro_number || "",
    stock: r.stock || "",
    dealer: r.dealer || "UNKNOWN",
    brand: r.brand || null,
    store: r.store || r.store_code || null,
    store_code: r.store_code || r.store || null,
    campus: r.campus || null,
    classMatched: r.classMatched || null,
    vin: r.vin || "",
    vin8: r.vin8 || "",
    type: r.category || "work",
    typeText: r.category || "work",
    hours: round1(hours),
    rate: round2(rate),
    earnings: round2(cashAmount),
    notes: r.description || "",
    cash_amount: cashAmount,
    photoDataUrl: null,
    photo_path: r.photo_path || null,
    location: r.location || null,
    isComeback: r.is_comeback ?? r.isComeback ?? false,
  };
}

const DB_NAME = "frlog";
const DB_VERSION = 6; // bump this

const STORES = {
  entries: "entries",
  types: "types_v2",      // <-- change from "types"
  weekflags: "weekflags",
  payroll: "payroll"
};

const $ = (id) => document.getElementById(id);

let _loadEntriesLock = false;
let _fullHistoryLoaded = false;
let _lastLoadedAt = 0;

async function safeLoadEntries({ fullHistory = false } = {}) {
  if (_loadEntriesLock) return Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  _loadEntriesLock = true;
  const emp = getEmpId();

  try {
    if (!window.CURRENT_UID) {
      // Auth hasn't resolved yet — show whatever we have locally so the screen
      // isn't blank while the session check is in flight.
      const emp2 = emp || (localStorage.getItem("fr_emp_id") || "").trim();
      const pending = getPendingQueue().map(item => ({ ...item.entry, _pending: true }));
      const cached = emp2 ? getCachedEntries(emp2) : [];
      const pendingIds = new Set(pending.map(p => String(p.id)));
      const merged = [...pending, ...cached.filter(c => !pendingIds.has(String(c.id)))];
      if (merged.length) {
        CURRENT_ENTRIES = syncStateEntries(normalizeEntries(merged));
        await renderLogs(CURRENT_ENTRIES);
      }
      return [];
    }
    if (!emp) return [];

    const rows = await loadEntries({ fullHistory: fullHistory || _fullHistoryLoaded });
    _lastLoadedAt = Date.now();
    return rows;
  } catch (e) {
    console.error("loadEntries failed:", e);
    if (!navigator.onLine || String(e?.message || "").includes("fetch")) {
      const pendingMap = new Map(getPendingQueue().map(x => [String(x.id), { ...x.entry, _pending: true }]));
      const cached = getCachedEntries(emp).filter(c => !pendingMap.has(String(c.id)));
      const merged = [...pendingMap.values(), ...cached];
      if (merged.length) {
        CURRENT_ENTRIES = syncStateEntries(normalizeEntries(merged));
        setCachedEntries(emp, merged);
        await renderLogs(CURRENT_ENTRIES);
        toast?.("Offline — showing cached entries");
      }
    }
    return [];
  } finally {
    _loadEntriesLock = false;
  }
}
window.__FR = window.__FR || {};
window.__FR.safeLoadEntries = safeLoadEntries;

/* ── Subscription status ─────────────────────────────────────────── */
window.CURRENT_PLAN = "free"; // "free" | "pro"

async function loadSubscription() {
  try {
    const uid = window.CURRENT_UID;
    const { data, error } = await sb()
      .from("subscriptions")
      .select("status")
      .eq("user_id", uid)
      .maybeSingle();
    if (error || !data) return;
    const active = data.status === "active" || data.status === "trialing";
    window.CURRENT_PLAN = active ? "pro" : "free";
  } catch {}
}
window.__FR.loadSubscription = loadSubscription;
function initEmpIdBoot() {
  const el = document.getElementById("empId");
  if (!el) return;

  const saved = (localStorage.getItem("fr_emp_id") || "").trim();
  if (saved && !el.value) el.value = saved;
}
function wireEmpIdReload() {
  const el = document.getElementById("empId");
  if (!el) return;

  const maybeReload = () => {
    const digits = (el.value || "").trim().replace(/\D/g, "");
    if (digits.length >= 5) {
      localStorage.setItem("fr_emp_id", digits);
    }
  };

  el.addEventListener("blur", maybeReload);
  el.addEventListener("change", maybeReload);

  // Optional: if you want it to auto-load as they type (only once valid)
  el.addEventListener("input", () => {
    const digits = (el.value || "").trim().replace(/\D/g, "");
    if (digits.length === 5) maybeReload();
  });
}

async function backfillDayKeysForEmp(empId){
  const all = await getAll(STORES.entries);
  const mine = filterEntriesByEmp(all, empId);
  const needsFix = mine.filter(e => !e.dayKey || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(e.dayKey)));
  if (!needsFix.length) return 0;

  for (const e of needsFix) {
    const fixed = dayKeyFromISO(e.createdAt);
    if (!fixed) continue;
    e.dayKey = fixed;
    e.weekStartKey = dateKey(startOfWeekLocal(new Date(fixed)));
    await put(STORES.entries, e);
  }
  return needsFix.length;
}


async function renderLogs(logs) {
  const entries = Array.isArray(logs) ? normalizeEntries(logs) : [];

  await refreshUI(entries);
}

const LS_ENTRY_CACHE = "fr_entry_cache_";

function getCachedEntries(empId) {
  try { return JSON.parse(localStorage.getItem(LS_ENTRY_CACHE + empId) || "[]"); } catch { return []; }
}

function setCachedEntries(empId, entries) {
  if (!empId || !entries?.length) return;
  try {
    const slim = entries.slice(0, 300).map(e => ({
      id: e.id, empId: e.empId, dayKey: e.dayKey, weekStartKey: e.weekStartKey,
      type: e.type, typeText: e.typeText, hours: e.hours, rate: e.rate,
      earnings: e.earnings, ref: e.ref, ro: e.ro, vin8: e.vin8, notes: e.notes,
      isComeback: e.isComeback, createdAt: e.createdAt, work_date: e.work_date,
      photo_path: e.photo_path, refType: e.refType,
    }));
    localStorage.setItem(LS_ENTRY_CACHE + empId, JSON.stringify(slim));
  } catch {}
}

async function renderEntries(rows) {
  const mapped = (rows || []).map(mapServerLogToEntry);
  CURRENT_ENTRIES = syncStateEntries(mapped);
  setCachedEntries(getEmpId(), mapped);
  await renderLogs(mapped);
  // Type sync runs after the list is already painted — autocomplete updates
  // asynchronously so it never delays the entry list from appearing.
  syncTypesFromEntries?.(mapped, getEmpId()).catch(() => {});
  await refreshMorePagePanels?.();
  return mapped;
}

async function loadEntries({ fullHistory = false } = {}) {
  const empId = getEmpId();
  if (!empId) {
    console.warn("No employee number set. Returning empty.");
    return [];
  }

  const uid = await requireUserId(sb());
  if (!uid) {
    console.warn("No UID - skipping loadEntries");
    return [];
  }

  let query = sb()
    .from("work_logs")
    .select("*")
    .eq("user_id", uid)
    .eq("employee_number", empId)
    .or("is_deleted.is.null,is_deleted.eq.false");

  if (fullHistory) {
    _fullHistoryLoaded = true;
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    query = query.gte("work_date", cutoff.toISOString().slice(0, 10));
  }

  const res = await query
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (res.error) throw res.error;

  const rows = (res.data || []).map(normalizeSupabaseLog);
  return await renderEntries(rows);
}

/* ── Offline pending sync queue ──────────────────────────────────── */
const LS_PENDING = "fr_pending_sync";

function getPendingQueue() {
  try { return JSON.parse(localStorage.getItem(LS_PENDING) || "[]"); } catch { return []; }
}

function setPendingQueue(q) {
  localStorage.setItem(LS_PENDING, JSON.stringify(q || []));
}

function queuePendingEntry(entry, payload) {
  const q = getPendingQueue();
  q.push({ id: String(entry.id), entry, payload, queuedAt: new Date().toISOString() });
  setPendingQueue(q);
  updatePendingBadge();
}

function removePendingById(id) {
  setPendingQueue(getPendingQueue().filter(x => x.id !== String(id)));
  updatePendingBadge();
}

function updatePendingBadge() {
  const count = getPendingQueue().length;
  const el = document.getElementById("offlineBanner");
  const badge = document.getElementById("pendingSyncBadge");
  const online = navigator.onLine;

  if (el) {
    if (count > 0 && !online) {
      el.textContent = `Offline · ${count} entr${count === 1 ? "y" : "ies"} queued — will sync when back online`;
      el.style.display = "";
    } else if (count > 0 && online) {
      el.textContent = `Syncing ${count} queued entr${count === 1 ? "y" : "ies"}…`;
      el.style.display = "";
    } else if (!online) {
      el.textContent = "Offline — new entries will be saved locally";
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
  }

  if (badge) {
    if (count > 0) {
      badge.textContent = `↑${count}`;
      badge.style.display = "";
    } else {
      badge.style.display = "none";
    }
  }

  // Keep 3-state sync dot in sync
  window.syncOfflineDot?.();
}
