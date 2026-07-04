// app.js — front-end logic for KOMA manga reader
// All manga metadata/images come live from our /api/* proxy (which itself
// pulls from the public MangaDex API). Nothing manga-related is ever
// downloaded permanently — only the user's own library/progress persists.

const views = {
  browse: document.getElementById("view-browse"),
  search: document.getElementById("view-search"),
  library: document.getElementById("view-library"),
  detail: document.getElementById("view-detail"),
  reader: document.getElementById("view-reader"),
};

let currentMangaId = null;
let currentChapters = [];
let currentPages = [];
let currentPageIndex = 0;
let currentChapterMeta = null;

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function mangaCard(m) {
  const card = document.createElement("div");
  card.className = "manga-card";
  card.innerHTML = `
    <div class="cover-wrap">
      ${m.coverUrl ? `<img src="${m.coverUrl}" alt="${escapeHtml(m.title)}" loading="lazy" />` : ""}
    </div>
    <div class="card-title">${escapeHtml(m.title)}</div>
    <div class="card-meta">${m.status || ""} ${m.year ? "· " + m.year : ""}</div>
  `;
  card.addEventListener("click", () => openDetail(m.id));
  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- Browse ----------
async function loadPopular() {
  const grid = document.getElementById("popularGrid");
  grid.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await api("/api/popular");
    grid.innerHTML = "";
    data.forEach((m) => grid.appendChild(mangaCard(m)));
  } catch (e) {
    grid.innerHTML = `<p class="empty-state">Couldn't load titles. Is the server running?</p>`;
  }
}

// ---------- Search ----------
async function runSearch(q) {
  if (!q.trim()) return;
  showView("search");
  document.getElementById("searchTitle").textContent = `“${q}”`;
  const grid = document.getElementById("searchGrid");
  grid.innerHTML = `<p class="empty-state">Searching…</p>`;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    grid.innerHTML = "";
    if (!data.length) {
      grid.innerHTML = `<p class="empty-state">No titles matched.</p>`;
      return;
    }
    data.forEach((m) => grid.appendChild(mangaCard(m)));
  } catch (e) {
    grid.innerHTML = `<p class="empty-state">Search failed.</p>`;
  }
}

// ---------- Library ----------
async function loadLibrary() {
  const grid = document.getElementById("libraryGrid");
  const empty = document.getElementById("libraryEmpty");
  const data = await api("/api/library");
  grid.innerHTML = "";
  if (!data.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  data.forEach((row) =>
    grid.appendChild(
      mangaCard({ id: row.manga_id, title: row.title, coverUrl: row.cover_url })
    )
  );
}

async function isInLibrary(mangaId) {
  const data = await api("/api/library");
  return data.some((r) => r.manga_id === mangaId);
}

// ---------- Detail ----------
async function openDetail(mangaId) {
  currentMangaId = mangaId;
  showView("detail");
  const detail = await api(`/api/manga/${mangaId}`);
  document.getElementById("detailCover").src = detail.coverUrl || "";
  document.getElementById("detailTitle").textContent = detail.title;
  document.getElementById("detailStatus").textContent = (detail.status || "").toUpperCase();
  document.getElementById("detailAuthor").textContent = detail.author || "";
  document.getElementById("detailDesc").textContent = detail.description || "";
  const tagRow = document.getElementById("detailTags");
  tagRow.innerHTML = "";
  (detail.tags || []).forEach((t) => {
    const span = document.createElement("span");
    span.textContent = t;
    tagRow.appendChild(span);
  });

  const libBtn = document.getElementById("libraryToggle");
  const inLib = await isInLibrary(mangaId);
  setLibraryButton(libBtn, inLib);
  libBtn.onclick = async () => {
    const nowIn = libBtn.classList.contains("added");
    if (nowIn) {
      await api(`/api/library/${mangaId}`, { method: "DELETE" });
      setLibraryButton(libBtn, false);
      toast("Removed from library");
    } else {
      await api("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manga_id: mangaId, title: detail.title, cover_url: detail.coverUrl }),
      });
      setLibraryButton(libBtn, true);
      toast("Added to library");
    }
  };

  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = `<p class="empty-state">Loading chapters…</p>`;
  currentChapters = await api(`/api/manga/${mangaId}/chapters`);
  chapterList.innerHTML = "";
  if (!currentChapters.length) {
    chapterList.innerHTML = `<p class="empty-state">No English chapters available for this title.</p>`;
    return;
  }
  currentChapters.forEach((c) => {
    const row = document.createElement("div");
    row.className = "chapter-row";
    row.innerHTML = `
      <span class="ch-num">Ch. ${c.chapter ?? "—"}</span>
      <span class="ch-title">${escapeHtml(c.title || "")}</span>
      <span class="ch-group">${escapeHtml(c.group)}</span>
    `;
    row.addEventListener("click", () => openReader(c));
    chapterList.appendChild(row);
  });
}

function setLibraryButton(btn, inLib) {
  btn.classList.toggle("added", inLib);
  btn.textContent = inLib ? "✓ In Library" : "+ Add to Library";
}

// ---------- Reader ----------
async function openReader(chapterMeta) {
  currentChapterMeta = chapterMeta;
  showView("reader");
  document.getElementById("readerChapterLabel").textContent = `Chapter ${chapterMeta.chapter ?? ""} — ${chapterMeta.title || ""}`;
  const pagesWrap = document.getElementById("readerPages");
  pagesWrap.innerHTML = `<p class="empty-state" style="color:#eee">Loading pages…</p>`;
  try {
    const data = await api(`/api/chapter/${chapterMeta.id}/pages`);
    currentPages = data.pages;
    currentPageIndex = 0;
    renderPage();
    if (currentMangaId) {
      api("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manga_id: currentMangaId,
          chapter_id: chapterMeta.id,
          chapter_number: chapterMeta.chapter,
          page: 0,
        }),
      });
    }
  } catch (e) {
    pagesWrap.innerHTML = `<p class="empty-state" style="color:#eee">Couldn't load this chapter.</p>`;
  }
}

function renderPage() {
  const wrap = document.getElementById("readerPages");
  wrap.innerHTML = "";
  if (!currentPages.length) return;
  const img = document.createElement("img");
  img.src = currentPages[currentPageIndex];
  img.alt = `Page ${currentPageIndex + 1}`;
  wrap.appendChild(img);
  document.getElementById("pageCounter").textContent = `Page ${currentPageIndex + 1} / ${currentPages.length}`;
}

document.getElementById("prevPageBtn").addEventListener("click", () => {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    renderPage();
  }
});
document.getElementById("nextPageBtn").addEventListener("click", () => {
  if (currentPageIndex < currentPages.length - 1) {
    currentPageIndex++;
    renderPage();
  }
});
window.addEventListener("keydown", (e) => {
  if (!views.reader.classList.contains("active")) return;
  if (e.key === "ArrowRight") document.getElementById("nextPageBtn").click();
  if (e.key === "ArrowLeft") document.getElementById("prevPageBtn").click();
});

// ---------- Nav wiring ----------
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    showView(view);
    if (view === "library") loadLibrary();
  });
});

document.getElementById("backFromDetail").addEventListener("click", () => showView("browse"));
document.getElementById("backFromReader").addEventListener("click", () => openDetail(currentMangaId));

document.getElementById("searchBtn").addEventListener("click", () => {
  runSearch(document.getElementById("searchInput").value);
});
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch(e.target.value);
});

// ---------- Init ----------
loadPopular();
