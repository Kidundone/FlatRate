const PHOTO_BUCKET = "proofs"; // private

function setPhotoUploadTarget(path) {
  const bucketEl = document.getElementById("photoBucketName");
  if (bucketEl) bucketEl.textContent = PHOTO_BUCKET;
  const pathEl = document.getElementById("photoPathPreview");
  if (pathEl) pathEl.textContent = path || "—";
}

function setPhotoSummaryState(text) {
  const summaryEl = document.getElementById("photoSummaryState");
  if (summaryEl) summaryEl.textContent = text || "No photo";
}

async function requireUserId(sb) {
  const uid = window.CURRENT_UID;
  if (!uid) return null;
  return uid;
}

async function ensureSession() {
  try {
    const { data } = await sb().auth.getSession();
    const uid = data?.session?.user?.id || null;
    if (uid) window.CURRENT_UID = uid;
  } catch {}
}

async function getProofSignedUrl(sb, photoPath) {
  const { data, error } = await sb.storage
    .from("proofs")
    .createSignedUrl(photoPath, 60);

  if (error) throw error;
  return data.signedUrl;
}

async function downscaleImage(fileOrBlob, maxDim = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(fileOrBlob);
  let { width, height } = bitmap;

  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height >= width && height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );

  if (!blob) throw new Error("Downscale failed");
  return blob;
}

async function uploadProofPhoto({ sb, empId, logId, file, roNumber = null }) {
  const uid = await requireUserId(sb);
  if (!uid) throw new Error("Sign in required");

  const uploadBlob = await downscaleImage(file);
  const ext = "jpg";
  const path = `${uid}/${empId}/${logId}.${ext}`;

  const { error } = await sb.storage
    .from("proofs")
    .upload(path, uploadBlob, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) throw error;
  const { error: updateErr } = await sb.from("work_logs").update({ photo_path: path }).eq("id", logId);
  if (updateErr) throw updateErr;
  return { path, dealer: null };
}

// --- Photo selection (camera / library / files) ---
let SELECTED_PHOTO_FILE = null;

function setSelectedPhotoFile(file, label = "") {
  SELECTED_PHOTO_FILE = file || null;
  window.SELECTED_PHOTO_FILE = SELECTED_PHOTO_FILE;

  const lbl = document.getElementById("photoPickedLabel");
  if (lbl) {
    lbl.textContent = file
      ? `Selected: ${label || file.name} (${Math.round(file.size / 1024)} KB)`
      : "No photo";
  }
  setPhotoSummaryState(file ? "Selected" : "No photo");
}

function setSelectedPhoto(file, label = "") {
  setSelectedPhotoFile(file, label);
}

function getSelectedPhotoFile() {
  if (window.SELECTED_PHOTO_FILE) return window.SELECTED_PHOTO_FILE;
  if (SELECTED_PHOTO_FILE) return SELECTED_PHOTO_FILE;
  const el = document.querySelector(
    "#photoInput, #proofPhoto, #photoPicker, #photoCamera, #photoFile, input[type=file][data-photo]"
  );
  return el?.files?.[0] || null;
}

function setPhotoLabelFromEntry(entry) {
  const lbl = document.getElementById("photoPickedLabel");
  if (!lbl) return;
  const hasPhoto = !!entry?.photo_path;
  lbl.textContent = hasPhoto ? "Photo attached" : "No photo";
  setPhotoSummaryState(hasPhoto ? "Attached" : "No photo");
  setPhotoUploadTarget(entry?.photo_path || "");
}

function clearPickedPhoto() {
  const cam = document.getElementById("photoCamera");
  const pick = document.getElementById("photoPicker");
  const file = document.getElementById("photoFile");
  if (cam) cam.value = "";
  if (pick) pick.value = "";
  if (file) file.value = "";
  setSelectedPhotoFile(null);
  setPhotoUploadTarget("");
  const panel = document.getElementById("photoPanel");
  if (panel) panel.open = false;
}

