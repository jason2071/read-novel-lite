# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — run the server (listens on `0.0.0.0:3000`; override with `PORT=...`).
- `NOVEL_DATA_DIR=<path to a Translator data folder> npm start` — read chapters/bookmarks from an external data dir instead of local `data/`.
- No build step, no tests, no linter configured.

## What this is

Personal novel-reading web app (Node + Express 5 + EJS, `"type": "module"`, Thai UI). Serves translated novels straight off a filesystem `data/` directory produced by the companion "Translator" project. Read-only for novel content; the only file it writes is `data/reader.json`.

## Data contract (do not break)

```
data/
  reader.json                 ← bookmarks, shape: { progress: { "<novel>": { ref, scroll, at } } }
  <novel>/                    ← folder name IS the novel name (URL segment)
    _novel.json               ← status, genres, source info
    chapters/<ref>/final.txt  ← displayed text; falls back to draft.txt
```

- `reader.json` shares its format with the Translator project — keep `saveProgress`/`init` in `lib/prefs.js` shape-compatible.
- Chapter `ref` = folder name under `chapters/`; chapter title = first line of `final.txt`.
- Inserted chapters like `0421-x01` sort after `0421` via `naturalCompare` in `lib/store.js`.

## Architecture

- `server.js` — all routes. `/` shelf, `/novel/:n` table of contents (paginated + `?q=` search), `/read/:n[/:ref]` reader, `POST /api/reader` bookmark save.
- `lib/store.js` — filesystem layer. `DATA_DIR` resolution (env override), `safeName`/`resolveWithin` path-traversal guards (use these for any new user-supplied path), chapter listing, title extraction via 2KB head-reads, search. Two in-memory caches: `refsCache` (chapter list, invalidated by `chapters/` dir mtime) and `titleCache` — new chapters appear without restart.
- `lib/prefs.js` — bookmarks. In-memory state, debounced (1s) write via temp-file + rename. `saveProgress` refuses to move a bookmark **backwards** in chapter order (furthest-read wins); callers pass the ordered ref list.
- `lib/chapter-text.js` — splits raw chapter text into title/body.
- `views/*.ejs`, `public/css/app.css`, `public/js/reader.js` — pages, 3 reader themes, arrow-key navigation, scroll-ping bookmark saves. Visual prefs (theme, font size, spacing) live in browser `localStorage`, NOT `reader.json` — keep that split.

## Conventions

- UI copy and comments in Thai-flavored docs (README is Thai). Keep tone consistent.
- Chapters are identified by folder name everywhere in URLs/API; never expose filesystem paths client-side.
