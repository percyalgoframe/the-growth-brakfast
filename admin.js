import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp, collection, query, where, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-signin", "view-denied", "view-admin"];
const showView = (id) => VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
const setLoading = (on) => $("loading").classList.toggle("hidden", !on);

const CONFIGURED =
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("REPLACE");

let auth, db, booted = false, parsedRecords = [];

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
  $("create-btn").addEventListener("click", onCreate);
  $("sign-out").addEventListener("click", doSignOut);
  $("denied-signout").addEventListener("click", doSignOut);
  $("file-input").addEventListener("change", onFile);
  $("upload-btn").addEventListener("click", onUpload);
  $("tab-checkins").addEventListener("click", () => switchTab("checkins"));
  $("tab-upload").addEventListener("click", () => switchTab("upload"));
  $("checkin-date").addEventListener("change", () => loadCheckins($("checkin-date").value || todayStr()));
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

async function onCreate() {
  $("signin-error").textContent = "";
  const email = $("admin-email").value.trim();
  const pw = $("admin-password").value;
  if (!email || pw.length < 6) { $("signin-error").textContent = "Enter an email and a password (min 6 chars)."; return; }
  setLoading(true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
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
  const ci = which === "checkins";
  $("tab-checkins").classList.toggle("active", ci);
  $("tab-upload").classList.toggle("active", !ci);
  $("panel-checkins").classList.toggle("hidden", !ci);
  $("panel-upload").classList.toggle("hidden", ci);
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
  parsedRecords = [];
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
  const file = e.target.files[0];
  if (!file) return;
  setLoading(true);
  try {
    const rows = await readWorkbook(file);
    const { records, skipped, map } = toRecords(rows);
    parsedRecords = records;
    if (!records.length) {
      $("admin-error").textContent = "No valid rows found (need at least a name and phone column).";
      $("parse-summary").classList.add("hidden");
      $("preview-wrap").classList.add("hidden");
      $("upload-btn").classList.add("hidden");
      return;
    }
    const cols = Object.entries(map).filter(([, v]) => v >= 0).map(([k]) => k).join(", ");
    $("parse-summary").textContent =
      `${records.length} valid rows ready` + (skipped ? `, ${skipped} skipped (missing name/phone)` : "") +
      `. Detected columns: ${cols}.`;
    $("parse-summary").classList.remove("hidden");
    renderPreview(records.slice(0, 3));
    $("upload-btn").classList.remove("hidden");
    $("upload-btn").textContent = `Merge ${records.length} into directory`;
  } catch (err) {
    console.error(err);
    $("admin-error").textContent = "Could not read that file. Use a .csv or .xlsx export.";
  } finally { setLoading(false); }
}

function renderPreview(recs) {
  const table = $("preview");
  table.textContent = "";
  const cols = ["name", "phone", "company", "title"];
  const thead = document.createElement("tr");
  for (const c of cols) { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); }
  table.appendChild(thead);
  for (const rec of recs) {
    const tr = document.createElement("tr");
    for (const c of cols) { const td = document.createElement("td"); td.textContent = rec[c] || "—"; tr.appendChild(td); }
    table.appendChild(tr);
  }
  $("preview-wrap").classList.remove("hidden");
}

/* ---------- upload (merge) ---------- */

async function onUpload() {
  if (!parsedRecords.length) return;
  $("admin-error").textContent = "";
  $("admin-result").textContent = "";
  $("upload-btn").disabled = true;
  setLoading(true);
  let ok = 0, fail = 0;
  for (const rec of parsedRecords) {
    const id = rec.phone.replace(/\D/g, "");
    try {
      const data = {
        name: rec.name, email: rec.email, phone: rec.phone,
        company: rec.company, title: rec.title, linkedin: rec.linkedin,
        source: "import", createdAt: serverTimestamp(),
      };
      // Only set photoURL when the upload actually provides one, so a merge never
      // wipes an existing cached photo.
      if (rec.photoURL) data.photoURL = rec.photoURL;
      await setDoc(doc(db, "attendees", id), data, { merge: true });
      ok++;
    } catch (err) { console.error("row failed:", rec.name, err); fail++; }
  }
  setLoading(false);
  $("upload-btn").disabled = false;
  $("admin-result").textContent = `Done — ${ok} merged${fail ? `, ${fail} failed (see console)` : ""}. The live directory updates instantly.`;
  if (fail && !ok) $("admin-error").textContent = "Upload failed. Confirm your account has admin access.";
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
