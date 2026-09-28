// Quadra: what every Quadra app shares. The canonical copy lives in
// Shared-Proxy/kit/; `node kit/sync.mjs` copies it into each app (never edit
// an app's copy by hand).
//
//   Quadra Securities   stock   the financial powerhouse: where money lives and grows
//   Quadra Play         odds    a place to play: sports betting and the lottery
//   Quadra Fixtures     match   the sports data centre, and the way into Play
//   Quadra Rewards      vocab   the centre of Quadra: earning, goals and every app's guide
//   Orbit Class         orbit   a related add-on: the class schedule
//
// One account works everywhere: the Quadra Pass, a 10-character code for
// Shared-Proxy's /eco. It is required: every app opens on a sign-in screen
// until the device is signed in, and the data proxy only answers signed-in
// apps. A device keeps a revocable sign-in, never the pass; another device
// signs in with the pass or a 10-minute device code. Behind the pass is one
// NT$ money pool (play money only), and the pass is the only place anything
// is saved.
//
// One app at a time: the app in use is the account's live one. Opening
// another app (or the same app on another device) makes that one live; the
// one left behind stops refreshing and shows where Quadra is open, with a
// button to continue there. Links between the apps carry the sign-in along.

export const ECO_URL = 'https://orbit-workers-proxy.pengzjay.workers.dev/eco';
export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev/sports-proxy';
export const SITE = 'https://jaypengx.github.io';
export const BRAND = { name: 'Quadra', pass: 'Quadra Pass' };

// The apps. `related`: an add-on outside the money pool (Orbit Class).
export const APPS = {
  stock: { name: 'Quadra Securities', short: 'Securities', path: '/Quadra-Securities/', color: '#0d9488', role: { zh: '投資與理財', en: 'Invest and grow' } },
  odds: { name: 'Quadra Play', short: 'Play', path: '/Quadra-Play/', color: '#2563eb', role: { zh: '運彩與彩券', en: 'Sports bets and lottery' } },
  match: { name: 'Quadra Fixtures', short: 'Fixtures', path: '/Quadra-Fixtures/', color: '#ea580c', role: { zh: '賽事資料中心', en: 'Every sport, every stat' } },
  vocab: { name: 'Quadra Rewards', short: 'Rewards', path: '/Quadra-Rewards/', color: '#7c3aed', role: { zh: '賺錢、目標與說明', en: 'Earn, goals and help' } },
  orbit: { name: 'Orbit Class', short: 'Orbit Class', tile: 'Orbit', path: '/Orbit-Class/', color: '#0ea5e9', related: true, role: { zh: '課表', en: 'Class schedule' } }
};
export const FAMILY = ['stock', 'odds', 'match', 'vocab'];
export const appName = app => APPS[app]?.name || app;

// ---- The economy -------------------------------------------------------------------
//
// One pool, one payday (paid by the Worker, whichever app is opened): a new
// pass opens with NT$110,000, and the 1st of every Taiwan month pays
// NT$7,000 (shown under the balance in the account sheet). Securities is where it grows (a diversified
// portfolio about 6-8% a year, real costs); Play is where it shrinks (the
// lottery keeps about 22%); Rewards pays for effort: word practice best
// (about NT$20 a minute), games about NT$15 a minute, missions a little
// for using the apps, all capped a day.
export const ECONOMY = {
  start: 110_000,
  monthly: 7_000,
  // Rewards: word practice, games and missions, with their caps a Taiwan day.
  vocab: { perCorrect: 3, perMastered: 25, dailyCap: 600 },
  gamesPerMinute: 15,
  gamesDailyCap: 400,
  missionsDailyCap: 300
};

// ---- Language ------------------------------------------------------------------------

export function detectLang() {
  try {
    const saved = localStorage.getItem('quadra.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {}
  const langs = globalThis.navigator?.languages || [globalThis.navigator?.language || 'zh-TW'];
  return langs.some(l => /^zh/i.test(l)) || !langs.some(l => /^en/i.test(l)) ? 'zh' : 'en';
}
export const pick = (lang, zh, en) => (lang === 'en' ? en : zh);

// ---- Codes ---------------------------------------------------------------------------

export const PASS_PATTERN = /^[2-9A-HJ-NP-Z]{10}$/;
export const DEVICE_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
export function cleanCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}
export const isPass = code => PASS_PATTERN.test(cleanCode(code));
export const formatPass = code => (code && code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code || '');

// ---- Storage -------------------------------------------------------------------------
//
// A device keeps its refresh token (a revocable sign-in for this device) and
// the account's id, never the pass itself: the pass is typed to sign in,
// shown once when it's made, and that's all.

const KEY = { refresh: 'quadra.refresh', account: 'quadra.account', wallet: 'quadra.wallet', aff: 'quadra.aff', dismiss: 'quadra.dismiss', notify: 'quadra.notify', oldPass: 'quadra.pass' };
function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
const readJson = (key, fallback) => {
  try {
    return JSON.parse(readStore(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

// The signed-in account's id on this device (the first 16 characters of
// the pass's hash, from the refresh token), '' when signed out.
export function storedAccount() {
  const id = readStore(KEY.account) || '';
  return /^[0-9a-f]{16}$/.test(id) && readStore(KEY.refresh) ? id : '';
}
function accountOf(refresh) {
  try {
    const body = String(refresh).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body + '==='.slice((body.length + 3) % 4))).d.slice(0, 16);
  } catch {
    return '';
  }
}
export function cachedWallet(account = storedAccount()) {
  const saved = readJson(KEY.wallet, null);
  return saved && account && saved.account === account ? saved.wallet : null;
}
function cacheWallet(account, wallet) {
  if (account && wallet) writeStore(KEY.wallet, JSON.stringify({ account, wallet }));
}
// The app's own data as last read or written on this device (under the
// account), so a cold start paints at once, before the Worker answers.
// Only small ones (Securities keeps its own compressed copy).
const payloadKey = app => `quadra.payload.${app}`;
export function cachedPayload(app, account = storedAccount()) {
  const saved = readJson(payloadKey(app), null);
  return saved && account && saved.account === account ? saved.payload : null;
}
function cachePayload(app, account, payload) {
  if (!account || typeof payload !== 'string') return;
  writeStore(payloadKey(app), payload.length < 200_000 ? JSON.stringify({ account, payload }) : null);
}

// ---- The Worker ----------------------------------------------------------------------

async function call(method, query = '', body) {
  const res = await fetch(`${ECO_URL}${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `HTTP ${res.status}`);
    error.code = data?.error?.code || `HTTP_${res.status}`;
    error.status = res.status;
    error.live = data?.live || null;
    if (data?.error?.index != null) error.index = data.error.index;
    throw error;
  }
  return data;
}
const qs = params => `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()}`;

export function randomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Data through the proxy: batched, remembered, shared ------------------------------
//
// proxyJson(url, { ttl, trim, persist }) is how every app reads outside data
// (ESPN, Kambi, Yahoo…) through the data proxy:
//
//   - the same URL asked twice within `ttl` is answered from memory;
//   - with `persist` (the default), the answer is also kept on the device
//     (Cache Storage), so it survives closing the app: a copy younger than
//     `ttl` is used without asking the proxy at all, and peekJson(url) gives
//     the last copy of any age for painting at once while a fresh one loads;
//   - requests made within a few milliseconds of each other go to the proxy
//     as one batch (`?batch=1&u=…`, up to 12): the Worker plan bills per
//     request, and a first paint asks for a dozen lists at once. A proxy
//     that doesn't know batches yet is asked one by one.
//
// The session token comes from the app's quadraSession (the last one made).
let dataSession = null;
const DATA_CACHE = 'quadra-data-v1';
const DATA_KEEP_MS = 4 * 86_400_000;
const memory = new Map();
const dataKey = (url, trim) => `https://quadra.data/${trim ? `${trim}!` : ''}${encodeURIComponent(url)}`;
const hasCaches = () => typeof caches !== 'undefined' && typeof Response !== 'undefined';
async function persisted(key) {
  if (!hasCaches()) return null;
  try {
    const cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(key);
    if (!hit) return null;
    return { at: Number(hit.headers.get('x-at')) || 0, data: await hit.json() };
  } catch {
    return null;
  }
}
let prunedAt = 0;
async function persist(key, text) {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'x-at': String(Date.now()) } }));
    // Now and then, what's older than a few days goes.
    if (Date.now() - prunedAt > 10 * 60_000) {
      prunedAt = Date.now();
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (Date.now() - (Number(res?.headers.get('x-at')) || 0) > DATA_KEEP_MS) await cache.delete(req);
      }
    }
  } catch {}
}
export function clearData() {
  memory.clear();
  if (hasCaches()) caches.delete(DATA_CACHE).catch(() => {});
}
// The last copy kept on this device, of any age: { at, data } or null.
export const peekJson = (url, { trim = '' } = {}) => persisted(dataKey(url, trim));

