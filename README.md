# KOMA — Manga Reader

A manga browsing/reading web app built on the **public MangaDex API**. MangaDex
only indexes chapters uploaded by scanlation groups that agreed to their
terms, and explicitly offers this API for third-party readers — so this is a
legitimate way to build an "aggregator" site, unlike scraping and rehosting
manga from random sites (which is copyright infringement and will get a site
taken down or a host account terminated).

**What gets stored where:**
- Manga metadata, covers, and page images are fetched **live** from MangaDex
  every time and never saved to your own storage.
- Your own database (`data.json`) only stores *your* library list and reading
  progress — never manga content itself.

## Project structure

```
manga-reader/
├── server.js          # Express backend, proxies MangaDex API + serves your library data
├── package.json
├── data.json          # auto-created on first run (your library/progress)
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Run it locally

Requires Node.js 18+.

```bash
cd manga-reader
npm install
npm start
```

Open **http://localhost:3000**.

## Hosting it for real

Google Sites **won't work** — it can't run a backend or call an external API
server-side. You need a place that runs Node.js. Cheapest reliable paths,
easiest first:

### Option A — Render.com (free tier, easiest)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Deploy. Render gives you a free `https://yourapp.onrender.com` URL.
5. (Free tier sleeps after inactivity — first request after idle is slow. Paid tier removes that.)

### Option B — Railway.app
1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
2. It auto-detects Node and runs `npm start`. Add a custom domain in settings if you want.

### Option C — Fly.io
More control, still generous free allowance, needs their CLI (`flyctl launch`, `flyctl deploy`). Better if you expect real traffic.

### Option D — A cheap VPS (DigitalOcean, Hetzner, etc.)
Most control, ~$4-6/mo. You'd run `npm start` behind a process manager (`pm2`)
and a reverse proxy (Caddy or nginx) for HTTPS.

### Custom domain
Buy one from Namecheap/Porkbun/Google Domains (~$10-15/yr) and point its DNS
at whichever host you pick (they all document this in their dashboard).

## Featured shelf

The homepage pins specific titles (currently One Piece, Blue Lock, Solo
Leveling, Jujutsu Kaisen) above the trending grid. Edit the `FEATURED_TITLES`
array near the top of `server.js` to change which titles show up — they're
looked up by name on MangaDex each time, not stored.

## Background music in the reader

The reader has a play/pause music bar, but **no actual audio is included** —
using real anime soundtracks would be copyright infringement. Instead:

1. Find royalty-free action/battle-style tracks you're allowed to use, e.g.
   [Pixabay Music](https://pixabay.com/music/) (no account needed) or
   [YouTube Audio Library](https://www.youtube.com/audiolibrary) (free with a
   Google account).
2. Download them as `.mp3` and drop them into `public/audio/`, named to
   match the entries in `MUSIC_MAP` inside `public/js/app.js`:
   ```
   public/audio/one-piece.mp3
   public/audio/blue-lock.mp3
   public/audio/solo-leveling.mp3
   public/audio/jujutsu-kaisen.mp3
   ```
3. To add a track for a title not in the featured list, add a new line to
   `MUSIC_MAP` in `public/js/app.js`:
   ```js
   "chainsaw man": "/audio/chainsaw-man.mp3",
   ```
   The key just needs to be a lowercase substring of the manga's title.

If no track file exists for a title, the reader shows "No track added for
this title yet" and disables the music button — nothing breaks.

## A note on scaling the "database"

The current `data.json` file store is fine for a single user testing this
out, but it isn't safe for concurrent multi-user writes. If you want real
accounts (so many people can each have their own library/bookmarks), swap it
for a hosted database:
- **Supabase** or **Neon** (free-tier Postgres, easiest to wire into Express)
- **MongoDB Atlas** (free-tier, if you prefer document storage)

Add a login flow (email/password or OAuth) and scope `library`/`progress`
rows by `user_id` instead of storing one global list.

## Respecting MangaDex's API

The server already rate-limits requests to itself and caches responses for 5
minutes to avoid hammering MangaDex. If you deploy this publicly with real
traffic, keep an eye on MangaDex's API rules (https://api.mangadex.org/docs/)
— they can rate-limit or block IPs that don't follow their etiquette
(reasonable request rates, proper `User-Agent`, not scraping the whole
catalog at once).
