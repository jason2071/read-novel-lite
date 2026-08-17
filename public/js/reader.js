// Reader page behaviour: the settings modal, the four sliders, and remembering
// where you stopped. Plain DOM, no framework — the page is one article and a bar.

(function () {
  var reader = document.getElementById('reader');
  if (!reader) return;

  var modal = document.getElementById('reader-settings');
  var novel = reader.dataset.novel;
  var ref = reader.dataset.ref;

  var CSS_VAR = {
    font_size: ['--reader-fs', 'px'],
    line_height: ['--reader-lh', ''],
    indent: ['--reader-indent', 'em'],
    para_gap: ['--reader-gap', 'em']
  };
  var THEMES = ['light', 'dark', 'sepia'];
  var RANGES = {
    font_size: [14, 40],
    line_height: [1.2, 3],
    indent: [0, 5],
    para_gap: [0, 3]
  };

  // ------------------------------------------------------------ local prefs

  function localPrefs() {
    try {
      var raw = JSON.parse(localStorage.getItem('readerPrefs') || '{}');
      var prefs = {};
      if (!raw || typeof raw !== 'object') return prefs;
      if (THEMES.indexOf(raw.theme) >= 0) prefs.theme = raw.theme;
      for (var key in RANGES) {
        if (typeof raw[key] !== 'number' || !isFinite(raw[key])) continue;
        prefs[key] = Math.min(RANGES[key][1], Math.max(RANGES[key][0], raw[key]));
      }
      return prefs;
    } catch (e) {
      return {};
    }
  }

  function rememberLocally(patch) {
    try {
      var p = localPrefs();
      for (var k in patch) p[k] = patch[k];
      localStorage.setItem('readerPrefs', JSON.stringify(p));
    } catch (e) { /* private mode / disabled storage — changes last for this page only */ }
  }

  function applyPrefs(prefs) {
    if (prefs.theme) reader.dataset.readerTheme = prefs.theme;
    for (var key in CSS_VAR) {
      if (typeof prefs[key] !== 'number') continue;
      reader.style.setProperty(CSS_VAR[key][0], prefs[key] + CSS_VAR[key][1]);
      var input = document.getElementById('rng-' + key);
      var out = document.getElementById('out-' + key);
      if (input) input.value = prefs[key];
      if (out) out.textContent = prefs[key] + (input ? input.dataset.unit || '' : '');
    }
    Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (btn) {
      btn.classList.toggle('active', btn.dataset.theme === reader.dataset.readerTheme);
    });
  }

  // ------------------------------------------------------------- server I/O

  var pending = null;
  var postTimer = null;

  // Scroll pings are coalesced so continuous reading does not mean one request
  // per scroll event. Appearance settings deliberately never leave this device.
  function post(patch, delay) {
    pending = Object.assign(pending || {}, patch);
    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(function () {
      var payload = pending;
      pending = null;
      postTimer = null;
      fetch('/api/reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () { /* offline: localStorage still has the prefs */ });
    }, delay === undefined ? 400 : delay);
  }

  // ---------------------------------------------------------------- sliders

  Array.prototype.forEach.call(document.querySelectorAll('.reader-slider input[type=range]'), function (input) {
    input.addEventListener('input', function () {
      var key = input.dataset.key;
      var unit = input.dataset.unit || '';
      var value = parseFloat(input.value);
      var out = document.getElementById('out-' + key);
      if (out) out.textContent = value + unit;
      reader.style.setProperty(CSS_VAR[key][0], value + CSS_VAR[key][1]);

      var patch = {};
      patch[key] = value;
      rememberLocally(patch);
    });
  });

  // ----------------------------------------------------------------- themes

  Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (btn) {
    btn.addEventListener('click', function () {
      var theme = btn.dataset.theme;
      reader.dataset.readerTheme = theme;
      Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      rememberLocally({ theme: theme });
    });
  });

  // The inline script applied these values before the reader was painted.
  // Repeat it here after the controls exist so their selected state and labels
  // match the content on this particular browser.
  applyPrefs(localPrefs());

  // ------------------------------------------------------------------ modal

  var open = document.getElementById('btn-reader-settings');
  var close = document.getElementById('btn-close-settings');
  if (open && modal) open.addEventListener('click', function () { modal.showModal(); });
  if (close && modal) close.addEventListener('click', function () { modal.close(); });
  // click on the backdrop = outside the dialog's own box
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.close();
    });
  }

  // --------------------------------------------------------------- progress

  function scrollRatio() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, window.scrollY / max));
  }

  var lastSent = -1;
  function saveProgress(delay) {
    var ratio = scrollRatio();
    // ignore drift smaller than a screenful-ish, but always send the first ping
    // of a chapter so opening it moves the bookmark
    if (lastSent >= 0 && Math.abs(ratio - lastSent) < 0.01) return;
    lastSent = ratio;
    post({ novel: novel, ref: ref, scroll: ratio }, delay);
  }

  // Opening a chapter is itself the bookmark — otherwise clicking "next" and
  // reading without scrolling leaves the mark on the previous chapter.
  // Except when the bookmark already points here mid-chapter: that ping would
  // fire before the saved offset is restored and overwrite it with 0.
  var resumeAt = parseFloat(reader.dataset.resume || '0');
  if (resumeAt > 0) lastSent = resumeAt;
  else saveProgress(0);

  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      saveProgress();
    }, 600);
  }, { passive: true });

  // leaving the tab (or the phone locking) is the moment most likely to end a
  // reading session, and the only one a scroll handler never sees
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveProgress(0);
  });

  // ----------------------------------------------------------------- resume

  if (resumeAt > 0) {
    var restored = false;
    var restore = function () {
      // the reader has already moved: their scroll wins over the bookmark
      if (restored || window.scrollY > 0) return;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      restored = true;
      window.scrollTo(0, resumeAt * max);
    };
    // Both, not just rAF: a chapter opened in a background tab gets no animation
    // frame until it is focused, and would otherwise sit at the top when the
    // reader finally switches to it. `load` waits for the layout to settle.
    restore();
    window.addEventListener('load', restore);
    requestAnimationFrame(restore);
  }

  // -------------------------------------------------------------- shortcuts

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (modal && modal.open) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    var target = null;
    if (e.key === 'ArrowLeft') target = reader.dataset.prev;
    if (e.key === 'ArrowRight') target = reader.dataset.next;
    if (!target) return;
    e.preventDefault();
    saveProgress(0);
    location.href = '/read/' + encodeURIComponent(novel) + '/' + encodeURIComponent(target);
  });
})();