async function dataToken() {
  const s = dataSession;
  if (!s) return '';
  return s.ensureToken().catch(() => s.token || '');
}
const proxyAddress = (url, trim, token) => `${PROXY_URL}?url=${encodeURIComponent(url)}${trim ? `&trim=${trim}` : ''}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
async function fetchOne(url, trim, timeout) {
  const token = await dataToken();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(proxyAddress(url, trim, token), { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return await res.text();
    } catch (error) {
      if (attempt >= 1 || (error.status >= 400 && error.status < 500 && error.status !== 429)) throw error;
      await new Promise(r => setTimeout(r, 700));
    }
  }
}
// The batch queue.
const BATCH_MAX = 12;
let queue = [];
let flushTimer = 0;
let batchOff = false;
function enqueue(url, trim, timeout) {
  return new Promise((resolve, reject) => {
    queue.push({ url, trim, timeout, resolve, reject });
    if (queue.length >= BATCH_MAX) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 12);
  });
}
async function flush() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const items = queue.splice(0, BATCH_MAX);
  if (queue.length) flushTimer = setTimeout(flush, 0);
  if (!items.length) return;
  const one = item => fetchOne(item.url, item.trim, item.timeout).then(item.resolve, item.reject);
  if (items.length === 1 || batchOff) return void items.forEach(one);
  try {
    const token = await dataToken();
    const u = items.map(i => `&u=${encodeURIComponent(i.trim ? `${i.trim}!${i.url}` : i.url)}`).join('');
    const res = await fetch(`${PROXY_URL}?batch=1${u}${token ? `&qt=${encodeURIComponent(token)}` : ''}`, { signal: AbortSignal.timeout(Math.max(...items.map(i => i.timeout))) });
    if (res.status === 400) {
      // A proxy from before batches: one by one from now on.
      batchOff = true;
      return void items.forEach(one);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { r } = await res.json();
    items.forEach((item, i) => {
      const got = r?.[i];
      if (got?.s === 200) item.resolve(got.b);
      else if (got?.s >= 500 || got?.s === 429 || !got) one(item);
      else item.reject(Object.assign(new Error(`HTTP ${got.s}`), { status: got.s }));
    });
  } catch {
    items.forEach(one);
  }
}

// A text in another language (English company descriptions for a Chinese
// reader…), through the proxy's translate route, kept a month everywhere.
// to: 'zh-TW' | 'en' | …; resolves to the original text if it can't.
export async function translate(text, to = 'zh-TW', from = 'auto') {
  const q = String(text || '').slice(0, 4500);
  if (!q.trim()) return q;
  try {
    const got = await proxyJson(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${from}&tl=${to}&q=${encodeURIComponent(q)}`, { ttl: 30 * 86_400_000 });
    const out = Array.isArray(got) ? (Array.isArray(got[0]) ? got[0][0] : got[0]) : null;
    return typeof out === 'string' && out.trim() ? out : q;
  } catch {
    return q;
  }
}

export function proxyJson(url, { ttl = 60_000, trim = '', persist: keep = true, timeout = 20_000 } = {}) {
  const key = dataKey(url, trim);
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = (async () => {
    if (keep) {
      const saved = await persisted(key);
      if (saved && Date.now() - saved.at < ttl) return saved.data;
    }
    const got = await enqueue(url, trim, timeout);
    const data = typeof got === 'string' ? JSON.parse(got) : got;
    // Kept on the device off the critical path.
    if (keep) setTimeout(() => persist(key, typeof got === 'string' ? got : JSON.stringify(got)), 0);
    return data;
  })();
  memory.set(key, { at: Date.now(), promise });
  promise.catch(() => memory.delete(key));
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return promise;
}

// ---- The session ---------------------------------------------------------------------
//
// const q = quadraSession('odds');
// q.on('wallet', w => ...)      the wallet changed (pool, settings…)
// q.on('active', live => ...)   true: this app is the live one; false: paused
// q.on('signedout', () => ...)
// await q.start()               signs in (the gate) and makes this app live;
//                               resolves to the first reply ({ payload, inbox,
//                               wallet } or { offline })
// q.pass                        the account's id on this device ('' signed out)
// q.oldPass                     a pass older versions kept here (for their keys)
// q.read({ data, inbox })       { wallet, pool, payload, inbox } (app data when data)
// q.write({ payload, wallet })  only while live
// q.proxy(url, extra)           the data proxy's address for `url`, signed in

// No two-finger zoom in any Quadra app. iOS ignores the viewport's
// user-scalable=no in Safari and doesn't honour touch-action for pinches
// everywhere, so the pinch itself is stopped: its gesture events (Safari),
// a move with two fingers down (every touch browser) and ctrl+wheel (a
// trackpad pinch). One finger still scrolls and every tap still works.
function noZoom() {
  if (typeof document === 'undefined' || document.__quadraNoZoom) return;
  document.__quadraNoZoom = true;
  const stop = e => e.cancelable && e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  document.addEventListener('touchmove', e => e.touches && e.touches.length > 1 && stop(e), { passive: false });
  globalThis.addEventListener?.('wheel', e => e.ctrlKey && stop(e), { passive: false });
}
noZoom();

// The solid strip under the phone's status bar (see .q-statusbar in quadra.css).
function statusStrip() {
  if (typeof document === 'undefined' || !document.body || document.querySelector('.q-statusbar')) return;
  const bar = document.createElement('div');
  bar.className = 'q-statusbar';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
}
if (typeof document !== 'undefined') document.body ? statusStrip() : document.addEventListener('DOMContentLoaded', statusStrip);

