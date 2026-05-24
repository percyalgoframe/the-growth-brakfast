// One-time seeder for the attendee directory.
// Loads seed/attendees.json into Firestore and makes a best-effort attempt to
// scrape each LinkedIn profile's og:image. Re-runnable (uses phone as doc id).
//
//   cd seed
//   npm install
//   # place serviceAccountKey.json here (Firebase console → Service accounts)
//   npm run seed
//
// Requires Node 18+ (uses the global fetch API).

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(keyPath)) {
  console.error(
    "Missing seed/serviceAccountKey.json.\n" +
      "Download it from Firebase console → Project settings → Service accounts → Generate new private key."
  );
  process.exit(1);
}

const serviceAccount = require(keyPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const attendees = require("./attendees.json");

// Best-effort: fetch the profile page and read <meta property="og:image">.
// LinkedIn shows an auth-wall to anonymous bots, so this misses for many
// profiles — that's expected; the site falls back to unavatar then initials.
async function scrapeOgImage(url) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthBreakfastBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (!m) return null;
    const img = m[1];
    // Reject generic LinkedIn authwall banners/logos.
    if (/static\.licdn\.com/i.test(img)) return null;
    if (!/licdn\.com|media/i.test(img)) return null;
    return img;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const docId = (phone) => String(phone).replace(/\D/g, "");

(async () => {
  let photos = 0;
  for (const a of attendees) {
    const photoURL = await scrapeOgImage(a.linkedin);
    if (photoURL) photos++;
    await db
      .collection("attendees")
      .doc(docId(a.phone))
      .set(
        {
          name: a.name || "",
          email: a.email || "",
          phone: a.phone || "",
          company: a.company || "",
          title: a.title || "",
          linkedin: a.linkedin || "",
          photoURL: photoURL || "",
          source: "seed",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    console.log(`✓ ${a.name}${photoURL ? "  [photo]" : ""}`);
  }
  console.log(`\nSeeded ${attendees.length} attendees. Real photos captured: ${photos}/${attendees.length}.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
