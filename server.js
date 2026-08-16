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
} from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const PAGE_SIZES = [50, 100, 200, 500];
const DEFAULT_SIZE = 100;

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

app.get('/', async (req, res, next) => {
  try {
    const novels = await listNovels();
    // A bookmark may point at a novel that is no longer in data/, or at a
    // chapter that has since been deleted — resolve it against the real refs.
    for (const n of novels) {
      const saved = prefs.progressFor(n.name);
      n.resume = null;
      if (saved) {
        const refs = await chapterRefs(n.name);
        const ref = saved.ref.startsWith(n.name + '/') ? saved.ref.slice(n.name.length + 1) : saved.ref;
        const idx = refs.indexOf(ref);
        if (idx >= 0) n.resume = { ref, position: idx + 1, at: saved.at };
      }
    }
    res.render('novels', { page: 'novels', title: 'ชั้นหนังสือ', novels });
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
    const size = PAGE_SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : DEFAULT_SIZE;
    const pages = Math.max(1, Math.ceil(refs.length / size));
    const page = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
    const start = (page - 1) * size;
    const slice = refs.slice(start, start + size);
    const titles = await chapterTitles(novel, slice);

    const saved = prefs.progressFor(novel);
    const savedRef = saved
      ? (saved.ref.startsWith(novel + '/') ? saved.ref.slice(novel.length + 1) : saved.ref)
      : null;

    res.render('novel', {
      page: 'novel',
      title: novel,
      novel,
      profile,
      total: refs.length,
      chapters: slice.map((ref, i) => ({ ref, no: start + i + 1, title: titles[i] })),
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
    const settings = prefs.load();
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
      reader: settings,
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
  prefs.savePrefs(body);
  if (typeof body.novel === 'string' && typeof body.ref === 'string') {
    const novel = safeName(body.novel);
    const ref = safeName(body.ref.includes('/') ? body.ref.split('/').pop() : body.ref);
    if (novel && ref && resolveWithin(novel, 'chapters', ref)) {
      prefs.saveProgress(novel, `${novel}/${ref}`, body.scroll);
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
