import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-phone", "view-otp", "view-denied", "view-admin"];
const showView = (id) => VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
const setLoading = (on) => $("loading").classList.toggle("hidden", !on);

const CONFIGURED =
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("REPLACE");

let auth, db, recaptcha = null, confirmationResult = null, booted = false;
let parsedRecords = [];

if (!CONFIGURED) {
  $("config-banner").classList.remove("hidden");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  initRecaptcha();
  wireEvents();
  onAuthStateChanged(auth, onAuthChange);
}

function initRecaptcha() { recaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" }); }
async function resetRecaptcha() { try { await recaptcha.clear(); } catch (_) {} initRecaptcha(); }

function wireEvents() {
  $("phone-form").addEventListener("submit", onSendOtp);
  $("otp-form").addEventListener("submit", onVerifyOtp);
  $("change-number").addEventListener("click", () => { confirmationResult = null; showView("view-phone"); });
  $("sign-out").addEventListener("click", doSignOut);
  $("denied-signout").addEventListener("click", doSignOut);
  $("file-input").addEventListener("change", onFile);
  $("upload-btn").addEventListener("click", onUpload);
}

async function onAuthChange(user) {
  if (user && user.phoneNumber) {
    $("session-phone").textContent = user.phoneNumber;
    $("session-info").classList.remove("hidden");
    if (!booted && !confirmationResult) { booted = true; setLoading(true); try { await checkAdmin(user); } finally { setLoading(false); } }
  } else {
    booted = true;
    $("session-info").classList.add("hidden");
    showView("view-phone");
  }
}

/* ---------- auth ---------- */

function composePhone() {
  const cc = $("country-code").value;
  const ccDigits = cc.replace(/\D/g, "");
  let national = $("phone-input").value.replace(/\D/g, "").replace(/^0+/, "");
  if (national.length > 10 && national.startsWith(ccDigits)) national = national.slice(ccDigits.length);
  return { e164: cc + national, ok: national.length >= 7 };
}

async function onSendOtp(e) {
  e.preventDefault();
  $("phone-error").textContent = "";
  const { e164, ok } = composePhone();
  if (!ok) { $("phone-error").textContent = "Enter a valid mobile number."; return; }
  setLoading(true);
  try {
    confirmationResult = await signInWithPhoneNumber(auth, e164, recaptcha);
    $("otp-target").textContent = e164;
    $("otp-input").value = "";
    showView("view-otp");
    $("otp-input").focus();
  } catch (err) {
    console.error(err);
    $("phone-error").textContent = friendlyErr(err);
    await resetRecaptcha();
  } finally { setLoading(false); }
}

async function onVerifyOtp(e) {
  e.preventDefault();
  $("otp-error").textContent = "";
  const code = $("otp-input").value.replace(/\D/g, "");
  if (code.length < 6) { $("otp-error").textContent = "Enter the 6-digit code."; return; }
  if (!confirmationResult) { showView("view-phone"); return; }
  setLoading(true);
  try {
    const cred = await confirmationResult.confirm(code);
    await checkAdmin(cred.user);
  } catch (err) {
    console.error(err);
    $("otp-error").textContent = friendlyErr(err);
  } finally { setLoading(false); }
}

async function checkAdmin(user) {
  const r = await user.getIdTokenResult(true); // force refresh to pick up a newly-granted claim
  if (r.claims && r.claims.admin === true) {
    showView("view-admin");
  } else {
    $("denied-phone").textContent = user.phoneNumber || "";
    showView("view-denied");
  }
}

async function doSignOut() {
  confirmationResult = null;
  parsedRecords = [];
  try { await signOut(auth); } catch (_) {}
  $("phone-input").value = ""; $("otp-input").value = "";
  $("file-input").value = "";
  showView("view-phone");
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
      await setDoc(doc(db, "attendees", id), {
        name: rec.name, email: rec.email, phone: rec.phone,
        company: rec.company, title: rec.title, linkedin: rec.linkedin,
        photoURL: rec.photoURL || "", source: "import", createdAt: serverTimestamp(),
      }, { merge: true });
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
    "auth/invalid-phone-number": "That phone number looks invalid.",
    "auth/too-many-requests": "Too many attempts. Please wait and retry.",
    "auth/invalid-verification-code": "That code is incorrect.",
    "auth/code-expired": "That code expired. Request a new one.",
    "auth/operation-not-allowed": "Phone sign-in isn't enabled on the project.",
    "permission-denied": "Your account isn't authorized to upload.",
  };
  return map[code] || (err && err.message) || "Something went wrong.";
}
