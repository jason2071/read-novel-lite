import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('shelf snapshots and chapter metadata stay fresh without request-time scans', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-novel-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'lib'));
  for (const file of ['store.js', 'chapter-text.js']) {
    await fs.copyFile(new URL(`../lib/${file}`, import.meta.url), path.join(root, 'lib', file));
  }
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const data = path.join(root, 'data');
  await fs.writeFile(path.join(root, '.env'), `NOVEL_DATA_DIR=${data.replaceAll('\\', '/')}`);
  const alpha = 'Alpha \u0e19\u0e34\u0e22\u0e32\u0e22';
  const baseTime = 1700000000000;
  async function put(novel, ref, file, text, offset = 0) {
    const dir = path.join(data, novel, 'chapters', ref);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, file);
    await fs.writeFile(target, text);
    await fs.utimes(target, new Date(baseTime + offset), new Date(baseTime + offset));
  }
  for (const novel of [alpha, 'Beta']) {
    await fs.mkdir(path.join(data, novel), { recursive: true });
    await fs.writeFile(path.join(data, novel, '_novel.json'), JSON.stringify({ genres: ['Fantasy'] }));
  }
  await put(alpha, '0001', 'final.txt', 'Title one\nBody', 1000);
  await put(alpha, '0001', 'draft.txt', 'Unused draft', 9000);
  await put(alpha, '0002', 'draft.txt', 'Title two\nBody', 2000);
  await put(alpha, '0002-x01', 'final.txt', '');
  await put(alpha, '0002-x01', 'draft.txt', 'Extra\nBody', 4000);
  await put(alpha, '0003', 'raw.txt', 'Untranslated');
  await put(alpha, '0004', 'final.txt', '');
  await put(alpha, '0004', 'draft.txt', '');
  await put(alpha, '_trash', 'final.txt', 'Hidden');
  await put('Beta', '0001', 'final.txt', 'Beta one', 3000);

  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 8000);
    timers.push(callback);
    return { unref() {} };
  });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const stat = fs.stat;
  const open = fs.open;
  let chapterStats = 0;
  let headReads = 0;
  let blockScan = false;
  let releaseScan;
  let scanStarted;
  let scanGate;
  t.mock.method(fs, 'stat', async (...args) => {
    if (/(?:final|draft)\.txt$/.test(String(args[0]))) {
      chapterStats++;
      if (blockScan) {
        scanStarted();
        await scanGate;
      }
    }
    return stat.apply(fs, args);
  });
  t.mock.method(fs, 'open', (...args) => {
    headReads++;
    return open.apply(fs, args);
  });
  const store = await import(pathToFileURL(path.join(root, 'lib', 'store.js')));
  const [first, concurrent] = await Promise.all([store.listNovels(), store.listNovels()]);
  assert.deepEqual(first, concurrent);
  assert.equal(chapterStats, 10, 'concurrent cold requests share one file scan');
  assert.equal(first.length, 2);
  assert.deepEqual(first[0].refs, ['0001', '0002', '0002-x01']);
  assert.equal(first[0].count, 3);
  assert.equal(first[0].updatedAt, baseTime + 4000, 'final wins over a newer draft');
  assert.equal(first[1].updatedAt, baseTime + 3000);
  first[0].resume = { ref: '0001' };
  const warm = await store.listNovels();
  assert.equal(warm[0].resume, undefined, 'reading progress does not leak into cached rows');
  assert.equal(chapterStats, 10, 'warm shelf reads do not stat chapter files');
  const oldTitle = (await store.chapterTitles(alpha, ['0001']))[0];
  const readsBefore = headReads;
  await timers.shift()();
  await store.chapterTitles(alpha, ['0001']);
  assert.equal(headReads, readsBefore, 'unchanged titles survive background scans');

  const chapterDir = path.join(data, alpha, 'chapters');
  const dirTime = (await stat(chapterDir)).mtimeMs;
  await put(alpha, '0003', 'draft.txt', 'Newly translated\nBody', 10000);
  await put(alpha, '0001', 'final.txt', 'Changed title\nBody', 11000);
  await fs.rm(path.join(chapterDir, '0002'), { recursive: true });
  // Restore the parent timestamp to prove freshness does not rely on it.
  await fs.utimes(chapterDir, new Date(dirTime), new Date(dirTime));
  blockScan = true;
  scanGate = new Promise((resolve) => { releaseScan = resolve; });
  const started = new Promise((resolve) => { scanStarted = resolve; });
  const refreshing = timers.shift()();
  await started;
  const stale = await store.listNovels();
  assert.equal(stale[0].updatedAt, baseTime + 4000, 'requests use the prior complete snapshot during a scan');
  blockScan = false;
  releaseScan();
  await refreshing;
  const refreshed = await store.listNovels();
  assert.deepEqual(refreshed[0].refs, ['0001', '0002-x01', '0003']);
  assert.equal(refreshed[0].updatedAt, baseTime + 11000);
  assert.notEqual((await store.chapterTitles(alpha, ['0001']))[0], oldTitle);
  assert.equal(await store.latestReadableUpdate(alpha, ['0003']), baseTime + 10000);
  assert.deepEqual(await store.chapterRefs('../outside'), []);
  assert.equal(await store.latestReadableUpdate('../outside', ['0001']), 0);

  await put(alpha, '0004', 'final.txt', 'Previously empty\nBody', 12000);
  now += 8001;
  assert.ok((await store.chapterRefs(alpha)).includes('0004'), 'direct chapter requests also expire the cache');
  await fs.rm(path.join(data, 'Beta'), { recursive: true });
  await fs.mkdir(path.join(data, 'Gamma'));
  await fs.writeFile(path.join(data, 'Gamma', '_novel.json'), '{}');
  await timers.shift()();
  assert.deepEqual((await store.listNovels()).map((n) => n.name), [alpha, 'Gamma']);

  const readdir = fs.readdir;
  const savedError = console.error;
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const failing = t.mock.method(fs, 'readdir', async (dir, ...args) => {
    if (String(dir) === data) throw Object.assign(new Error('Unavailable'), { code: 'EACCES' });
    return readdir.call(fs, dir, ...args);
  });
  await timers.shift()();
  assert.deepEqual((await store.listNovels()).map((n) => n.name), [alpha, 'Gamma']);
  assert.equal(errors.length, 1, 'background failure is logged and keeps the last snapshot');
  failing.mock.restore();
  console.error = savedError;
  await timers.shift()();
  assert.deepEqual((await store.listNovels()).map((n) => n.name), [alpha, 'Gamma']);
});
