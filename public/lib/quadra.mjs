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
// until there's a pass, and the data proxy only answers signed-in apps.
// Behind the pass is one NT$ money pool (play money only).
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
// pass opens with NT$110,000, and every Taiwan month adds NT$5,000 and
// every Taiwan week NT$500. Securities is where it grows (a diversified
// portfolio about 6-8% a year, real costs); Play is where it shrinks (the
// lottery keeps about 22%); Rewards pays for effort: word practice best
// (about NT$20 a minute), games about NT$15 a minute, missions a little
// for using the apps, all capped a day.
export const ECONOMY = {
  start: 110_000,
  monthly: 5_000,
  weekly: 500,
  // Play's weekly betting limit until you set your own (0: none).
  oddsDefaultLimit: 2_000,
  // Rewards: word practice, games and missions, with their caps a Taiwan day.
  vocab: { perCorrect: 3, perMastered: 25, dailyCap: 600 },
  gamesPerMinute: 15,
  gamesDailyCap: 400,
  missionsDailyCap: 300,
  // Kept for older data: each app's former game cap.
  legacyGamesDailyCap: { odds: 300, stock: 300 }
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
export const LEGACY_PATTERNS = { stock: /^[2-9A-HJ-NP-Z]{8}$/, odds: /^[2-9A-HJ-NP-Z]{8}$/, vocab: /^[2-9A-HJ-NP-Z]{16}$/ };
export function cleanCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}
export const isPass = code => PASS_PATTERN.test(cleanCode(code));
export const formatPass = code => (code && code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code || '');
export const maskPass = code => (code && code.length === 10 ? `${code.slice(0, 2)}•••-•••${code.slice(8)}` : '');

// ---- Storage -------------------------------------------------------------------------

const KEY = { pass: 'quadra.pass', refresh: 'quadra.refresh', wallet: 'quadra.wallet', aff: 'quadra.aff', dismiss: 'quadra.dismiss' };
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

