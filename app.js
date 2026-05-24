import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, getDocs, addDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-phone", "view-otp", "view-directory", "view-request"];
const showView = (id) => VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
const setLoading = (on) => $("loading").classList.toggle("hidden", !on);

const CONFIGURED =
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("REPLACE");

let auth, db;
let recaptcha = null;
let confirmationResult = null;
let verifiedPhone = null;
let unsub = null;
let allAttendees = [];
let booted = false;

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

function initRecaptcha() {
  recaptcha = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
}
async function resetRecaptcha() {
  try { await recaptcha.clear(); } catch (_) {}
  initRecaptcha();
}

function wireEvents() {
  $("phone-form").addEventListener("submit", onSendOtp);
  $("otp-form").addEventListener("submit", onVerifyOtp);
  $("change-number").addEventListener("click", () => { confirmationResult = null; showView("view-phone"); });
  $("sign-out").addEventListener("click", doSignOut);
  $("request-form").addEventListener("submit", onSubmitRequest);
  $("search").addEventListener("input", renderCards);
}

async function onAuthChange(user) {
  if (user && user.phoneNumber) {
    verifiedPhone = user.phoneNumber;
    $("session-phone").textContent = user.phoneNumber;
    $("session-info").classList.remove("hidden");
    // Already signed in on a fresh load (not mid OTP flow) -> route straight in.
    if (!booted && !confirmationResult) {
      booted = true;
      setLoading(true);
      try { await routeAfterAuth(); } catch (e) { console.error(e); } finally { setLoading(false); }
    }
  } else {
    booted = true;
    verifiedPhone = null;
    $("session-info").classList.add("hidden");
    showView("view-phone");
  }
}

/* ---------- phone + OTP ---------- */

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
  } finally {
    setLoading(false);
  }
}

async function onVerifyOtp(e) {
  e.preventDefault();
  $("otp-error").textContent = "";
  const code = $("otp-input").value.replace(/\D/g, "");
  if (code.length < 6) { $("otp-error").textContent = "Enter the 6-digit code."; return; }
  if (!confirmationResult) { $("otp-error").textContent = "Please request a new code."; showView("view-phone"); return; }
  setLoading(true);
  try {
    const cred = await confirmationResult.confirm(code);
    verifiedPhone = cred.user.phoneNumber;
    await routeAfterAuth();
  } catch (err) {
    console.error(err);
    $("otp-error").textContent = friendlyErr(err);
  } finally {
    setLoading(false);
  }
}

// Decide: existing guest -> directory; unknown verified number -> request form.
async function routeAfterAuth() {
  const snap = await getDocs(query(collection(db, "attendees"), where("phone", "==", verifiedPhone)));
  if (!snap.empty) {
    openDirectory();
  } else {
    $("r-phone").value = verifiedPhone;
    showView("view-request");
  }
}

async function doSignOut() {
  if (unsub) { unsub(); unsub = null; }
  allAttendees = [];
  verifiedPhone = null;
  confirmationResult = null;
  try { await signOut(auth); } catch (_) {}
  $("phone-input").value = "";
  $("otp-input").value = "";
  showView("view-phone");
}

/* ---------- request form ---------- */

async function onSubmitRequest(e) {
  e.preventDefault();
  $("request-error").textContent = "";
  if (!verifiedPhone) { $("request-error").textContent = "Please verify your number first."; return; }
  const name = $("r-name").value.trim();
  const email = $("r-email").value.trim();
  if (!name || !email) { $("request-error").textContent = "Name and email are required."; return; }

  const record = {
    name,
    email,
    phone: verifiedPhone,
    company: $("r-company").value.trim(),
    title: $("r-title").value.trim(),
    linkedin: $("r-linkedin").value.trim(),
    photoURL: $("r-photo").value.trim(),
    source: "signup",
    createdAt: serverTimestamp(),
  };
  setLoading(true);
  try {
    await addDoc(collection(db, "attendees"), record);
    openDirectory();
  } catch (err) {
    console.error(err);
    $("request-error").textContent = friendlyErr(err);
  } finally {
    setLoading(false);
  }
}

/* ---------- directory (live) ---------- */