export function quadraSession(app, { lang = detectLang(), heartbeat = 60_000 } = {}) {
  const made = makeSession(app, { lang, heartbeat });
  dataSession = made;
  return made;
}
function makeSession(app, { lang, heartbeat }) {
  const listeners = {};
  const emit = (name, value) => (listeners[name] || []).forEach(fn => fn(value));
  let token = '';
  let tokenAt = 0;
  let active = false;
  let live = null;
  let wallet = cachedWallet();
  let timer = 0;
  let started = false;
  const oldPass = PASS_PATTERN.test(readStore(KEY.oldPass) || '') ? readStore(KEY.oldPass) : '';
  // Signed in by an older version: the account's id from its refresh token.
  if (readStore(KEY.refresh) && !readStore(KEY.account)) writeStore(KEY.account, accountOf(readStore(KEY.refresh)));

  const s = {
    app,
    lang,
    oldPass,
    get pass() {
      return storedAccount();
    },
    get token() {
      return token;
    },
    get wallet() {
      return wallet;
    },
    get pool() {
      return poolBalance(wallet);
    },
    get active() {
      return active;
    },
    get live() {
      return live;
    },
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
      return s;
    }
  };

  function setWallet(w) {
    if (!w) return;
    wallet = w;
    cacheWallet(storedAccount(), w);
    emit('wallet', w);
  }
  function setActive(next, where = null) {
    live = where;
    if (active === next) return;
    active = next;
    emit('active', next);
    if (!next) showMoved(s);
    else hideMoved();
  }
  function absorb(data) {
    if (data.refresh) {
      writeStore(KEY.refresh, data.refresh);
      writeStore(KEY.account, accountOf(data.refresh));
      writeStore(KEY.oldPass, null);
    }
    if (data.token) {
      token = data.token;
      tokenAt = Date.now();
    }
    if (data.wallet) setWallet(data.wallet);
    if (typeof data.payload === 'string') cachePayload(app, storedAccount(), data.payload);
    if (data.active != null) setActive(Boolean(data.active), data.live || null);
    return data;
  }

  // Every way of signing in ends here: a refresh token for this device.
  const signIn = body => call('POST', '', { ...body, app, inbox: true }).then(res => absorb({ ...res, active: true }));
  const login = code => signIn(DEVICE_CODE_PATTERN.test(cleanCode(code)) ? { op: 'pair-redeem', code: cleanCode(code) } : { op: 'login', passcode: cleanCode(code) });
  const create = () => signIn({ op: 'create' });
  // A session from the device's refresh token (claim: make this app live).
  async function refresh({ claim = false, data = false } = {}) {
    const ref = readStore(KEY.refresh);
    if (!ref) return signedOut();
    try {
      return absorb(await call('POST', '', { op: 'refresh', refresh: ref, app, claim, data, inbox: data }));
    } catch (error) {
      if (error.code === 'ECO_SIGNED_OUT' || error.code === 'ECO_TOKEN_INVALID') return signedOut();
      throw error;
    }
  }
  function signedOut() {
    for (const k of [KEY.refresh, KEY.account, KEY.wallet, KEY.oldPass, payloadKey(app)]) writeStore(k, null);
    clearData();
    token = '';
    wallet = null;
    active = false;
    emit('signedout');
    return { signedOut: true };
  }
  // Every call with the session token: a fresh one on expiry, once.
  async function withToken(fn) {
    if (!token || Date.now() - tokenAt > 15 * 60_000) await refresh({ claim: false });
    if (!token) {
      const error = new Error('not live');
      error.code = 'ECO_SESSION_MOVED';
      error.live = live;
      setActive(false, live);
      throw error;
    }
    try {
      return await fn(token);
    } catch (error) {
      if (error.code === 'ECO_TOKEN_INVALID') {
        await refresh({ claim: false });
        return fn(token);
      }
      if (error.code === 'ECO_SIGNED_OUT') signedOut();
      if (error.code === 'ECO_SESSION_MOVED') setActive(false, error.live);
      throw error;
    }
  }

  s.login = login;
  s.create = create;
  s.claim = () => refresh({ claim: true });
  s.signOut = () => signedOut();
  // Every other device signed out; this one stays signed in.
  s.signOutEverywhere = () => withToken(qt => call('POST', '', { op: 'signout-all', qt })).then(absorb);
  // A new pass for the account: shown once, the old one stops working.
  s.rotate = () =>
    withToken(qt => call('POST', '', { op: 'rotate', qt })).then(res => {
      absorb(res);
      return res.passcode;
    });
  // A device code: sign in on another device within 10 minutes, once.
  s.deviceCode = () => withToken(qt => call('POST', '', { op: 'pair-create', qt }));
  s.read = ({ data = false, inbox = false } = {}) =>
    withToken(qt => call('GET', qs({ qt, app: data ? app : '', inbox: inbox ? '1' : '' }))).then(res => {
      absorb(res);
      return res;
    });
  s.write = ({ payload, wallet: patch } = {}) =>
    withToken(qt => {
      if (!active) {
        const error = new Error('not live');
        error.code = 'ECO_SESSION_MOVED';
        error.live = live;
        throw error;
      }
      return call('PATCH', qs({ qt, app }), { payload, wallet: patch });
    }).then(res => {
      if (typeof payload === 'string') cachePayload(app, storedAccount(), payload);
      return absorb(res);
    });
  s.dropInbox = id => withToken(qt => call('DELETE', qs({ qt, app, inbox: id })));
  // Other passes into this one (they're deleted after).
  s.merge = passes => withToken(qt => call('POST', '', { op: 'merge', qt, sources: passes.map(passcode => ({ passcode })) })).then(absorb);
  s.op = (op, body = {}) => withToken(qt => call('POST', '', { op, qt, ...body }));
  // The data proxy, signed in.
  s.proxy = (url, extra = '') => `${PROXY_URL}?url=${encodeURIComponent(url)}${extra}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
  s.ensureToken = async () => {
    if (!token || Date.now() - tokenAt > 15 * 60_000) await refresh({ claim: false });
    return token;
  };

  // Sign in (the gate, when this device isn't), take a sign-in handed over
  // by a link, and make this app live.
  s.start = async ({ data = true } = {}) => {
    if (started) return s.first || {};
    started = true;
    let first = null;
    try {
      first = await takeHandoff(app);
      if (first) absorb({ ...first, active: true });
      // A pass an older version kept on this device: traded for a device
      // sign-in, then forgotten.
      else if (oldPass && !readStore(KEY.refresh)) first = await login(oldPass).catch(() => null);
      if (!first && storedAccount()) {
        first = await refresh({ claim: true, data });
        if (first?.signedOut) first = null;
      }
    } catch (error) {
      // Offline: the cached wallet stands in until the next try.
      first = { offline: true, error };
    }
    writeStore(KEY.oldPass, null);
    if (!first) first = await signInGate(s);
    s.first = first;
    loop();
    // The first reply: what the app merges its own copy with (never the
    // session itself: an app that took the session for the reply saw "no
    // data" and saved over the pass).
    return first || {};
  };
  function loop() {
    clearInterval(timer);
    timer = setInterval(beat, heartbeat);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
    globalThis.addEventListener?.('pageshow', event => event.persisted && wake());
    globalThis.addEventListener?.('online', wake);
  }
  // Back on screen: this app becomes the live one again.
  let waking = null;
  function wake() {
    if (!storedAccount() || waking) return;
    waking = refresh({ claim: true })
      .catch(() => {})
      .finally(() => (waking = null));
  }
  function beat() {
    if (document.visibilityState === 'hidden' || !storedAccount() || !active) return;
    s.read().catch(() => {});
  }

  s.appUrl = (other, hash = '') => appUrl(other, hash);
  // A link to another app that arrives signed in (apps on a phone's home
  // screen don't share storage): a sealed sign-in, good for 3 minutes.
  s.go = async (other, hash = '') => {
    let target = appUrl(other, hash);
    if (isStandalone() && storedAccount()) {
      try {
        const { handoff } = await s.op('handoff');
        target = appUrl(other, [String(hash || '').replace(/^#/, ''), `qh=${handoff}`].filter(Boolean).join('&'));
      } catch {}
    }
    globalThis.location.assign(target);
  };
  return s;
}

export function appUrl(app, hash = '') {
  const h = String(hash || '').replace(/^#/, '');
  return `${APPS[app]?.path || '/'}${h ? `#${h}` : ''}`;
}

// A sign-in handed over in the address (#qh=<sealed>): taken out of the
// address at once and traded for this device's own sign-in. null if none.
async function takeHandoff(app) {
  const loc = globalThis.location;
  if (!loc?.hash) return null;
  const parts = loc.hash.slice(1).split('&');
  const at = parts.findIndex(p => p.startsWith('qh=') || p.startsWith('qp='));
  if (at < 0) return null;
  const [k, v] = [parts[at].slice(0, 2), decodeURIComponent(parts[at].slice(3))];
  parts.splice(at, 1);
  try {
    globalThis.history?.replaceState(globalThis.history.state, '', `${loc.pathname}${loc.search}${parts.length ? `#${parts.join('&')}` : ''}`);
  } catch {}
  try {
    sessionStorage.setItem('quadra.visit', '1');
  } catch {}
  if (k !== 'qh') return null;
  try {
    return await call('POST', '', { op: 'redeem', handoff: v, app, inbox: true });
  } catch {
    return null;
  }
}

// ---- The pool --------------------------------------------------------------------------

const cash = s => (typeof s?.cash === 'number' && Number.isFinite(s.cash) ? s.cash : 0);
export function poolBalance(wallet) {
  if (!wallet) return 0;
  const entries = (wallet.entries || []).reduce((sum, e) => sum + e.amount, 0);
  return Math.round((entries + Object.values(wallet.snap || {}).reduce((sum, s) => sum + cash(s), 0)) * 100) / 100;
}
// The pool less `app`'s own part (an app with its own books shows its own
// money plus this).
export function othersBalance(wallet, app) {
  if (!wallet) return 0;
  const entries = (wallet.entries || []).filter(e => e.app !== app).reduce((sum, e) => sum + e.amount, 0);
  const snaps = Object.entries(wallet.snap || {})
    .filter(([name]) => name !== app)
    .reduce((sum, [, s]) => sum + cash(s), 0);
  return Math.round((entries + snaps) * 100) / 100;
}
export const entriesNotFrom = (wallet, app) => (wallet?.entries || []).filter(e => e.app !== app).sort((a, b) => b.t - a.t);

const KIND = {
  start: ['開戶金', 'Opening money'],
  grant: ['零用金', 'Allowance'],
  pay: ['每月薪資', 'Monthly pay'],
  stake: ['下注', 'Bet'],
  payout: ['彩金', 'Winnings'],
  refund: ['退款', 'Refund'],
  lottery: ['彩券', 'Lottery ticket'],
  prize: ['彩券獎金', 'Lottery prize'],
  game: ['遊戲', 'Game'],
  reward: ['單字獎勵', 'Word practice'],
  mission: ['任務獎勵', 'Mission reward'],
  'xfer-in': ['轉入', 'Transfer in'],
  'xfer-out': ['轉出', 'Transfer out'],
  merge: ['合併帶入', 'Carried over']
};
export function describeEntry(e, lang = 'zh') {
  const i = lang === 'en' ? 1 : 0;
  const what = KIND[e.kind]?.[i] || e.kind;
  const from = e.app === 'eco' ? 'Quadra' : APPS[e.app]?.short || e.app;
  const peer = e.peer ? ` ${e.peer}` : '';
  return `${from} · ${what}${peer}${e.note ? ` · ${e.note}` : ''}`;
}

export const setting = (wallet, key, fallback = null) => wallet?.settings?.[key]?.value ?? fallback;
export const settingPatch = (key, value) => ({ settings: { [key]: { value, t: Date.now() } } });
export const activePins = wallet =>
  Object.entries(wallet?.pins || {})
    .filter(([, p]) => p.on)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

export function money(x, { sign = false, cents = false } = {}) {
  const v = Number(x) || 0;
  const body = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: 0 });
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}NT$${body}`;
}