export function storedPass() {
  const code = readStore(KEY.pass) || '';
  return PASS_PATTERN.test(code) ? code : '';
}
export function cachedWallet(code = storedPass()) {
  const saved = readJson(KEY.wallet, null);
  return saved && saved.code === code ? saved.wallet : null;
}
function cacheWallet(code, wallet) {
  if (code && wallet) writeStore(KEY.wallet, JSON.stringify({ code, wallet }));
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

// ---- The session ---------------------------------------------------------------------
//
// const q = quadraSession('odds');
// q.on('wallet', w => ...)      the wallet changed (pool, settings…)
// q.on('active', live => ...)   true: this app is the live one; false: paused
// q.on('signedout', () => ...)
// await q.start()               signs in (the gate) and makes this app live
// q.read({ data, inbox })       { wallet, pool, payload, inbox } (app data when data)
// q.write({ payload, wallet })  only while live
// q.proxy(url, extra)           the data proxy's address for `url`, signed in

export function quadraSession(app, { lang = detectLang(), heartbeat = 60_000 } = {}) {
  const listeners = {};
  const emit = (name, value) => (listeners[name] || []).forEach(fn => fn(value));
  let token = '';
  let tokenAt = 0;
  let active = false;
  let live = null;
  let wallet = cachedWallet();
  let timer = 0;
  let started = false;

  const s = {
    app,
    lang,
    get pass() {
      return storedPass();
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
    cacheWallet(storedPass(), w);
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
    if (data.token) {
      token = data.token;
      tokenAt = Date.now();
    }
    if (data.refresh) writeStore(KEY.refresh, data.refresh);
    if (data.wallet) setWallet(data.wallet);
    if (data.active != null) setActive(Boolean(data.active), data.live || null);
    return data;
  }

  async function login(passcode, { data = false } = {}) {
    const code = cleanCode(passcode);
    const res = await call('POST', '', { op: 'login', passcode: code, app, inbox: data });
    writeStore(KEY.pass, code);
    absorb({ ...res, active: true });
    return res;
  }
  async function create() {
    const res = await call('POST', qs({ app }), { op: 'create', v2: true });
    writeStore(KEY.pass, res.passcode);
    absorb({ ...res, active: true });
    return res;
  }
  // A session from the device's refresh token (claim: make this app live).
  // Falls back to the pass itself when the refresh token no longer works.
  async function refresh({ claim = false, data = false } = {}) {
    const ref = readStore(KEY.refresh);
    if (ref) {
      try {
        const res = await call('POST', '', { op: 'refresh', refresh: ref, app, claim, data, inbox: data });
        return absorb(res);
      } catch (error) {
        if (error.code === 'ECO_SIGNED_OUT') return signedOut();
        if (error.code !== 'ECO_TOKEN_INVALID') throw error;
      }
    }
    if (!storedPass()) return signedOut();
    if (!claim) return { active: false };
    try {
      return await login(storedPass(), { data });
    } catch (error) {
      if (error.code === 'SYNC_PASSCODE_NOT_FOUND') return signedOut();
      throw error;
    }
  }
  function signedOut() {
    writeStore(KEY.pass, null);
    writeStore(KEY.refresh, null);
    writeStore(KEY.wallet, null);
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
  s.signOutEverywhere = async () => {
    await withToken(qt => call('POST', '', { op: 'signout-all', qt }));
    signedOut();
  };
  s.rotate = async () => {
    const res = await call('POST', '', { op: 'rotate', passcode: storedPass() });
    writeStore(KEY.refresh, null);
    await login(res.passcode);
    return res.passcode;
  };
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
    }).then(absorb);
  s.dropInbox = id => withToken(qt => call('DELETE', qs({ qt, app, inbox: id })));
  s.transfer = (to, amount, note, id = randomId()) => call('POST', '', { op: 'transfer', passcode: storedPass(), to: cleanCode(to), amount, note, id }).then(absorb);
  s.merge = sources => withToken(qt => call('POST', '', { op: 'merge', qt, sources })).then(absorb);
  s.op = (op, body = {}) => withToken(qt => call('POST', '', { op, qt, ...body }));
  // The data proxy, signed in.
  s.proxy = (url, extra = '') => `${PROXY_URL}?url=${encodeURIComponent(url)}${extra}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
  s.ensureToken = async () => {
    if (!token || Date.now() - tokenAt > 15 * 60_000) await refresh({ claim: false });
    return token;
  };

  // Sign in (the gate, when there's no pass), take any pass handed over by
  // a link, and make this app live.
  s.start = async ({ data = true } = {}) => {
    if (started) return s;
    started = true;
    const handed = await takeHandoff();
    if (handed && handed !== storedPass()) {
      writeStore(KEY.refresh, null);
      writeStore(KEY.pass, handed);
    }
    let first = null;
    if (!storedPass()) first = await signInGate(s);
    else {
      try {
        first = await refresh({ claim: true, data });
        if (first?.signedOut) first = await signInGate(s);
      } catch (error) {
        // Offline: the cached wallet stands in until the next try.
        first = { offline: true, error };
      }
    }
    s.first = first;
    loop();
    return s;
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
    if (!storedPass() || waking) return;
    waking = refresh({ claim: true })
      .catch(() => {})
      .finally(() => (waking = null));
  }
  function beat() {
    if (document.visibilityState === 'hidden' || !storedPass() || !active) return;
    s.read().catch(() => {});
  }

  s.appUrl = (other, hash = '') => appUrl(other, hash);
  // A link to another app that arrives signed in (a sealed pass: apps on a
  // phone's home screen don't share storage).
  s.go = async (other, hash = '') => {
    let target = appUrl(other, hash);
    if (isStandalone() && storedPass()) {
      try {
        const { handoff } = await s.op('handoff', { passcode: storedPass() });
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

// A pass handed over in the address: #qh=<sealed> (or, from older apps,
// #qp=<pass>). Returns the pass, or ''.
async function takeHandoff() {
  const loc = globalThis.location;
  if (!loc?.hash) return '';
  const parts = loc.hash.slice(1).split('&');
  const at = parts.findIndex(p => p.startsWith('qh=') || p.startsWith('qp='));
  if (at < 0) return '';
  const [k, v] = [parts[at].slice(0, 2), decodeURIComponent(parts[at].slice(3))];
  parts.splice(at, 1);
  try {
    globalThis.history?.replaceState(globalThis.history.state, '', `${loc.pathname}${loc.search}${parts.length ? `#${parts.join('&')}` : ''}`);
  } catch {}
  try {
    sessionStorage.setItem('quadra.visit', '1');
  } catch {}
  if (k === 'qp') return PASS_PATTERN.test(cleanCode(v)) ? cleanCode(v) : '';
  try {
    const { passcode } = await call('POST', '', { op: 'redeem', handoff: v });
    return PASS_PATTERN.test(passcode) ? passcode : '';
  } catch {
    return '';
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
  grant: ['每週零用金', 'Weekly allowance'],
  pay: ['每月薪資', 'Monthly pay'],
  stake: ['下注', 'Bet'],
  payout: ['彩金', 'Winnings'],
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
export const ODDS_LIMIT_KEY = 'oddsWeeklyLimit';
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

const typedPass = text => {
  const code = cleanCode(text).replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 10);
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
};
function passInput(label) {
  const input = node('input', { class: 'q-pass-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: '11', placeholder: 'XXXXX-XXXXX', 'aria-label': label });
  input.addEventListener('input', () => {
    input.value = typedPass(input.value);
  });
  return input;
}
const ERR = {
  SYNC_PASSCODE_NOT_FOUND: ['找不到這組通行碼。', 'No Quadra Pass has this code.'],
  RATE_LIMITED: ['嘗試太多次，請稍後再試。', 'Too many tries. Please wait a little.'],
  INVALID_PASSCODE: ['通行碼是 10 個英數字，例如 ABCDE-23456。', 'A pass is 10 letters and digits, like ABCDE-23456.']
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
          if (!PASS_PATTERN.test(code)) return void (error.textContent = errorText({ code: 'INVALID_PASSCODE' }, s.lang));
          done(() => s.login(code, { data: true }));
        }
      },
      [node('label', { class: 'q-gate-label', text: en ? 'Your Quadra Pass' : '你的 Quadra Pass' }), input, error, enter]
    );
    make.addEventListener('click', () => done(() => s.create()));
    const gate = node('div', { class: 'q-gate', role: 'dialog', 'aria-modal': 'true', style: `--q-accent:${a.color}` }, [
      node('div', { class: 'q-gate-box' }, [
        node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
        node('p', { class: 'q-gate-brand', text: a.related ? (en ? 'WITH QUADRA' : 'QUADRA 相關服務') : 'QUADRA' }),
        node('h1', { class: 'q-gate-title', text: a.name }),
        node('p', { class: 'q-gate-lede', text: en ? 'Sign in with your Quadra Pass: one account for every Quadra app.' : '用 Quadra Pass 登入：所有 Quadra App 共用一個帳戶。' }),
        form,
        node('div', { class: 'q-gate-or', text: en ? 'New to Quadra?' : '第一次使用？' }),
        make,
        node('p', { class: 'q-gate-note', text: en ? 'A new pass is shown once signed in. Keep it safe: it is the key to your account.' : '建立後會顯示通行碼，請妥善保存：它是帳戶的鑰匙。' })
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
export function accountButton(s, { extra = null } = {}) {
  const btn = node('button', { class: 'q-account', type: 'button', 'aria-label': s.lang === 'en' ? 'Account' : '帳戶' }, [node('span', { class: 'q-account-pool' }), node('span', { class: 'q-account-dot', 'aria-hidden': 'true' })]);
  const paint = () => (btn.firstChild.textContent = s.wallet ? money(s.pool) : 'Quadra');
  paint();
  s.on('wallet', paint);
  btn.addEventListener('click', () => accountSheet(s, { extra: extra ? extra() : null }));
  return btn;
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
  const pass = s.pass;
  const code = node('div', { class: 'q-pass-code' }, [
    node('strong', { text: formatPass(pass), class: 'num' }),
    node('button', {
      class: 'q-btn small',
      type: 'button',
      text: T('複製', 'Copy'),
      onclick: e => navigator.clipboard?.writeText(formatPass(pass)).then(() => (e.target.textContent = T('已複製', 'Copied')))
    })
  ]);
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
            if (id === s.app) return e.preventDefault();
            e.preventDefault();
            s.go(id);
          }
        },
        [node('img', { src: `${a.path}favicon.svg`, alt: '' }), node('span', { text: a.tile || a.short })]
      )
    )
  );
  dialog.append(
    node('div', { class: 'q-sheet-head' }, [node('h2', { text: BRAND.pass }), node('button', { class: 'q-close', type: 'button', 'aria-label': T('關閉', 'Close'), text: '×', onclick: close })]),
    node('div', { class: 'q-balance' }, [node('span', { text: T('Quadra 餘額', 'Quadra balance') }), node('strong', { class: 'num', text: money(s.pool) })]),
    code,
    node('p', { class: 'q-sheet-sub', text: T('這組通行碼是帳戶唯一的鑰匙，請記下來。', 'This pass is the only key to your account: keep it somewhere safe.') }),
    node('h3', { class: 'q-sheet-h', text: T('Quadra 的 App', 'Quadra apps') }),
    tiles,
    ...(extra ? [extra] : []),
    node('h3', { class: 'q-sheet-h', text: T('帳戶安全', 'Security') }),
    node('div', { class: 'q-rows' }, [
      act(T('在其他所有裝置登出', 'Sign out on every other device'), async () => {
        if (!confirm(T('其他裝置都會登出（這台也要重新輸入通行碼）。繼續？', 'Every device is signed out (this one too: you sign in again with your pass). Continue?'))) return;
        const p = s.pass;
        await s.signOutEverywhere();
        await s.login(p);
        note.textContent = T('其他裝置已登出。', 'Every other device is signed out.');
      }),
      act(T('更換通行碼', 'Change my pass'), async () => {
        if (!confirm(T('換一組新的通行碼：帳戶和所有資料都會移過去，舊通行碼立即失效。繼續？', 'Get a new pass: the account and everything in it moves to it, and the old pass stops working at once. Continue?'))) return;
        const next = await s.rotate();
        code.querySelector('strong').textContent = formatPass(next);
        note.textContent = T(`新的通行碼：${formatPass(next)}，請記下來。`, `Your new pass: ${formatPass(next)}. Write it down.`);
      }),
      node('a', { class: 'q-row-btn', href: helpUrl(s.app), text: T(`${APPS[s.app].short} 使用說明`, `${APPS[s.app].short} guide`) }),
      act(T('在這台裝置登出', 'Sign out on this device'), async () => {
        if (!confirm(T('在這台裝置登出？資料都保留在通行碼裡。', 'Sign out on this device? Everything stays with your pass.'))) return;
        s.signOut();
        location.reload();
      }, 'q-row-btn danger')
    ]),
    note
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', e => e.target === dialog && close());
  dialog.showModal();
  return dialog;
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

// Always the newest deploy (version.json, checked on opening, on coming back
// and every few minutes): old caches are dropped and the page reloads once.
export function watchUpdates({ current, key, cachePrefix, busy = () => false, every = 5 * 60_000 } = {}) {
  if (!current || current === 'dev') return;
  let checking = false;
  async function check() {
    if (checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const latest = res.ok ? (await res.json())?.version : null;
      if (!latest || latest === current || busy()) return;
      const flag = `${key || 'quadra'}.reloadedTo`;
      if (sessionStorage.getItem(flag) === latest) return;
      sessionStorage.setItem(flag, latest);
      document.documentElement.classList.add('quadra-updating');
      if (globalThis.caches && cachePrefix) for (const name of await caches.keys()) if (name.startsWith(cachePrefix)) await caches.delete(name);
      const reg = await navigator.serviceWorker?.getRegistration?.(location.pathname);
      await reg?.update?.().catch(() => {});
      location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}${location.hash}`);
    } catch {
    } finally {
      checking = false;
    }
  }
  check();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  globalThis.addEventListener?.('pageshow', event => event.persisted && check());
  setInterval(check, every);
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
