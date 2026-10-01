// Quadra's loading screen and first update check, shared by every app (a
// classic script, loaded right after <div id="loading"> so it runs before
// the app's modules): the kit's copy, synced as public/boot.js. Never edit
// an app's copy.
//
// - Draws the loading screen into #loading (logo, the app's name from
//   data-title, a progress line and what it's doing), so every app opens
//   the same way.
// - Checks version.json while the app's files load: a newer deploy than
//   this page (meta build-version) is loaded straight away, its old cached
//   files dropped (data-cache, the service worker's cache prefix), before
//   anything starts. The kit's watchUpdates keeps the page current after.
// - Offers a way out when the app never starts (an error, or 15 s): reload,
//   or open anyway. The app says it started with window.__fxStarted (or the
//   older __oddsStarted / __stockStarted) and hides #loading itself (the kit
//   does).
(function () {
  var box = document.getElementById('loading');
  if (!box) return;
  var zh = /^zh/i.test(document.documentElement.lang || navigator.language || '');
  var L = function (a, b) {
    return zh ? a : b;
  };
  var title = box.getAttribute('data-title') || document.title;
  var logo = box.getAttribute('data-logo') || './favicon.svg';
  box.className = 'loading q-boot';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML =
    '<div class="q-boot-box">' +
    '<img class="q-boot-logo" alt="" width="72" height="72">' +
    '<p class="q-boot-brand">QUADRA</p>' +
    '<p class="q-boot-title"></p>' +
    '<div class="q-boot-bar" aria-hidden="true"><i></i></div>' +
    '<p class="q-boot-step"></p>' +
    '<div class="q-boot-error" hidden><p class="q-boot-error-text"></p>' +
    '<div class="q-boot-actions"><button type="button" class="q-btn primary" data-act="reload"></button><button type="button" class="q-btn" data-act="skip"></button></div></div>' +
    '</div>';
  var q = function (sel) {
    return box.querySelector(sel);
  };
  q('.q-boot-logo').src = logo;
  q('.q-boot-title').textContent = title;
  q('[data-act=reload]').textContent = L('重新整理', 'Reload');
  q('[data-act=skip]').textContent = L('直接開啟', 'Open anyway');
  q('[data-act=reload]').onclick = function () {
    location.reload();
  };
  q('[data-act=skip]').onclick = function () {
    box.hidden = true;
  };

  // The progress line creeps towards 90% on its own; the app can name a
  // step (window.__bootStep('…')), and hiding #loading ends it.
  var shown = 0.08;
  var bar = q('.q-boot-bar i');
  var step = q('.q-boot-step');
  var paint = function () {
    bar.style.transform = 'scaleX(' + shown.toFixed(3) + ')';
  };
  paint();
  step.textContent = L('載入中…', 'Loading…');
  var timer = setInterval(function () {
    if (box.hidden) return clearInterval(timer);
    shown += (0.9 - shown) * 0.08;
    paint();
  }, 120);
  window.__bootStep = function (text, part) {
    if (text) step.textContent = text;
    if (part > shown) {
      shown = Math.min(0.98, part);
      paint();
    }
  };

  var started = function () {
    return Boolean(window.__fxStarted || window.__oddsStarted || window.__stockStarted || window.__quadraStarted);
  };
  var fail = function (message) {
    if (box.hidden || !q('.q-boot-error').hidden) return;
    q('.q-boot-error-text').textContent = message || L('頁面沒有正常啟動，可能是網路不穩。', "The page didn't start, maybe a network hiccup.");
    q('.q-boot-error').hidden = false;
    q('.q-boot-bar').hidden = true;
    step.hidden = true;
  };
  // The names the apps' scripts already call.
  window.__quadraFail = window.__fxFail = window.__oddsFail = window.__stockFail = fail;
  window.addEventListener('error', function () {
    if (!started()) fail();
  });
  setTimeout(function () {
    if (!started()) fail();
  }, 15000);

  // A newer deploy than this page: load it now, before the app starts.
  var meta = document.querySelector('meta[name="build-version"]');
  var current = meta && meta.content;
  if (!current || current === 'dev' || !window.fetch) return;
  var cachePrefix = box.getAttribute('data-cache') || '';
  var ctl = window.AbortController ? new AbortController() : null;
  setTimeout(function () {
    if (ctl) ctl.abort();
  }, 3000);
  fetch('./version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl && ctl.signal })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (v) {
      var latest = v && v.version;
      if (!latest || latest === current) return;
      var flag = 'quadra.bootTo:' + location.pathname;
      if (sessionStorage.getItem(flag) === latest) return;
      sessionStorage.setItem(flag, latest);
      window.__bootUpdating = true;
      step.textContent = L('更新到最新版本…', 'Updating to the latest version…');
      var go = function () {
        location.replace(location.pathname + '?v=' + encodeURIComponent(latest) + location.hash);
      };
      if (!window.caches || !cachePrefix) return go();
      caches
        .keys()
        .then(function (names) {
          return Promise.all(
            names
              .filter(function (n) {
                return n.indexOf(cachePrefix) === 0;
              })
              .map(function (n) {
                return caches.delete(n);
              })
          );
        })
        .then(go, go);
    })
    .catch(function () {});
})();
