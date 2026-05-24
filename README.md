# The Growth Breakfast — Attendee Directory

A QR-code-driven web app for the event. A guest scans the QR code, verifies their
mobile number via **SMS one-time code**, and sees the live attendee directory. People
not on the guest list get a short form and, once submitted, appear in the directory
**instantly for everyone**.

- **Hosting:** GitHub Pages (static, no server)
- **Auth:** Firebase Phone Authentication (SMS OTP)
- **Database:** Cloud Firestore (live updates via real-time listeners)
- **Live URL (after deploy):** https://percyalgoframe.github.io/the-growth-brakfast/

---

## How it works

1. Scan QR → open the site.
2. Enter mobile number → receive an SMS code → enter it.
3. The app checks whether that verified number is in the `attendees` collection:
   - **On the list** → see the full directory.
   - **Not on the list** → fill the "request to be added" form → you're added live and
     then see the directory. Everyone else's open directory updates in real time.

> Note: OTP proves you own the phone number; it does not prove you were invited. The
> guest-list lookup is what distinguishes existing guests from new sign-ups.

---

## One-time setup

### 1. Firebase project
1. Create a free project at <https://console.firebase.google.com>.
2. **Build → Authentication → Sign-in method → Phone → Enable.**
3. **Build → Firestore Database → Create database** (Production mode).
4. **Firestore → Rules:** paste the contents of [`firestore.rules`](firestore.rules) and Publish.
5. **Authentication → Settings → Authorized domains → Add domain:** `percyalgoframe.github.io`
   (`localhost` is already allowed for local testing).
6. **Project settings → General → Your apps → Web app** (create one if needed) →
   copy the config values into [`firebase-config.js`](firebase-config.js).

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

## Local development
```bash
python3 -m http.server 8000
# open http://localhost:8000
```
`localhost` is an authorized Firebase domain by default, so OTP works locally with a real
phone you control.

---

## Avatar fallback chain
Each card resolves its photo through: **`photoURL`** (scraped or user-supplied) →
**`unavatar.io/linkedin/<handle>`** → **initials avatar**. So a card always shows something.

## Files
| Path | Purpose |
|---|---|
| `index.html` | App shell — phone / OTP / directory / request-form views |
| `styles.css` | Styling |
| `app.js` | Firebase init, OTP flow, Firestore read/write, rendering |
| `firebase-config.js` | Your Firebase web config (public by design) |
| `firestore.rules` | Security rules (OTP-gated reads; self-only writes) |
| `qr.html` | QR generator with PNG download |
| `seed/attendees.example.json` | Template showing the guest record shape (committed) |
| `seed/attendees.json` | Real guest data — **git-ignored, local only**, seeded into Firestore |
| `seed/seed.js` | One-time seeder + best-effort LinkedIn photo scrape |

---

## Privacy
The guest list (emails + phone numbers) is intentionally kept **out of this public repo**
(`seed/attendees.json` is git-ignored) and lives only in Firestore, where
[`firestore.rules`](firestore.rules) require SMS verification before any read. The directory
then displays email and phone to verified users — a deliberate choice. Tighten
`firestore.rules` and the card rendering in `app.js` if you later want to restrict what's
shown even to verified users.

## Cost
Firebase Phone Auth includes a free daily SMS quota that comfortably covers an event of
this size. Very high volume may require the Blaze (pay-as-you-go) plan.
