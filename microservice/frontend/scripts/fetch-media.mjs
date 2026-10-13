#!/usr/bin/env node
/**
 * Fetch OG metadata + thumbnails for media items.
 * Mirrors what LinkedIn does for link previews.
 * Usage: node scripts/fetch-media.mjs
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MEDIA_DIR = join(ROOT, "public", "media");
const GEN_FILE = join(ROOT, "src", "content", "media.generated.ts");
const OVR_FILE = join(ROOT, "src", "content", "media.overrides.ts");

mkdirSync(MEDIA_DIR, { recursive: true });

// ── Sources (duplicated from media.ts to avoid TS import) ──
const SOURCES = [
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=PZ42pYy-Gzo", order: 1 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=7-oIt5gaHLo", order: 2 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=kD00g7Q2NCQ", order: 3 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=kNzOvq8Dlmw", order: 4 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=ZsofGOah79s", order: 5 },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DdAc6jimWYc/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/Dc-iO3gtLcU/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DY1EWoapTSA/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DYGOKSdjyU_/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DXLj6KbkXtx/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DQBMbWij8yV/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DPoMGJKE60j/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DNqF6xdR8mk/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DJElV3XSbH3/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DIjG-qAJz5-/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DKMrvJkzUEp/" },
  { group: "press", kind: "news", url: "https://www.detik.com/edu/edutainment/d-7212856/inovasi-mahasiswa-its-bantu-tunanetra-melihat-orang-alzheimer-mengingat" },
  { group: "press", kind: "news", url: "https://kumparan.com/beritaanaksurabaya/teknologi-ai-karya-mahasiswa-di-surabaya-bantu-tunanetra-dan-alzheimer-22M4Z5qN4lV" },
  { group: "press", kind: "news", url: "https://sorotnesia.com/its-kenalkan-teknologi-ai-untuk-penyandang-tunanetra-di-surabaya/" },
  { group: "press", kind: "x", url: "https://x.com/narasitv/status/1768137689768030550" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/DHTPNrqvLXN/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/DE7VE2VpFJi/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C34Te0PvbSD/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C32GMlJBnrt/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C37D4TuJvpW/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C4p0gyYvFPY/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C_z-QW4SD6_/" },
];

function itemId(url, kind) {
  if (kind === "youtube") { const m = url.match(/[?&]v=([^&#]+)/); return m?.[1] || url; }
  if (kind === "instagram") { const m = url.match(/\/p\/([^/]+)/); return m?.[1] || url; }
  if (kind === "x") { const m = url.match(/status\/(\d+)/); return m?.[1] || url; }
  try { return new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-"); } catch { return url; }
}

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ");
}

function parseMeta(html) {
  const og = {};
  const re = /<meta\s+(?:property|name)=["']([^"']+)["']\s+content=["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) og[m[1]] = decodeEntities(m[2]);
  // Try reversed order too: content before property
  const re2 = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["']([^"']+)["']/gi;
  while ((m = re2.exec(html))) og[m[2]] = og[m[2]] || decodeEntities(m[1]);
  // <title> fallback
  const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (tm) og._title = decodeEntities(tm[1].trim());
  return og;
}

const UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com)",
  "Twitterbot/1.0",
];

async function fetchOg(url, retries = 2) {
  for (const ua of UAS) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": ua, Accept: "text/html", "Accept-Language": "id-ID,en;q=0.8" },
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const og = parseMeta(html);
        if (og["og:title"] || og["og:image"]) return og;
      } catch {}
      if (attempt < retries) await sleep(3000);
    }
  }
  return null;
}

async function fetchYouTubeOembed(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

async function downloadImage(imageUrl, id) {
  const dest = join(MEDIA_DIR, `${id}.jpg`);
  if (existsSync(dest)) return `/media/${id}.jpg`;
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": UAS[0] },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) return null;
    writeFileSync(dest, buf);
    return `/media/${id}.jpg`;
  } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);

function parseInstagramOg(og) {
  const desc = og["og:description"] || "";
  // Format: "123 likes, 4 comments - accountname on Month DD, YYYY: caption..."
  const m = desc.match(/- (.+?) on (.+?):\s*"?(.*)/s);
  const result = {};
  if (m) {
    result.source = `Instagram @${m[1].trim()}`;
    // Parse date
    try {
      const d = new Date(m[2].trim());
      if (!isNaN(d.getTime())) result.date = d.toISOString().slice(0, 10);
    } catch {}
    // Caption → title (max 90 chars, trim at word boundary, strip leading emoji)
    let caption = (m[3] || "").replace(/^[\p{Emoji}\s]+/u, "").replace(/"$/, "").trim();
    if (caption.length > 90) caption = caption.slice(0, 87).replace(/\s+\S*$/, "") + "…";
    if (caption) result.title = caption;
  }
  if (!result.source) result.source = og["og:site_name"] || "Instagram";
  if (!result.title) result.title = (og["og:title"] || "").replace(/ on Instagram.*/, "").trim() || "TODO: title";
  return result;
}

