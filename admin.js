import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs, onSnapshot, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-signin", "view-denied", "view-admin"];
const showView = (id) => VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
const setLoading = (on) => $("loading").classList.toggle("hidden", !on);

const CONFIGURED =
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("REPLACE");

let auth, db, booted = false;
let diff = null;            // current import diff (computed from a chosen file)
let allPeople = [];         // live attendees, for the People tab
let peopleUnsub = null, peopleStarted = false;
let editingId = null;       // doc id being edited in the modal (null = adding)

if (!CONFIGURED) {
  $("config-banner").classList.remove("hidden");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  wireEvents();
  onAuthStateChanged(auth, onAuthChange);
}

function wireEvents() {
  $("signin-form").addEventListener("submit", onSignIn);
  $("sign-out").addEventListener("click", doSignOut);
  $("denied-signout").addEventListener("click", doSignOut);
  $("file-input").addEventListener("change", onFile);
  $("tab-checkins").addEventListener("click", () => switchTab("checkins"));
  $("tab-people").addEventListener("click", () => switchTab("people"));
  $("tab-import").addEventListener("click", () => switchTab("import"));
  $("checkin-date").addEventListener("change", () => loadCheckins($("checkin-date").value || todayStr()));
  $("people-search").addEventListener("input", renderPeople);
  $("add-person-btn").addEventListener("click", () => openPersonModal(null));
  $("person-form").addEventListener("submit", onSavePerson);
  $("pf-cancel").addEventListener("click", closePersonModal);
}

async function onAuthChange(user) {
  // Ignore anonymous sessions (carried over from the attendee directory) — the
  // admin page requires a real email/password sign-in.
  if (user && !user.isAnonymous) {
    $("session-phone").textContent = user.email || "";
    $("session-info").classList.remove("hidden");
    if (!booted) { booted = true; setLoading(true); try { await checkAdmin(user); } finally { setLoading(false); } }
  } else {
    booted = true;
    $("session-info").classList.add("hidden");
    showView("view-signin");
  }
}

async function onSignIn(e) {
  e.preventDefault();
  $("signin-error").textContent = "";
  const email = $("admin-email").value.trim();
  const pw = $("admin-password").value;
  if (!email || pw.length < 6) { $("signin-error").textContent = "Enter your email and password (min 6 chars)."; return; }
  setLoading(true);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    await checkAdmin(cred.user);
  } catch (err) { console.error(err); $("signin-error").textContent = friendlyErr(err); }
  finally { setLoading(false); }
}

async function checkAdmin(user) {
  const r = await user.getIdTokenResult(true); // force refresh to pick up a newly-granted claim
  if (r.claims && r.claims.admin === true) {
    showAdmin();
  } else {
    $("denied-phone").textContent = user.email || "";
    showView("view-denied");
  }
}

/* ---------- admin home: check-ins ---------- */

let adminReady = false;
function showAdmin() {
  showView("view-admin");
  if (adminReady) return;
  adminReady = true;
  const today = todayStr();
  $("checkin-date").value = today;
  $("checkin-date").max = today;
  switchTab("checkins");
  loadCheckins(today);
}

function switchTab(which) {
  for (const t of ["checkins", "people", "import"]) {
    $("tab-" + t).classList.toggle("active", t === which);
    $("panel-" + t).classList.toggle("hidden", t !== which);
  }
  if (which === "people") startPeople();
}

async function loadCheckins(date) {
  const listEl = $("checkin-list");
  listEl.textContent = "";
  $("checkin-empty").classList.add("hidden");
  $("checkin-count").textContent = "…";
  try {
    const snap = await getDocs(query(collection(db, "checkins"), where("date", "==", date)));
    const rows = snap.docs.map((d) => d.data());
    rows.sort((a, b) => msOf(b.lastAt) - msOf(a.lastAt));
    const today = date === todayStr();
    $("checkin-count").innerHTML = `${rows.length}<small>checked in${today ? " today" : ""}</small>`;
    if (!rows.length) { $("checkin-empty").classList.remove("hidden"); return; }
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.appendChild(checkinRow(r));
    listEl.appendChild(frag);
  } catch (err) {
    console.error("checkins:", err);
    $("checkin-count").textContent = "—";
    $("checkin-empty").textContent = "Couldn't load check-ins.";
    $("checkin-empty").classList.remove("hidden");
  }
}

