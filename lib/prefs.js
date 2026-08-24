// Reading position, kept in data/reader.json.
//
// The file is shared by every browser that reads this server, so it is only for
// bookmarks. Visual reading preferences belong to each browser's localStorage.
// Keeping the progress shape means the reader.json copied from Translator still
// works on the first run.
//
//   { progress: { "<novel>": { ref, scroll, at } } }

import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'reader.json');
const TMP = FILE + '.tmp';

// Used only to render a sensible first visit. Once a browser saves a setting,
// public/js/reader.js replaces these with its localStorage values before paint.
export const READER_DEFAULTS = Object.freeze({
  theme: 'sepia',
  font_size: 20,
  line_height: 1.9,
  indent: 2,
  para_gap: 0.8,
});

let state = { progress: {} };
let writeTimer = null;
let writing = null;

/** Read bookmarks once at boot. A missing or broken file just means no bookmarks. */
export async function init() {
  let raw = null;
  try {
    raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    raw = null;
  }
  if (raw && typeof raw === 'object') {
    if (raw.progress && typeof raw.progress === 'object') {
      for (const [novel, p] of Object.entries(raw.progress)) {
        if (p && typeof p.ref === 'string') {
          state.progress[novel] = {
            ref: p.ref,
            scroll: Number(p.scroll) || 0,
            at: typeof p.at === 'string' ? p.at : '',
          };
        }
      }
    }
  }
  return state;
}

export function load() {
  return state;
}

/**
 * Bookmark for a novel, or null. Callers must still check the ref still exists —
 * reader.json carries entries for novels that are no longer in data/.
 */
export function progressFor(novel) {
  return state.progress[novel] || null;
}

function chapterOf(novel, ref) {
  const value = String(ref || '');
  const prefix = `${novel}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Save the furthest readable chapter reached. Opening an earlier chapter is
 * allowed, but must not move the resume bookmark backwards.
 */
export function saveProgress(novel, ref, scroll, orderedRefs = null) {
  const previous = state.progress[novel];
  if (previous && Array.isArray(orderedRefs)) {
    const previousIndex = orderedRefs.indexOf(chapterOf(novel, previous.ref));
    const nextIndex = orderedRefs.indexOf(chapterOf(novel, ref));
    // A missing entry is stale or invalid, so do not let it block a valid save.
    if (previousIndex >= 0 && nextIndex >= 0 && nextIndex < previousIndex) return state;
  }
  state.progress[novel] = {
    ref,
    scroll: Math.min(1, Math.max(0, Number(scroll) || 0)),
    at: new Date().toISOString(),
  };
  schedule();
  return state;
}

// Scroll pings arrive far faster than a disk write is worth, so coalesce them.
function schedule() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush().catch(() => {});
  }, 1000);
  writeTimer.unref?.();
}

/** Write via a temp file + rename, so a crash mid-write cannot truncate the real one. */
export async function flush() {
  if (writing) return writing;
  writing = (async () => {
    try {
      const body = JSON.stringify(state, null, 2);
      await fs.writeFile(TMP, body, 'utf8');
      await fs.rename(TMP, FILE);
    } finally {
      writing = null;
    }
  })();
  return writing;
}