// ---- Taiwan days -------------------------------------------------------------------------

const TPE = 8 * 3_600_000;
export const taipeiDay = (t = Date.now()) => new Date(t + TPE).toISOString().slice(0, 10);

// ---- Activity: what each app is used for, for missions and recommendations ---------------
//
// Each app keeps two small things in the wallet's settings (newest wins, one
// key per app, so apps never overwrite each other):
//   act:<app>  today's counts of what was done ({ day, n: { trade: 2 } })
//   aff:<app>  the app's affinity map: what the person is into (below)

export function activityPatch(wallet, app, action, by = 1, now = Date.now()) {
  const day = taipeiDay(now);
  const had = setting(wallet, `act:${app}`, null);
  const n = had?.day === day ? { ...had.n } : {};
  n[action] = (n[action] || 0) + by;
  return settingPatch(`act:${app}`, { day, n });
}
// Today's counts across the apps: { stock: { trade: 2 }, … }.
export function todayActivity(wallet, now = Date.now()) {
  const day = taipeiDay(now);
  const out = {};
  for (const app of Object.keys(APPS)) {
    const a = setting(wallet, `act:${app}`, null);
    if (a?.day === day) out[app] = a.n || {};
  }
  return out;
}

// ---- Recommendations: one engine for every app -------------------------------------------
//
// Affinity: every meaningful action (opening a match, a bet, a trade, a
// watch) adds weight to the keys it's about ('team:mlb:LAD', 'league:mlb',
// 'sport:baseball', 'sym:2330.TW', 'sector:tech' …), decaying with a half
// life, so the model follows what the person does now. Each app keeps its
// own map (and syncs its strongest keys to the wallet); ranking reads all
// the apps' maps together, so a team followed in Fixtures lifts its bets in
// Play and a sector traded in Securities lifts its stocks' news.
//
// Ranking: score = quality × (1 + affinity) + exploration, then a diversity
// pass (maximal marginal relevance) so one team or sector doesn't fill the
// list, with a little exploration for keys seldom seen (so the list learns
// instead of repeating itself) and items the person dismissed pushed down.

const HALF_LIFE = 21 * 86_400_000;
const AFF_SYNC_KEYS = 40;
const decay = (v, t, now) => v * 0.5 ** ((now - t) / HALF_LIFE);

export function affinityOf(app) {
  return readJson(`${KEY.aff}.${app}`, {});
}
export function recordAffinity(app, keys, weight = 1, now = Date.now()) {
  const map = affinityOf(app);
  for (const k of [].concat(keys).filter(Boolean)) {
    const had = map[k];
    map[k] = { v: (had ? decay(had.v, had.t, now) : 0) + weight, t: now, n: (had?.n || 0) + 1 };
  }
  // Keep it small: the strongest 300.
  const kept = Object.entries(map)
    .sort((a, b) => decay(b[1].v, b[1].t, now) - decay(a[1].v, a[1].t, now))
    .slice(0, 300);
  writeStore(`${KEY.aff}.${app}`, JSON.stringify(Object.fromEntries(kept)));
}
// The strongest keys for the wallet (aff:<app>).
export function affinityPatch(app, now = Date.now()) {
  const top = Object.entries(affinityOf(app))
    .map(([k, a]) => [k, Math.round(decay(a.v, a.t, now) * 100) / 100])
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, AFF_SYNC_KEYS);
  return settingPatch(`aff:${app}`, Object.fromEntries(top));
}
// Everything known: this device's maps and every app's synced map (the
// larger of the two per key), key -> weight.
export function affinity(wallet, now = Date.now()) {
  const out = {};
  const add = (k, v) => (out[k] = Math.max(out[k] || 0, v));
  for (const app of Object.keys(APPS)) {
    for (const [k, a] of Object.entries(affinityOf(app))) add(k, decay(a.v, a.t, now));
    for (const [k, v] of Object.entries(setting(wallet, `aff:${app}`, {}) || {})) add(k, Number(v) || 0);
  }
  return out;
}

export function dismiss(id) {
  const d = readJson(KEY.dismiss, {});
  d[id] = Date.now();
  const kept = Object.entries(d)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
  writeStore(KEY.dismiss, JSON.stringify(Object.fromEntries(kept)));
}
const dismissed = () => readJson(KEY.dismiss, {});

// items: [{ id, keys: [...], quality (0..1), group }]; returns the best
// `n`, each with `why` (its strongest matching key) and `score`.
export function rank(items, { wallet, n = 10, diversity = 0.35, explore = 0.08, now = Date.now(), aff = affinity(wallet, now) } = {}) {
  const gone = dismissed();
  const max = Math.max(1, ...Object.values(aff));
  const scored = items.map(item => {
    let best = 0;
    let why = null;
    let seen = 0;
    for (const k of item.keys || []) {
      const v = (aff[k] || 0) / max;
      if (v > best) [best, why] = [v, k];
      if (aff[k]) seen++;
    }
    const q = Math.max(0, Math.min(1, item.quality ?? 0.5));
    // A little for the unexplored: items touching nothing known yet.
    const novelty = seen ? 0 : explore * (0.5 + hash01(`${item.id}:${taipeiDay(now)}`));
    const penalty = gone[item.id] ? 0.25 : 1;
    return { ...item, why, score: (q * (0.6 + 1.4 * best) + novelty) * penalty };
  });
  // Maximal marginal relevance over groups.
  const picked = [];
  const groups = {};
  const pool = scored.sort((a, b) => b.score - a.score);
  while (picked.length < n && pool.length) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 60); i++) {
      const c = pool[i];
      const v = c.score * (1 - diversity) ** (groups[c.group] || 0);
      if (v > bv) [bi, bv] = [i, v];
    }
    const [c] = pool.splice(bi, 1);
    groups[c.group] = (groups[c.group] || 0) + 1;
    picked.push(c);
  }
  return picked;
}
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// ---- Help: every app's guide lives in Rewards ---------------------------------------------

export const helpUrl = (app, topic = '') => appUrl('vocab', `help=${app}${topic ? `:${topic}` : ''}`);

// ---- Screens -----------------------------------------------------------------------------

const node = (tag, props = {}, children = []) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) el.append(child);
  return el;
};
export { node as el };