function checkinRow(r) {
  const row = document.createElement("div");
  row.className = "checkin-row";
  const av = document.createElement("div");
  av.className = "checkin-av";
  av.textContent = initials(r.name);
  av.style.background = colorOf(r.name || r.phone || "?");
  const name = document.createElement("div");
  name.className = "checkin-name";
  name.textContent = r.name || r.phone || "—";
  if (r.count > 1) {
    const b = document.createElement("span");
    b.className = "checkin-badge";
    b.textContent = "×" + r.count;
    name.appendChild(b);
  }
  const time = document.createElement("div");
  time.className = "checkin-time";
  time.textContent = r.lastAt && r.lastAt.toDate
    ? r.lastAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  row.append(av, name, time);
  return row;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function msOf(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }
function initials(name) {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function colorOf(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 38% 52%)`; }

async function doSignOut() {
  diff = null;
  if (peopleUnsub) { peopleUnsub(); peopleUnsub = null; }
  peopleStarted = false; allPeople = [];
  try { await signOut(auth); } catch (_) {}
  $("admin-password").value = "";
  $("file-input").value = "";
  showView("view-signin");
}

/* ---------- file parsing ---------- */

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function mapColumns(headers) {
  const h = headers.map((x) => String(x || "").toLowerCase().trim());
  const find = (...keys) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  return {
    name: find("name"),
    email: find("email", "e-mail"),
    phone: find("phone", "mobile", "number", "contact"),
    company: find("company", "organi"),
    title: find("title", "job", "designation", "role"),
    linkedin: find("linkedin", "profile"),
    photo: find("photo", "image", "picture", "avatar"),
  };
}

function normPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1);
  else if (d.length === 10) d = "91" + d;
  return "+" + d;
}

function toRecords(rows) {
  if (!rows.length) return { records: [], skipped: 0, map: {} };
  const map = mapColumns(rows[0]);
  const get = (r, idx) => (idx >= 0 ? String(r[idx] ?? "").trim() : "");
  const records = []; let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const phone = normPhone(get(r, map.phone));
    const name = get(r, map.name);
    if (!name || phone.length < 8) { if (r.join("").trim()) skipped++; continue; }
    records.push({
      name, email: get(r, map.email), phone,
      company: get(r, map.company), title: get(r, map.title),
      linkedin: get(r, map.linkedin), photoURL: get(r, map.photo),
    });
  }
  return { records, skipped, map };
}

async function onFile(e) {
  $("admin-error").textContent = "";
  $("admin-result").textContent = "";
  $("diff").classList.add("hidden");
  const file = e.target.files[0];
  if (!file) return;
  setLoading(true);
  try {
    const rows = await readWorkbook(file);
    const { records, skipped, map } = toRecords(rows);
    if (!records.length) {
      $("admin-error").textContent = "No valid rows found (need at least a name and phone column).";
      $("parse-summary").classList.add("hidden");
      return;
    }
    const cols = Object.entries(map).filter(([, v]) => v >= 0).map(([k]) => k).join(", ");
    $("parse-summary").textContent =
      `${records.length} rows read` + (skipped ? `, ${skipped} skipped (missing name/phone)` : "") + `. Columns: ${cols}.`;
    $("parse-summary").classList.remove("hidden");
    diff = await computeDiff(records);
    renderDiff(diff);
  } catch (err) {
    console.error(err);
    $("admin-error").textContent = "Could not read that file. Use a .csv or .xlsx export.";
  } finally { setLoading(false); }
}

/* ---------- import diff ---------- */

const DIFF_FIELDS = ["name", "email", "company", "title", "linkedin"];

async function computeDiff(records) {
  const snap = await getDocs(collection(db, "attendees"));
  const current = new Map();
  snap.forEach((d) => current.set(d.id, d.data()));
  const fileIds = new Set();
  const add = [], update = [], unchanged = [];
  for (const r of records) {
    const id = r.phone.replace(/\D/g, "");
    if (!id) continue;
    fileIds.add(id);
    const cur = current.get(id);
    if (!cur) { add.push({ id, rec: r }); continue; }
    const changed = DIFF_FIELDS.filter((k) => (cur[k] || "") !== (r[k] || ""));
    if (changed.length) update.push({ id, rec: r, changed }); else unchanged.push({ id, rec: r });
  }
  const remove = [], kept = [];
  current.forEach((data, id) => {
    if (fileIds.has(id)) return;
    if (data.source === "signup") kept.push({ id, data }); else remove.push({ id, data });
  });
  return { add, update, unchanged, remove, kept };
}

function diffSection(kind, title, names) {
  const sec = document.createElement("div");
  sec.className = "diff-sec diff-" + kind;
  const head = document.createElement("div");
  head.className = "diff-sec-head";
  head.textContent = `${title} · ${names.length}`;
  sec.appendChild(head);
  if (names.length) {
    const body = document.createElement("div");
    body.className = "diff-names";
    body.textContent = names.slice(0, 60).join(", ") + (names.length > 60 ? `, +${names.length - 60} more` : "");
    sec.appendChild(body);
  }
  return sec;
}

function renderDiff(d) {
  const wrap = $("diff");
  wrap.textContent = "";
  wrap.classList.remove("hidden");
  wrap.appendChild(diffSection("add", "To add", d.add.map((x) => x.rec.name)));
  wrap.appendChild(diffSection("update", "To update", d.update.map((x) => `${x.rec.name} (${x.changed.join(", ")})`)));
  if (d.remove.length) wrap.appendChild(diffSection("remove", "In directory, not in file", d.remove.map((x) => x.data.name || x.id)));
  if (d.kept.length) wrap.appendChild(diffSection("kept", "Self-registered (kept)", d.kept.map((x) => x.data.name || x.id)));

  const u = document.createElement("p");
  u.className = "muted"; u.style.margin = "10px 0 0";
  u.textContent = `${d.unchanged.length} unchanged.`;
  wrap.appendChild(u);

  let removeToggle = null;
  if (d.remove.length) {
    const lab = document.createElement("label");
    lab.className = "diff-remove-toggle";
    removeToggle = document.createElement("input");
    removeToggle.type = "checkbox";
    lab.appendChild(removeToggle);
    lab.appendChild(document.createTextNode(` Also remove ${d.remove.length} guest${d.remove.length > 1 ? "s" : ""} not in this file`));
    wrap.appendChild(lab);
  }

  const actions = document.createElement("div");
  actions.className = "row"; actions.style.marginTop = "16px";
  const apply = document.createElement("button");
  apply.className = "btn primary"; apply.textContent = "Apply changes";
  if (!d.add.length && !d.update.length && !d.remove.length) { apply.disabled = true; apply.textContent = "No changes"; }
  apply.addEventListener("click", () => applyDiff(removeToggle && removeToggle.checked));
  const cancel = document.createElement("button");
  cancel.className = "btn"; cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    diff = null; wrap.classList.add("hidden"); $("parse-summary").classList.add("hidden"); $("file-input").value = "";
  });
  actions.append(apply, cancel);
  wrap.appendChild(actions);
}

async function applyDiff(doRemove) {
  if (!diff) return;
  $("admin-error").textContent = "";
  setLoading(true);
  try {
    const batch = writeBatch(db);
    for (const { id, rec } of diff.add) {
      const data = { name: rec.name, email: rec.email, phone: rec.phone, company: rec.company, title: rec.title, linkedin: rec.linkedin, source: "import", createdAt: serverTimestamp() };
      if (rec.photoURL) data.photoURL = rec.photoURL;
      batch.set(doc(db, "attendees", id), data, { merge: true });
    }
    for (const { id, rec } of diff.update) {
      const data = { name: rec.name, email: rec.email, phone: rec.phone, company: rec.company, title: rec.title, linkedin: rec.linkedin };
      if (rec.photoURL) data.photoURL = rec.photoURL;
      batch.set(doc(db, "attendees", id), data, { merge: true });
    }
    let removed = 0;
    if (doRemove) for (const { id } of diff.remove) { batch.delete(doc(db, "attendees", id)); removed++; }
    await batch.commit();
    const a = diff.add.length, up = diff.update.length;
    $("diff").classList.add("hidden");
    $("parse-summary").classList.add("hidden");
    $("file-input").value = "";
    diff = null;
    $("admin-result").textContent = `Done — ${a} added · ${up} updated${removed ? ` · ${removed} removed` : ""}. Live directory updated.`;
  } catch (err) {
    console.error(err);
    $("admin-error").textContent = friendlyErr(err);
  } finally { setLoading(false); }
}

/* ---------- People: manual management ---------- */

function startPeople() {
  if (peopleStarted) return;
  peopleStarted = true;
  $("people-count").textContent = "Loading…";
  peopleUnsub = onSnapshot(collection(db, "attendees"), (snap) => {
    allPeople = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allPeople.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderPeople();
  }, (err) => { console.error("people:", err); $("people-count").textContent = "Couldn't load people."; });
}

function renderPeople() {
  const term = ($("people-search").value || "").toLowerCase().trim();
  const dterm = term.replace(/\D/g, "");
  const list = !term ? allPeople : allPeople.filter((p) => {
    if ([p.name, p.company, p.title, p.email].filter(Boolean).join(" ").toLowerCase().includes(term)) return true;
    if (dterm && (p.phone || "").replace(/\D/g, "").includes(dterm)) return true;
    return false;
  });
  $("people-count").textContent = `${list.length} ${list.length === 1 ? "person" : "people"}`;
  const wrap = $("people-list");
  wrap.textContent = "";
  const frag = document.createDocumentFragment();
  for (const p of list) frag.appendChild(personRow(p));
  wrap.appendChild(frag);
}

function personRow(p) {
  const row = document.createElement("div");
  row.className = "person-row";
  const av = document.createElement("div");
  av.className = "person-av";
  av.textContent = initials(p.name);
  av.style.background = colorOf(p.name || p.phone || "?");
  if (p.photoURL) {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => { av.textContent = ""; av.style.background = ""; av.appendChild(img); };
    img.src = p.photoURL;
  }
  const meta = document.createElement("div");
  meta.className = "person-meta";
  const nm = document.createElement("div"); nm.className = "person-name"; nm.textContent = p.name || "—";
  const sub = document.createElement("div"); sub.className = "person-sub"; sub.textContent = [p.company, p.phone].filter(Boolean).join(" · ");
  meta.append(nm, sub);
  const acts = document.createElement("div");
  acts.className = "person-acts";
  const edit = document.createElement("button"); edit.className = "act"; edit.textContent = "Edit"; edit.addEventListener("click", () => openPersonModal(p));
  const rm = document.createElement("button"); rm.className = "act act-danger"; rm.textContent = "Remove"; rm.addEventListener("click", () => removePerson(p));
  acts.append(edit, rm);
  row.append(av, meta, acts);
  return row;
}

function openPersonModal(p) {
  editingId = p ? p.id : null;
  $("person-modal-title").textContent = p ? "Edit attendee" : "Add attendee";
  $("pf-name").value = p ? (p.name || "") : "";
  $("pf-email").value = p ? (p.email || "") : "";
  $("pf-phone").value = p ? (p.phone || "") : "";
  $("pf-company").value = p ? (p.company || "") : "";
  $("pf-title").value = p ? (p.title || "") : "";
  $("pf-linkedin").value = p ? (p.linkedin || "") : "";
  $("pf-photo").value = p ? (p.photoURL || "") : "";
  $("pf-phone").disabled = !!p;
  $("pf-phone-hint").textContent = p ? "(can't change)" : "";
  $("pf-error").textContent = "";
  $("person-modal").classList.remove("hidden");
  $("pf-name").focus();
}

function closePersonModal() { $("person-modal").classList.add("hidden"); editingId = null; }

async function onSavePerson(e) {
  e.preventDefault();
  $("pf-error").textContent = "";
  const name = $("pf-name").value.trim();
  if (!name) { $("pf-error").textContent = "Name is required."; return; }
  let id, phone;
  if (editingId) { id = editingId; phone = $("pf-phone").value.trim(); }
  else {
    phone = normPhone($("pf-phone").value.trim());
    id = phone.replace(/\D/g, "");
    if (id.length < 8) { $("pf-error").textContent = "Enter a valid mobile number."; return; }
  }
  const data = {
    name, email: $("pf-email").value.trim(), phone,
    company: $("pf-company").value.trim(), title: $("pf-title").value.trim(),
    linkedin: $("pf-linkedin").value.trim(), photoURL: $("pf-photo").value.trim(),
  };
  if (!editingId) { data.source = "manual"; data.createdAt = serverTimestamp(); }
  setLoading(true);
  try {
    await setDoc(doc(db, "attendees", id), data, { merge: true });
    closePersonModal();
  } catch (err) { console.error(err); $("pf-error").textContent = friendlyErr(err); }
  finally { setLoading(false); }
}

async function removePerson(p) {
  if (!confirm(`Remove ${p.name || p.phone} from the directory?`)) return;
  setLoading(true);
  try { await deleteDoc(doc(db, "attendees", p.id)); }
  catch (err) { console.error(err); $("admin-error").textContent = "Couldn't remove: " + friendlyErr(err); }
  finally { setLoading(false); }
}

/* ---------- errors ---------- */

function friendlyErr(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-email": "Enter a valid email.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/email-already-in-use": "That email already has an account — use Sign in.",
    "auth/too-many-requests": "Too many attempts. Please wait and retry.",
    "permission-denied": "Your account isn't authorized to upload.",
  };
  return map[code] || (err && err.message) || "Something went wrong.";
}
