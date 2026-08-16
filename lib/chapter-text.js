// Structure inside a chapter's text: which part is the heading, which is the body.
//
// The translated title is the FIRST LINE of final/draft ("บทที่ 1 โม่ฮว่า"). It is
// not in meta.json, and raw.txt holds the untouched Chinese source.
//
// A trimmed port of Translator/translator/chapter_text.py — only the parts a
// reader page needs. The publish-side heuristics there (strip_title_note and its
// note-word vocabularies) decide what a *published* title may keep; nothing on
// this site republishes anything, so they are deliberately left out.

// The prefix drifts between บทที่/ตอนที่ across chapters of the same novel because
// it comes out of the model, so parse it off and let the caller re-render one form.
const TITLE_LINE_RE = new RegExp(
  // Some providers keep a source-style ordinal before their Thai heading:
  // "121. บทที่ 121 ห้ามยั่วโมโหคนบ้า". Ignore that outer ordinal.
  '^\\s*(?:[0-9]+(?:[.\\-][0-9]+)?\\s*[:：.\\-—–]\\s*)?' +
  '(?:บทที่|ตอนที่|บท|ตอน|Chapter|Ch\\.?)\\s*' +
  '([0-9]+(?:[.\\-][0-9]+)?)\\s*[:：.\\-—–]?\\s*(.*)$'
);

// A line wholly inside brackets is the author talking to the source site's
// readers ("(ขอตั๋วรายเดือนด้วยนะ)") — an artefact of that site's ranking system
// that means nothing here.
const NOTE_LINE_RE = /^\s*[(（[【][^)）\]】]*[)）\]】]\s*$/;

/**
 * Split a chapter into its heading and its paragraphs.
 *
 * @param {string} text raw contents of final.txt / draft.txt
 * @returns {{num: string|null, title: string, heading: string, paragraphs: string[]}}
 */
export function splitTitleBody(text) {
  const lines = String(text || '').split(/\r?\n/);

  // find the first non-empty line — that is where the heading would be
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  let num = null;
  let title = '';
  const first = i < lines.length ? lines[i].trim() : '';
  const m = first ? TITLE_LINE_RE.exec(first) : null;
  if (m) {
    num = m[1];
    title = m[2].trim();
    i++;
  }
  // no match => no heading line was consumed, so the first line stays in the body

  const paragraphs = [];
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (NOTE_LINE_RE.test(line)) continue;
    paragraphs.push(line);
  }
  stripTrailingNote(paragraphs);

  const heading = num
    ? `บทที่ ${num} ${title}`.replace(/\s+/g, ' ').trim()
    : title;

  return { num, title, heading, paragraphs };
}

// A line of nothing but dots or dashes. The source sites use it to fence off an
// afterword — but it also appears mid-story as a scene break, so it can only be
// dropped once the note below it is gone, never as a signal on its own. Measured
// over the corpus: of the sampled chapters ending near a separator, several are
// followed by ordinary narration.
const SEPARATOR_RE = /^[\s.·•…\-–—_=*~^]{3,}$/u;

// What the author says to the source site's readers after the story ends: asking
// for that site's tickets/votes/bookmarks, or reporting the day's word count.
//
// Every term here is one a story never says. Words that DO appear in narration
// were deliberately left out even though they are common in real notes:
// "ขอบคุณ" (133 hits in tail lines — most of them dialogue), "สนับสนุน",
// "พันธมิตร" (an alliance, in a cultivation novel), "คอมเมนต์" (the live-stream
// novels are full of them). Missing a note is a cosmetic loss; eating the last
// line of a chapter is not.
const NOTE_TAIL_RE = new RegExp(
  'คะแนนแนะนำ|ขอคะแนน|ตั๋วรายเดือน|ตั๋วแนะนำ|ตั๋วประเมิน|ขอตั๋ว|โหวต|' +
  'เก็บเข้าชั้น|สมัครสมาชิก|ขอบคุณที่ติดตาม|ฝากติดตาม|' +
  // the day's output, always phrased as a count of words written
  '(?:เขียน|ปั่น|อัปเดต|อัพเดท|วันนี้|พรุ่งนี้)[^\\n]{0,30}?[\\d,]+\\s*(?:คำ|ตัวอักษร)|' +
  '^[\\d,]+\\s*[KkกิโลＫ]$'
);

/**
 * Drop an author's afterword from the end of `paragraphs`, in place.
 *
 * Only the last few paragraphs are even considered, and only ones that name
 * something from the source site's economy — position alone never removes text,
 * because a separator is just as likely to be a scene break. A separator left
 * dangling by a removal goes too, since it now fences off nothing.
 */
function stripTrailingNote(paragraphs) {
  const LOOK_BACK = 3;
  let removed = 0;
  while (paragraphs.length && removed < LOOK_BACK) {
    const last = paragraphs[paragraphs.length - 1];
    if (!NOTE_TAIL_RE.test(last)) break;
    paragraphs.pop();
    removed++;
  }
  if (removed && paragraphs.length && SEPARATOR_RE.test(paragraphs[paragraphs.length - 1])) {
    paragraphs.pop();
  }
  return paragraphs;
}

/**
 * The heading alone, for chapter lists. Cheap: only the head of the file is
 * ever passed in, so a 1,900-chapter table of contents never reads whole files.
 *
 * Falls back to the first line as-is when it is not a recognisable heading —
 * some opening text beats an empty row.
 */
export function headingOf(head) {
  const lines = String(head || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = TITLE_LINE_RE.exec(line);
    if (m) return `บทที่ ${m[1]} ${m[2].trim()}`.replace(/\s+/g, ' ').trim();
    return line.length > 80 ? line.slice(0, 80) + '…' : line;
  }
  return '';
}
