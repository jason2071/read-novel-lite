// เว็บอ่านนิยาย — reads the novels sitting in data/ and nothing else.
// No database, no build step: node server.js

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitTitleBody } from './lib/chapter-text.js';
import * as prefs from './lib/prefs.js';
import {
  chapterRefs,
  chapterText,
  chapterTitles,
  listNovels,
  novelProfile,
  resolveWithin,
  safeName,
  searchChapters,
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const PAGE_SIZES = [50, 100, 200, 500];
const DEFAULT_SIZE = 100;
const SHELF_PAGE_SIZE = 20;
const CATALOG_SORTS = new Set([
  'name',
  'chapters-desc',
  'chapters-asc',
  'updated-desc',
  'added-desc',
]);
const DEFAULT_CATALOG_SORT = 'updated-desc';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// No max-age: the ETag still turns a repeat visit into a 304, and editing
// app.css or reader.js takes effect on the next reload instead of an hour later.
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '16kb' }));

const enc = encodeURIComponent;
app.locals.enc = enc;

// ------------------------------------------------------------------ shelf

async function shelfNovels(q = '') {
  const all = await listNovels();
  // Search covers both title and genre, because both appear on the shelf.
  const needle = q.toLowerCase();
  const catalog = needle
    ? all.filter((n) => n.name.toLowerCase().includes(needle) ||
                        (n.profile.genres || []).some((g) => String(g).toLowerCase().includes(needle)))
    : all;

  // A bookmark may point at a novel that is no longer in data/, or at a
  // chapter that has since been deleted — resolve it against the real refs.
  for (const n of catalog) {
    const saved = prefs.progressFor(n.name);
    n.resume = null;
    if (saved) {
      const refs = await chapterRefs(n.name);
      const ref = saved.ref.startsWith(n.name + '/') ? saved.ref.slice(n.name.length + 1) : saved.ref;
      const idx = refs.indexOf(ref);
      if (idx >= 0) n.resume = { ref, position: idx + 1, at: saved.at };
    }
  }

  // Only the dedicated Continue shelf is ordered by recent reading.  The main
  // catalogue stays in its normal library order, so its pager always means
  // "all novels" rather than "the books I happened to open most recently".
  const readAt = (n) => (n.resume?.at ? Date.parse(n.resume.at) || 0 : 0);
  const continueNovels = catalog.filter((n) => n.resume);
  continueNovels.sort((a, b) => readAt(b) - readAt(a) || a.name.localeCompare(b.name, 'th'));

  return { all, catalog, continueNovels };
}

function catalogSort(value) {
  return CATALOG_SORTS.has(value) ? value : DEFAULT_CATALOG_SORT;
}

function sortCatalog(novels, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'th');
  if (sort === 'chapters-desc') return [...novels].sort((a, b) => b.count - a.count || byName(a, b));
  if (sort === 'chapters-asc') return [...novels].sort((a, b) => a.count - b.count || byName(a, b));
  if (sort === 'updated-desc') return [...novels].sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b));
  if (sort === 'added-desc') return [...novels].sort((a, b) => b.addedAt - a.addedAt || byName(a, b));
  return [...novels].sort(byName);
}