function wirePhotoPickers() {
  const btnTake = document.getElementById("btnTakePhoto");
  const btnPick = document.getElementById("btnPickPhoto");
  const btnFile = document.getElementById("btnPickFile");

  const inCamera = document.getElementById("photoCamera");
  const inPicker = document.getElementById("photoPicker");
  const inFile   = document.getElementById("photoFile");

  if (!inCamera || !inPicker || !inFile) return;

  // IMPORTANT: accept attrs help iOS show correct picker
  inCamera.setAttribute("accept", "image/*");
  inCamera.setAttribute("capture", "environment");

  inPicker.setAttribute("accept", "image/*");
  inFile.setAttribute("accept", "image/*");

  // Buttons must trigger input click from a user gesture
  btnTake?.addEventListener("click", (e) => { e.preventDefault(); inCamera.click(); });
  btnPick?.addEventListener("click", (e) => { e.preventDefault(); inPicker.click(); });
  btnFile?.addEventListener("click", (e) => { e.preventDefault(); inFile.click(); });

  // Change handlers (this is what you’re missing/broken)
  const handlePhotoChange = (input, label) => async () => {
    const file = input.files?.[0] || null;
    if (!file) { setSelectedPhoto(null); return; }
    setPhotoSummaryState("Scanning…");
    await new Promise(r => setTimeout(r, 0)); // yield so UI updates
    setSelectedPhoto(file, label);
    scanPhotoAndPrefillForm(file).catch(e => console.warn("[OCR prefill]", e?.message || e));
  };
  inCamera.addEventListener("change", handlePhotoChange(inCamera, "camera"));
  inPicker.addEventListener("change", handlePhotoChange(inPicker, "library"));
  inFile.addEventListener("change",   handlePhotoChange(inFile, "file"));
}

