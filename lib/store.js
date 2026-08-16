// The data/ folder is the database. Everything here is filesystem reads plus a
// small in-memory cache, so there is nothing to migrate, seed, or keep in sync.
//
// Layout (produced by the Translator project):
//   data/<novel>/_novel.json          profile: era, setting, status, genres, ...
//   data/<novel>/chapters/<ref>/final.txt   polished translation  <- what we read
//   data/<novel>/chapters/<ref>/draft.txt   unpolished fallback
//   data/<novel>/chapters/<ref>/raw.txt     Chinese source (unused here)
//   data/<novel>/_trash-000N/         deleted chapters, skipped

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { headingOf } from './chapter-text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------- path safety

// A novel name is a single path segment. Names in this corpus contain Thai,
// spaces, em-dashes and "!", so the rule is "no separators, no dot-dot" rather
// than an allowlist of characters.
export function safeName(name) {
  const s = String(name || '');
  if (!s || s === '.' || s === '..') return null;
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) return null;
  return s;
}

/** Resolve `segments` under DATA_DIR, or null if they escape it. */
export function resolveWithin(...segments) {
  for (const s of segments) if (!safeName(s)) return null;
  const full = path.resolve(DATA_DIR, ...segments);
  const root = path.resolve(DATA_DIR);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// --------------------------------------------------------------------- novels

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every readable novel: a directory holding a _novel.json. That test alone
 * filters out reader.json, app_settings.json, index.sqlite and the review notes
 * that also live in data/.
 */
export async function listNovels() {
  let entries;
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const novels = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const profile = await readJson(path.join(DATA_DIR, e.name, '_novel.json'));
    if (!profile) continue;
    const refs = await chapterRefs(e.name);
    novels.push({
      name: e.name,
      profile,
      count: refs.length,
      firstRef: refs[0] || null,
      lastRef: refs[refs.length - 1] || null,
    });
  }
  novels.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  return novels;
}

export async function novelProfile(novel) {
  const dir = resolveWithin(novel);
  if (!dir) return null;
  return readJson(path.join(dir, '_novel.json'));
}

// ------------------------------------------------------------------- chapters

// "0198" and "0198-x01" must sort as neighbours, and "0002" before "0010" —
// so compare digit runs as numbers and the rest as text.
function naturalCompare(a, b) {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (x !== '' && y !== '' && !Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Size of a file, or 0 when it is missing. A 0-byte file counts as absent. */
async function sizeOf(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// novel -> { mtimeMs, refs }. Keyed on the mtime of chapters/, which changes
// whenever a chapter directory is added or removed — so a newly translated
// chapter shows up without a restart. Edits *inside* an existing chapter do not
// bump it; that only matters if a chapter goes from empty to translated, which
// this reader hides either way until the next add.
const refsCache = new Map();
// ref -> heading. Dropped together with the novel's refs entry, so a re-scan
// re-reads the titles too.
const titleCache = new Map();

/**
 * Readable chapter refs of a novel, in reading order.
 * A chapter is readable when final.txt or draft.txt has content — chapters that
 * were fetched but never translated stay out of the table of contents.
 */
export async function chapterRefs(novel) {
  const dir = resolveWithin(novel, 'chapters');
  if (!dir) return [];

  let mtimeMs;
  try {
    mtimeMs = (await fs.stat(dir)).mtimeMs;
  } catch {
    return [];
  }
  const hit = refsCache.get(novel);
  if (hit && hit.mtimeMs === mtimeMs) return hit.refs;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);

  const readable = await mapLimit(candidates, 64, async (ref) => {
    if (await sizeOf(path.join(dir, ref, 'final.txt'))) return ref;
    if (await sizeOf(path.join(dir, ref, 'draft.txt'))) return ref;
    return null;
  });

  const refs = readable.filter(Boolean).sort(naturalCompare);
  for (const [ref] of titleCache) {
    if (ref.startsWith(novel + '/')) titleCache.delete(ref);
  }
  refsCache.set(novel, { mtimeMs, refs });
  return refs;
}

/** Full text of a chapter: the polished final, else the draft, else ''. */
export async function chapterText(novel, ref) {
  const dir = resolveWithin(novel, 'chapters', ref);
  if (!dir) return '';
  for (const name of ['final.txt', 'draft.txt']) {
    const file = path.join(dir, name);
    if (await sizeOf(file)) return fs.readFile(file, 'utf8');
  }
  return '';
}

// Enough bytes to always contain the first line. Read as a chunk rather than
// the whole file: a 1,900-chapter novel would otherwise mean ~50MB of reads for
// one table-of-contents page.
const HEAD_BYTES = 2048;

async function readHead(file) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    // A multi-byte character may be cut at the boundary; the first line is far
    // shorter than the buffer, so the damage never reaches it.
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await fh?.close();
  }
}

/**
 * Headings for the given refs of one novel — only the refs asked for, which is
 * one page of the table of contents, never the whole novel.
 */
export async function chapterTitles(novel, refs) {
  return mapLimit(refs, 32, async (ref) => {
    const key = `${novel}/${ref}`;
    const cached = titleCache.get(key);
    if (cached !== undefined) return cached;

    const dir = resolveWithin(novel, 'chapters', ref);
    let title = '';
    if (dir) {
      for (const name of ['final.txt', 'draft.txt']) {
        const head = await readHead(path.join(dir, name));
        if (head.trim()) {
          title = headingOf(head);
          break;
        }
      }
    }
    titleCache.set(key, title);
    return title;
  });
}

/**
 * Chapters of one novel whose title or number matches `q`.
 *
 * Searching means knowing every title, so the first search in a novel reads the
 * head of every chapter file — about a second on the 1,900-chapter one. After
 * that the titles are in titleCache and it is a string scan over memory. That is
 * why the table of contents still only asks for the page it shows: it must stay
 * fast for readers who never search.
 *
 * The number matches too, so "421" finds ref 0421 as well as any title saying 421.
 */
export async function searchChapters(novel, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];

  const refs = await chapterRefs(novel);
  const titles = await chapterTitles(novel, refs);
  const hits = [];
  for (let i = 0; i < refs.length; i++) {
    const title = titles[i] || '';
    if (title.toLowerCase().includes(needle) || refs[i].toLowerCase().includes(needle)) {
      hits.push({ ref: refs[i], no: i + 1, title });
    }
  }
  return hits;
}