function parseNewsOg(og) {
  let title = og["og:title"] || og._title || "TODO: title";
  const siteName = og["og:site_name"] || "";
  // Remove site name suffix
  if (siteName) title = title.replace(new RegExp(`\\s*[-|–—]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  const date = og["article:published_time"]?.slice(0, 10);
  return { title: decodeEntities(title), source: siteName || "Web", date };
}

// ── Main ──
async function main() {
  const results = {};
  const report = [];

  for (const src of SOURCES) {
    const id = itemId(src.url, src.kind);
    const entry = { id, group: src.group, kind: src.kind };

    if (src.kind === "youtube") {
      const oe = await fetchYouTubeOembed(src.url);
      entry.title = oe?.title || "TODO: title";
      entry.source = oe?.author_name ? `YouTube @${oe.author_name}` : "YouTube";
      // YouTube thumbnails are permanent URLs — no download needed
      report.push({ id, group: src.group, status: oe ? "OK" : "FAIL", thumbnail: "ytimg", title: entry.title });
    } else {
      const og = await fetchOg(src.url);
      if (og) {
        if (src.kind === "instagram") {
          Object.assign(entry, parseInstagramOg(og));
        } else if (src.kind === "x") {
          entry.title = og["og:title"] || og._title || "TODO: title";
          entry.source = og["og:site_name"] || "X";
          const dateM = og["og:title"]?.match(/on (\w+ \d+, \d{4})/);
          if (dateM) try { entry.date = new Date(dateM[1]).toISOString().slice(0, 10); } catch {}
        } else {
          Object.assign(entry, parseNewsOg(og));
        }
        // Download og:image
        const imgUrl = og["og:image"];
        if (imgUrl) {
          const thumb = await downloadImage(imgUrl, id);
          if (thumb) entry.thumbnail = thumb;
        }
        report.push({ id, group: src.group, status: "OK", thumbnail: entry.thumbnail || "NONE", title: entry.title });
      } else {
        entry.title = "TODO: title"; // TODO
        entry.source = src.kind;
        report.push({ id, group: src.group, status: "NEEDS MANUAL SCREENSHOT", thumbnail: "NONE", title: entry.title });
      }
    }

    results[id] = entry;
    await sleep(rand(2000, 4000));
  }

  // Write generated file
  const code = `// AUTO-GENERATED by scripts/fetch-media.mjs — do not edit manually
const data: Record<string, any> = ${JSON.stringify(results, null, 2)};
export default data;
`;
  writeFileSync(GEN_FILE, code);

  // Create overrides stub if missing
  if (!existsSync(OVR_FILE)) {
    writeFileSync(OVR_FILE, `// Manual overrides — fields here win over generated data
const overrides: Record<string, any> = {};
export default overrides;
`);
  }

  // Report
  console.log("\n┌─────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ FETCH REPORT                                                                            │");
  console.log("├──────────────────┬──────────┬────────────┬──────────────┬───────────────────────────────┤");
  console.log("│ id               │ group    │ status     │ thumbnail    │ title                         │");
  console.log("├──────────────────┼──────────┼────────────┼──────────────┼───────────────────────────────┤");
  for (const r of report) {
    const id = r.id.slice(0, 16).padEnd(16);
    const grp = r.group.padEnd(8);
    const st = r.status.slice(0, 10).padEnd(10);
    const th = (r.thumbnail || "").slice(0, 12).padEnd(12);
    const ti = (r.title || "").slice(0, 29).padEnd(29);
    console.log(`│ ${id} │ ${grp} │ ${st} │ ${th} │ ${ti} │`);
  }
  console.log("└──────────────────┴──────────┴────────────┴──────────────┴───────────────────────────────┘");

  const failed = report.filter((r) => r.status.includes("MANUAL"));
  if (failed.length) {
    console.log("\n⚠ NEEDS MANUAL SCREENSHOT:");
    for (const f of failed) console.log(`  - ${f.id} → public/media/${f.id}.jpg`);
  }
  console.log(`\nDone. ${report.filter((r) => r.status === "OK").length}/${report.length} fetched.`);
}

main().catch(console.error);