async function fileToDataURL(file){
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function setPayrollStatus(msgHtml) {
  const status = $("payrollScanStatus");
  if (status) status.innerHTML = msgHtml || "";
}

function fileToImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function compressImageFile(file, {
  maxWidth = 1280,
  quality = 0.75,
  mime = "image/jpeg",
} = {}) {
  const blob = await downscaleImage(file, maxWidth, quality);
  return new File([blob], "proof.jpg", { type: mime });
}

async function compressImageFileToDataUrl(file, maxW = 1200, quality = 0.75) {
  const dataUrl = await fileToDataURL(file);
  const img = await fileToImageFromDataUrl(dataUrl);

  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

function applyPhotoLoadGuard(img, photo_path) {
  if (!img) return;
  img.onerror = () => {
    console.error("PHOTO LOAD FAILED", photo_path);
    img.replaceWith(
      Object.assign(document.createElement("div"), {
        textContent: "Photo failed to load",
        className: "photo-error"
      })
    );
  };
}

function ensurePhotoImg(id, container, styleText, beforeEl) {
  let img = document.getElementById(id);
  if (img || !container) return img;

  img = document.createElement("img");
  img.id = id;
  img.alt = "Proof photo";
  if (styleText) img.style.cssText = styleText;

  const errorDiv = container.querySelector(".photo-error");
  if (errorDiv) {
    errorDiv.replaceWith(img);
    return img;
  }

  if (beforeEl) container.insertBefore(img, beforeEl);
  else container.appendChild(img);
  return img;
}

async function viewPhotoById(id) {
  const entries = Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : [];
  const row = entries.find(e => String(e.id) === String(id));

  if (!row) {
    alert("Photo entry not found.");
    return;
  }

  const path = row.photo_path || row.photoPath;
  if (!path) {
    alert("No photo on this entry.");
    return;
  }

  const url = await getPhotoUrl(path);

  // whatever modal you already use:
  openPhotoModal(url, path);
}

function openPhotoModal(url, pathLabel) {
  const modal = document.getElementById("photoModal");
  const card = modal?.querySelector(".card");
  const img = ensurePhotoImg(
    "photoImg",
    card,
    "width:100%; height:auto; border-radius:14px; margin-top:12px; display:block;"
  );
  const label = document.getElementById("photoPathLabel") || document.getElementById("photoMeta");

  if (!modal || !img) {
    window.open(url, "_blank");
    return;
  }

  if (label) label.textContent = pathLabel || "";
  applyPhotoLoadGuard(img, pathLabel);
  img.src = url;

  modal.classList.add("open");
  lockBodyScroll();
}

async function openPhoto(row) {
  const path = row?.photo_path || row?.photoPath;
  if (!path) return toast("No photo saved.");
  const url = await getPhotoUrl(path);
  openPhotoModal(url, path);
}

function closePhotoModal(){
  const shell = document.getElementById("photoModal");
  const img = document.getElementById("photoImg");
  if (img) img.src = "";
  if (shell) {
    shell.classList.remove("open");
    shell.style.display = "";
  }
  unlockBodyScroll();
}

async function entryPhotoUrl(entry) {
  return getPhotoUrl(entry?.photo_path);
}

function entryHasPhoto(entry) {
  return !!entry?.photo_path;
}

async function getRecentPhotoEntriesByEmp(empId, limit = 24) {
  const id = String(empId || "").trim();
  if (!id) return [];
  const all = normalizeEntries(Array.isArray(CURRENT_ENTRIES) ? CURRENT_ENTRIES : []);
  return all
    .filter((e) => String(e?.empId || "").trim() === id && entryHasPhoto(e))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, limit);
}

function setGalleryStatus(msg){
  const el = document.getElementById("galleryStatus");
  if (el) el.textContent = msg || "";
}

let _photosRequested = false;

function clearPhotoGallery(){
  const el = document.getElementById("photoGallery");
  if (el) el.innerHTML = "";
  setGalleryStatus("");
  _photosRequested = false;
}

async function renderPhotoGallerySafe(entries){
  const el = document.getElementById("photoGallery");
  if (!el) return 0;

  if (!entries || !entries.length) {
    el.innerHTML = `<div class="muted">No photos found for this employee.</div>`;
    return 0;
  }

  el.innerHTML = "";
  let count = 0;
  for (const e of entries) {
    const photoUrl = await entryPhotoUrl(e);
    if (!photoUrl) continue;

    const img = document.createElement("img");
    img.className = "thumb";
    applyPhotoLoadGuard(img, e.photo_path);
    img.src = photoUrl;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => openPhotoViewer(e));
    el.appendChild(img);
    count += 1;
  }

  if (!count) {
    el.innerHTML = `<div class="muted">No photos found for this employee.</div>`;
  }

  return count;
}

async function renderPhotoGrid(allowAll = false, opts = {}){
  const empId = getEmpId();
  if (!empId) {
    clearPhotoGallery();
    setGalleryStatus("Enter Employee # to load photos.");
    return 0;
  }

  try {
    const limit = opts.limit || 24;
    const entries = await getRecentPhotoEntriesByEmp(empId, limit);
    const count = await renderPhotoGallerySafe(entries);

    if (opts.updateStatus) {
      if (count > 0) setGalleryStatus(`Loaded ${count} photo${count === 1 ? "" : "s"}.`);
      else setGalleryStatus("No photos found for this employee.");
    }

    return count;
  } catch (e) {
    if (opts.updateStatus) setGalleryStatus("Failed to load photos.");
    return 0;
  }
}

async function openPhotoViewer(e){
  const shell = document.getElementById("photoViewer");
  const meta = document.getElementById("photoMeta");
  const dl = document.getElementById("downloadPhotoBtn");
  const card = shell?.querySelector(".card");
  const downloadRow = dl?.closest?.(".row");
  const img = ensurePhotoImg(
    "photoFull",
    card,
    "width:100%; border-radius:16px; margin-top:10px;",
    downloadRow
  );

  if (!shell || !img || !meta || !dl) return;

  if (!e?.photo_path) return toast("No photo saved.");

  const url = await getPhotoUrl(e.photo_path);

  applyPhotoLoadGuard(img, e.photo_path);
  img.src = url;
  dl.href = url;

  const label = `${e.ro || e.ref || ""}`.trim();
  meta.textContent = `${label} • ${e.work_date || e.dayKey || ""}`;

  shell.style.display = "block";
  shell.classList.add("open");
}