function openDirectory() {
  showView("view-directory");
  if (unsub) return;
  unsub = onSnapshot(
    collection(db, "attendees"),
    (snap) => {
      allAttendees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      allAttendees.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderCards();
    },
    (err) => console.error("directory listener:", err)
  );
}

function renderCards() {
  const term = ($("search").value || "").toLowerCase().trim();
  const list = term
    ? allAttendees.filter((p) =>
        [p.name, p.company, p.title].filter(Boolean).join(" ").toLowerCase().includes(term))
    : allAttendees;

  $("count").textContent = `${list.length} ${list.length === 1 ? "person" : "people"}`;
  $("dir-empty").classList.toggle("hidden", list.length > 0);

  const wrap = $("cards");
  wrap.textContent = "";
  const frag = document.createDocumentFragment();
  for (const p of list) frag.appendChild(card(p));
  wrap.appendChild(frag);
}

function card(p) {
  const el = document.createElement("article");
  el.className = "card";

  const av = document.createElement("div");
  av.className = "avatar";
  setAvatar(av, p);

  const body = document.createElement("div");
  body.className = "card-body";

  const name = document.createElement("h3");
  name.textContent = p.name || "—";

  const role = document.createElement("p");
  role.className = "role";
  role.textContent = [p.title, p.company].filter(Boolean).join(" · ");

  const contacts = document.createElement("div");
  contacts.className = "contacts";
  if (p.email) contacts.appendChild(contactRow("@", p.email, "mailto:" + p.email));
  if (p.phone) contacts.appendChild(contactRow("☎", p.phone, "tel:" + p.phone));
  const li = sanitizeLinkedin(p.linkedin);
  if (li) {
    const row = contactRow("in", "LinkedIn", li);
    row.classList.add("li");
    contacts.appendChild(row);
  }

  body.append(name, role, contacts);
  el.append(av, body);
  return el;
}

function contactRow(icon, text, href) {
  const a = document.createElement("a");
  a.className = "contact";
  a.href = href;
  if (href.startsWith("http")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  const ci = document.createElement("span");
  ci.className = "ci";
  ci.textContent = icon;
  const ct = document.createElement("span");
  ct.className = "ct";
  ct.textContent = text;
  a.append(ci, ct);
  return a;
}

/* ---------- avatars: photoURL -> unavatar(linkedin) -> initials ---------- */

function setAvatar(container, p) {
  const candidates = [];
  if (p.photoURL) candidates.push(p.photoURL);
  const handle = linkedinHandle(p.linkedin);
  if (handle) candidates.push(`https://unavatar.io/linkedin/${encodeURIComponent(handle)}?fallback=false`);

  const showInitials = () => {
    container.textContent = initialsOf(p.name);
    container.style.background = colorOf(p.name || p.email || "?");
  };

  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { showInitials(); return; }
    const url = candidates[i++];
    const img = new Image();
    img.alt = p.name || "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onload = () => { container.textContent = ""; container.style.background = ""; container.appendChild(img); };
    img.onerror = tryNext;
    img.src = url;
  };
  tryNext();
}

function initialsOf(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function colorOf(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 52% 46%)`;
}

/* ---------- LinkedIn URL handling ---------- */

function linkedinHandle(url) {
  if (!url) return null;
  const m = String(url).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  const h = decodeURIComponent(m[1]).replace(/\/+$/, "").trim();
  if (h.length < 3) return null;
  if (h.toLowerCase() === "na") return null;
  return h;
}

function sanitizeLinkedin(url) {
  const h = linkedinHandle(url);
  return h ? `https://www.linkedin.com/in/${h}` : null;
}

/* ---------- errors ---------- */

function friendlyErr(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-phone-number": "That phone number looks invalid.",
    "auth/missing-phone-number": "Enter your phone number.",
    "auth/quota-exceeded": "SMS limit reached. Please try again later.",
    "auth/too-many-requests": "Too many attempts. Please wait and retry.",
    "auth/invalid-verification-code": "That code is incorrect.",
    "auth/code-expired": "That code expired. Request a new one.",
    "auth/captcha-check-failed": "Verification failed. Reload the page and retry.",
    "auth/operation-not-allowed": "Phone sign-in isn't enabled on the Firebase project yet.",
    "permission-denied": "You can only add your own verified number.",
  };
  return map[code] || (err && err.message) || "Something went wrong.";
}