app.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const sort = catalogSort(typeof req.query.sort === 'string' ? req.query.sort : '');
    const { all, catalog: unsortedCatalog, continueNovels } = await shelfNovels(q);
    const catalog = sortCatalog(unsortedCatalog, sort);

    // Page only the catalogue.  Continue reading is a separate shelf that stays
    // visible while moving between catalogue pages, so it never shifts a novel
    // into an unexpected page.
    const pages = Math.max(1, Math.ceil(catalog.length / SHELF_PAGE_SIZE));
    const pageNo = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    const slice = catalog.slice((pageNo - 1) * SHELF_PAGE_SIZE, pageNo * SHELF_PAGE_SIZE);

    res.render('novels', {
      page: 'novels',
      title: q ? `ค้นหา “${q}”` : 'ชั้นหนังสือ',
      novels: slice,
      q,
      sort,
      total: all.length,
      matchCount: catalog.length,
      pageNo,
      pages,
      continueCount: continueNovels.length,
      // Keep this shortcut shelf on every unfiltered catalogue page.  Its own
      // "ดูทั้งหมด" page handles a longer list without changing pagination.
      continueNovels: q ? [] : continueNovels.slice(0, 4),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/continue', async (_req, res, next) => {
  try {
    const { continueNovels } = await shelfNovels();
    res.render('continue', {
      page: 'continue',
      title: 'อ่านต่อ',
      novels: continueNovels,
      total: continueNovels.length,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- table of contents

app.get('/novel/:novel', async (req, res, next) => {
  try {
    const novel = safeName(req.params.novel);
    if (!novel || !resolveWithin(novel)) return res.status(400).render('error', errCtx(400, 'ชื่อเรื่องไม่ถูกต้อง'));

    const profile = await novelProfile(novel);
    if (!profile) return res.status(404).render('error', errCtx(404, 'ไม่พบนิยายเรื่องนี้'));

    const refs = await chapterRefs(novel);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

    // A search result set is paged exactly like the full list, so the two share
    // everything below — only where the rows come from differs.
    const rows = q
      ? await searchChapters(novel, q)
      : refs.map((ref, i) => ({ ref, no: i + 1, title: null }));

    const size = PAGE_SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : DEFAULT_SIZE;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    const start = (page - 1) * size;
    const slice = rows.slice(start, start + size);
    // searchChapters already carries the titles; the plain list still reads only
    // the page it shows
    if (!q) {
      const titles = await chapterTitles(novel, slice.map((r) => r.ref));
      slice.forEach((row, i) => { row.title = titles[i]; });
    }

    const saved = prefs.progressFor(novel);
    const savedRef = saved
      ? (saved.ref.startsWith(novel + '/') ? saved.ref.slice(novel.length + 1) : saved.ref)
      : null;

    res.render('novel', {
      page: 'novel',
      title: q ? `ค้นหา “${q}” · ${novel}` : novel,
      novel,
      profile,
      total: refs.length,
      q,
      found: q ? rows.length : null,
      chapters: slice,
      pageNo: page,
      pages,
      size,
      sizes: PAGE_SIZES,
      savedRef,
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ reader

app.get('/read/:novel', async (req, res, next) => {
  try {
    const novel = safeName(req.params.novel);
    if (!novel || !resolveWithin(novel)) return res.status(400).render('error', errCtx(400, 'ชื่อเรื่องไม่ถูกต้อง'));

    const refs = await chapterRefs(novel);
    if (!refs.length) return res.status(404).render('error', errCtx(404, 'เรื่องนี้ยังไม่มีตอนที่แปลแล้ว'));

    const saved = prefs.progressFor(novel);
    const savedRef = saved
      ? (saved.ref.startsWith(novel + '/') ? saved.ref.slice(novel.length + 1) : saved.ref)
      : null;
    const ref = savedRef && refs.includes(savedRef) ? savedRef : refs[0];
    res.redirect(302, `/read/${enc(novel)}/${enc(ref)}`);
  } catch (err) {
    next(err);
  }
});

app.get('/read/:novel/:chapter', async (req, res, next) => {
  try {
    const novel = safeName(req.params.novel);
    const chapter = safeName(req.params.chapter);
    if (!novel || !chapter || !resolveWithin(novel, 'chapters', chapter)) {
      return res.status(400).render('error', errCtx(400, 'ที่อยู่ไม่ถูกต้อง'));
    }

    const text = await chapterText(novel, chapter);
    if (!text) return res.status(404).render('error', errCtx(404, 'ยังไม่มีคำแปลของตอนนี้'));

    const refs = await chapterRefs(novel);
    const idx = refs.indexOf(chapter);
    const prevRef = idx > 0 ? refs[idx - 1] : null;
    const nextRef = idx >= 0 && idx < refs.length - 1 ? refs[idx + 1] : null;

    const { heading, paragraphs } = splitTitleBody(text);
    const saved = prefs.progressFor(novel);
    const savedRef = saved
      ? (saved.ref.startsWith(novel + '/') ? saved.ref.slice(novel.length + 1) : saved.ref)
      : null;

    res.render('read', {
      page: 'read',
      title: heading || novel,
      novel,
      chapter,
      ref: `${novel}/${chapter}`,
      heading,
      paragraphs,
      prevRef,
      nextRef,
      position: idx >= 0 ? `${idx + 1} / ${refs.length}` : '',
      reader: prefs.READER_DEFAULTS,
      // only restore the offset when the bookmark is THIS chapter
      resumeScroll: savedRef === chapter ? (saved.scroll || 0) : 0,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------- api

app.post('/api/reader', async (req, res) => {
  const body = req.body || {};
  if (typeof body.novel === 'string' && typeof body.ref === 'string') {
    const novel = safeName(body.novel);
    const ref = safeName(body.ref.includes('/') ? body.ref.split('/').pop() : body.ref);
    if (novel && ref && resolveWithin(novel, 'chapters', ref)) {
      const refs = await chapterRefs(novel);
      if (refs.includes(ref)) prefs.saveProgress(novel, `${novel}/${ref}`, body.scroll, refs);
    }
  }
  res.json(prefs.load());
});

// ------------------------------------------------------------------ errors

function errCtx(status, message) {
  return { page: 'error', title: `${status}`, status, message };
}

app.use((req, res) => {
  res.status(404).render('error', errCtx(404, 'ไม่พบหน้านี้'));
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', errCtx(500, 'เซิร์ฟเวอร์มีปัญหา'));
});

// -------------------------------------------------------------------- boot

await prefs.init();
app.listen(PORT, HOST, () => {
  console.log(`อ่านนิยายได้ที่  http://localhost:${PORT}`);
});

// Flush the debounced write before the process goes away, so the last few
// seconds of reading position are not lost on Ctrl-C.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await prefs.flush().catch(() => {});
    process.exit(0);
  });
}