function closePhotoViewer(){
  const shell = document.getElementById("photoViewer");
  if (!shell) return;
  shell.classList.remove("open");
  shell.style.display = "none";
}


function initPhotosUI(){
  document.getElementById("closePhotoViewerBtn")?.addEventListener("click", closePhotoViewer);
  document.getElementById("photoViewer")?.addEventListener("click", (e) => {
    if (e.target?.id === "photoViewer") closePhotoViewer();
  });

  clearPhotoGallery();

  const loadBtn = document.getElementById("loadPhotosBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      const empId = getEmpId();
      if (!empId) {
        alert("Enter Employee # first.");
        return;
      }

      setGalleryStatus("Loading...");
      loadBtn.disabled = true;
      try {
        const photos = await getRecentPhotoEntriesByEmp(empId, 24);
        const count = await renderPhotoGallerySafe(photos);
        _photosRequested = true;
        setGalleryStatus(`Loaded ${count} photo(s).`);
      } catch (e) {
        _photosRequested = false;
        setGalleryStatus("Load failed.");
        alert("Photo load failed: " + (e?.message || e));
      } finally {
        loadBtn.disabled = false;
      }
    });
  }

  document.getElementById("clearGalleryBtn")?.addEventListener("click", () => {
    clearPhotoGallery();
    setGalleryStatus("");
    closePhotoViewer();
  });
}

async function _callScanRo(base64, mediaType = "image/jpeg", timeoutMs = 18000) {
  const sbInstance = window.__FR?.sb;
  const fnUrl = `${window.__SUPABASE_CONFIG__.url}/functions/v1/scan-ro`;

  const getToken = async () => {
    // Always refresh to ensure a non-expired token
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
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => String(res.status));
        throw Object.assign(new Error(`Scan failed (${res.status}): ${txt}`), { status: res.status });
      }
      return res.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("OCR timed out — try again");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await doFetch(token);
  } catch (e) {
    // On 401, refresh once more and retry
    if (e.status === 401) {
      const fresh = await getToken();
      if (fresh && fresh !== token) return await doFetch(fresh);
    }
    throw e;
  }
}

// Snap-to-fill: scan photo immediately when selected, prefill form fields before save.
async function scanPhotoAndPrefillForm(file) {
  if (!file) return;

  const scanStatus = document.getElementById("photoScanStatus");
  const refEl      = document.getElementById("ref");
  const vinEl      = document.getElementById("vin8");
  const typeEl     = document.getElementById("typeText");
  const detailsPanel = document.getElementById("detailsPanel");
  const detailsBtn   = document.getElementById("toggleDetailsBtn");

  const showStatus = (msg, isScanning = false) => {
    if (!scanStatus) return;
    scanStatus.textContent = msg;
    scanStatus.style.display = msg ? "" : "none";
    scanStatus.className = "fr26ScanStatus" + (isScanning ? " scanning" : "");
  };

  showStatus("Reading photo…", true);

  try {
    const dataUrl  = await compressImageFileToDataUrl(file, 800, 0.80);
    const base64   = dataUrl.split(",")[1];
    const mediaType = dataUrl.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const result   = await _callScanRo(base64, mediaType);

    const { ro, vin, stk } = result || {};
    const filled = [];

    // Fill RO/Stock — prefer RO when both exist (Repair Order form)
    if (refEl && !refEl.value.trim()) {
      if (ro) {
        // RO form: combine RO/STK if both present (e.g. "474073/A7001")
        refEl.value = stk ? `${ro}/${stk}` : ro;
        document.getElementById("refTypeRO")?.click();
        filled.push(stk ? `RO ${ro}/STK ${stk}` : `RO ${ro}`);
      } else if (stk) {
        // Get Ready form: fill stock, set toggle to Stock
        refEl.value = stk;
        document.getElementById("refTypeSTK")?.click();
        filled.push(`STK ${stk}`);
      }
    }

    // Fill VIN (last 8) only if field is empty
    if (vinEl && !vinEl.value.trim() && vin) {
      const vin8 = vin.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
      if (vin8.length >= 6) {
        vinEl.value = vin8;
        filled.push(`VIN …${vin8}`);
      }
    }

    if (filled.length) {
      // Open the details panel so user can see what was filled
      if (detailsPanel && detailsPanel.style.display === "none") {
        detailsPanel.style.display = "block";
        if (detailsBtn) detailsBtn.textContent = "Less";
      }
      showStatus("✓ " + filled.join("  ·  "));
      // Focus "Work Done" so the only thing left to do is type it
      setTimeout(() => typeEl?.focus(), 80);
    } else {
      showStatus("No RO, STK or VIN found — fill in manually");
      setTimeout(() => showStatus(""), 3500);
    }

    setPhotoSummaryState("Selected");

  } catch (e) {
    setPhotoSummaryState("Selected");
    const msg = e?.message || "";
    console.warn("[OCR prefill error]", msg, e);
    if (msg === "auth_expired" || e?.status === 401) {
      showStatus("Sign in on More page to enable OCR");
      setTimeout(() => showStatus(""), 4000);
      return;
    }
    if (msg.includes("timed out")) {
      showStatus("Scan timed out — fill in manually");
      setTimeout(() => showStatus(""), 3500);
      return;
    }
    showStatus(`Scan failed: ${msg.slice(0, 50) || "unknown error"}`);
    setTimeout(() => showStatus(""), 5000);
  }
}

