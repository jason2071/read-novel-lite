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

  // ------------------------------------------------------------ local prefs

  function localPrefs() {
    try {
      return JSON.parse(localStorage.getItem('readerPrefs') || '{}');
    } catch (e) {
      return {};
    }
  }

  function rememberLocally(patch) {
    try {
      var p = localPrefs();
      for (var k in patch) p[k] = patch[k];
      localStorage.setItem('readerPrefs', JSON.stringify(p));
    } catch (e) { /* private mode — the server copy still holds */ }
  }

  // ------------------------------------------------------------- server I/O

  var pending = null;
  var postTimer = null;

  // Slider drags and scroll pings both land here; one debounced POST carries
  // whatever accumulated, so dragging a slider is not one request per pixel.
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
      post(patch);
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
      post({ theme: theme }, 0);
    });
  });

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
