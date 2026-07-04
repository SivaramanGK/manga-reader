// server.js
// Backend for a legal manga reader/aggregator built on the MangaDex public API.
//
// IMPORTANT LEGAL NOTE:
// MangaDex only indexes chapters uploaded by scanlation groups who have
// agreed to their content guidelines, and its API is public and free to use
// for exactly this purpose (building third-party readers). We NEVER download
// or permanently store manga page images in our own database — chapter page
// URLs are fetched fresh from MangaDex's "at-home" image server each time a
// user opens a chapter, per MangaDex's API terms. Our database only stores
// OUR OWN user data (library entries, bookmarks, reading progress) — never
// copyrighted manga content itself.

const express = require("express");
const path = require("path");
const fs = require("fs");
const { rateLimit } = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const MANGADEX_API = "https://api.mangadex.org";

// ---------- Simple JSON-file "database" (only for OUR user data) ----------
// No manga content is ever stored here — just the user's own library
// entries and reading progress. A tiny dependency-free store is used so
// this deploys cleanly on any host without native binary builds; swap in
// a real database (Postgres, etc.) later if you need multi-user support.
const DB_PATH = path.join(__dirname, "data.json");

function loadDb() {
  if (!fs.existsSync(DB_PATH)) return { library: [], progress: {} };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { library: [], progress: {} };
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Basic rate limiting so we stay well within MangaDex's fair-use etiquette
// and don't get our server IP throttled or banned.
const apiLimiter = rateLimit({
  windowMs: 1000,
  max: 5, // max 5 requests/sec to our proxy, which forwards to MangaDex
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// Tiny in-memory cache to avoid hammering MangaDex for the same data
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function cachedFetch(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.data;
  const res = await fetch(url, {
    headers: { "User-Agent": "MyMangaReader/1.0 (personal project)" },
  });
  if (!res.ok) throw new Error(`MangaDex API error: ${res.status}`);
  const data = await res.json();
  cache.set(url, { data, time: Date.now() });
  return data;
}

// ---------- MangaDex proxy routes ----------

// Popular / trending manga
app.get("/api/popular", async (req, res) => {
  try {
    const url = `${MANGADEX_API}/manga?order[followedCount]=desc&limit=24&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art`;
    const data = await cachedFetch(url);
    res.json(formatMangaList(data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Search manga by title
app.get("/api/search", async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q || "");
    const url = `${MANGADEX_API}/manga?title=${q}&limit=24&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art`;
    const data = await cachedFetch(url);
    res.json(formatMangaList(data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Manga detail
app.get("/api/manga/:id", async (req, res) => {
  try {
    const url = `${MANGADEX_API}/manga/${req.params.id}?includes[]=cover_art&includes[]=author&includes[]=artist`;
    const data = await cachedFetch(url);
    res.json(formatMangaDetail(data.data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Chapter list for a manga (English by default; change lang param as needed)
app.get("/api/manga/:id/chapters", async (req, res) => {
  try {
    const lang = req.query.lang || "en";
    const url = `${MANGADEX_API}/manga/${req.params.id}/feed?translatedLanguage[]=${lang}&order[chapter]=asc&limit=200&includes[]=scanlation_group`;
    const data = await cachedFetch(url);
    res.json(formatChapterList(data.data));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Page image URLs for a chapter — fetched live each time, never stored.
app.get("/api/chapter/:id/pages", async (req, res) => {
  try {
    const url = `${MANGADEX_API}/at-home/server/${req.params.id}`;
    const data = await cachedFetch(url);
    const { baseUrl, chapter } = data;
    const pages = chapter.data.map(
      (filename) => `${baseUrl}/data/${chapter.hash}/${filename}`
    );
    res.json({ pages });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- Library / bookmarks (OUR data, not manga content) ----------

app.get("/api/library", (req, res) => {
  const data = loadDb();
  const rows = [...data.library].sort((a, b) => (a.added_at < b.added_at ? 1 : -1));
  res.json(rows);
});

app.post("/api/library", (req, res) => {
  const { manga_id, title, cover_url } = req.body;
  if (!manga_id || !title) return res.status(400).json({ error: "manga_id and title required" });
  const data = loadDb();
  if (!data.library.some((r) => r.manga_id === manga_id)) {
    data.library.push({
      manga_id,
      title,
      cover_url: cover_url || null,
      added_at: new Date().toISOString(),
    });
    saveDb(data);
  }
  res.json({ ok: true });
});

app.delete("/api/library/:manga_id", (req, res) => {
  const data = loadDb();
  data.library = data.library.filter((r) => r.manga_id !== req.params.manga_id);
  saveDb(data);
  res.json({ ok: true });
});

app.get("/api/progress/:manga_id", (req, res) => {
  const data = loadDb();
  res.json(data.progress[req.params.manga_id] || null);
});

app.post("/api/progress", (req, res) => {
  const { manga_id, chapter_id, chapter_number, page } = req.body;
  if (!manga_id || !chapter_id)
    return res.status(400).json({ error: "manga_id and chapter_id required" });
  const data = loadDb();
  data.progress[manga_id] = {
    manga_id,
    chapter_id,
    chapter_number: chapter_number || null,
    page: page || 0,
    updated_at: new Date().toISOString(),
  };
  saveDb(data);
  res.json({ ok: true });
});

// ---------- Helpers to shape MangaDex's response into something simple ----------

function formatMangaList(data) {
  return (data.data || []).map((m) => shapeMangaSummary(m));
}

function shapeMangaSummary(m) {
  const title =
    m.attributes.title.en ||
    Object.values(m.attributes.title)[0] ||
    "Untitled";
  const coverRel = (m.relationships || []).find((r) => r.type === "cover_art");
  const coverFile = coverRel?.attributes?.fileName;
  const coverUrl = coverFile
    ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg`
    : null;
  return {
    id: m.id,
    title,
    coverUrl,
    status: m.attributes.status,
    year: m.attributes.year,
    tags: (m.attributes.tags || []).map((t) => t.attributes.name.en).slice(0, 4),
  };
}

function formatMangaDetail(m) {
  const base = shapeMangaSummary(m);
  const description =
    m.attributes.description?.en ||
    Object.values(m.attributes.description || {})[0] ||
    "";
  const authorRel = (m.relationships || []).find(
    (r) => r.type === "author" || r.type === "artist"
  );
  return {
    ...base,
    description,
    author: authorRel?.attributes?.name || "Unknown",
  };
}

function formatChapterList(chapters) {
  return chapters.map((c) => {
    const groupRel = (c.relationships || []).find(
      (r) => r.type === "scanlation_group"
    );
    return {
      id: c.id,
      chapter: c.attributes.chapter,
      title: c.attributes.title,
      pages: c.attributes.pages,
      publishAt: c.attributes.publishAt,
      group: groupRel?.attributes?.name || "Unknown group",
    };
  });
}

app.listen(PORT, () => {
  console.log(`Manga reader server running at http://localhost:${PORT}`);
});
