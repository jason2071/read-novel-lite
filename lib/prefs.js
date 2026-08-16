// Reading preferences and "where I stopped", kept in data/reader.json.
//
// Same file and same shape the Translator project uses, on purpose: the copy of
// reader.json that shipped with data/ already holds real bookmarks, and keeping
// the format means they work here on the first run.
//
//   { theme, font_size, line_height, indent, para_gap,
//     progress: { "<novel>": { ref, scroll, at } } }

import fs from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'reader.json');
const TMP = FILE + '.tmp';

export const THEMES = ['light', 'dark', 'sepia'];

// Must match the slider min/max in views/read.ejs — the slider is the
// affordance, this is the guard.
const RANGES = {
  font_size: [14, 40],
  line_height: [1.2, 3],
  indent: [0, 5],
  para_gap: [0, 3],
};

const DEFAULTS = {
  theme: 'sepia',
  font_size: 20,
  line_height: 1.9,
  indent: 2,
  para_gap: 0.8,
};

let state = { ...DEFAULTS, progress: {} };
let writeTimer = null;
let writing = null;

function clampAll(patch) {
  const out = {};
  if (THEMES.includes(patch.theme)) out.theme = patch.theme;
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(patch[key]);
    if (Number.isFinite(v)) out[key] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

/** Read reader.json once at boot. A missing or broken file just means defaults. */
export async function init() {
  let raw = null;
  try {
    raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    raw = null;
  }
  if (raw && typeof raw === 'object') {
    Object.assign(state, clampAll(raw));
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

export function savePrefs(patch) {
  const clean = clampAll(patch);
  if (Object.keys(clean).length) {
    Object.assign(state, clean);
    schedule();
  }
  return state;
}

export function saveProgress(novel, ref, scroll) {
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