async function autoScanPhotoAndPatch(file, entryId, currentRef, currentVin8) {
  try {
    const dataUrl = await compressImageFileToDataUrl(file, 1200, 0.75);
    const base64 = dataUrl.split(",")[1];
    const mediaType = dataUrl.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const { ro, vin, stk } = await _callScanRo(base64, mediaType);

    const patch = {};
    const found = [];

    const hasRef = !!String(currentRef || "").trim();
    if (!hasRef) {
      if (ro)       { patch.ro_number = ro;  found.push(`RO: ${ro}`);   }
      else if (stk) { patch.ro_number = stk; found.push(`STK: ${stk}`); }
    }

    const hasVin = !!String(currentVin8 || "").trim();
    if (!hasVin && vin) {
      const vin8 = vin.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
      if (vin8.length >= 6) { patch.vin8 = vin8; found.push(`VIN: ${vin8}`); }
    }

    if (!Object.keys(patch).length) return;

    const sbInstance = window.__FR?.sb;
    const uid = window.CURRENT_UID;
    if (sbInstance && entryId && uid) {
      await sbInstance.from("work_logs").update(patch).eq("id", entryId).eq("user_id", uid);
    }

    if (Array.isArray(window.CURRENT_ENTRIES)) {
      const idx = window.CURRENT_ENTRIES.findIndex(e => String(e.id) === String(entryId));
      if (idx >= 0) {
        const updated = { ...window.CURRENT_ENTRIES[idx] };
        if (patch.ro_number) {
          updated.ro_number = patch.ro_number;
          updated.ref = patch.ro_number;
          updated.ro  = patch.ro_number;
        }
        if (patch.vin8) updated.vin8 = patch.vin8;
        window.CURRENT_ENTRIES[idx] = updated;
        refreshUI?.(window.CURRENT_ENTRIES);
      }
    }

    if (found.length) toast(`Photo scanned — ${found.join(" · ")}`);
  } catch (e) {
    console.warn("[OCR]", e?.message || e);
    const msg = e?.message || "";
    // Auth/session errors are silent — user didn't ask for OCR explicitly
    if (msg === "auth_expired" || e?.status === 401 || /unauthorized/i.test(msg)) return;
    if (msg.includes("timed out")) { toast("Photo scan timed out — tap again to retry"); return; }
    // Other errors: brief console note only, not a user-facing toast
  }
}
