import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, getDocs, setDoc, doc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["view-phone", "view-directory", "view-request"];
const showView = (id) => VIEWS.forEach((v) => $(v).classList.toggle("hidden", v !== id));
const setLoading = (on) => $("loading").classList.toggle("hidden", !on);

const CONFIGURED =
  firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("REPLACE");

let db, authReady, enteredPhone = "", unsub = null, allAttendees = [];

if (!CONFIGURED) {
  $("config-banner").classList.remove("hidden");
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = getFirestore(app);
  // Anonymous session just lets the app read/write Firestore under the rules; it is
  // not identity verification. The guest-list match below is the actual gate.
  authReady = new Promise((resolve) => {
    onAuthStateChanged(auth, (u) => { if (u) resolve(u); });
  });
  signInAnonymously(auth).catch((e) => console.error("anon sign-in:", e));
  wireEvents();
}

function wireEvents() {
  $("phone-form").addEventListener("submit", onLookup);
  $("request-form").addEventListener("submit", onSubmitRequest);
  $("search").addEventListener("input", renderCards);
  const back = $("back-to-start");
  if (back) back.addEventListener("click", () => { showView("view-phone"); });
}

function composePhone() {
  const cc = $("country-code").value;
  const ccDigits = cc.replace(/\D/g, "");
  let national = $("phone-input").value.replace(/\D/g, "").replace(/^0+/, "");
  if (national.length > 10 && national.startsWith(ccDigits)) national = national.slice(ccDigits.length);
  return { e164: cc + national, ok: national.length >= 7 };
}

async function onLookup(e) {
  e.preventDefault();
  $("phone-error").textContent = "";
  const { e164, ok } = composePhone();
  if (!ok) { $("phone-error").textContent = "Enter a valid mobile number."; return; }
  enteredPhone = e164;
  setLoading(true);
  try {
    await authReady;
    const snap = await getDocs(query(collection(db, "attendees"), where("phone", "==", e164)));
    if (!snap.empty) {
      openDirectory();
    } else {
      $("r-phone").value = e164;
      showView("view-request");
    }
  } catch (err) {
    console.error(err);
    $("phone-error").textContent = "Something went wrong. Please try again.";
  } finally { setLoading(false); }
}

async function onSubmitRequest(e) {
  e.preventDefault();
  $("request-error").textContent = "";
  const name = $("r-name").value.trim();
  const email = $("r-email").value.trim();
  if (!name || !email) { $("request-error").textContent = "Name and email are required."; return; }
  if (!enteredPhone) { showView("view-phone"); return; }
  const id = enteredPhone.replace(/\D/g, "");
  setLoading(true);
  try {
    await authReady;
    await setDoc(doc(db, "attendees", id), {
      name, email, phone: enteredPhone,
      company: $("r-company").value.trim(),
      title: $("r-title").value.trim(),
      linkedin: $("r-linkedin").value.trim(),
      photoURL: $("r-photo").value.trim(),
      source: "signup",
      createdAt: serverTimestamp(),
    }, { merge: true });
    openDirectory();
  } catch (err) {
    console.error(err);
    $("request-error").textContent = "Couldn't add you. Please try again.";
  } finally { setLoading(false); }
}

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
  if (li) { const row = contactRow("in", "LinkedIn", li); row.classList.add("li"); contacts.appendChild(row); }
  body.append(name, role, contacts);
  el.append(av, body);
  return el;
}

function contactRow(icon, text, href) {
  const a = document.createElement("a");
  a.className = "contact";
  a.href = href;
  if (href.startsWith("http")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  const ci = document.createElement("span"); ci.className = "ci"; ci.textContent = icon;
  const ct = document.createElement("span"); ct.className = "ct"; ct.textContent = text;
  a.append(ci, ct);
  return a;
}

function setAvatar(container, p) {
  const candidates = [];
  if (p.photoURL) candidates.push(p.photoURL);
  const handle = linkedinHandle(p.linkedin);
  if (handle) candidates.push(`https://unavatar.io/linkedin/${encodeURIComponent(handle)}?fallback=false`);
  const showInitials = () => { container.textContent = initialsOf(p.name); container.style.background = colorOf(p.name || p.email || "?"); };
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { showInitials(); return; }
    const url = candidates[i++];
    const img = new Image();
    img.alt = p.name || ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.onload = () => { container.textContent = ""; container.style.background = ""; container.appendChild(img); };
    img.onerror = tryNext;
    img.src = url;
  };
  tryNext();
}

function initialsOf(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function colorOf(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 52% 46%)`; }

function linkedinHandle(url) {
  if (!url) return null;
  const m = String(url).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  const h = decodeURIComponent(m[1]).replace(/\/+$/, "").trim();
  if (h.length < 3 || h.toLowerCase() === "na") return null;
  return h;
}
function sanitizeLinkedin(url) { const h = linkedinHandle(url); return h ? `https://www.linkedin.com/in/${h}` : null; }
