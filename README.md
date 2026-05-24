# The Growth Breakfast — Attendee Directory

A QR-code-driven web app for the event. A guest scans the QR code, enters the mobile
number they registered with, and — if it's on the guest list — sees the live attendee
directory. People not on the list get a short form and, once submitted, appear in the
directory **instantly for everyone**.

- **Hosting:** GitHub Pages (static, no server)
- **Verification:** guest-list match against Firestore (**no SMS — free**). An anonymous
  Firebase Auth session backs the Firestore reads/writes; it is not identity proof.
- **Database:** Cloud Firestore (live updates via real-time listeners)
- **Admin:** email/password account + an `admin` custom claim, for guest-list uploads
- **Live URL:** https://percyalgoframe.github.io/the-growth-brakfast/

---

## How it works

1. Scan QR → open the site (an anonymous Firebase session starts automatically).
2. Enter the mobile number you registered with.
3. The app looks that number up in the `attendees` collection:
   - **On the list** → see the full directory.
   - **Not on the list** → fill the "request to be added" form → you're added live and
     then see the directory. Everyone else's open directory updates in real time.

> Why no SMS OTP: Firebase Phone Auth now requires the paid Blaze plan, so this uses a
> free guest-list match instead — it checks membership, not phone ownership.

---

## One-time setup

### 1. Firebase project (free Spark plan)
1. Create a free project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method:** enable **Anonymous** (attendees) and
   **Email/Password** (admin page).
3. **Firestore Database → Create database** (Production mode).
4. **Firestore → Rules:** paste [`firestore.rules`](firestore.rules) and Publish.
5. **Authentication → Settings → Authorized domains → Add:** `percyalgoframe.github.io`
   (`localhost` is allowed by default).
6. **Project settings → Your apps → Web app** → copy the config into
   [`firebase-config.js`](firebase-config.js).

### 2. Seed the guests (data lives in Firestore, not in this repo)
The real guest list contains personal data, so **`seed/attendees.json` is git-ignored** and
never committed — the data lives only in Firestore after seeding. The repo ships
[`seed/attendees.example.json`](seed/attendees.example.json) to document the expected shape.

Create your local `seed/attendees.json` (each record: `name, email, phone` in E.164 like
`+919811636442`, `company`, `title`, `linkedin`), then:

```bash
cd seed
npm install
# Firebase console → Project settings → Service accounts → Generate new private key
# Save the downloaded file as seed/serviceAccountKey.json  (git-ignored — do NOT commit)
npm run seed
```

The seeder also makes a **best-effort** attempt to scrape each LinkedIn profile photo
(`og:image`). LinkedIn blocks most anonymous fetches, so expect a mix of real photos and
generated initials — the script prints how many real photos it captured.

### 3. Deploy to GitHub Pages
```bash
git push -u origin main          # if not already pushed
```
Then: **repo → Settings → Pages → Source = `main` / root → Save.**
The site goes live at `https://percyalgoframe.github.io/the-growth-brakfast/`.

### 4. Print the QR
Open [`qr.html`](qr.html) (locally or on the live site), confirm the URL, and click
**Download PNG**.

---

## Updating the guest list (admin page)

For the event you'll get an updated CSV/Excel. Merge it into the live directory via the
**admin page** (`…/admin.html`, unlisted / `noindex`):

1. Open `admin.html` and sign in with your admin **email + password** (must be an **admin**
   account — see below). First time, use **Create admin account**.
2. Choose the `.csv` or `.xlsx`. Columns are auto-detected (name, email, phone, company,
   title, linkedin, photo). Rows are matched by phone and **merged** — existing people are
   updated, new people added, **nobody is deleted** (self-registered sign-ups are kept).

**Admin access = a Firebase custom claim** (`admin: true`) — deliberately not stored in this
public repo. To grant it: create an account on `admin.html` (email + password), then set the
claim on that user's UID via the Admin SDK or the Identity Toolkit API (`accounts:update`
with `customAttributes={"admin":true}`). Reload `admin.html` and the claim is picked up
automatically (the page force-refreshes the token). Firestore rules (`firestore.rules`)
enforce that only `admin:true` tokens can edit other people's entries.

## Local development
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
`localhost` is an authorized Firebase domain by default, so the guest-list check and admin
sign-in work locally.

---

## Avatar fallback chain
Each card resolves its photo through: **`photoURL`** (scraped or user-supplied) →
**`unavatar.io/linkedin/<handle>`** → **initials avatar**. So a card always shows something.

## Files
| Path | Purpose |
|---|---|
| `index.html` | App shell — number lookup / directory / request-form views |
| `styles.css` | Styling |
| `app.js` | Firebase init, anonymous auth, guest-list lookup, Firestore read/write, rendering |
| `firebase-config.js` | Your Firebase web config (public by design) |
| `firestore.rules` | Security rules (auth-gated reads; self sign-up; admin-only edits) |
| `qr.html` | QR generator with PNG download |
| `admin.html` / `admin.js` | Admin-only page to upload a CSV/Excel and merge it into the directory |
| `seed/attendees.example.json` | Template showing the guest record shape (committed) |
| `seed/attendees.json` | Real guest data — **git-ignored, local only**, seeded into Firestore |
| `seed/seed.js` | One-time seeder + best-effort LinkedIn photo scrape |

---

## Privacy
The guest list (emails + phone numbers) is kept **out of this public repo**
(`seed/attendees.json` is git-ignored) and lives only in Firestore. Reads require an
(anonymous) Firebase Auth session, so the directory is a **soft gate**: anyone who opens the
site can view it, and the number entry checks list membership rather than proving ownership.
The directory shows email and phone to anyone who gets in — a deliberate choice. Tighten
`firestore.rules` / `app.js` to restrict further (e.g. hide contact fields).

## Cost
Runs entirely on Firebase's free **Spark** plan — no billing, no card. (SMS OTP would
require the paid Blaze plan, which is why verification uses a free guest-list match.)
