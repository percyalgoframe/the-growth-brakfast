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
  restoreSession();
}

async function restoreSession() {
  let saved = null;
  try { saved = localStorage.getItem("gb_phone"); } catch (_) {}
  if (!saved) return;
  enteredPhone = saved;
  setLoading(true);
  try {
    await authReady;
    const snap = await getDocs(query(collection(db, "attendees"), where("phone", "==", saved)));
    if (!snap.empty) openDirectory();
    else { try { localStorage.removeItem("gb_phone"); } catch (_) {} }
  } catch (err) { console.error(err); }
  finally { setLoading(false); }
}

function wireEvents() {
  $("phone-form").addEventListener("submit", onLookup);
  $("request-form").addEventListener("submit", onSubmitRequest);
  $("search").addEventListener("input", onSearch);
  const clear = $("search-clear");
  if (clear) clear.addEventListener("click", clearSearch);
  const back = $("back-to-start");
  if (back) back.addEventListener("click", () => {
    try { localStorage.removeItem("gb_phone"); } catch (_) {}
    if (unsub) { unsub(); unsub = null; }
    $("phone-input").value = "";
    showView("view-phone");
  });
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
      try { localStorage.setItem("gb_phone", e164); } catch (_) {}
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
    try { localStorage.setItem("gb_phone", enteredPhone); } catch (_) {}
    openDirectory();
  } catch (err) {
    console.error(err);
    $("request-error").textContent = "Couldn't add you. Please try again.";
  } finally { setLoading(false); }
}

function renderSkeletons(n = 6) {
  const wrap = $("cards");
  wrap.textContent = "";
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "card skeleton";
    const av = document.createElement("div"); av.className = "sk-av";
    const body = document.createElement("div"); body.className = "sk-body";
    for (const w of ["w60", "w40", "w80"]) {
      const l = document.createElement("div"); l.className = "sk-line " + w; body.appendChild(l);
    }
    c.append(av, body);
    wrap.appendChild(c);
  }
}

function openDirectory() {
  showView("view-directory");
  if (unsub) return;
  renderSkeletons();
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

function onSearch() {
  $("search-clear").classList.toggle("hidden", !$("search").value);
  renderCards();
}

function clearSearch() {
  $("search").value = "";
  $("search-clear").classList.add("hidden");
  renderCards();
  $("search").focus();
}

function renderCards() {
  const raw = ($("search").value || "").trim();
  const term = raw.toLowerCase();
  const dterm = raw.replace(/\D/g, "");
  const list = !term ? allAttendees : allAttendees.filter((p) => {
    const hay = [p.name, p.company, p.title, p.email, p.phone].filter(Boolean).join(" ").toLowerCase();
    if (hay.includes(term)) return true;
    if (dterm && (p.phone || "").replace(/\D/g, "").includes(dterm)) return true;
    return false;
  });
  $("count").textContent = `${list.length} ${list.length === 1 ? "person" : "people"}`;
  $("dir-empty").classList.toggle("hidden", list.length > 0);
  const wrap = $("cards");
  wrap.textContent = "";
  const frag = document.createDocumentFragment();
  for (const p of list) frag.appendChild(card(p));
  wrap.appendChild(frag);
}

const ICONS = {
  save: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
  wa: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.477-.917zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>',
  li: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>',
};

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
  body.append(name, role, buildActions(p));
  el.append(av, body);
  return el;
}

// Three consistent actions per card: Save contact (vCard), WhatsApp, LinkedIn.
function buildActions(p) {
  const wrap = document.createElement("div");
  wrap.className = "card-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "act act-save";
  save.innerHTML = ICONS.save + "<span>Save contact</span>";
  save.addEventListener("click", () => saveContact(p));
  wrap.appendChild(save);

  const digits = (p.phone || "").replace(/\D/g, "");
  if (digits.length >= 8) {
    const wa = document.createElement("a");
    wa.className = "act act-wa";
    wa.href = "https://wa.me/" + digits;
    wa.target = "_blank"; wa.rel = "noopener noreferrer";
    wa.innerHTML = ICONS.wa + "<span>WhatsApp</span>";
    wrap.appendChild(wa);
  }

  const li = sanitizeLinkedin(p.linkedin);
  if (li) {
    const a = document.createElement("a");
    a.className = "act act-li";
    a.href = li; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.innerHTML = ICONS.li + "<span>LinkedIn</span>";
    wrap.appendChild(a);
  }
  return wrap;
}

function vcardEscape(s) {
  return String(s || "").replace(/[\\,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
}

function buildVCard(p) {
  const name = (p.name || "").trim();
  const parts = name.split(/\s+/);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
    `FN:${vcardEscape(name)}`,
  ];
  if (p.company) lines.push(`ORG:${vcardEscape(p.company)}`);
  if (p.title) lines.push(`TITLE:${vcardEscape(p.title)}`);
  if (p.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(p.phone)}`);
  if (p.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(p.email)}`);
  const li = sanitizeLinkedin(p.linkedin);
  if (li) lines.push(`URL:${vcardEscape(li)}`);
  lines.push("NOTE:Met at The Growth Breakfast");
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function saveContact(p) {
  const blob = new Blob([buildVCard(p)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(p.name || "contact").replace(/[^\w.-]+/g, "_")}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function setAvatar(container, p) {
  // Show initials immediately so a card is never blank, then upgrade to a real
  // photo only if one actually loads (external services may hang, not error).
  container.textContent = initialsOf(p.name);
  container.style.background = colorOf(p.name || p.email || "?");
  const candidates = [];
  if (p.photoURL) candidates.push(p.photoURL);
  const handle = linkedinHandle(p.linkedin);
  if (handle) candidates.push(`https://unavatar.io/linkedin/${encodeURIComponent(handle)}?fallback=false`);
  if (p.email && /\S+@\S+\.\S+/.test(p.email)) candidates.push(`https://unavatar.io/${encodeURIComponent(p.email)}?fallback=false`);
  if (!candidates.length) return;
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) return; // keep initials
    const url = candidates[i++];
    const img = new Image();
    img.alt = p.name || ""; img.referrerPolicy = "no-referrer";
    img.onload = () => { container.textContent = ""; container.style.background = ""; container.appendChild(img); };
    img.onerror = tryNext;
    img.src = url;
  };
  // Lazy: only request when the card nears the viewport, so we don't fire all
  // avatar requests at once (the service rate-limits bursts → 429 → no photo).
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries, obs) => {
      if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); tryNext(); }
    }, { rootMargin: "300px" });
    io.observe(container);
  } else {
    tryNext();
  }
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