const typedPass = text => cleanCode(text).replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 10);
// No maxlength: a pass is copied as ABCDE-23456 (11 characters), and a
// maxlength of 10 cut its last character off before the dash was taken out.
function passInput(label) {
  const input = node('input', { class: 'q-pass-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: 'ABCDE23456', 'aria-label': label });
  input.addEventListener('input', () => {
    input.value = typedPass(input.value);
  });
  return input;
}
const ERR = {
  SYNC_PASSCODE_NOT_FOUND: ['找不到這組通行碼。', 'No Quadra Pass has this code.'],
  ECO_PAIR_NOT_FOUND: ['這組裝置代碼無效或已過期（10 分鐘內、只能用一次）。', 'That device code isn’t valid or has expired (10 minutes, once).'],
  RATE_LIMITED: ['嘗試太多次，請稍後再試。', 'Too many tries. Please wait a little.'],
  INVALID_PASSCODE: ['請輸入 10 碼通行碼（例如 ABCDE-23456）或 8 碼裝置代碼。', 'Enter your 10-character pass (like ABCDE-23456) or an 8-character device code.']
};
export const errorText = (error, lang) => {
  const e = ERR[error?.code];
  if (e) return lang === 'en' ? e[1] : e[0];
  return lang === 'en' ? 'Couldn’t reach Quadra. Check the connection and try again.' : '無法連線到 Quadra，請檢查網路後再試一次。';
};

// The sign-in screen: nothing of the app shows until there's a pass.
function signInGate(s) {
  const en = s.lang === 'en';
  const a = APPS[s.app];
  document.getElementById('loading')?.setAttribute('hidden', '');
  return new Promise(resolve => {
    const input = passInput(BRAND.pass);
    const error = node('p', { class: 'q-gate-error', role: 'alert' });
    const enter = node('button', { class: 'q-btn primary block', type: 'submit', text: en ? 'Sign in' : '登入' });
    const make = node('button', { class: 'q-btn block', type: 'button', text: en ? 'Create a new Quadra Pass' : '建立新的 Quadra Pass' });
    const busy = on => [enter, make, input].forEach(b => (b.disabled = on));
    const done = async task => {
      busy(true);
      error.textContent = '';
      try {
        const res = await task();
        gate.remove();
        document.documentElement.classList.remove('q-signing-in');
        resolve(res);
      } catch (e) {
        error.textContent = errorText(e, s.lang);
        busy(false);
      }
    };
    const form = node(
      'form',
      {
        class: 'q-gate-form',
        onsubmit: event => {
          event.preventDefault();
          const code = cleanCode(input.value);
          if (!PASS_PATTERN.test(code) && !DEVICE_CODE_PATTERN.test(code)) return void (error.textContent = errorText({ code: 'INVALID_PASSCODE' }, s.lang));
          done(() => s.login(code));
        }
      },
      [node('label', { class: 'q-gate-label', text: en ? 'Your Quadra Pass or a device code' : 'Quadra Pass 或裝置代碼' }), input, error, enter]
    );
    make.addEventListener('click', () => done(async () => {
      const res = await s.create();
      await showNewPass(s, res.passcode);
      return res;
    }));
    const gate = node('div', { class: 'q-gate', role: 'dialog', 'aria-modal': 'true', style: `--q-accent:${a.color}` }, [
      node('div', { class: 'q-gate-box' }, [
        node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
        node('p', { class: 'q-gate-brand', text: a.related ? (en ? 'WITH QUADRA' : 'QUADRA 相關服務') : 'QUADRA' }),
        node('h1', { class: 'q-gate-title', text: a.name }),
        node('p', { class: 'q-gate-lede', text: en ? 'Sign in with your Quadra Pass: one account for every Quadra app.' : '用 Quadra Pass 登入：所有 Quadra App 共用一個帳戶。' }),
        form,
        node('div', { class: 'q-gate-or', text: en ? 'New to Quadra?' : '第一次使用？' }),
        make,
        node('p', { class: 'q-gate-note', text: en ? 'Signed in on another device? Its Account sheet gives a device code for this one.' : '已在其他裝置登入？在那裡的「帳戶」取得裝置代碼，就能在這裡登入。' })
      ])
    ]);
    document.documentElement.classList.add('q-signing-in');
    document.body.append(gate);
    setTimeout(() => input.focus(), 50);
  });
}

// "Quadra is open in another app": this one waits.
let movedEl = null;
function showMoved(s) {
  if (movedEl || typeof document === 'undefined') return;
  const en = s.lang === 'en';
  const where = s.live?.app && APPS[s.live.app] ? APPS[s.live.app].name : en ? 'another app' : '另一個 App';
  const same = s.live?.app === s.app;
  movedEl = node('div', { class: 'q-moved', role: 'dialog', 'aria-modal': 'true' }, [
    node('div', { class: 'q-moved-box' }, [
      node('p', { class: 'q-moved-title', text: same ? (en ? 'Open on another device' : '已在其他裝置使用') : en ? `In use in ${where}` : `正在 ${where} 使用中` }),
      node('p', { class: 'q-moved-text', text: en ? 'Quadra runs in one app at a time. This one paused so nothing gets out of step.' : 'Quadra 一次只在一個 App 使用，這裡先暫停，資料才不會互相覆蓋。' }),
      node('button', {
        class: 'q-btn primary block',
        type: 'button',
        text: en ? 'Continue here' : '在這裡繼續',
        onclick: async event => {
          event.currentTarget.disabled = true;
          try {
            await s.claim();
          } finally {
            if (movedEl) movedEl.querySelector('button').disabled = false;
          }
        }
      })
    ])
  ]);
  document.body.append(movedEl);
}
function hideMoved() {
  movedEl?.remove();
  movedEl = null;
}

// ---- The account sheet: the same in every app ---------------------------------------------
//
// accountSheet(s, { extra }) opens a sheet with the pass, the pool, the
// apps, and the security actions. `extra`: an element the app adds (its
// own settings).

// extra(): the app's own settings for the sheet (an element), optional.
// The button is the account's badge (a person in the Quadra mark's colours),
// never the balance: the balance lives inside the sheet.
const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/></svg>';
export function accountButton(s, { extra = null } = {}) {
  const btn = node('button', { class: 'q-account', type: 'button', 'aria-label': s.lang === 'en' ? 'Quadra Pass' : 'Quadra Pass 帳戶', title: BRAND.pass });
  btn.innerHTML = PERSON_SVG;
  btn.append(node('span', { class: 'q-account-dot', 'aria-hidden': 'true' }));
  const paint = () => btn.classList.toggle('signed', Boolean(s.wallet));
  paint();
  s.on('wallet', paint);
  btn.addEventListener('click', () => accountSheet(s, { extra: extra ? extra() : null }));
  return btn;
}

// ---- Dialogs: Quadra's own, never the browser's alert/confirm ---------------------------
//
// ask({ title, body, ok, cancel, danger }) resolves true or false; tell({
// title, body, ok }) resolves once closed. A centred card over the page (and
// over an open sheet), Esc or a tap outside cancels.
export function ask({ title, body = '', ok = '', cancel = '', danger = false, icon = '', lang = detectLang(), alertOnly = false } = {}) {
  const en = lang === 'en';
  return new Promise(resolve => {
    const dialog = node('dialog', { class: `q-ask${danger ? ' danger' : ''}`, 'aria-labelledby': 'q-ask-title' });
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      dialog.classList.add('out');
      setTimeout(() => {
        dialog.close();
        dialog.remove();
      }, 140);
      resolve(value);
    };
    const okBtn = node('button', { class: `q-btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: ok || (alertOnly ? (en ? 'OK' : '好') : en ? 'Continue' : '繼續'), onclick: () => finish(true) });
    dialog.append(
      ...[
      icon ? node('div', { class: 'q-ask-icon', 'aria-hidden': 'true', text: icon }) : null,
      node('h2', { id: 'q-ask-title', class: 'q-ask-title', text: title }),
      body ? node('p', { class: 'q-ask-body', text: body }) : null,
      node('div', { class: 'q-ask-actions' }, [
        alertOnly ? null : node('button', { class: 'q-btn', type: 'button', text: cancel || (en ? 'Cancel' : '取消'), onclick: () => finish(false) }),
        okBtn
      ])
      ].filter(Boolean)
    );
    dialog.addEventListener('cancel', event => (event.preventDefault(), finish(alertOnly)));
    dialog.addEventListener('click', event => event.target === dialog && finish(alertOnly));
    document.body.append(dialog);
    dialog.showModal();
    (alertOnly || !danger ? okBtn : dialog.querySelector('.q-btn:not(.danger)'))?.focus();
  });
}
export const tell = (opts = {}) => ask({ ...opts, alertOnly: true }).then(() => undefined);

// The next payday: the 1st of next Taiwan month.
export function nextPayday(now = Date.now()) {
  const d = new Date(now + TPE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - TPE;
}
export function paydayText(lang, now = Date.now()) {
  const d = new Date(nextPayday(now) + TPE);
  return lang === 'en'
    ? `Payday: ${money(ECONOMY.monthly)} on the 1st of every month (next ${d.getUTCMonth() + 1}/1; a missed month is paid when you're back)`
    : `發薪日：每月 1 日 ${money(ECONOMY.monthly)}（下次 ${d.getUTCMonth() + 1}/1；沒打開的月份下次補發）`;
}
// The account at a glance: its number, since when, this month's money in
// and out, and the latest entries (every app's, like a bank statement).
export function accountDetails(wallet, lang = 'zh', now = Date.now()) {
  const entries = [...(wallet?.entries || [])].sort((a, b) => b.t - a.t);
  const month = taipeiDay(now).slice(0, 7);
  const thisMonth = entries.filter(e => taipeiDay(e.t).slice(0, 7) === month);
  const sum = list => Math.round(list.reduce((x, e) => x + e.amount, 0) * 100) / 100;
  return {
    created: Number.isFinite(wallet?.created) ? wallet.created : null,
    in: sum(thisMonth.filter(e => e.amount > 0)),
    out: sum(thisMonth.filter(e => e.amount < 0)),
    count: thisMonth.length,
    recent: entries.slice(0, 8).map(e => ({ t: e.t, amount: e.amount, text: describeEntry(e, lang), app: e.app }))
  };
}
const accountNumber = id => (id ? `QP ${id.slice(0, 4).toUpperCase()} ${id.slice(4, 8).toUpperCase()} ${id.slice(8, 12).toUpperCase()}` : '');
function detailsCard(s) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const d = accountDetails(s.wallet, s.lang);
  const date = t => new Date(t).toLocaleDateString(en ? 'en-US' : 'zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
  const short = t => new Date(t).toLocaleDateString(en ? 'en-US' : 'zh-TW', { month: 'numeric', day: 'numeric' });
  const days = d.created ? Math.max(1, Math.round((Date.now() - d.created) / 86_400_000)) : 0;
  return node('div', { class: 'q-details' }, [
    node('div', { class: 'q-card-hero' }, [
      node('div', { class: 'q-hero-top' }, [node('span', { class: 'q-hero-brand', text: 'QUADRA PASS' }), node('span', { class: 'q-hero-no num', text: accountNumber(s.pass) })]),
      node('span', { class: 'q-hero-label', text: T('Quadra 餘額', 'Quadra balance') }),
      node('strong', { class: 'q-hero-balance num', text: money(s.pool) }),
      node('span', { class: 'q-hero-sub', text: d.created ? T(`${date(d.created)} 開戶 · 第 ${days} 天`, `Opened ${date(d.created)} · day ${days}`) : '' })
    ]),
    node('div', { class: 'q-month' }, [
      node('div', {}, [node('small', { text: T('本月收入', 'In this month') }), node('strong', { class: 'num up', text: money(d.in, { sign: true }) })]),
      node('div', {}, [node('small', { text: T('本月支出', 'Out this month') }), node('strong', { class: 'num down', text: money(d.out) })])
    ]),
    node('p', { class: 'q-payday', text: paydayText(s.lang) }),
    d.recent.length
      ? node('details', { class: 'q-recent' }, [
          node('summary', { text: T(`最近明細（本月 ${d.count} 筆）`, `Latest entries (${d.count} this month)`) }),
          node(
            'ul',
            {},
            d.recent.map(e => node('li', {}, [node('span', { class: 'q-recent-when num', text: short(e.t) }), node('span', { class: 'q-recent-what', text: e.text }), node('strong', { class: `num ${e.amount < 0 ? 'down' : 'up'}`, text: money(e.amount, { sign: true }) })]))
          )
        ])
      : null
  ].filter(Boolean));
}
export function accountSheet(s, { extra = null } = {}) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const dialog = node('dialog', { class: 'q-sheet' });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const note = node('p', { class: 'q-sheet-note', role: 'status' });
  const act = (label, fn, cls = 'q-row-btn') =>
    node('button', {
      class: cls,
      type: 'button',
      text: label,
      onclick: async event => {
        const b = event.currentTarget;
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          note.textContent = errorText(e, s.lang);
        } finally {
          b.disabled = false;
        }
      }
    });
  const tiles = node(
    'div',
    { class: 'q-apps' },
    Object.entries(APPS).map(([id, a]) =>
      node(
        'a',
        {
          class: `q-app${id === s.app ? ' here' : ''}${a.related ? ' related' : ''}`,
          href: appUrl(id),
          onclick: e => {
            e.preventDefault();
            if (id !== s.app) s.go(id);
          }
        },
        [node('img', { src: `${a.path}favicon.svg`, alt: '' }), node('span', { text: a.tile || a.short })]
      )
    )
  );
  // A device code, shown with its countdown.
  const device = node('div', { class: 'q-device', hidden: true });
  let tick = 0;
  const showCode = ({ code, exp }) => {
    clearInterval(tick);
    const left = node('span', { class: 'q-device-left' });
    const paint = () => {
      const ms = exp - Date.now();
      if (ms <= 0) {
        clearInterval(tick);
        device.hidden = true;
        return;
      }
      left.textContent = T(`${Math.ceil(ms / 60_000)} 分鐘內有效，只能用一次`, `Valid ${Math.ceil(ms / 60_000)} more min, once`);
    };
    device.replaceChildren(node('span', { class: 'q-device-label', text: T('裝置代碼', 'Device code') }), node('strong', { class: 'q-device-code num', text: formatPass(code) }), left, node('span', { class: 'q-device-how', text: T('在另一台裝置打開任一個 Quadra App，輸入這組代碼登入。', 'On the other device, open any Quadra app and enter this code to sign in.') }));
    device.hidden = false;
    paint();
    tick = setInterval(paint, 15_000);
  };
  dialog.append(
    node('div', { class: 'q-sheet-head' }, [node('h2', { text: BRAND.pass }), node('button', { class: 'q-close', type: 'button', 'aria-label': T('關閉', 'Close'), text: '×', onclick: close })]),
    detailsCard(s),
    node('h3', { class: 'q-sheet-h', text: T('Quadra 的 App', 'Quadra apps') }),
    tiles,
    ...(extra ? [extra] : []),
    node('h3', { class: 'q-sheet-h', text: T('裝置', 'Devices') }),
    node('div', { class: 'q-rows' }, [
      act(T('新增裝置（取得裝置代碼）', 'Add a device (get a device code)'), async () => showCode(await s.deviceCode())),
      device
    ]),
    node('h3', { class: 'q-sheet-h', text: T('通知', 'Notifications') }),
    ...notifyRows(s, note),
    node('h3', { class: 'q-sheet-h', text: T('帳戶安全', 'Security') }),
    node('div', { class: 'q-rows' }, [
      act(T('登出其他所有裝置', 'Sign out every other device'), async () => {
        if (!(await ask({ lang: s.lang, icon: '🔒', title: T('登出其他所有裝置？', 'Sign out every other device?'), body: T('除了這台以外，所有裝置都會登出，要用通行碼或裝置代碼重新登入。', 'Every device except this one is signed out and needs your pass or a device code to sign in again.'), ok: T('全部登出', 'Sign them out'), danger: true }))) return;
        await s.signOutEverywhere();
        note.textContent = T('其他裝置都已登出。', 'Every other device is signed out.');
      }),
      act(T('更換通行碼', 'Change my pass'), async () => {
        if (!(await ask({ lang: s.lang, icon: '🔑', title: T('換一組新的通行碼？', 'Get a new pass?'), body: T('帳戶和所有資料都會移到新通行碼，舊通行碼立即失效，其他裝置也會登出。新通行碼只會顯示一次，請記下來。', 'Everything moves to the new pass, the old one stops working at once and every other device is signed out. The new pass is shown once: write it down.'), ok: T('換新通行碼', 'Get a new pass'), danger: true }))) return;
        const passcode = await s.rotate();
        // The sheet closes first: a modal sheet stays above everything else,
        // so the new pass would open behind it.
        close();
        await showNewPass(s, passcode);
      }),
      node('a', { class: 'q-row-btn', href: helpUrl(s.app), text: T(`${APPS[s.app].short} 使用說明`, `${APPS[s.app].short} guide`) }),
      act(
        T('在這台裝置登出', 'Sign out on this device'),
        async () => {
          if (!(await ask({ lang: s.lang, icon: '👋', title: T('在這台裝置登出？', 'Sign out on this device?'), body: T('資料都保留在 Quadra Pass，之後用通行碼或裝置代碼再登入。', 'Everything stays on your Quadra Pass; sign in again with the pass or a device code.'), ok: T('登出', 'Sign out') }))) return;
          s.signOut();
          location.reload();
        },
        'q-row-btn danger'
      )
    ]),
    node('p', { class: 'q-sheet-sub', text: T('通行碼只在建立或更換時顯示一次，裝置上不會保存。忘記了？在已登入的裝置按「更換通行碼」。', 'Your pass is shown only when it’s made or changed, and never kept on a device. Forgot it? Choose “Change my pass” on a signed-in device.') }),
    note
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    clearInterval(tick);
    dialog.remove();
  });
  dialog.addEventListener('click', e => e.target === dialog && close());
  dialog.showModal();
  return dialog;
}

// A new pass, shown once: it can't be shown again, so it waits until it has
// been typed back (its last five characters), which also proves it was
// copied right. A modal <dialog>, so it sits above every other sheet and
// dialog and nothing behind it can be tapped.
export function showNewPass(s, passcode) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const shown = formatPass(passcode);
  const tail = String(passcode).replace(/[^0-9A-Za-z]/g, '').slice(-5).toUpperCase();
  return new Promise(resolve => {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    const ok = node('button', { class: 'q-btn primary block', type: 'button', text: T('我已經記下來了', 'I’ve saved it'), disabled: true });
    const copy = node('button', {
      class: 'q-btn small',
      type: 'button',
      text: T('複製', 'Copy'),
      onclick: () => navigator.clipboard?.writeText(shown).then(() => (copy.textContent = T('已複製', 'Copied')))
    });
    const hint = node('small', { class: 'q-newpass-hint' });
    const check = node('input', { class: 'q-pass-input q-newpass-check num', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '5', placeholder: '•••••', 'aria-label': T('通行碼最後 5 個字', 'The last 5 characters of your pass') });
    check.addEventListener('input', () => {
      const typed = check.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      ok.disabled = typed !== tail;
      hint.textContent = typed.length === 5 && typed !== tail ? T('不對：請對照上面的通行碼。', 'That doesn’t match: check the pass above.') : '';
    });
    const box = node('dialog', { class: 'q-gate q-newpass', style: `--q-accent:${APPS[s.app].color}` }, [
      node('div', { class: 'q-gate-box' }, [
        node('p', { class: 'q-gate-brand', text: 'QUADRA PASS' }),
        node('h1', { class: 'q-gate-title', text: T('這是你的新通行碼', 'This is your new pass') }),
        node('div', { class: 'q-pass-code' }, [node('strong', { class: 'num', text: shown }), copy]),
        node('p', { class: 'q-gate-lede', text: T('它只會顯示這一次，裝置上也不會保存，舊的通行碼已經失效。記在安全的地方：在新裝置登入、找回帳戶都要用到它。', 'It’s shown only this once and isn’t kept on any device; the old pass no longer works. Keep it somewhere safe: you need it to sign in on a new device or get your account back.') }),
        node('label', { class: 'q-newpass-label', text: T('記好以後，輸入通行碼的最後 5 個字確認：', 'Once it’s saved, type its last 5 characters to confirm:') }),
        check,
        hint,
        ok
      ])
    ]);
    // Not closed by Esc or a tap outside: only by the confirmed button.
    box.addEventListener('cancel', e => e.preventDefault());
    ok.addEventListener('click', () => {
      box.close();
      box.remove();
      resolve();
    });
    document.body.append(box);
    box.showModal();
  });
}

// ---- Notifications: the same in every app --------------------------------------------
//
// notify(s, { title, body, tag, hash }) shows an in-app banner while the app
// is on screen, and a system notification when it isn't (once allowed in
// the account sheet, per device). `tag` keeps one notice per thing (a slip,
// a match), `hash` is where tapping it goes, `kind` is its NOTICE_KINDS entry
// (a kind turned off in the account sheet is dropped). There's no push server: a
// notice comes from an app that's open or in the background.

export const notifyOn = () => readStore(KEY.notify) === '1' && globalThis.Notification?.permission === 'granted';

// Every kind of notice, by app: what it is and when it comes. Each can be
// turned off on its own (per device, `quadra.notify.kinds`); a kind that's
// off shows neither a banner nor a system notice.
export const NOTICE_KINDS = {
  match: [
    ['start', '比賽開打', 'A game starts', '你追蹤的球隊比賽開始時。', 'When a team you follow starts a game.'],
    ['end', '比賽結束', 'Final score', '你追蹤的球隊比賽結束，附上比分。', 'When a team you follow finishes a game, with the score.']
  ],
  odds: [
    ['slip', '投注單結算', 'Slip settled', '投注單的比賽全部結束、算好派彩時。', 'When every game on a slip is over and it’s paid.'],
    ['ticket', '彩券中獎', 'Lottery win', '電腦彩券開獎、你的彩券中獎時。', 'When a draw is out and your ticket won.']
  ],
  vocab: [
    ['ready', '獎勵可以領', 'Reward to claim', '每日任務或每週目標完成、可以領錢時。', 'When a mission or weekly goal is done and ready to claim.'],
    ['streak', '連續紀錄快斷了', 'Streak ending', '今天還沒玩，連續天數今晚就會歸零時。', 'When you haven’t played today and your streak ends tonight.']
  ],
  stock: [
    ['alert', '價格提醒', 'Price alert', '你設定的價格提醒到價時。', 'When a price alert you set is reached.'],
    ['fill', '委託成交', 'Order filled', '掛單或定期定額成交時。', 'When an order or a monthly plan is filled.']
  ],
  orbit: [['class', '上課提醒', 'Class reminder', '每堂課開始前 5 分鐘。', 'Five minutes before each class.']]
};
const KINDS_KEY = 'quadra.notify.kinds';
function kindPrefs() {
  try {
    return JSON.parse(readStore(KINDS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
// Whether notices of this kind are wanted (every kind is, until turned off).
export const kindOn = (app, kind) => !kind || kindPrefs()[`${app}:${kind}`] !== false;
export function setKind(app, kind, on) {
  const prefs = kindPrefs();
  if (on) delete prefs[`${app}:${kind}`];
  else prefs[`${app}:${kind}`] = false;
  writeStore(KINDS_KEY, JSON.stringify(prefs));
}

// A switch: role=switch, aria-checked.
function toggle(on, label, onchange) {
  const b = node('button', { class: 'q-switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', async () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    const ok = await onchange(next);
    if (ok !== false) b.setAttribute('aria-checked', String(next));
  });
  return b;
}

// The account sheet's notices: this device's system notices (on, off, or
// not allowed by the phone), then every kind of notice with what it is and
// its own switch.
function notifyRows(s, note) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const supported = 'Notification' in globalThis;
  const state = () => (!supported ? T('這個瀏覽器不支援', 'Not supported here') : Notification.permission === 'denied' ? T('被系統封鎖：請到系統設定允許', 'Blocked: allow them in the system settings') : notifyOn() ? T('開啟：App 沒開著時也會通知', 'On: notices arrive while the app is closed too') : T('關閉：只在 App 開著時顯示在畫面上', 'Off: notices show only while the app is open'));
  const sub = node('small', { class: 'q-notice-sub', text: state() });
  const master = node('div', { class: 'q-notice-row master' }, [
    node('span', { class: 'q-notice-icon', 'aria-hidden': 'true', text: '🔔' }),
    node('div', { class: 'q-notice-text' }, [node('strong', { text: T('系統通知（這台裝置）', 'System notices (this device)') }), sub]),
    supported
      ? toggle(notifyOn(), T('系統通知', 'System notices'), async on => {
          if (!on) {
            writeStore(KEY.notify, '0');
            sub.textContent = state();
            return true;
          }
          const p = await Notification.requestPermission().catch(() => 'denied');
          if (p === 'granted') writeStore(KEY.notify, '1');
          else note.textContent = T('系統沒有允許通知：請到系統設定開啟。', 'Notifications aren’t allowed: turn them on in the system settings.');
          sub.textContent = state();
          return p === 'granted';
        })
      : null
  ]);
  // This app's kinds first, then the rest.
  const order = [s.app, ...Object.keys(NOTICE_KINDS).filter(a => a !== s.app)].filter(a => NOTICE_KINDS[a] && APPS[a]);
  const groups = order.map(app =>
    node('div', { class: 'q-notice-group' }, [
      node('p', { class: 'q-notice-app', text: APPS[app].short }),
      ...NOTICE_KINDS[app].map(([kind, zh, e, dzh, de]) =>
        node('div', { class: 'q-notice-row' }, [
          node('div', { class: 'q-notice-text' }, [node('strong', { text: T(zh, e) }), node('small', { class: 'q-notice-sub', text: T(dzh, de) })]),
          toggle(kindOn(app, kind), T(zh, e), on => setKind(app, kind, on))
        ])
      )
    ])
  );
  return [node('div', { class: 'q-rows' }, [master]), node('div', { class: 'q-rows q-notice-kinds' }, groups)];
}

const shown = new Set();
export async function notify(s, { title, body = '', tag = '', hash = '', kind = '' }) {
  if (!kindOn(s.app, kind)) return;
  const key = `${s.app}:${tag || title}`;
  if (tag && shown.has(key)) return;
  if (tag) shown.add(key);
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return banner(s, { title, body, hash });
  if (!notifyOn()) return;
  const options = { body, tag: key, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: `${APPS[s.app].path}${hash ? `#${hash}` : ''}` } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) return void (await reg.showNotification(title, options));
    const n = new Notification(title, options);
    n.onclick = () => {
      globalThis.focus?.();
      if (hash) location.hash = hash;
      n.close();
    };
  } catch {}
}
let bannerEl = null;
function banner(s, { title, body, hash }) {
  bannerEl?.remove();
  const el = node('div', { class: 'q-banner', role: 'status', style: `--q-accent:${APPS[s.app].color}` }, [
    node('img', { src: './favicon.svg', alt: '' }),
    node('div', {}, [node('strong', { text: title }), body ? node('span', { text: body }) : null])
  ]);
  const gone = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', () => {
    if (hash) location.hash = hash;
    gone();
  });
  document.body.append(el);
  bannerEl = el;
  setTimeout(gone, 5000);
}

// ---- Shell: installed-only on phones, and always the newest version ------------------------

export function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: fullscreen)').matches || globalThis.navigator?.standalone);
}
export function isPhoneOrTablet() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (globalThis.navigator?.maxTouchPoints || 0) > 1;
}
const isIOS = () => /iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || '') || (/Macintosh/.test(globalThis.navigator?.userAgent || '') && (globalThis.navigator?.maxTouchPoints || 0) > 1);
const inAppBrowser = () => /Line\/|FBAN|FBAV|Instagram|Messenger|MicroMessenger|KAKAOTALK/i.test(globalThis.navigator?.userAgent || '');
const visiting = () => {
  try {
    return sessionStorage.getItem('quadra.visit') === '1' || /[#&]q[hp]=/.test(globalThis.location?.hash || '');
  } catch {
    return false;
  }
};

// On phones and tablets the apps run from the home screen only. Returns true
// when it covered the page (the app shouldn't start).
export function installGate(app, lang = detectLang()) {
  if (!isPhoneOrTablet() || isStandalone() || visiting()) return false;
  const en = lang === 'en';
  const name = appName(app);
  const steps = inAppBrowser()
    ? en
      ? ['Open this page in Safari (iPhone) or Chrome (Android): tap ⋯ and “Open in browser”.', 'Then add it to your home screen.']
      : ['請先用 Safari（iPhone）或 Chrome（Android）開啟：點右上角 ⋯，選「在瀏覽器開啟」。', '再加入主畫面。']
    : isIOS()
      ? en
        ? ['Tap Share (the square with an arrow) in Safari.', 'Choose “Add to Home Screen”, then “Add”.', `Open ${name} from its new icon.`]
        : ['點 Safari 的「分享」（方框加箭頭）。', '選「加入主畫面」，再點「新增」。', `從主畫面的新圖示打開 ${name}。`]
      : en
        ? ['Tap ⋮ at the top right of Chrome.', 'Choose “Add to Home screen” (or “Install app”).', `Open ${name} from its new icon.`]
        : ['點 Chrome 右上角的 ⋮。', '選「加入主畫面」或「安裝應用程式」。', `從主畫面的新圖示打開 ${name}。`];
  const gate = node('div', { class: 'q-gate q-install', role: 'dialog', 'aria-modal': 'true', style: `--q-accent:${APPS[app].color}` }, [
    node('div', { class: 'q-gate-box' }, [
      node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
      node('p', { class: 'q-gate-brand', text: 'QUADRA' }),
      node('h1', { class: 'q-gate-title', text: en ? `Add ${name} to your home screen` : `把 ${name} 加入主畫面` }),
      node(
        'ol',
        { class: 'q-steps' },
        steps.map(t => node('li', { text: t }))
      )
    ])
  ]);
  document.body.append(gate);
  document.documentElement.classList.add('q-signing-in');
  document.getElementById('loading')?.setAttribute('hidden', '');
  return true;
}

// A phone-only app on a computer: covers the page with where to open it
// instead (a QR code the app draws, `qr` as SVG markup, and the link), then
// how to add it to the home screen. Returns true when it covered the page.
export function phoneOnlyGate(app, { lang = detectLang(), qr = '' } = {}) {
  if (isPhoneOrTablet()) return false;
  const en = lang === 'en';
  const name = appName(app);
  const url = `${SITE}${APPS[app].path}`;
  const qrBox = node('div', { class: 'q-qr', role: 'img', 'aria-label': en ? `QR code for ${url}` : `${url} 的 QR code` });
  qrBox.innerHTML = qr;
  const copy = node('button', {
    class: 'q-btn',
    type: 'button',
    text: en ? 'Copy the link' : '複製連結',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = en ? 'Copied ✓' : '已複製 ✓';
      } catch {}
    }
  });
  const gate = node('div', { class: 'q-gate q-phone-only', role: 'dialog', 'aria-modal': 'true', style: `--q-accent:${APPS[app].color}` }, [
    node('div', { class: 'q-gate-box' }, [
      node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
      node('p', { class: 'q-gate-brand', text: 'QUADRA' }),
      node('h1', { class: 'q-gate-title', text: en ? `${name} is made for your phone` : `${name} 是手機 App` }),
      node('p', { class: 'q-gate-lede', text: en ? 'It lives in your pocket, beside your day. Open it on your phone:' : '課表跟著你一整天，所以只在手機上使用。用手機打開：' }),
      qrBox,
      node('p', { class: 'q-qr-url', text: url.replace(/^https:\/\//, '') }),
      copy,
      node(
        'ol',
        { class: 'q-steps' },
        (en
          ? ['Scan the code with your phone’s camera (or open the link on it).', 'Add it to the home screen: Share → “Add to Home Screen” on iPhone, ⋮ → “Install app” on Android.', 'Sign in with your Quadra Pass or a device code: your schedule is already there.']
          : ['用手機相機掃描上面的條碼（或在手機打開連結）。', '加入主畫面：iPhone 點「分享」→「加入主畫面」；Android 點 ⋮ →「安裝應用程式」。', '用 Quadra Pass 或裝置代碼登入，課表就在裡面。']
        ).map(t => node('li', { text: t }))
      )
    ])
  ]);
  document.body.append(gate);
  document.documentElement.classList.add('q-signing-in');
  document.getElementById('loading')?.setAttribute('hidden', '');
  return true;
}

// Always the newest deploy (version.json, checked on opening, on coming back
// and every few minutes): old caches are dropped and the page reloads once.
//
// Never in the person's face: a new deploy found right after opening loads
// at once (nothing's been done yet); found later, while the app is in use or
// on coming back to it, it waits for the app to be put away and loads then,
// so coming back to an app never reloads it under the person's thumb. Away
// longer than `stale` (the app would have been refreshed anyway), it loads
// at once on coming back.
export function watchUpdates({ current, key, cachePrefix, busy = () => false, every = 5 * 60_000, stale = 30 * 60_000 } = {}) {
  if (!current || current === 'dev') return;
  const opened = Date.now();
  let checking = false;
  let pending = null;
  let hiddenAt = 0;
  async function apply(latest) {
    const flag = `${key || 'quadra'}.reloadedTo`;
    if (sessionStorage.getItem(flag) === latest) return;
    sessionStorage.setItem(flag, latest);
    rememberPlace();
    if (globalThis.caches && cachePrefix) for (const name of await caches.keys()) if (name.startsWith(cachePrefix)) await caches.delete(name);
    const reg = await navigator.serviceWorker?.getRegistration?.(location.pathname);
    await reg?.update?.().catch(() => {});
    location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}${location.hash}`);
  }
  async function check({ back = false } = {}) {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const latest = res.ok ? (await res.json())?.version : null;
      if (!latest || latest === current) return;
      const now = Date.now() - opened < 6000 || (back && hiddenAt && Date.now() - hiddenAt > stale);
      if (now && !busy()) await apply(latest);
      else pending = latest;
    } catch {
    } finally {
      checking = false;
    }
  }
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (pending && !busy()) apply(pending).catch(() => {});
      else hiddenAt = Date.now();
    } else check({ back: true });
  });
  globalThis.addEventListener?.('pageshow', event => event.persisted && check({ back: true }));
  setInterval(check, every);
}

// Where the person was (the scroll), kept across a reload for an update and
// put back by restorePlace() once the app has painted.
const PLACE_KEY = 'quadra.place';
export function rememberPlace() {
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify({ path: location.pathname, hash: location.hash, y: Math.round(globalThis.scrollY || 0), t: Date.now() }));
  } catch {}
}
export function restorePlace() {
  try {
    const p = JSON.parse(sessionStorage.getItem(PLACE_KEY) || 'null');
    sessionStorage.removeItem(PLACE_KEY);
    if (p && p.path === location.pathname && p.hash === location.hash && Date.now() - p.t < 60_000 && p.y > 0) requestAnimationFrame(() => globalThis.scrollTo(0, p.y));
  } catch {}
}

// The fixed tab bar keeps clear of the iPhone's home indicator even when iOS
// reports no safe area after a resume (the largest inset seen is a floor).
const SAFE_KEY = 'quadra.safeBottom';
function steadyTabBar() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.getComputedStyle) return;
  const root = document.documentElement;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)';
  let seen = { p: 0, l: 0 };
  try {
    seen = { ...seen, ...JSON.parse(localStorage.getItem(SAFE_KEY) || '{}') };
  } catch {}
  const fix = () => {
    if (!document.body) return;
    if (!probe.isConnected) document.body.append(probe);
    const side = window.innerWidth > window.innerHeight ? 'l' : 'p';
    const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    if (inset > (seen[side] || 0) && inset < 80) {
      seen[side] = inset;
      try {
        localStorage.setItem(SAFE_KEY, JSON.stringify(seen));
      } catch {}
    }
    root.style.setProperty('--q-safe-bottom', `${isStandalone() ? seen[side] || 0 : 0}px`);
  };
  const settle = () => {
    fix();
    requestAnimationFrame(fix);
    for (const ms of [120, 400, 1000, 2000]) setTimeout(fix, ms);
  };
  for (const ev of ['resize', 'orientationchange', 'pageshow', 'focus']) window.addEventListener(ev, settle);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && settle());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settle, { once: true });
  else settle();
}
steadyTabBar();

// Big numbers never wrap: they shrink (to 60% at most) to fit their box.
export function fitNumbers(nodes) {
  for (const el of nodes) {
    el.style.fontSize = '';
    const box = el.parentElement?.clientWidth || 0;
    if (!box || el.scrollWidth <= box) continue;
    const base = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${Math.max(base * 0.6, (base * box) / el.scrollWidth - 0.5)}px`;
  }
}
