// Stock Study: rendering and wiring. The rules live in lib/ (account.mjs for
// the ledger, markets.mjs for fees and hours, quotes.mjs for prices).
import {
  newAccount, replay, available, placeOrder, processOrders, cancelOrder, exchange, quoteExchange, amountFor, deposit, valuate, borrow, repay,
  repayAll, liquidationPlan, applyCorporateActions, applyBondCashflows, backfillPrice, fillFromHistory, netWorthSeries, mergeAccounts, recordSnapshot,
  benchmarkValue, isAccount, toggleWatch, watched, estimate, setPlan, activePlans, planRuns, nextPlanRun, runPlan, planOrderId, setAlert, activeAlerts,
  alertsFor, checkAlerts, alertHitInBars, markAlertHit,
  START_PRESETS, MIN_START, MAX_START, PLAN_MIN, taipeiDay
} from './lib/account.mjs';
import {
  BASE, CURRENCIES, MARKETS, METALS, COLLATERAL, MARGIN_CALL, MARGIN_LIQUIDATE, NHI_RATE, NHI_THRESHOLD, CLOSED_FX_MULTIPLIER,
  SHORT_FEE, currencyInfo, isOpen, isTradable, isShortable, qtyStep, roundQty, dealPrice
} from './lib/markets.mjs';
import { BONDS, ISSUERS } from './lib/bonds.mjs';
import { fetchQuotes, fetchChart, fetchBars, fetchCorporateActions, fetchFundamentals, fetchNews, searchSymbols, fxSymbol } from './lib/quotes.mjs';
import { CATEGORIES, OVERVIEW, TRACKERS, catalogInfo, searchCatalog } from './lib/catalog.mjs';
import { money, price as fmtPrice, pct, qty as fmtQty, num, compact, dateTime, date as fmtDate, shortDate, clock, weekdayClock, monthYear, escapeHtml as h, setFormatLocale } from './lib/format.mjs';
import { sparkline, lineChart, attachHover, candleChart, attachCandleHover, stackBar, SERIES } from './lib/chart.mjs';
import { timeMachine, movingAverage } from './lib/timemachine.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';
import { LESSONS, MISSIONS, GLOSSARY } from './lib/learn.mjs';
import { pack, unpack } from './lib/codec.mjs';
import { createSync, readSync, writeSync, cleanPasscode, PASSCODE_PATTERN } from './lib/sync.mjs';

const $ = id => document.getElementById(id);
const TABS = ['markets', 'portfolio', 'fx', 'history', 'guide'];
const QUOTE_REFRESH_MS = 45_000;
const LIST_REFRESH_MS = 90_000;
const ACTIONS_EVERY_MS = 12 * 3_600_000;
const STORE = {
  account: 'stockStudy.account',
  sync: 'stockStudy.syncCode',
  settings: 'stockStudy.settings',
  actions: 'stockStudy.actionsChecked',
  learn: 'stockStudy.learn',
  quotes: 'stockStudy.quotes'
};
// The live examples in the lessons.
const LEARN_SYMBOLS = ['2330.TW', '0050.TW', '^TNX', 'BTC-USD'];

const locale = detectLocale();
const t = makeT(locale);
setFormatLocale(locale);
document.documentElement.lang = locale === 'zh' ? 'zh-Hant' : 'en';

const state = {
  tab: 'markets',
  account: null,
  accountReady: false,
  quotes: new Map(),
  listAt: new Map(),
  rates: { [BASE]: 1 },
  // Currencies Yahoo has no NT$ pair for (DKK): priced through US$ instead.
  crossFx: new Set(),
  fxOpen: true,
  loaded: false,
  error: null,
  updated: 0,
  category: 'overview',
  query: '',
  search: { query: '', results: [], loading: false },
  detail: null,
  fx: { from: BASE, to: 'USD', amount: '' },
  loan: { currency: BASE, amount: '' },
  alloc: 'kind',
  historyView: 'activity',
  activityFilter: 'all',
  activityShown: 60,
  bench: null,
  settings: loadSettings(),
  learn: loadLearn(),
  // Which folding cards in the Learn tab are open (they survive redraws).
  openFolds: new Set(['lessons']),
  sync: { code: null, busy: false, error: null, at: 0 },
  // Company numbers and news per symbol, fetched when its sheet opens.
  about: new Map(),
  plan: { amount: '5000', day: '5' },
  alertPrice: '',
  tm: { symbol: '0050.TW', amount: '100000', start: String(new Date().getFullYear() - 10), mode: 'lump', result: null, loading: false, error: false },
  online: navigator.onLine !== false,
  installPrompt: null
};

// ---- Settings and storage ------------------------------------------------------

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE.settings) || '{}');
    return { updown: s.updown || (locale === 'zh' ? 'tw' : 'us'), chart: s.chart === 'candle' ? 'candle' : 'line', ma: s.ma !== false };
  } catch {
    return { updown: locale === 'zh' ? 'tw' : 'us', chart: 'line', ma: true };
  }
}
function loadLearn() {
  try {
    const l = JSON.parse(localStorage.getItem(STORE.learn) || '{}');
    return { done: l.done || {}, answers: l.answers || {} };
  } catch {
    return { done: {}, answers: {} };
  }
}
function saveLearn() {
  try {
    localStorage.setItem(STORE.learn, JSON.stringify(state.learn));
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem(STORE.settings, JSON.stringify(state.settings));
  } catch {}
  applySettings();
}
function applySettings() {
  document.body.dataset.updown = state.settings.updown;
}

async function loadAccount() {
  try {
    const saved = await unpack(localStorage.getItem(STORE.account));
    return isAccount(saved) ? saved : null;
  } catch {
    return null;
  }
}

let saveTimer;
let syncTimer;
function commit(account, { sync = true } = {}) {
  state.account = account;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      if (state.account) localStorage.setItem(STORE.account, await pack(state.account));
      else localStorage.removeItem(STORE.account);
    } catch {}
  }, 200);
  if (sync && state.sync.code) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1200);
  }
}

// ---- Names and labels ------------------------------------------------------------

const L = obj => (obj ? (locale === 'zh' ? obj.zh : obj.en) : '');
function nameOf(symbol, quote = state.quotes.get(symbol)) {
  const info = catalogInfo(symbol);
  if (info) return locale === 'zh' ? info.zh : info.en;
  if (METALS[symbol]) return L(METALS[symbol]);
  if (symbol.endsWith('=X') && symbol.length === 8) return `${symbol.slice(0, 3)}/${symbol.slice(3, 6)}`;
  return quote?.shortName || quote?.name || symbol;
}
const bareSymbol = s => (METALS[s] ? s : s.replace(/\.(TW|TWO)$/, ''));
const kindLabel = kind => t(`kind_${kind}`);
const marketLabel = id => L(MARKETS[id] || MARKETS.INTL);
const flagOf = (symbol, q) => {
  const info = q || state.quotes.get(symbol);
  if (info?.kind === 'index' || info?.kind === 'future' || info?.kind === 'fx') {
    const cat = catalogInfo(symbol)?.category;
    return cat === 'metal' ? '🛢️' : info.kind === 'fx' ? '💱' : '📈';
  }
  if (BONDS[symbol]) return BONDS[symbol].flag;
  return (MARKETS[info?.market] || MARKETS.INTL).flag;
};
const dirClass = x => (x > 1e-12 ? 'up' : x < -1e-12 ? 'down' : 'flat');
function unitOf(symbol) {
  if (METALS[symbol]) return L({ zh: METALS[symbol].unitZh, en: METALS[symbol].unitEn });
  if (BONDS[symbol]) return t('bondsUnit');
  // A currency pair is counted in its first currency (EUR/USD: euros).
  if (/^[A-Z]{6}=X$/.test(symbol)) return symbol.slice(0, 3);
  const kind = state.quotes.get(symbol)?.kind || catalogInfo(symbol)?.kind;
  if (kind === 'crypto' || /-USD$/.test(symbol)) return symbol.replace(/-USD$/, '');
  return kind === 'fund' ? t('units') : t('shares');
}
// A rate as a percentage with only the digits it has: 0.1425%, 0.3%.
const rateText = x => `${num(x * 100, 4, 0)}%`;
// An exchange rate the readable way round: 1 US$ = 31.69 NT$, not 0.0316.
const rateLine = (from, to, r) => (r >= 1 ? `1 ${from} = ${fmtPrice(r, to)} ${to}` : `1 ${to} = ${fmtPrice(1 / r, from)} ${from}`);

// ---- Data -------------------------------------------------------------------------

const wantedCurrencies = () => {
  const set = new Set(Object.keys(CURRENCIES));
  if (state.account) {
    const s = replay(state.account);
    for (const c of Object.keys(s.cash)) set.add(c);
    for (const p of Object.values(s.positions)) set.add(p.currency);
    for (const c of Object.keys(s.loans)) set.add(c);
  }
  const dq = state.detail && state.quotes.get(state.detail.symbol);
  if (dq?.currency) set.add(dq.currency);
  set.delete(BASE);
  return [...set];
};

function coreSymbols() {
  const set = new Set(OVERVIEW);
  for (const c of wantedCurrencies()) for (const sym of fxSymbolsFor(c)) set.add(sym);
  if (state.account) {
    const s = replay(state.account);
    for (const sym of Object.keys(s.positions)) set.add(sym);
    for (const o of state.account.orders) if (o.status === 'open') set.add(o.symbol);
    for (const sym of watched(state.account)) set.add(sym);
    for (const p of activePlans(state.account)) set.add(p.symbol);
    for (const a of activeAlerts(state.account)) set.add(a.symbol);
  }
  if (state.detail) set.add(state.detail.symbol);
  return set;
}

function listSymbols() {
  const cat = CATEGORIES.find(c => c.id === state.category);
  return cat ? cat.items.map(i => i[0]) : [];
}

function absorb(quotes) {
  for (const [sym, q] of quotes) {
    const info = catalogInfo(sym);
    if (info?.kind && q.kind !== info.kind && q.kind !== 'index' && q.kind !== 'future') q.kind = info.kind;
    state.quotes.set(sym, q);
  }
  for (const c of wantedCurrencies()) {
    if (state.crossFx.has(c)) crossRate(c);
    const q = state.quotes.get(fxSymbol(c));
    if (q?.price > 0) state.rates[c] = q.price;
  }
  const usd = state.quotes.get(fxSymbol('USD'));
  state.fxOpen = usd ? isOpen(usd) : true;
}

const crossSymbol = c => `USD${c}=X`;
const fxSymbolsFor = c => (state.crossFx.has(c) ? [fxSymbol('USD'), crossSymbol(c)] : [fxSymbol(c)]);

// NT$ per unit of `c` from US$ per NT$ and `c` per US$, stored as if Yahoo
// had the pair.
function crossRate(c) {
  const usd = state.quotes.get(fxSymbol('USD'));
  const uc = state.quotes.get(crossSymbol(c));
  if (!usd || !uc?.price) return;
  const price = usd.price / uc.price;
  const prev = usd.prev / uc.prev;
  state.quotes.set(fxSymbol(c), {
    ...uc,
    symbol: fxSymbol(c),
    name: `${c}/${BASE}`,
    shortName: `${c}/${BASE}`,
    currency: BASE,
    price,
    prev,
    change: price - prev,
    pct: price / prev - 1,
    line: uc.line.map(([tt, v]) => [tt, usd.price / v])
  });
}

// Rates for these currencies, fetched now if missing (through US$ when
// there's no NT$ pair).
async function ensureRates(currencies) {
  const missing = currencies.filter(c => c && c !== BASE && !state.rates[c]);
  if (!missing.length) return;
  absorb(await fetchQuotes(missing.flatMap(fxSymbolsFor)));
  const still = missing.filter(c => !state.rates[c] && !state.crossFx.has(c));
  if (!still.length) return;
  for (const c of still) state.crossFx.add(c);
  absorb(await fetchQuotes(still.flatMap(fxSymbolsFor)));
}

let refreshing = null;
async function refresh({ list = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const symbols = coreSymbols();
    const now = Date.now();
    if (state.tab === 'guide') for (const sym of LEARN_SYMBOLS) symbols.add(sym);
    if (list || now - (state.listAt.get(state.category) || 0) > LIST_REFRESH_MS) {
      for (const s of listSymbols()) symbols.add(s);
      state.listAt.set(state.category, now);
    }
    setBusy(true);
    try {
      absorb(await fetchQuotes([...symbols]));
      await ensureRates(wantedCurrencies()).catch(() => {});
      state.error = null;
      state.updated = Date.now();
      state.loaded = true;
      state.fromCache = 0;
      state.online = true;
      afterPrices();
      saveQuotes();
    } catch (error) {
      state.error = error;
    } finally {
      setBusy(false);
      refreshing = null;
      render();
    }
  })();
  return refreshing;
}

// Once new prices are in: fill waiting orders, force-sell if the loans call
// for it, record today's value.
function afterPrices() {
  // Orders left open while the page was closed are settled from the price
  // history first (backfillOrders), not at today's price.
  if (!state.account || !state.backfilled) return;
  let account = state.account;
  const now = Date.now();
  const r = processOrders(account, state.quotes, state.rates, now);
  account = r.account;
  for (const f of r.filled) toast(t('toastFilled', { side: t(f.side), qty: fmtQty(f.qty), name: nameOf(f.symbol), price: fmtPrice(f.price, f.currency) }), 'good');
  for (const o of r.rejected) toast(t('toastRejected', { name: nameOf(o.symbol), why: t(`err_${o.reason}`) }), 'bad');
  if (r.filled.some(f => f.forced)) account = repayAll(account, state.rates, state.fxOpen, now);
  let v = valuate(replay(account, now), state.quotes, state.rates);
  for (const plan of liquidationPlan(account, v)) {
    const placed = placeOrder(account, plan, { quote: state.quotes.get(plan.symbol), rates: state.rates, now });
    if (placed.account) {
      account = placed.account;
      toast(t('toastForced', { name: nameOf(plan.symbol) }), 'bad');
    }
  }
  if (account !== state.account) {
    if (account.orders.some(o => o.forced && o.status === 'filled' && o.done === now)) account = repayAll(account, state.rates, state.fxOpen, now);
    v = valuate(replay(account, now), state.quotes, state.rates);
  }
  if (!v.missingRates.length && !v.stale.length) account = recordSnapshot(account, now, v.netWorth, v.deposits);
  const alerts = checkAlerts(account, state.quotes, now);
  account = alerts.account;
  for (const a of alerts.hits) alertFired(a);
  if (account !== state.account) commit(account);
}

// ---- Offline: the last prices are kept, so the page opens with them ------------

function saveQuotes() {
  try {
    const keep = coreSymbols();
    for (const sym of LEARN_SYMBOLS) keep.add(sym);
    const quotes = [...state.quotes].filter(([sym]) => keep.has(sym) || sym.endsWith('=X'));
    localStorage.setItem(STORE.quotes, JSON.stringify({ at: state.updated, rates: state.rates, crossFx: [...state.crossFx], quotes }));
  } catch {}
}
function loadQuotes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE.quotes) || 'null');
    if (!saved?.quotes?.length) return;
    for (const [sym, q] of saved.quotes) if (!state.quotes.has(sym)) state.quotes.set(sym, q);
    Object.assign(state.rates, saved.rates || {});
    for (const c of saved.crossFx || []) state.crossFx.add(c);
    state.fromCache = saved.at;
    state.updated = saved.at;
    state.loaded = true;
  } catch {}
}
// Trading and exchanging wait for live prices (not the saved ones).
const pricesLive = () => state.loaded && !state.fromCache;

// ---- Price alerts: notifications -----------------------------------------------

function alertText(a) {
  return t(a.op === 'above' ? 'alertHitAbove' : 'alertHitBelow', { name: nameOf(a.symbol), price: fmtPrice(a.hit?.price ?? a.price, state.quotes.get(a.symbol)?.currency) });
}
function alertFired(a, { late = false } = {}) {
  const text = alertText(a) + (late ? ` · ${dateTime(a.hit.t)}` : '');
  toast(`🔔 ${text}`, 'good');
  notify(t('alertTitle'), text, a.symbol);
}
async function notify(title, body, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(title, { body, tag, icon: './icons/apple-touch-icon.png', badge: './favicon.svg' });
    else new Notification(title, { body, tag });
  } catch {}
}
async function askNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  } catch {}
}

// Alerts set before the page was closed: checked against the price bars
// since, so one that went off meanwhile is reported (with when).
async function checkAlertHistory() {
  const list = activeAlerts(state.account).filter(a => !BONDS[a.symbol]);
  for (const a of list) {
    try {
      const hit = alertHitInBars(a, await fetchBars(a.symbol, Math.max(a.since, Date.now() - 700 * 86_400_000)));
      if (!hit || !state.account.alerts?.[a.id]?.on) continue;
      commit(markAlertHit(state.account, a.id, hit, Date.now()));
      alertFired(state.account.alerts[a.id], { late: true });
    } catch {}
  }
}

// ---- Monthly plans (定期定額) ----------------------------------------------------

// Every month's buy that is due and not done: bought at the first price on
// or after its day (from the price history), at that moment's rate.
let plansRunning = false;
async function checkPlans() {
  if (!state.account || plansRunning || !state.backfilled) return;
  plansRunning = true;
  try {
    for (const plan of activePlans(state.account)) {
      const due = planRuns(plan).filter(r => !state.account.orders.some(o => o.id === planOrderId(plan, r.month)));
      if (!due.length) continue;
      let bars = [];
      try {
        bars = await fetchBars(plan.symbol, due[0].t - 86_400_000);
      } catch {
        continue;
      }
      const quote = state.quotes.get(plan.symbol);
      for (const run of due) {
        const bar = bars.find(b => b.t >= run.t);
        if (!bar) break;
        const currency = quote?.currency || plan.currency;
        let twd = currency === BASE ? 1 : null;
        if (!twd) {
          const fx = await fetchBars(fxSymbol(currency), bar.t - 5 * 86_400_000).catch(() => []);
          for (const b of fx) if (b.t <= bar.t) twd = b.c;
          twd ||= state.rates[currency];
        }
        const r = runPlan(state.account, plan, run, { price: bar.o, twd, at: bar.t, quote }, Date.now());
        if (r.account === state.account) continue;
        commit(r.account);
        if (r.fill) toast(t('toastPlan', { name: nameOf(plan.symbol), qty: fmtQty(r.fill.qty), price: fmtPrice(r.fill.price, r.fill.currency), time: fmtDate(r.fill.t) }), 'good');
        else if (r.order?.status === 'rejected') toast(t('toastPlanSkipped', { name: nameOf(plan.symbol), why: t(`err_${r.order.reason}`) }), 'bad');
      }
    }
  } finally {
    plansRunning = false;
  }
  render();
}

// Coupons and repayments of the government bonds held.
function checkBonds() {
  if (!state.account) return;
  const s = snap();
  for (const symbol of Object.keys(s.held)) {
    if (!BONDS[symbol]) continue;
    const r = applyBondCashflows(state.account, symbol, { rates: state.rates, now: Date.now() });
    if (!r.added.length) continue;
    commit(r.account);
    for (const e of r.added)
      toast(e.coupon ? t('toastCoupon', { name: nameOf(symbol), amount: money(e.net, e.currency) }) : t('toastMatured', { name: nameOf(symbol), amount: money(e.total, e.currency) }), 'good');
  }
}

// Orders that stayed open while the page was closed: each is checked
// against the price bars since it was placed, and filled at the first one
// that reached its price, dated then (at that moment's exchange rate).
async function backfillOrders() {
  const open = (state.account?.orders || []).filter(o => o.status === 'open' && !BONDS[o.symbol] && Date.now() - o.t > 60_000);
  const results = await Promise.all(
    open.map(async o => {
      try {
        const hit = backfillPrice(o, await fetchBars(o.symbol, o.t));
        if (!hit) return null;
        let twd = o.currency === BASE ? 1 : null;
        if (!twd) {
          const fx = await fetchBars(fxSymbol(o.currency), hit.t - 3 * 86_400_000).catch(() => []);
          for (const b of fx) if (b.t <= hit.t) twd = b.c;
          twd ||= state.rates[o.currency];
        }
        return twd ? { o, hit, twd } : null;
      } catch {
        return null;
      }
    })
  );
  for (const r of results.filter(Boolean).sort((a, b) => a.hit.t - b.hit.t)) {
    const f = fillFromHistory(state.account, r.o.id, r.hit, r.twd, Date.now());
    if (f.account !== state.account) commit(f.account);
    if (f.fill) toast(t('toastFilledAt', { side: t(f.fill.side), name: nameOf(f.fill.symbol), qty: fmtQty(f.fill.qty), price: fmtPrice(f.fill.price, f.fill.currency), time: dateTime(f.fill.t) }), 'good');
    else if (f.order?.status === 'rejected') toast(t('toastRejected', { name: nameOf(f.order.symbol), why: t(`err_${f.order.reason}`) }), 'bad');
  }
  if (state.account?.orders.some(o => o.forced && o.status === 'filled')) commit(repayAll(state.account, state.rates, state.fxOpen, Date.now()));
}

// Dividends and splits of everything held since the account opened, checked
// twice a day per symbol.
async function checkCorporateActions() {
  if (!state.account) return;
  let checked = {};
  try {
    checked = JSON.parse(localStorage.getItem(STORE.actions) || '{}');
  } catch {}
  const s = replay(state.account);
  const now = Date.now();
  const credited = [];
  for (const [symbol, held] of Object.entries(s.held)) {
    if (METALS[symbol] || BONDS[symbol] || now - (checked[`${state.account.id}:${symbol}`] || 0) < ACTIONS_EVERY_MS) continue;
    const kind = state.account.events.find(e => e.symbol === symbol)?.kind;
    if (kind === 'crypto' || kind === 'fx') continue;
    try {
      const actions = await fetchCorporateActions(symbol, held.first);
      const r = applyCorporateActions(state.account, symbol, actions, { rates: state.rates, now: Date.now() });
      if (r.added.length) {
        commit(r.account);
        credited.push(...r.added);
      }
      checked[`${state.account.id}:${symbol}`] = now;
    } catch {}
  }
  try {
    localStorage.setItem(STORE.actions, JSON.stringify(checked));
  } catch {}
  for (const e of credited) {
    if (e.type === 'div') toast(t('toastDividend', { name: nameOf(e.symbol), amount: money(e.net, e.currency) }), 'good');
    else toast(t('toastSplit', { name: nameOf(e.symbol), ratio: num(e.ratio, 4) }), 'good');
  }
  if (credited.length) render();
}

function setBusy(busy) {
  $('refresh').disabled = busy;
}

// ---- Toasts -------------------------------------------------------------------------

function toast(text, kind = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4700);
}

// ---- Shared bits of markup --------------------------------------------------------

function changeHtml(q, { big = false } = {}) {
  if (!q) return '<span class="chg flat">—</span>';
  const d = dirClass(q.change);
  return `<span class="chg ${d}${big ? ' big' : ''}">${q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''}${fmtPrice(Math.abs(q.change), q.currency)} (${pct(q.pct)})</span>`;
}
function pctPill(q) {
  if (!q) return '<span class="pill flat">—</span>';
  return `<span class="pill ${dirClass(q.pct)}">${pct(q.pct)}</span>`;
}
function statusDot(q) {
  if (!q) return '';
  const open = isOpen(q);
  return `<span class="mkt-dot ${open ? 'open' : ''}" title="${h(open ? t('marketOpen') : t('marketClosed'))}"></span>`;
}
// When a closed market opens next: Yahoo's next session if it has it, else
// the next weekday at the same time (holidays aren't known ahead).
function nextOpen(q, now) {
  if (!q.session) return null;
  if (q.session.start > now) return q.session.start;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: q.tz });
  let next = q.session.start;
  for (let i = 0; i < 10 && (next <= now || /Sat|Sun/.test(weekday.format(next))); i++) next += 86_400_000;
  return next;
}

function marketStatus(q) {
  if (!q) return '';
  if (q.kind === 'crypto') return `<span class="mkt-status open">${statusDot(q)}${h(t('always'))}</span>`;
  const now = Date.now();
  if (isOpen(q, now)) return `<span class="mkt-status open">${statusDot(q)}${h(t('marketOpenUntil', { time: clock(q.session.end, q.tz) }))} <small>(${h(t('localTime'))} ${h(clock(now, q.tz))})</small></span>`;
  const opens = nextOpen(q, now);
  const next = opens ? t('opensAt', { time: weekdayClock(opens) }) : t('marketClosed');
  return `<span class="mkt-status">${statusDot(q)}${h(next)} <small>(${h(t('localTime'))} ${h(clock(now, q.tz))})</small></span>`;
}
function symbolBadge(symbol, q) {
  const text = BONDS[symbol] ? symbol.split('-')[1] : /^[A-Z]{6}=X$/.test(symbol) ? symbol.slice(0, 3) : bareSymbol(symbol).replace(/-USD$/, '').replace(/^\^/, '').slice(0, 4);
  return `<span class="sym-badge k-${h(q?.kind || catalogInfo(symbol)?.kind || 'stock')}">${h(text)}</span>`;
}

function quoteRow(symbol, { note = '' } = {}) {
  const q = state.quotes.get(symbol);
  const info = catalogInfo(symbol);
  const held = snap()?.positions[symbol];
  const sub = [bareSymbol(symbol), q ? marketLabel(q.market) : '', note].filter(Boolean).join(' · ');
  return `<button class="row quote-row" type="button" data-action="open" data-symbol="${h(symbol)}">
    ${symbolBadge(symbol, q || info)}
    <span class="row-main"><span class="row-title">${h(nameOf(symbol, q))}${held ? `<span class="held-tag">${h(t('heldTag'))}</span>` : ''}</span><span class="row-sub">${flagOf(symbol, q)} ${h(sub)}</span></span>
    <span class="row-spark">${q ? sparkline(q.line, q.kind === 'crypto' ? null : q.prev) : ''}</span>
    <span class="row-price"><strong class="num">${q ? fmtPrice(q.price, q.currency) : '…'}</strong><small>${q ? h(q.currency) : ''}${q ? statusDot(q) : ''}</small></span>
    ${pctPill(q)}
  </button>`;
}

// Replaying the log is cheap but not free: one replay per account version,
// refreshed every few seconds for loan interest.
let memo = { account: null, at: 0, s: null };
function snap() {
  if (!state.account) return null;
  const now = Date.now();
  if (memo.account !== state.account || now - memo.at > 5000) memo = { account: state.account, at: now, s: replay(state.account, now) };
  return memo.s;
}
function valuation() {
  const s = snap();
  return s ? valuate(s, state.quotes, state.rates) : null;
}

// ---- Markets tab ---------------------------------------------------------------------

function renderMarkets() {
  // Overview tiles.
  $('overview').innerHTML = OVERVIEW.map(sym => {
    const q = state.quotes.get(sym);
    return `<button class="tile" type="button" data-action="open" data-symbol="${h(sym)}">
      <span class="tile-name">${h(nameOf(sym, q))}</span>
      <strong class="tile-price num">${q ? fmtPrice(q.price, q.currency) : '…'}</strong>
      <span class="tile-foot">${pctPill(q)}${q ? sparkline(q.line, q.kind === 'crypto' ? null : q.prev, { width: 64, height: 22 }) : ''}</span>
    </button>`;
  }).join('');

  const watch = watched(state.account);
  const chips = [
    ...(watch.length ? [{ id: 'watch', icon: '⭐', zh: '自選', en: 'Watchlist' }] : []),
    ...CATEGORIES
  ];
  if (state.category === 'watch' && !watch.length) state.category = 'overview';
  if (state.category === 'overview') state.category = watch.length ? 'watch' : 'tw';
  $('categories').innerHTML = chips
    .map(c => `<button class="chip" type="button" data-action="cat" data-id="${c.id}" aria-pressed="${!state.query && state.category === c.id}"><span class="chip-icon">${c.icon}</span>${h(L(c))}</button>`)
    .join('');

  if (state.query) return renderSearch();
  const cat = CATEGORIES.find(c => c.id === state.category);
  const symbols = state.category === 'watch' ? watch : cat.items.map(i => i[0]);
  $('list-title').textContent = state.category === 'watch' ? t('watchlist') : L(cat);
  $('list-note').textContent = cat?.id === 'index' || cat?.id === 'metal' ? t('watchOnlyNote') : cat?.id === 'crypto' ? t('cryptoNote') : cat?.id === 'fx' ? t('fxTradeNote') : '';
  $('quote-list').innerHTML = symbols.map(s => quoteRow(s)).join('') || `<p class="empty">${h(t('nothingHere'))}</p>`;
}

let searchTimer;
function onSearchInput(value) {
  state.query = value.trim();
  clearTimeout(searchTimer);
  renderMarkets();
  if (!state.query) return;
  searchTimer = setTimeout(async () => {
    const q = state.query;
    const local = searchCatalog(q, 40).map(i => i.symbol);
    state.search = { query: q, results: [], loading: true };
    renderSearch();
    let remote = [];
    try {
      remote = await searchSymbols(q);
    } catch {}
    if (state.query !== q) return;
    const extra = remote.filter(r => !local.includes(r.symbol));
    state.search = { query: q, results: extra, loading: false };
    const missing = [...local, ...extra.map(r => r.symbol)].filter(s => !state.quotes.has(s)).slice(0, 40);
    if (missing.length) {
      try {
        absorb(await fetchQuotes(missing));
      } catch {}
    }
    if (state.query === q) renderSearch();
  }, 350);
}

function renderSearch() {
  const q = state.query;
  const local = searchCatalog(q, 40).map(i => i.symbol);
  const extra = state.search.query === q ? state.search.results : [];
  $('list-title').textContent = t('searchResults', { q });
  $('list-note').textContent = /[^\x20-\x7e]/.test(q) ? t('searchChineseNote') : t('searchNote');
  const rows = [...local.map(s => quoteRow(s)), ...extra.map(r => quoteRow(r.symbol, { note: r.exchange }))];
  $('quote-list').innerHTML =
    rows.join('') ||
    (state.search.loading && state.search.query === q ? `<p class="empty">${h(t('searching'))}</p>` : `<p class="empty">${h(t('noResults'))}</p>`);
}

// ---- Detail sheet: chart, facts, trade ticket ------------------------------------------

async function openDetail(symbol) {
  const q0 = state.quotes.get(symbol);
  const held = snap()?.positions[symbol];
  state.detail = {
    symbol,
    range: '1d',
    chart: null,
    chartError: false,
    side: 'buy',
    type: 'market',
    qty: '',
    limit: q0 ? String(+q0.price.toPrecision(6)) : '',
    stop: q0 ? String(+q0.price.toPrecision(6)) : '',
    msg: null,
    held: Boolean(held)
  };
  const dialog = $('detail');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  renderDetail();
  try {
    absorb(await fetchQuotes([symbol]));
    const q = state.quotes.get(symbol);
    if (q) await ensureRates([q.currency]);
    if (q && state.detail?.symbol === symbol && !state.detail.limit) state.detail.limit = state.detail.stop = String(+q.price.toPrecision(6));
  } catch {}
  if (state.detail?.symbol !== symbol) return;
  renderDetail();
  loadChart();
  loadAbout(symbol);
}

// Kinds with a company or fund behind them (P/E, holdings, news).
const ABOUT_KINDS = new Set(['stock', 'etf', 'bond', 'fund']);
async function loadAbout(symbol) {
  const q = state.quotes.get(symbol);
  if (!q || !ABOUT_KINDS.has(q.kind) || BONDS[symbol]) return;
  const have = state.about.get(symbol);
  if (have && (have.loading || Date.now() - have.at < 30 * 60_000)) return;
  state.about.set(symbol, { loading: true, at: Date.now() });
  const info = catalogInfo(symbol);
  const [facts, news] = await Promise.all([
    fetchFundamentals(symbol).catch(() => null),
    fetchNews(/\.(TW|TWO)$/.test(symbol) ? info?.en || q.name : bareSymbol(symbol)).catch(() => [])
  ]);
  state.about.set(symbol, { loading: false, at: Date.now(), facts, news });
  if (state.detail?.symbol === symbol) refreshDetailLive();
}

async function loadChart() {
  const d = state.detail;
  if (!d) return;
  const { symbol, range } = d;
  d.chart = null;
  d.chartError = false;
  renderChart();
  try {
    const chart = await fetchChart(symbol, range);
    if (state.detail !== d || d.range !== range) return;
    d.chart = chart;
  } catch {
    if (state.detail !== d) return;
    d.chartError = true;
  }
  renderChart();
}

function closeDetail() {
  state.detail = null;
  if ($('detail').open) $('detail').close();
}

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  const q = state.quotes.get(d.symbol);
  const info = catalogInfo(d.symbol);
  const starred = watched(state.account).includes(d.symbol);
  const kind = q?.kind || info?.kind;
  const sub = [bareSymbol(d.symbol), q?.exchange, kind ? kindLabel(kind) : ''].filter(Boolean).join(' · ');
  $('detail-body').innerHTML = `
    <header class="sheet-head">
      ${symbolBadge(d.symbol, q || info)}
      <div class="sheet-title"><h2>${h(nameOf(d.symbol, q))}</h2><p>${flagOf(d.symbol, q)} ${h(sub)}</p></div>
      <button class="icon-button star${starred ? ' on' : ''}" type="button" data-action="star" aria-label="${h(t('watchToggle'))}" title="${h(t('watchToggle'))}">${starred ? '★' : '☆'}</button>
      <button class="icon-button" type="button" data-action="close" aria-label="${h(t('close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    ${
      q
        ? `<div class="price-block">
      <div><strong class="big-price num">${fmtPrice(q.price, q.currency)}</strong> <span class="cur">${h(q.currency)}${METALS[d.symbol] ? ` / ${h(unitOf(d.symbol))}` : ''}</span></div>
      <div>${changeHtml(q, { big: true })}</div>
      <div class="price-meta">${marketStatus(q)}${q.marketTime ? ` · <span>${h(t('asOf', { time: dateTime(q.marketTime) }))}</span>` : ''}</div>
    </div>`
        : `<p class="empty">${h(t('loadingQuote'))}</p>`
    }
    <div class="card chart-card">
      <div class="chart-controls">
        <div class="segmented ranges" role="group">${['1d', '5d', '1mo', '6mo', 'ytd', '1y', '5y', 'max']
          .map(r => `<button type="button" data-action="range" data-range="${r}" aria-pressed="${d.range === r}">${h(t(`range_${r}`))}</button>`)
          .join('')}</div>
        <div class="chart-style">
          <div class="segmented small" role="group"><button type="button" data-action="chart-style" data-v="line" aria-pressed="${state.settings.chart === 'line'}">${h(t('chartLine'))}</button><button type="button" data-action="chart-style" data-v="candle" aria-pressed="${state.settings.chart === 'candle'}">${h(t('chartCandle'))}</button></div>
          <button class="chip small" type="button" data-action="chart-ma" aria-pressed="${state.settings.ma}">${h(t('chartMa'))}</button>
        </div>
      </div>
      <div id="detail-chart" class="chart-box"></div>
    </div>
    ${q ? factsHtml(q) : ''}
    ${positionHtml(d.symbol)}
    ${q ? (isTradable(q.kind) ? '<div id="ticket"></div>' : trackersHtml(d.symbol)) : ''}
    ${q ? toolsHtml(d.symbol, q) : ''}
    ${q ? aboutHtml(d.symbol, q) : ''}
    ${ownTradesHtml(d.symbol)}
  `;
  renderChart();
  if (q && isTradable(q.kind)) renderTicket();
}

function renderChart() {
  const d = state.detail;
  const box = $('detail-chart');
  if (!d || !box) return;
  const q = state.quotes.get(d.symbol);
  if (d.chartError) {
    box.innerHTML = `<p class="empty">${h(t('chartError'))}</p>`;
    return;
  }
  let points = d.chart?.points;
  if (!points && d.range === '1d' && q?.line?.length > 1) points = q.line;
  if (!points || points.length < 2) {
    box.innerHTML = `<p class="empty">${h(d.chart ? t('chartEmpty') : t('loadingChart'))}</p>`;
    return;
  }
  const cur = q?.currency || d.chart?.quote?.currency;
  const intraday = d.range === '1d' || d.range === '5d';
  const base = d.range === '1d' && q && q.kind !== 'crypto' ? q.prev : points[0][1];
  const dir = dirClass(points.at(-1)[1] - base);
  const width = Math.max(320, Math.round(box.clientWidth || 640));
  const tz = q?.tz;
  const xFormat = tt => (d.range === '1d' ? clock(tt, tz) : intraday ? shortDate(tt, tz) : d.range === '5y' || d.range === 'max' ? monthYear(tt, tz) : shortDate(tt, tz));
  const when = tt => (intraday ? dateTime(tt, tz) : fmtDate(tt, tz));
  const change = points.at(-1)[1] / base - 1;
  const bars = d.chart?.bars?.length > 1 ? d.chart.bars : null;
  // Moving averages over the bars (or points) shown: 5, 20 and 60 of them.
  const closes = bars ? bars.map(b => [b.t, b.c]) : points;
  const mas = state.settings.ma ? MA_PERIODS.filter(n => closes.length > n + 2).map((n, i) => ({ n, points: movingAverage(closes, n), cls: `ma${i + 1}` })) : [];
  const legend = mas.length ? `<ul class="legend-inline">${mas.map(m => `<li><i class="sw ${m.cls}"></i>MA${m.n}</li>`).join('')}</ul>` : '';
  const head = `<p class="chart-change">${h(t('rangeChange', { range: t(`range_${d.range}`) }))} <span class="chg ${dir}">${pct(change)}</span></p>`;
  const height = width < 480 ? 220 : 260;
  if (state.settings.chart === 'candle' && bars) {
    const { svg, frame } = candleChart(bars, { width, height, lines: mas, yFormat: v => fmtPrice(v, cur), xFormat });
    box.innerHTML = `${head}${svg}${legend}`;
    attachCandleHover(box, bars, frame, b => {
      const ma = mas.map(m => {
        const p = m.points.find(x => x[0] === b.t);
        return p ? `<span>MA${m.n} ${fmtPrice(p[1], cur)}</span>` : '';
      });
      return `<span>${h(when(b.t))}</span><span class="ohlc num">${h(t('ohlcOpen'))} ${fmtPrice(b.o, cur)} · ${h(t('ohlcHigh'))} ${fmtPrice(b.h, cur)}</span><span class="ohlc num">${h(t('ohlcLow'))} ${fmtPrice(b.l, cur)} · ${h(t('ohlcClose'))} <strong>${fmtPrice(b.c, cur)}</strong></span><span class="chg ${dirClass(b.c - b.o)}">${pct(b.c / b.o - 1)}</span>${b.v ? `<span>${h(t('volume'))} ${compact(b.v)}</span>` : ''}${ma.join('')}`;
    });
    return;
  }
  const series = [{ points }, ...mas.map(m => ({ points: m.points, cls: m.cls }))];
  const { svg, frame } = lineChart(series, { width, height, base: d.range === '1d' ? base : null, dir, yFormat: v => fmtPrice(v, cur), xFormat });
  box.innerHTML = `${head}${svg}${legend}${state.settings.chart === 'candle' && !bars ? `<p class="note">${h(t('noCandles'))}</p>` : ''}`;
  attachHover(box, series, frame, (i, tt, [v, ...ma]) => `<strong class="num">${fmtPrice(v, cur)}</strong><span>${h(when(tt))}</span><span class="chg ${dirClass(v - base)}">${pct(v / base - 1)}</span>${ma.map((x, k) => (x != null ? `<span>MA${mas[k].n} ${fmtPrice(x, cur)}</span>` : '')).join('')}`);
}
const MA_PERIODS = [5, 20, 60];

function feeSummary(q) {
  const m = MARKETS[q.market] || MARKETS.INTL;
  const parts = [];
  if (m.commission.rate) parts.push(m.commission.min ? t('feeCommission', { rate: rateText(m.commission.rate), min: money(m.commission.min, m.currency || q.currency) }) : t('feeCommissionNoMin', { rate: rateText(m.commission.rate) }));
  if (m.spread) parts.push(t('feeSpread', { rate: rateText(m.spread) }));
  for (const side of ['buy', 'sell']) {
    const rules = m[side];
    if (!rules) continue;
    const r = rules[q.kind] || rules.all;
    if (r?.tax) parts.push(t(side === 'buy' ? 'feeBuyTax' : 'feeSellTax', { rate: rateText(r.tax) }));
  }
  if (!parts.length) parts.push(t('feeNone'));
  return parts.join(' · ');
}

function bondFacts(q) {
  const bond = BONDS[q.symbol];
  const b = q.bond;
  const perYear = { 1: t('annual'), 2: t('semiannual') }[bond.freq];
  return [
    [t('bondYield'), `${num(b.yield, 3)}%${b.live ? '' : ` (${t('referenceYield')})`}`],
    [t('cleanPrice'), `${num(b.clean, 3)} / 100`],
    [t('accrued'), `${money((b.accrued * bond.face) / 100, bond.currency, { digits: 2 })} ${t('perBond')}`],
    [t('coupon'), bond.coupon ? `${num(bond.coupon, 3)}% · ${perYear}` : t('zeroCoupon')],
    [t('maturity'), `${fmtDate(bond.maturity, 'UTC')} (${t('yearsLeft', { n: num(b.years, 1) })})`],
    [t('faceValue'), `${money(bond.face, bond.currency)} ${t('perBond')}`],
    [t('couponTax'), rateText(bond.tax)],
    [t('currency'), `${currencyInfo(q.currency).flag} ${q.currency} · ${L(currencyInfo(q.currency))}`],
    [t('hours'), `${clock(q.session.start, q.tz)}–${clock(q.session.end, q.tz)} (${t('localTime')}) · ${clock(q.session.start)}–${clock(q.session.end)} ${t('taipeiTime')}`],
    [t('costs'), feeSummary(q)],
    ...(state.rates[q.currency] && q.currency !== BASE ? [[t('inTwd'), `${money(q.price * state.rates[q.currency], BASE)} ${t('perBond')}`]] : [])
  ];
}

function factsHtml(q) {
  if (BONDS[q.symbol] && q.bond) {
    return `<dl class="facts-grid">${bondFacts(q).map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>${
      q.bond.live ? '' : `<p class="note">${h(t('referenceNote'))}</p>`
    }`;
  }
  const rows = [
    [t('prevClose'), fmtPrice(q.prev, q.currency)],
    [t('dayRange'), q.dayLow != null ? `${fmtPrice(q.dayLow, q.currency)} – ${fmtPrice(q.dayHigh, q.currency)}` : '—'],
    [t('range52'), q.low52 != null ? `${fmtPrice(q.low52, q.currency)} – ${fmtPrice(q.high52, q.currency)}` : '—'],
    [t('volume'), q.volume ? compact(q.volume) : '—'],
    [t('currency'), `${currencyInfo(q.currency).flag} ${q.currency} · ${L(currencyInfo(q.currency))}`],
    [t('market'), `${(MARKETS[q.market] || MARKETS.INTL).flag} ${marketLabel(q.market)}`],
    ...(q.session && q.kind !== 'crypto' ? [[t('hours'), `${clock(q.session.start, q.tz)}–${clock(q.session.end, q.tz)} (${t('localTime')}) · ${clock(q.session.start)}–${clock(q.session.end)} ${t('taipeiTime')}`]] : []),
    ...(isTradable(q.kind) ? [[t('costs'), feeSummary(q)]] : []),
    ...(state.rates[q.currency] && q.currency !== BASE ? [[t('inTwd'), `${money(q.price * state.rates[q.currency], BASE, { digits: q.price * state.rates[q.currency] < 100 ? 2 : 0 })} ${t('perUnit', { unit: unitOf(q.symbol) })}`]] : [])
  ];
  return `<dl class="facts-grid">${rows.map(([k, v]) => `<div><dt>${h(k)}</dt><dd>${h(v)}</dd></div>`).join('')}</dl>`;
}

function positionHtml(symbol) {
  const v = valuation();
  const p = v?.positions.find(x => x.symbol === symbol);
  if (!p) return '';
  return `<div class="card position-card">
    <h3 class="card-title">${h(t('yourPosition'))}</h3>
    <div class="kpis">
      ${kpi(p.short ? t('shortHolding') : t('holding'), `${fmtQty(Math.abs(p.qty))} ${unitOf(symbol)}`, p.short ? t('borrowFeeSoFar', { amount: money(p.borrowFee || 0, p.currency, { digits: 2 }) }) : '')}
      ${kpi(t('avgCost'), `${fmtPrice(p.avg, p.currency)} ${p.currency}`)}
      ${kpi(t('marketValue'), money(p.valueTWD, BASE), p.currency !== BASE ? money(p.value, p.currency) : '')}
      ${kpi(t('unrealized'), money(p.pl, BASE, { sign: true }), pct(p.plPct), dirClass(p.pl))}
    </div>
  </div>`;
}

function kpi(label, value, sub = '', dir = '') {
  return `<div class="kpi"><span class="kpi-label">${h(label)}</span><strong class="stat-value num ${dir}">${h(value)}</strong>${sub ? `<span class="kpi-sub num ${dir}">${h(sub)}</span>` : ''}</div>`;
}

function trackersHtml(symbol) {
  const list = TRACKERS[symbol] || [];
  return `<div class="card note-card"><p>${h(t('watchOnly'))}</p>${
    list.length ? `<p class="muted">${h(t('trackWith'))}</p><div class="button-row">${list.map(s => `<button class="ghost-button" type="button" data-action="open" data-symbol="${h(s)}">${h(nameOf(s))} <small>${h(bareSymbol(s))}</small></button>`).join('')}</div>` : ''
  }</div>`;
}

// ---- Detail sheet: alerts, monthly plan, time machine ---------------------------

const canPlan = q => isTradable(q.kind) && !BONDS[q.symbol];

function toolsHtml(symbol, q) {
  return [alertCardHtml(symbol, q), canPlan(q) ? planCardHtml(symbol, q) : '', `<div class="button-row tools-row"><button class="ghost-button" type="button" data-action="tm-open" data-symbol="${h(symbol)}">⏳ ${h(t('tmFromDetail'))}</button></div>`].join('');
}

function alertCardHtml(symbol, q) {
  const list = alertsFor(state.account, symbol);
  const price = Number(state.alertPrice);
  const op = price > q.price ? 'above' : 'below';
  const presets = [-0.1, -0.05, 0.05, 0.1].map(k => [pct(k, { digits: 0 }), +(q.price * (1 + k)).toPrecision(5)]);
  const rows = list
    .map(a =>
      a.on
        ? `<li><span>🔔 ${h(t(a.op === 'above' ? 'alertWhenAbove' : 'alertWhenBelow', { price: fmtPrice(a.price, q.currency) }))}</span><button class="ghost-button small" type="button" data-action="alert-off" data-id="${h(a.id)}">${h(t('remove'))}</button></li>`
        : `<li class="muted"><span>✓ ${h(t('alertWentOff', { price: fmtPrice(a.hit.price, q.currency), time: dateTime(a.hit.t) }))}</span></li>`
    )
    .join('');
  return fold(
    '🔔',
    t('alertTitle'),
    `<p>${h(t('alertIntro'))}</p>
    ${rows ? `<ul class="tool-list">${rows}</ul>` : ''}
    <div class="fx-amount"><label class="field grow"><span>${h(t('alertPriceLabel'))} (${h(q.currency)})</span><input id="alert-price" inputmode="decimal" autocomplete="off" value="${h(state.alertPrice)}" placeholder="${h(fmtPrice(q.price, q.currency))}" /></label></div>
    <div class="qty-presets">${presets.map(([label, v]) => `<button class="chip small" type="button" data-action="alert-preset" data-v="${v}">${h(label)}</button>`).join('')}</div>
    <button class="primary-button" type="button" data-action="alert-add" ${price > 0 && Math.abs(price / q.price - 1) > 1e-6 ? '' : 'disabled'}>${h(price > 0 ? t(op === 'above' ? 'alertAddAbove' : 'alertAddBelow', { price: fmtPrice(price, q.currency) }) : t('alertAdd'))}</button>
    ${'Notification' in window && Notification.permission !== 'granted' ? `<p class="note">${h(Notification.permission === 'denied' ? t('alertNoNotify') : t('alertNotifyNote'))}</p>` : ''}`,
    list.some(a => a.on),
    'tool:alert'
  );
}

function planCardHtml(symbol, q) {
  const plan = activePlans(state.account).find(p => p.symbol === symbol);
  if (plan) {
    const next = nextPlanRun(plan);
    return fold(
      '📅',
      t('planTitle'),
      `<p>${h(t('planActive', { amount: money(plan.amount, BASE), day: plan.day }))}</p>
      <p class="muted">${h(t('planNext', { date: next ? fmtDate(next) : '—' }))}</p>
      ${planHistoryHtml(plan)}
      <div class="button-row"><button class="ghost-button danger" type="button" data-action="plan-off" data-id="${h(plan.id)}">${h(t('planStop'))}</button></div>`,
      true,
      'tool:plan'
    );
  }
  const amount = Number(state.plan.amount);
  const perUnit = q.price * (state.rates[q.currency] || 0);
  const units = perUnit > 0 ? amount / perUnit : 0;
  return fold(
    '📅',
    t('planTitle'),
    `<p>${h(t('planIntro'))}</p>
    <div class="loan-form">
      <label class="field grow"><span>${h(t('planAmount'))} (NT$)</span><input id="plan-amount" inputmode="numeric" autocomplete="off" value="${h(state.plan.amount)}" /></label>
      <label class="field"><span>${h(t('planDay'))}</span><select id="plan-day">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === state.plan.day ? 'selected' : ''}>${h(t('dayOfMonth', { n: i + 1 }))}</option>`).join('')}</select></label>
    </div>
    ${perUnit > 0 && amount > 0 ? `<p class="muted">${h(t('planBuys', { units: num(units, units < 10 ? 2 : 0), unit: unitOf(symbol) }))}${q.currency !== BASE ? ` · ${h(t('planFx', { cur: q.currency }))}` : ''}</p>` : ''}
    ${state.account ? '' : `<p class="note">${h(t('needAccount'))}</p>`}
    <button class="primary-button" type="button" data-action="plan-add" ${amount >= PLAN_MIN && state.account ? '' : 'disabled'}>${h(t('planStart'))}</button>
    <p class="note">${h(t('planNote', { min: money(PLAN_MIN, BASE) }))}</p>`,
    false,
    'tool:plan'
  );
}

function planHistoryHtml(plan) {
  const runs = state.account.orders.filter(o => o.plan === plan.id).slice(-4).reverse();
  if (!runs.length) return '';
  return `<ul class="tool-list">${runs
    .map(o => `<li><span>${h(fmtDate(o.done || o.t))}</span><span class="num">${o.status === 'filled' ? h(`${fmtQty(o.qty)} ${unitOf(o.symbol)} @ ${fmtPrice(o.price, o.currency)}`) : h(t(`err_${o.reason}`))}</span></li>`)
    .join('')}</ul>`;
}

function addAlert() {
  const d = state.detail;
  const q = state.quotes.get(d.symbol);
  if (!state.account) return showSetup();
  const price = Number(state.alertPrice);
  const r = setAlert(state.account, { symbol: d.symbol, op: price > q.price ? 'above' : 'below', price });
  if (r.error) return toast(t(`err_${r.error}`), 'bad');
  commit(r.account);
  state.alertPrice = '';
  toast(t('alertSet'), 'good');
  askNotifications().then(() => refreshDetailLive());
  refreshDetailLive();
}

function addPlan() {
  const d = state.detail;
  const q = state.quotes.get(d.symbol);
  if (!state.account) return showSetup();
  const r = setPlan(state.account, { symbol: d.symbol, amount: state.plan.amount, day: state.plan.day, name: q.name, kind: q.kind, market: q.market, currency: q.currency });
  if (r.error) return toast(t(`err_${r.error}`), 'bad');
  commit(r.account);
  toast(t('planSet', { date: fmtDate(nextPlanRun(r.plan)) }), 'good');
  refreshDetailLive();
}

// ---- Detail sheet: what the company does, its numbers, news ------------------------

// Yahoo's sectors, in Chinese.
const SECTORS_ZH = {
  Technology: '科技', 'Financial Services': '金融', Healthcare: '醫療保健', 'Consumer Cyclical': '非必需消費', 'Consumer Defensive': '必需消費',
  'Communication Services': '通訊服務', Industrials: '工業', Energy: '能源', Utilities: '公用事業', 'Real Estate': '不動產', 'Basic Materials': '原物料'
};

function aboutHtml(symbol, q) {
  if (!ABOUT_KINDS.has(q.kind) || BONDS[symbol]) return '';
  const a = state.about.get(symbol);
  const fund = q.kind !== 'stock';
  const title = fund ? t('aboutFund') : t('aboutCompany');
  if (!a || a.loading) return fold(fund ? '📦' : '🏢', title, `<p class="muted">${h(t('aboutLoading'))}</p>`, true, 'about');
  const f = a.facts;
  const cur = f?.currency || q.currency;
  const inTwd = x => (x != null && cur !== BASE && state.rates[cur] ? ` (≈ ${compactMoney(x * state.rates[cur], BASE)})` : '');
  const rows = [];
  const add = (key, value, explain) => value != null && value !== '' && rows.push([t(key), value, explain ? t(explain) : '']);
  if (f) {
    if (fund) {
      add('expenseRatio', f.expenseRatio != null ? pct(f.expenseRatio, { sign: false, digits: 2 }) : null, 'expenseRatioHelp');
      add('fundSize', f.totalAssets != null ? compactMoney(f.totalAssets, cur) + inTwd(f.totalAssets) : null, 'fundSizeHelp');
      add('divYield', f.dividendYield != null ? pct(f.dividendYield, { sign: false }) : null, 'divYieldHelp');
      add('peRatio', f.pe != null ? num(f.pe, 1) : null, 'peFundHelp');
      add('issuer', f.family, '');
      add('fundCategory', f.category, '');
      add('inception', f.inception ? fmtDate(f.inception) : null, '');
    } else {
      add('marketCap', f.marketCap != null ? compactMoney(f.marketCap, cur) + inTwd(f.marketCap) : null, 'marketCapHelp');
      add('peRatio', f.pe != null ? num(f.pe, 1) : null, 'peHelp');
      add('eps', f.eps != null ? `${fmtPrice(f.eps, cur)} ${cur}` : null, 'epsHelp');
      add('divYield', f.dividendYield != null ? pct(f.dividendYield, { sign: false }) : null, 'divYieldHelp');
      add('profitMargin', f.margin != null ? pct(f.margin, { sign: false, digits: 1 }) : null, 'profitMarginHelp');
      add('roe', f.roe != null ? pct(f.roe, { sign: false, digits: 1 }) : null, 'roeHelp');
      add('revenueGrowth', f.growth != null ? pct(f.growth, { digits: 1 }) : null, 'revenueGrowthHelp');
      add('beta', f.beta != null ? num(f.beta, 2) : null, 'betaHelp');
      add('pbRatio', f.pb != null ? num(f.pb, 2) : null, 'pbHelp');
      add('sector', f.sector ? `${locale === 'zh' ? SECTORS_ZH[f.sector] || f.sector : f.sector}${f.industry ? ` · ${f.industry}` : ''}` : null, '');
      add('employees', f.employees ? num(f.employees) : null, '');
    }
  }
  const grid = rows.length
    ? `<dl class="about-grid">${rows.map(([k, v, e]) => `<div><dt>${h(k)}</dt><dd class="num">${h(v)}</dd>${e ? `<p>${h(e)}</p>` : ''}</div>`).join('')}</dl>`
    : `<p class="muted">${h(t('aboutNone'))}</p>`;
  const top = f?.holdings?.length
    ? `<h3 class="card-title">${h(t('topHoldings'))}</h3><ul class="bars-list holdings">${f.holdings
        .map(x => `<li><button class="link bar-label" type="button" data-action="open" data-symbol="${h(x.symbol)}">${h(catalogInfo(x.symbol) ? nameOf(x.symbol) : x.name)}</button><span class="bar-track"><span class="bar flat" style="width:${Math.min(100, (x.weight / f.holdings[0].weight) * 100)}%"></span></span><strong class="num">${h(pct(x.weight, { sign: false, digits: 1 }))}</strong></li>`)
        .join('')}</ul><p class="note">${h(t('topHoldingsNote', { pct: pct(f.holdings.reduce((sum, x) => sum + x.weight, 0), { sign: false, digits: 0 }) }))}</p>`
    : '';
  const summary = f?.summary
    ? `<details class="summary-text"><summary>${h(t('whatItDoes'))}</summary><p lang="en">${h(f.summary)}</p>${f.website ? `<p><a href="${h(f.website)}" target="_blank" rel="noopener">${h(f.website.replace(/^https?:\/\//, ''))}</a></p>` : ''}</details>`
    : '';
  const news = a.news?.length
    ? `<h3 class="card-title">${h(t('newsTitle'))}</h3><ul class="news">${a.news
        .slice(0, 5)
        .map(n => `<li><a href="${h(n.link)}" target="_blank" rel="noopener">${h(n.title)}</a><small>${h(n.publisher)} · ${h(dateTime(n.t))}</small></li>`)
        .join('')}</ul>`
    : '';
  return fold(fund ? '📦' : '🏢', title, `${grid}${top}${summary}${news}<p class="note">${h(t('aboutSource'))}</p>`, true, 'about');
}
// Big amounts, short: NT$6,418兆 / US$4.98T.
const compactMoney = (x, cur) => `${currencyInfo(cur).symbol || `${cur} `}${compact(x)}`;

function ownTradesHtml(symbol) {
  if (!state.account) return '';
  const fills = state.account.events.filter(e => e.symbol === symbol && (e.type === 'fill' || e.type === 'div' || e.type === 'split')).slice(-6).reverse();
  const open = state.account.orders.filter(o => o.symbol === symbol && o.status === 'open');
  if (!fills.length && !open.length) return '';
  return `<div class="card"><h3 class="card-title">${h(t('yourActivity'))}</h3>${open.map(orderRow).join('')}${fills.map(activityRow).join('')}</div>`;
}

// What the ticket would do: the estimate, cash and shares at hand, the most
// that can be bought.
function ticketInfo() {
  const d = state.detail;
  const q = state.quotes.get(d.symbol);
  const s = snap();
  const avail = s ? available(state.account, s) : { cash: {}, qty: {} };
  const qty = Number(d.qty);
  const ref = d.type === 'limit' ? Number(d.limit) : d.type === 'stop' ? Math.max(Number(d.stop), d.side === 'buy' ? q.price : 0) || q.price : q.price;
  const est = qty > 0 && ref > 0 ? estimate({ market: q.market, kind: q.kind, currency: q.currency, side: d.side, qty, price: ref }) : null;
  const cash = Math.max(0, avail.cash[q.currency] || 0);
  const shares = Math.max(0, avail.qty[d.symbol] || 0);
  // Largest quantity whose all-in cost fits the cash.
  let max = 0;
  if (ref > 0) {
    const step = qtyStep(q.kind);
    const perUnit = dealPrice(q.market, 'buy', ref) * (1 + ((MARKETS[q.market] || MARKETS.INTL).commission.rate || 0) + 0.006);
    max = roundQty(cash / perUnit, q.kind);
    while (max > 0 && estimate({ market: q.market, kind: q.kind, currency: q.currency, side: 'buy', qty: max, price: ref }).total > cash) max = roundQty(max - (step >= 1 ? 1 : max * 0.001), q.kind);
  }
  const short = d.side === 'buy' && est ? Math.max(0, est.total - cash) : 0;
  let topUp = null;
  if (short > 0 && q.currency !== BASE && state.rates[q.currency]) {
    const need = amountFor(BASE, q.currency, short, state.rates, state.fxOpen);
    if (need && (avail.cash[BASE] || 0) >= need) topUp = { need, get: short };
  }
  // How much can be sold short on top of what's held.
  let shortRoom = 0;
  if (d.side === 'sell' && isShortable(q.kind) && state.rates[q.currency]) {
    const v = valuation();
    const room = Math.max(0, (v.assets - 1.5 * (v.debtTWD + v.shortTWD)) / 0.5);
    shortRoom = v.margin === 'ok' ? roundQty(room / (q.price * state.rates[q.currency]), q.kind) : 0;
  }
  return { q, est, cash, shares, max, short, topUp, qty, ref, shortRoom };
}

function renderTicket() {
  const box = $('ticket');
  const d = state.detail;
  if (!box || !d) return;
  if (!state.account) {
    box.innerHTML = `<div class="card ticket"><p>${h(t('needAccount'))}</p><button class="primary-button" type="button" data-action="setup">${h(t('openAccount'))}</button></div>`;
    return;
  }
  const { q, est, cash, shares, max, short, topUp, qty, shortRoom } = ticketInfo();
  const open = isOpen(q);
  const unit = unitOf(d.symbol);
  const presets =
    d.side === 'sell'
      ? [[t('pct25'), roundQty(shares * 0.25, q.kind)], [t('pct50'), roundQty(shares * 0.5, q.kind)], [t('all'), roundQty(shares, q.kind)], [t('maxShort'), roundQty(shares + shortRoom, q.kind)]]
      : q.kind === 'govbond'
        ? [[t('max'), max], ['1', 1], ['10', 10], ['100', 100]]
        : q.kind === 'fx'
        ? [[t('max'), max], ['1,000', 1000], ['10,000', 10_000], ['100,000', 100_000]]
        : q.kind === 'crypto'
        ? [[t('max'), max], ['0.001', 0.001], ['0.01', 0.01], ['0.1', 0.1], ['1', 1]]
        : q.market === 'TW'
          ? [[t('max'), max], ['1', 1], ['100', 100], [t('oneLot'), 1000]]
          : [[t('max'), max], ['1', 1], ['10', 10], ['100', 100]];
  const typeHint = d.type === 'limit' ? t(d.side === 'buy' ? 'limitBuyHint' : 'limitSellHint') : d.type === 'stop' ? t(d.side === 'buy' ? 'stopBuyHint' : 'stopSellHint') : t('marketHint');
  const lines = est
    ? [
        [t('estPrice'), fmtPrice(est.price, q.currency)],
        [t('gross'), money(est.gross, q.currency)],
        ...(est.commission ? [[t('commission'), money(est.commission, q.currency)]] : []),
        ...(est.tax ? [[t(d.side === 'buy' ? 'buyTax' : 'sellTax'), money(est.tax, q.currency)]] : []),
        ...(est.fee ? [[t('exchangeFee'), money(est.fee, q.currency)]] : [])
      ]
    : [];
  const problems = [];
  const shorting = d.side === 'sell' && qty > shares + 1e-9;
  if (shorting && !isShortable(q.kind)) problems.push(t('notEnoughShares', { have: fmtQty(shares) }));
  else if (shorting && qty > shares + shortRoom + 1e-9) problems.push(t('shortTooBig', { max: fmtQty(shares + shortRoom) }));
  if (short > 0) problems.push(t('notEnoughCash', { cur: q.currency, have: money(cash, q.currency), short: money(short, q.currency) }));
  if (d.qty && Math.abs(roundQty(qty, q.kind) - qty) > qtyStep(q.kind) * 1e-3) problems.push(t('err_qtyStep'));
  const canPlace = est && !problems.length;
  const rate = state.rates[q.currency];
  box.innerHTML = `<div class="card ticket">
    <div class="ticket-top">
      <div class="segmented side-toggle" role="group">
        <button type="button" data-action="side" data-side="buy" class="buy" aria-pressed="${d.side === 'buy'}">${h(t('buy'))}</button>
        <button type="button" data-action="side" data-side="sell" class="sell" aria-pressed="${d.side === 'sell'}">${h(t('sell'))}</button>
      </div>
      <div class="segmented" role="group">${['market', 'limit', 'stop'].map(x => `<button type="button" data-action="otype" data-otype="${x}" aria-pressed="${d.type === x}">${h(t(`otype_${x}`))}</button>`).join('')}</div>
    </div>
    <p class="note">${h(typeHint)}</p>
    <div class="ticket-fields">
      <label class="field"><span>${h(t('quantity'))} (${h(unit)})</span><input id="t-qty" inputmode="decimal" autocomplete="off" value="${h(d.qty)}" placeholder="0" /></label>
      ${d.type === 'limit' ? `<label class="field"><span>${h(t('limitPrice'))} (${h(q.currency)})</span><input id="t-limit" inputmode="decimal" autocomplete="off" value="${h(d.limit)}" /></label>` : ''}
      ${d.type === 'stop' ? `<label class="field"><span>${h(t('stopPrice'))} (${h(q.currency)})</span><input id="t-stop" inputmode="decimal" autocomplete="off" value="${h(d.stop)}" /></label>` : ''}
    </div>
    <div class="qty-presets">${presets.filter(([, v]) => v > 0).map(([label, v]) => `<button class="chip small" type="button" data-action="qty" data-qty="${v}">${h(label)}${label === t('max') || label === t('all') ? ` <small>${h(fmtQty(v))}</small>` : ''}</button>`).join('')}</div>
    <p class="muted">${h(d.side === 'buy' ? t('cashAvail', { amount: money(cash, q.currency) }) : t('sharesAvail', { qty: fmtQty(shares), unit }))}${q.market === 'TW' && q.kind !== 'metal' ? ` · ${h(t('lotNote'))}` : ''}</p>
    ${
      est
        ? `<dl class="preview">${lines.map(([k, v]) => `<div><dt>${h(k)}</dt><dd class="num">${h(v)}</dd></div>`).join('')}
        <div class="preview-total"><dt>${h(d.side === 'buy' ? t('totalCost') : t('totalProceeds'))}</dt><dd class="num"><strong>${h(money(est.total, q.currency))}</strong>${rate && q.currency !== BASE ? `<small>≈ ${h(money(est.total * rate, BASE))}</small>` : ''}</dd></div></dl>`
        : ''
    }
    ${shorting && isShortable(q.kind) && !problems.length ? `<p class="note">${h(t('shortNote', { qty: fmtQty(qty - shares), unit, fee: rateText(SHORT_FEE) }))}</p>` : ''}
    ${problems.map(p => `<p class="warn">${h(p)}</p>`).join('')}
    ${topUp ? `<button class="ghost-button topup" type="button" data-action="topup" data-need="${topUp.need}" data-cur="${h(q.currency)}">${h(t('topUp', { get: money(topUp.get, q.currency), pay: money(topUp.need, BASE) }))}</button>` : ''}
    ${!open ? `<p class="note">${h(q.kind === 'metal' ? t('closedMetal') : t('closedQueue'))}</p>` : ''}
    ${pricesLive() ? '' : `<p class="warn">${h(t('waitLive'))}</p>`}
    <button class="primary-button place ${d.side}" type="button" data-action="place" ${canPlace && pricesLive() ? '' : 'disabled'}>${h(d.side === 'buy' ? t('placeBuy') : t('placeSell'))}</button>
    ${d.msg ? `<p class="${d.msg.kind === 'bad' ? 'warn' : 'ok-msg'}">${h(d.msg.text)}</p>` : ''}
  </div>`;
}

function placeFromTicket() {
  const d = state.detail;
  const q = state.quotes.get(d.symbol);
  if (!q || !state.account || !pricesLive()) return;
  const req = { symbol: d.symbol, side: d.side, type: d.type, qty: Number(d.qty) };
  if (d.type === 'limit') req.limit = Number(d.limit);
  if (d.type === 'stop') req.stop = Number(d.stop);
  const r = placeOrder(state.account, req, { quote: q, rates: state.rates, valuation: valuation(), now: Date.now() });
  if (r.error && !r.account) {
    d.msg = { kind: 'bad', text: errorText(r) };
  } else {
    commit(r.account);
    if (r.fill) {
      d.msg = { kind: 'good', text: t('filledMsg', { side: t(r.fill.side), qty: fmtQty(r.fill.qty), price: fmtPrice(r.fill.price, r.fill.currency), total: money(r.fill.total, r.fill.currency) }) };
      toast(d.msg.text, 'good');
    } else if (r.order.status === 'rejected') {
      d.msg = { kind: 'bad', text: errorText(r) };
    } else {
      d.msg = { kind: 'good', text: t('queuedMsg') };
      toast(t('queuedMsg'), 'good');
    }
    d.qty = '';
  }
  renderDetail();
  render();
}

function errorText(r) {
  switch (r.error) {
    case 'funds':
      return t('err_funds', { need: money(r.need, r.currency || state.quotes.get(state.detail?.symbol)?.currency || BASE), have: money(r.have ?? 0, r.currency || BASE) });
    case 'shares':
      return t('err_shares');
    case 'capacity':
      return t('err_capacity', { cap: money(r.capacity, BASE) });
    case 'shortMargin':
      return t('err_shortMargin', { max: fmtQty(r.max) });
    default:
      return t(`err_${r.error}`);
  }
}

// ---- Portfolio tab ----------------------------------------------------------------------

function renderPortfolio() {
  const box = $('portfolio-body');
  if (!state.account) {
    box.innerHTML = setupCardHtml();
    return;
  }
  const v = valuation();
  const s = snap();
  const incomplete = v.missingRates.length || !state.loaded;
  const open = state.account.orders.filter(o => o.status === 'open');
  const avail = available(state.account, s);
  box.innerHTML = `
    <div class="card hero-card">
      <p class="hero-label">${h(t('netWorth'))}${incomplete ? ` <small>${h(t('pricesLoading'))}</small>` : ''}</p>
      <strong class="hero-value num stat-value">${h(money(v.netWorth, BASE))}</strong>
      <div class="hero-row">
        ${heroStat(t('today'), money(v.dayChange, BASE, { sign: true }), v.netWorth - v.dayChange ? pct(v.dayChange / (v.netWorth - v.dayChange)) : '', dirClass(v.dayChange))}
        ${heroStat(t('totalReturn'), money(v.totalReturn, BASE, { sign: true }), pct(v.totalReturnPct), dirClass(v.totalReturn))}
        ${heroStat(t('putIn'), money(v.deposits, BASE), t('since', { date: fmtDate(state.account.created) }))}
      </div>
      <div class="hero-split">
        <span>${h(t('cash'))} <strong class="num">${h(money(v.cashTWD, BASE))}</strong></span>
        <span>${h(t('holdings'))} <strong class="num">${h(money(v.longTWD, BASE))}</strong></span>
        ${v.shortTWD > 0 ? `<span>${h(t('shorts'))} <strong class="num">−${h(money(v.shortTWD, BASE))}</strong></span>` : ''}
        ${v.debtTWD > 0 ? `<span>${h(t('loans'))} <strong class="num">−${h(money(v.debtTWD, BASE))}</strong></span>` : ''}
      </div>
      <div class="button-row hero-actions">
        <button class="hero-button" type="button" data-action="goto" data-tab="markets">${h(t('goTrade'))}</button>
        <button class="hero-button" type="button" data-action="goto" data-tab="fx">${h(t('goFx'))}</button>
        <button class="hero-button" type="button" data-action="deposit">${h(t('addMoney'))}</button>
      </div>
    </div>
    ${marginCardHtml(v)}
    <div class="two-col">
      <div class="card">
        <h3 class="card-title">${h(t('history'))}</h3>
        <div id="nw-chart" class="chart-box"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3 class="card-title">${h(t('allocation'))}</h3>
          <div class="segmented small" role="group">${['kind', 'currency', 'market'].map(k => `<button type="button" data-action="alloc" data-alloc="${k}" aria-pressed="${state.alloc === k}">${h(t(`alloc_${k}`))}</button>`).join('')}</div>
        </div>
        ${allocationHtml(v)}
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">${h(t('positions'))} <span class="count">${v.positions.length}</span></h3>
      ${v.positions.length ? `<div class="positions">${v.positions.map(positionRow).join('')}</div>` : `<div class="empty">${h(t('noPositions'))}<div class="button-row center"><button class="ghost-button" type="button" data-action="goto" data-tab="markets">${h(t('goTrade'))}</button><button class="ghost-button" type="button" data-action="goto" data-tab="guide">${h(t('newHere'))}</button></div></div>`}
    </div>
    ${open.length ? `<div class="card"><h3 class="card-title">${h(t('openOrders'))} <span class="count">${open.length}</span></h3>${open.map(orderRow).join('')}</div>` : ''}
    ${plansListHtml()}
    ${alertsListHtml()}
    <div class="card">
      <h3 class="card-title">${h(t('wallets'))}</h3>
      <div class="wallets">${v.cash.map(c => walletRow(c, c.amount - (avail.cash[c.currency] ?? c.amount))).join('')}${v.loans.map(loanWalletRow).join('')}</div>
      <p class="note">${h(t('walletsNote'))}</p>
    </div>
    ${syncCardHtml()}
  `;
  renderNetWorthChart(v, s);
}

function plansListHtml() {
  const plans = activePlans(state.account);
  if (!plans.length) return '';
  return `<div class="card"><h3 class="card-title">📅 ${h(t('plansTitle'))} <span class="count">${plans.length}</span></h3>${plans
    .map(p => {
      const next = nextPlanRun(p);
      const last = state.account.orders.filter(o => o.plan === p.id).at(-1);
      return `<div class="order-row"><span class="side-tag buy">${h(t('planTag'))}</span>
      <span class="row-main"><span class="row-title"><button class="link" type="button" data-action="open" data-symbol="${h(p.symbol)}">${h(nameOf(p.symbol))}</button></span>
      <span class="row-sub">${h(t('planActive', { amount: money(p.amount, BASE), day: p.day }))} · ${h(t('planNext', { date: next ? fmtDate(next) : '—' }))}${last ? ` · ${h(last.status === 'filled' ? t('planLast', { qty: fmtQty(last.qty), unit: unitOf(p.symbol) }) : t(`err_${last.reason}`))}` : ''}</span></span>
      <button class="ghost-button small" type="button" data-action="plan-off" data-id="${h(p.id)}">${h(t('planStop'))}</button></div>`;
    })
    .join('')}<p class="note">${h(t('plansNote'))}</p></div>`;
}

function alertsListHtml() {
  const list = Object.values(state.account.alerts || {}).filter(a => a.on || (a.hit && Date.now() - a.hit.t < 7 * 86_400_000)).sort((a, b) => b.t - a.t);
  if (!list.length) return '';
  return `<div class="card"><h3 class="card-title">🔔 ${h(t('alertsTitle'))} <span class="count">${list.filter(a => a.on).length}</span></h3>${list
    .map(a => {
      const q = state.quotes.get(a.symbol);
      const gap = q && a.on ? pct(a.price / q.price - 1) : '';
      return `<div class="order-row"><span class="side-tag ${a.on ? 'fx' : 'div'}">${a.on ? '🔔' : '✓'}</span>
      <span class="row-main"><span class="row-title"><button class="link" type="button" data-action="open" data-symbol="${h(a.symbol)}">${h(nameOf(a.symbol))}</button></span>
      <span class="row-sub">${h(a.on ? t(a.op === 'above' ? 'alertWhenAbove' : 'alertWhenBelow', { price: fmtPrice(a.price, q?.currency) }) : t('alertWentOff', { price: fmtPrice(a.hit.price, q?.currency), time: dateTime(a.hit.t) }))}${gap ? ` · ${h(t('alertGap', { pct: gap }))}` : ''}</span></span>
      ${a.on ? `<button class="ghost-button small" type="button" data-action="alert-off" data-id="${h(a.id)}">${h(t('remove'))}</button>` : ''}</div>`;
    })
    .join('')}</div>`;
}

function heroStat(label, value, sub, dir = '') {
  return `<div class="hero-stat"><span>${h(label)}</span><strong class="num stat-value ${dir}">${h(value)}</strong>${sub ? `<small class="num">${h(sub)}</small>` : ''}</div>`;
}

function positionRow(p) {
  const q = p.quote;
  return `<button class="row position-row" type="button" data-action="open" data-symbol="${h(p.symbol)}">
    ${symbolBadge(p.symbol, p)}
    <span class="row-main"><span class="row-title">${h(nameOf(p.symbol, q))}${p.short ? `<span class="held-tag short">${h(t('shortTag'))}</span>` : ''}</span>
      <span class="row-sub">${flagOf(p.symbol, p)} ${h(fmtQty(Math.abs(p.qty)))} ${h(unitOf(p.symbol))} · ${h(t('avgShort'))} ${h(fmtPrice(p.avg, p.currency))} · ${h(t('nowShort'))} ${h(fmtPrice(p.price, p.currency))} ${h(p.currency)}</span></span>
    <span class="row-value"><strong class="num">${h(money(p.valueTWD, BASE))}</strong><small class="num">${h(t('weight', { w: pct(p.weight, { digits: 1, sign: false }) }))}</small></span>
    <span class="row-pl"><strong class="num ${dirClass(p.pl)}">${h(money(p.pl, BASE, { sign: true }))}</strong><small class="num ${dirClass(p.pl)}">${h(pct(p.plPct))}</small><small class="num ${dirClass(p.dayTWD)}">${h(t('todayShort'))} ${h(money(p.dayTWD, BASE, { sign: true }))}</small></span>
  </button>`;
}

function walletRow(c, reserved = 0) {
  const info = currencyInfo(c.currency);
  return `<button class="wallet" type="button" data-action="fx-from" data-cur="${h(c.currency)}">
    <span class="wallet-flag">${info.flag}</span>
    <span class="wallet-main"><strong>${h(c.currency)}</strong><small>${h(L(info))}</small></span>
    <span class="wallet-amt"><strong class="num">${h(money(c.amount, c.currency))}</strong>${c.currency !== BASE ? `<small class="num">≈ ${h(money(c.twd, BASE))}</small>` : ''}${reserved > 1e-9 ? `<small class="num">${h(t('reserved', { amount: money(reserved, c.currency) }))}</small>` : ''}</span>
  </button>`;
}

function loanWalletRow(l) {
  const info = currencyInfo(l.currency);
  return `<button class="wallet debt" type="button" data-action="goto" data-tab="fx">
    <span class="wallet-flag">${info.flag}</span>
    <span class="wallet-main"><strong>${h(t('loanIn', { cur: l.currency }))}</strong><small>${h(t('loanRate', { rate: pct(l.rate, { digits: 2, sign: false }) }))}</small></span>
    <span class="wallet-amt"><strong class="num down-ink">−${h(money(l.balance, l.currency))}</strong>${l.currency !== BASE ? `<small class="num">≈ −${h(money(l.twd, BASE))}</small>` : ''}</span>
  </button>`;
}

function marginCardHtml(v) {
  if (!(v.owed > 0)) return '';
  const cls = v.margin === 'ok' ? '' : ' alert';
  const text = v.margin === 'liquidate' ? t('marginLiquidate') : v.margin === 'call' ? t('marginCall') : t('marginOk');
  return `<div class="card margin-card${cls}">
    <div class="margin-top"><span>${h(t('maintenance'))}</span><strong class="num">${h(pct(v.ratio, { digits: 0, sign: false }))}</strong></div>
    ${gauge(v.ratio)}
    <p>${h(text)}</p>
  </div>`;
}

function gauge(ratio) {
  const max = 3;
  const x = r => `${Math.min(100, (Math.min(r, max) / max) * 100)}%`;
  return `<div class="gauge"><span class="gauge-fill ${ratio < MARGIN_LIQUIDATE ? 'bad' : ratio < MARGIN_CALL ? 'warn' : 'ok'}" style="width:${x(ratio)}"></span>
    <i style="left:${x(MARGIN_LIQUIDATE)}" title="${h(t('liquidateLine'))}"></i><i style="left:${x(MARGIN_CALL)}" title="${h(t('callLine'))}"></i></div>
    <div class="gauge-scale"><span style="left:${x(MARGIN_LIQUIDATE)}">${pct(MARGIN_LIQUIDATE, { digits: 0, sign: false })}</span><span style="left:${x(MARGIN_CALL)}">${pct(MARGIN_CALL, { digits: 0, sign: false })}</span></div>`;
}

function allocationHtml(v) {
  let groups;
  if (state.alloc === 'currency') groups = Object.entries(v.byCurrency).filter(([, x]) => x > 0).map(([k, x]) => [`${currencyInfo(k).flag} ${k}`, x]);
  else if (state.alloc === 'market') {
    const m = {};
    for (const p of v.positions) m[p.market] = (m[p.market] || 0) + p.valueTWD;
    if (v.cashTWD > 0) m.cash = v.cashTWD;
    groups = Object.entries(m).map(([k, x]) => [k === 'cash' ? t('kind_cash') : `${(MARKETS[k] || MARKETS.INTL).flag} ${marketLabel(k)}`, x]);
  } else groups = Object.entries(v.byKind).map(([k, x]) => [kindLabel(k), x]);
  groups.sort((a, b) => b[1] - a[1]);
  // Past eight, the rest fold into one.
  if (groups.length > 8) groups = [...groups.slice(0, 7), [t('others'), groups.slice(7).reduce((s, g) => s + g[1], 0)]];
  const parts = groups.map(([label, value], i) => ({ label, value, color: SERIES[i] }));
  return stackBar(parts, { format: x => money(x, BASE) }) || `<p class="empty">${h(t('nothingYet'))}</p>`;
}

// Net worth at the end of every day since the account opened, rebuilt from
// the log and each day's closing prices and rates (so the chart needs no
// visits). Loaded when the portfolio shows, again once the log changes.
async function loadNetWorthHistory() {
  const account = state.account;
  if (!account || Date.now() - account.created < 86_400_000) return;
  const key = `${account.id}:${account.events.length}:${taipeiDay(Date.now())}`;
  if (state.nwHistory?.key === key || state.nwHistory?.loading === key) return;
  state.nwHistory = { ...(state.nwHistory || {}), loading: key };
  const s = replay(account);
  const age = Date.now() - account.created;
  const range = age < 25 * 86_400_000 ? '1mo' : age < 170 * 86_400_000 ? '6mo' : age < 360 * 86_400_000 ? '1y' : '5y';
  const currencies = new Set();
  for (const e of account.events) for (const c of [e.currency, e.from, e.to]) if (c && c !== BASE) currencies.add(c);
  const symbols = Object.keys(s.held);
  const [charts, fx] = await Promise.all([
    Promise.all(symbols.map(sym => fetchChart(sym, range).catch(() => null))),
    Promise.all([...currencies].map(c => fetchChart(fxSymbol(c), range).catch(() => null)))
  ]);
  const series = new Map(symbols.map((sym, i) => [sym, charts[i]?.points || []]));
  const rates = new Map([...currencies].map((c, i) => [c, fx[i]?.points || []]));
  const at = (points, t) => {
    let v = null;
    for (const [tt, c] of points) {
      if (tt > t) break;
      v = c;
    }
    return v;
  };
  const days = [];
  for (let d = Date.parse(`${taipeiDay(account.created)}T23:59:59+08:00`); d < Date.now(); d += 86_400_000) days.push(d);
  const history = netWorthSeries(
    account,
    days,
    (sym, t) => at(series.get(sym) || [], t),
    (cur, t) => (cur === BASE ? 1 : at(rates.get(cur) || [], t) ?? state.rates[cur] ?? null)
  );
  state.nwHistory = { key, history };
  if (state.tab === 'portfolio') renderNetWorthChart(valuation(), snap());
}

function renderNetWorthChart(v, s) {
  const box = $('nw-chart');
  if (!box) return;
  loadNetWorthHistory();
  const rebuilt = state.nwHistory?.history?.length ? state.nwHistory.history.map(([tt, nw]) => ({ t: tt, nw })) : null;
  const snaps = rebuilt || Object.values(state.account.snapshots || {}).sort((a, b) => a.t - b.t);
  if (snaps.length < 2 && Date.now() - state.account.created < 86_400_000 * 2) {
    box.innerHTML = `<div class="first-day"><strong class="num">${h(money(v.netWorth, BASE))}</strong><p>${h(t('historyFirstDay'))}</p></div>`;
    return;
  }
  const points = snaps.map(x => [x.t, x.nw]);
  const now = Date.now();
  if (!points.length || points.at(-1)[0] < now - 60_000) points.push([now, v.netWorth]);
  if (points.length < 2) points.unshift([state.account.created, s.deposits]);
  const deposits = [];
  let total = 0;
  for (const e of state.account.events.filter(e => e.type === 'deposit').sort((a, b) => a.t - b.t)) {
    if (deposits.length) deposits.push([e.t, total]);
    total += e.amount;
    deposits.push([e.t, total]);
  }
  deposits.push([now, total]);
  const width = Math.max(300, Math.round(box.clientWidth || 480));
  const dir = dirClass(v.totalReturn);
  const values = [...points, ...deposits].map(p => p[1]);
  const fine = Math.max(...values) - Math.min(...values) < Math.max(...values) * 0.05;
  const { svg, frame } = lineChart([{ points }, { points: deposits, cls: 'ref' }], {
    width,
    height: 200,
    dir,
    // A narrow range needs the full number (萬 would round it all alike).
    yFormat: x => (fine ? num(x) : compact(x)),
    xFormat: tt => shortDate(tt)
  });
  box.innerHTML = `<ul class="legend-inline"><li><i class="sw ${dir}"></i>${h(t('netWorth'))}</li><li><i class="sw ref"></i>${h(t('putIn'))}</li></ul>${svg}`;
  attachHover(box, [{ points }, { points: deposits }], frame, (i, tt, [nw, dep]) => `<strong class="num">${money(nw, BASE)}</strong><span>${h(fmtDate(tt))}</span><span class="chg ${dirClass(nw - dep)}">${money(nw - dep, BASE, { sign: true })}</span>`);
}

function orderRow(o) {
  const q = state.quotes.get(o.symbol);
  const price = o.type === 'limit' ? t('atLimit', { p: fmtPrice(o.limit, o.currency) }) : o.type === 'stop' ? t('atStop', { p: fmtPrice(o.stop, o.currency) }) : t('atMarket');
  const status = o.status === 'open' ? (q && !isOpen(q) ? t('waitingOpen') : t('waitingPrice')) : t(`status_${o.status}`);
  return `<div class="order-row">
    <span class="side-tag ${o.side}">${h(t(o.side))}</span>
    <span class="row-main"><span class="row-title">${h(nameOf(o.symbol, q))} <small>${h(fmtQty(o.qty))} ${h(unitOf(o.symbol))} ${h(price)}</small></span>
    <span class="row-sub">${h(dateTime(o.t))} · ${h(status)}${o.forced ? ` · ${h(t('forcedTag'))}` : ''}${o.reason ? ` · ${h(t(`err_${o.reason}`))}` : ''}</span></span>
    ${o.status === 'open' && !o.forced ? `<button class="ghost-button small" type="button" data-action="cancel" data-id="${h(o.id)}">${h(t('cancel'))}</button>` : ''}
  </div>`;
}

// ---- FX & loans tab ----------------------------------------------------------------------

function currencyOptions(selected, list = [BASE, ...Object.keys(CURRENCIES).filter(c => c !== BASE)]) {
  const all = [...new Set([...list, ...Object.keys(snap()?.cash || {})])];
  return all.map(c => `<option value="${h(c)}" ${c === selected ? 'selected' : ''}>${currencyInfo(c).flag} ${h(c)} · ${h(L(currencyInfo(c)))}</option>`).join('');
}

function renderFx() {
  const box = $('fx-body');
  const f = state.fx;
  const s = snap();
  const avail = s ? available(state.account, s) : { cash: {} };
  const amount = Number(f.amount);
  const q = amount > 0 ? quoteExchange(f.from, f.to, amount, state.rates, state.fxOpen) : null;
  const have = Math.max(0, avail.cash[f.from] || 0);
  const mid = state.rates[f.from] && state.rates[f.to] ? state.rates[f.from] / state.rates[f.to] : null;
  const spread = Math.max(currencyInfo(f.from).spread, currencyInfo(f.to).spread) * (state.fxOpen ? 1 : CLOSED_FX_MULTIPLIER);
  const tooMuch = amount > have + 1e-9;
  const usd = state.quotes.get(fxSymbol('USD'));
  box.innerHTML = `
    <div class="two-col">
      <div class="card fx-card">
        <h3 class="card-title">${h(t('exchangeTitle'))}</h3>
        ${!state.account ? `<p>${h(t('needAccount'))}</p><button class="primary-button" type="button" data-action="setup">${h(t('openAccount'))}</button>` : `
        <label class="field"><span>${h(t('fxFrom'))}</span><select id="fx-from">${currencyOptions(f.from)}</select></label>
        <div class="fx-amount">
          <label class="field grow"><span>${h(t('amount'))}</span><input id="fx-amount" inputmode="decimal" autocomplete="off" value="${h(f.amount)}" placeholder="0" /></label>
          <button class="chip small" type="button" data-action="fx-max">${h(t('all'))} <small>${h(money(have, f.from))}</small></button>
        </div>
        <button class="swap" type="button" data-action="fx-swap" aria-label="${h(t('swap'))}">⇅</button>
        <label class="field"><span>${h(t('fxTo'))}</span><select id="fx-to">${currencyOptions(f.to)}</select></label>
        <dl class="preview">
          <div><dt>${h(t('midRate'))}</dt><dd class="num">${mid ? h(rateLine(f.from, f.to, mid)) : '—'}</dd></div>
          <div><dt>${h(t('spread'))}</dt><dd class="num">${h(pct(spread, { digits: 2, sign: false }))}${state.fxOpen ? '' : ` <small>${h(t('closedDouble'))}</small>`}</dd></div>
          ${q ? `<div><dt>${h(t('yourRate'))}</dt><dd class="num">${h(rateLine(f.from, f.to, q.rate))}</dd></div>
          <div><dt>${h(t('fxCost'))}</dt><dd class="num">${h(money(q.spreadTWD, BASE, { digits: q.spreadTWD < 10 ? 2 : 0 }))}</dd></div>
          <div class="preview-total"><dt>${h(t('youGet'))}</dt><dd class="num"><strong>${h(money(q.received, f.to))}</strong></dd></div>` : ''}
        </dl>
        ${tooMuch ? `<p class="warn">${h(t('notEnoughCur', { cur: f.from, have: money(have, f.from) }))}</p>` : ''}
        <p class="note">${h(state.fxOpen ? t('fxOpenNote') : t('fxClosedNote'))}${usd?.marketTime ? ` ${h(t('asOf', { time: dateTime(usd.marketTime) }))}` : ''}</p>
        ${pricesLive() ? '' : `<p class="warn">${h(t('waitLive'))}</p>`}
        <button class="primary-button" type="button" data-action="fx-go" ${q && q.received > 0 && !tooMuch && f.from !== f.to && pricesLive() ? '' : 'disabled'}>${h(t('doExchange'))}</button>`}
      </div>
      <div class="card">
        <h3 class="card-title">${h(t('ratesTitle'))}</h3>
        <p class="lede">${h(t('ratesIntro'))}</p>
        <div class="button-row"><button class="ghost-button" type="button" data-action="fx-trade">💱 ${h(t('fxTradeButton'))}</button></div>
        <div class="rates">${Object.keys(CURRENCIES).filter(c => c !== BASE).map(rateRow).join('')}</div>
      </div>
    </div>
    ${loansHtml()}
  `;
}

function rateRow(c) {
  const q = state.quotes.get(fxSymbol(c));
  const info = currencyInfo(c);
  const sp = info.spread * (state.fxOpen ? 1 : CLOSED_FX_MULTIPLIER);
  const unit = info.digits === 0 && q?.price < 1 ? 100 : 1;
  return `<button class="rate-row" type="button" data-action="fx-to" data-cur="${h(c)}">
    <span class="wallet-flag">${info.flag}</span>
    <span class="row-main"><span class="row-title">${h(unit > 1 ? `${unit} ` : '')}${h(c)} <small>${h(L(info))}</small></span>
    <span class="row-sub num">${q ? `${h(t('bankSells'))} ${h(num(q.price * unit * (1 + sp), 4))} · ${h(t('bankBuys'))} ${h(num(q.price * unit * (1 - sp), 4))}` : '…'}</span></span>
    <span class="row-spark">${q ? sparkline(q.line, q.prev, { width: 72, height: 26 }) : ''}</span>
    <span class="row-price"><strong class="num">${q ? h(num(q.price * unit, 4)) : '…'}</strong><small>NT$</small></span>
    ${pctPill(q)}
  </button>`;
}

function loansHtml() {
  if (!state.account) return '';
  const v = valuation();
  const l = state.loan;
  const s = snap();
  const loan = s.loans[l.currency];
  const avail = available(state.account, s);
  const rate = currencyInfo(l.currency).loanRate;
  const amount = Number(l.amount);
  const capacityCur = state.rates[l.currency] ? v.capacity / state.rates[l.currency] : 0;
  return `<div class="card loans-card">
    <h3 class="card-title">${h(t('loansTitle'))}</h3>
    <p class="lede">${h(t('loansIntro'))}</p>
    <div class="kpis">
      ${kpi(t('collateral'), money(v.collateral, BASE), t('collateralSub'))}
      ${kpi(t('borrowed'), money(v.debtTWD, BASE), v.interestTWD > 0 ? t('interestSoFar', { amount: money(v.interestTWD, BASE, { digits: v.interestTWD < 10 ? 2 : 0 }) }) : '')}
      ${kpi(t('canBorrow'), money(v.capacity, BASE))}
      ${kpi(t('maintenance'), v.debtTWD > 0 ? pct(v.ratio, { digits: 0, sign: false }) : '—', v.debtTWD > 0 ? t(`margin_${v.margin}`) : t('noLoans'), v.margin === 'ok' ? '' : 'down-ink')}
    </div>
    ${v.debtTWD > 0 ? gauge(v.ratio) : ''}
    <div class="loan-form">
      <label class="field"><span>${h(t('currency'))}</span><select id="loan-cur">${currencyOptions(l.currency)}</select></label>
      <label class="field grow"><span>${h(t('amount'))}</span><input id="loan-amount" inputmode="decimal" autocomplete="off" value="${h(l.amount)}" placeholder="0" /></label>
    </div>
    <p class="muted">${h(t('loanTerms', { rate: pct(rate, { digits: 2, sign: false }), cap: money(capacityCur, l.currency) }))}${loan?.balance > 0 ? ` · ${h(t('owed', { amount: money(loan.balance, l.currency) }))}` : ''}</p>
    ${amount > 0 ? `<p class="muted">${h(t('interestPerDay', { amount: money((amount * rate) / 365, l.currency, { digits: 2 }) }))}</p>` : ''}
    <div class="button-row">
      <button class="primary-button" type="button" data-action="borrow" ${amount > 0 && v.margin === 'ok' && amount <= capacityCur + 1e-9 ? '' : 'disabled'}>${h(t('borrow'))}</button>
      <button class="ghost-button" type="button" data-action="repay" ${loan?.balance > 0 && amount > 0 ? '' : 'disabled'}>${h(t('repay'))}</button>
      ${loan?.balance > 0 ? `<button class="ghost-button" type="button" data-action="repay-all" ${(avail.cash[l.currency] || 0) > 0 ? '' : 'disabled'}>${h(t('repayAll'))}</button>` : ''}
    </div>
    ${v.loans.length ? `<div class="wallets">${v.loans.map(x => `<div class="wallet debt"><span class="wallet-flag">${currencyInfo(x.currency).flag}</span><span class="wallet-main"><strong>${h(x.currency)}</strong><small>${h(t('loanRate', { rate: pct(x.rate, { digits: 2, sign: false }) }))} · ${h(t('interestSoFar', { amount: money(x.interest, x.currency, { digits: 2 }) }))}</small></span><span class="wallet-amt"><strong class="num down-ink">−${h(money(x.balance, x.currency))}</strong>${x.currency !== BASE ? `<small class="num">≈ −${h(money(x.twd, BASE))}</small>` : ''}</span></div>`).join('')}</div>` : ''}
  </div>`;
}

function doExchange() {
  if (!pricesLive()) return;
  const f = state.fx;
  const r = exchange(state.account, { from: f.from, to: f.to, amount: Number(f.amount) }, { rates: state.rates, fxOpen: state.fxOpen, now: Date.now() });
  if (r.error) return toast(errorText(r), 'bad');
  commit(r.account);
  toast(t('fxDone', { from: money(r.event.amount, f.from), to: money(r.event.received, f.to) }), 'good');
  f.amount = '';
  render();
}

function doBorrow() {
  const l = state.loan;
  const r = borrow(state.account, { currency: l.currency, amount: Number(l.amount) }, { valuation: valuation(), rates: state.rates, now: Date.now() });
  if (r.error) return toast(errorText(r), 'bad');
  commit(r.account);
  toast(t('borrowed_', { amount: money(r.event.amount, l.currency) }), 'good');
  l.amount = '';
  render();
}

function doRepay(all = false) {
  const l = state.loan;
  // "Repay all" offers every unit of cash in the loan's currency; repay()
  // takes only what's owed.
  const amount = all ? Math.max(0, available(state.account, snap()).cash[l.currency] || 0) : Number(l.amount);
  const r = repay(state.account, { currency: l.currency, amount }, { now: Date.now() });
  if (r.error) return toast(errorText(r), 'bad');
  commit(r.account);
  toast(t('repaid', { amount: money(r.event.amount, l.currency) }), 'good');
  l.amount = '';
  render();
}

// ---- History tab: activity, orders, stats ---------------------------------------------------

function activityRow(e) {
  const q = state.quotes.get(e.symbol);
  let icon;
  let title;
  let sub;
  let amount = '';
  switch (e.type) {
    case 'fill':
      icon = `<span class="side-tag ${e.side}">${h(e.maturity ? t('maturedTag') : t(e.side))}</span>`;
      title = `${nameOf(e.symbol, q)} · ${fmtQty(e.qty)} ${unitOf(e.symbol)} @ ${fmtPrice(e.price, e.currency)}`;
      sub = [e.commission ? `${t('commission')} ${money(e.commission, e.currency)}` : '', e.tax ? `${t('tax')} ${money(e.tax, e.currency)}` : '', e.fee ? `${t('exchangeFee')} ${money(e.fee, e.currency)}` : '', e.forced ? t('forcedTag') : '']
        .filter(Boolean)
        .join(' · ');
      amount = `<strong class="num ${e.side === 'buy' ? '' : 'up-ink'}">${e.side === 'buy' ? '−' : '+'}${h(money(e.total, e.currency))}</strong>`;
      break;
    case 'fx':
      icon = '<span class="side-tag fx">💱</span>';
      title = `${money(e.amount, e.from)} → ${money(e.received, e.to)}`;
      sub = `${rateLine(e.from, e.to, e.rate)} · ${t('fxCost')} ${money(e.spreadTWD, BASE, { digits: e.spreadTWD < 10 ? 2 : 0 })}`;
      break;
    case 'div':
      icon = '<span class="side-tag div">💰</span>';
      title = `${nameOf(e.symbol, q)} ${e.coupon ? t('couponPaid') : t('dividend')}`;
      sub = [`${fmtQty(e.shares)} × ${fmtPrice(e.perShare, e.currency)}`, e.withheld ? `${t('withheld')} ${money(e.withheld, e.currency)}` : '', e.nhi ? `${t('nhi')} ${money(e.nhi, e.currency)}` : ''].filter(Boolean).join(' · ');
      amount = `<strong class="num ${e.net < 0 ? '' : 'up-ink'}">${e.net < 0 ? '' : '+'}${h(money(e.net, e.currency))}</strong>`;
      break;
    case 'split':
      icon = '<span class="side-tag div">✂️</span>';
      title = `${nameOf(e.symbol, q)} ${t('split')} ${num(e.ratio, 4)} : 1`;
      sub = t('splitNote');
      break;
    case 'deposit':
      icon = '<span class="side-tag div">🏦</span>';
      title = e.id === 'deposit:start' ? t('openedWith') : t('deposited');
      sub = '';
      amount = `<strong class="num">+${h(money(e.amount, e.currency))}</strong>`;
      break;
    case 'borrow':
      icon = '<span class="side-tag loan">🏦</span>';
      title = t('borrowedRow', { cur: e.currency });
      sub = t('loanRate', { rate: pct(e.rate, { digits: 2, sign: false }) });
      amount = `<strong class="num">+${h(money(e.amount, e.currency))}</strong>`;
      break;
    case 'repay':
      icon = '<span class="side-tag loan">🏦</span>';
      title = t('repaidRow', { cur: e.currency });
      sub = '';
      amount = `<strong class="num">−${h(money(e.amount, e.currency))}</strong>`;
      break;
    default:
      return '';
  }
  const clickable = e.symbol && e.type !== 'deposit';
  return `<${clickable ? 'button type="button" data-action="open" data-symbol="' + h(e.symbol) + '"' : 'div'} class="activity-row">
    ${icon}<span class="row-main"><span class="row-title">${h(title)}</span><span class="row-sub">${h(dateTime(e.t))}${sub ? ` · ${h(sub)}` : ''}</span></span>
    <span class="row-amt">${amount}</span></${clickable ? 'button' : 'div'}>`;
}

const ACTIVITY_FILTERS = {
  all: () => true,
  trades: e => e.type === 'fill',
  fx: e => e.type === 'fx',
  income: e => e.type === 'div' || e.type === 'split',
  loans: e => e.type === 'borrow' || e.type === 'repay',
  cash: e => e.type === 'deposit'
};

function renderHistory() {
  const box = $('history-body');
  if (!state.account) {
    box.innerHTML = setupCardHtml();
    return;
  }
  const views = ['activity', 'orders', 'stats'];
  const tabs = `<div class="segmented history-tabs" role="group">${views.map(x => `<button type="button" data-action="hview" data-view="${x}" aria-pressed="${state.historyView === x}">${h(t(`hview_${x}`))}</button>`).join('')}</div>`;
  if (state.historyView === 'orders') {
    const open = state.account.orders.filter(o => o.status === 'open').reverse();
    const done = state.account.orders.filter(o => o.status !== 'open').reverse().slice(0, 100);
    box.innerHTML = `${tabs}
      <div class="card"><h3 class="card-title">${h(t('openOrders'))} <span class="count">${open.length}</span></h3>${open.map(orderRow).join('') || `<p class="empty">${h(t('noOpenOrders'))}</p>`}</div>
      <div class="card"><h3 class="card-title">${h(t('pastOrders'))}</h3>${done.map(orderRow).join('') || `<p class="empty">${h(t('nothingYet'))}</p>`}</div>`;
    return;
  }
  if (state.historyView === 'stats') {
    box.innerHTML = `${tabs}${statsHtml()}`;
    renderBench();
    return;
  }
  const events = [...state.account.events].filter(ACTIVITY_FILTERS[state.activityFilter]).sort((a, b) => b.t - a.t);
  const shown = events.slice(0, state.activityShown);
  const groups = new Map();
  for (const e of shown) {
    const day = taipeiDay(e.t);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  box.innerHTML = `${tabs}
    <div class="chips filter-chips">${Object.keys(ACTIVITY_FILTERS).map(k => `<button class="chip" type="button" data-action="afilter" data-f="${k}" aria-pressed="${state.activityFilter === k}">${h(t(`af_${k}`))}</button>`).join('')}</div>
    ${[...groups].map(([day, list]) => `<h3 class="day-head">${h(dayLabel(day))}</h3><div class="card list-card">${list.map(activityRow).join('')}</div>`).join('') || `<p class="empty">${h(t('nothingYet'))}</p>`}
    ${events.length > shown.length ? `<button class="ghost-button more" type="button" data-action="more">${h(t('showMore', { n: events.length - shown.length }))}</button>` : ''}`;
}

function dayLabel(day) {
  const today = taipeiDay(Date.now());
  const yesterday = taipeiDay(Date.now() - 86_400_000);
  if (day === today) return t('todayLabel');
  if (day === yesterday) return t('yesterday');
  return fmtDate(Date.parse(`${day}T12:00:00+08:00`));
}

function statsHtml() {
  const v = valuation();
  const s = snap();
  const closed = s.closed;
  const wins = closed.filter(c => c.realized > 0);
  const best = closed.reduce((b, c) => (!b || c.realized > b.realized ? c : b), null);
  const worst = closed.reduce((b, c) => (!b || c.realized < b.realized ? c : b), null);
  const costs = [
    ['commission', v.paid.commission],
    ['tax', v.paid.tax],
    ['fee', v.paid.fee],
    ['fx', v.paid.fx],
    ['interest', v.paid.interest],
    ['withheld', v.paid.withheld],
    ['nhi', v.paid.nhi],
    ['borrow', v.paid.borrow]
  ];
  const costTotal = costs.reduce((sum, [, x]) => sum + x, 0);
  const byMarket = {};
  for (const c of closed) byMarket[c.market] = (byMarket[c.market] || 0) + c.realized;
  for (const p of v.positions) byMarket[p.market] = (byMarket[p.market] || 0) + p.pl;
  const marketRows = Object.entries(byMarket).sort((a, b) => b[1] - a[1]);
  const maxAbs = Math.max(1, ...marketRows.map(([, x]) => Math.abs(x)));
  return `
    <div class="card">
      <h3 class="card-title">${h(t('whereMoney'))}</h3>
      <div class="kpis">
        ${kpi(t('putIn'), money(v.deposits, BASE))}
        ${kpi(t('netWorth'), money(v.netWorth, BASE))}
        ${kpi(t('totalReturn'), money(v.totalReturn, BASE, { sign: true }), pct(v.totalReturnPct), dirClass(v.totalReturn))}
        ${kpi(t('realizedPl'), money(v.realized, BASE, { sign: true }), '', dirClass(v.realized))}
        ${kpi(t('unrealized'), money(v.unrealized, BASE, { sign: true }), '', dirClass(v.unrealized))}
        ${kpi(t('dividendsNet'), money(v.dividends, BASE))}
      </div>
      <p class="note">${h(t('plNote'))}</p>
    </div>
    <div class="card">
      <h3 class="card-title">${h(t('costsTitle'))} <span class="count num">${h(money(costTotal, BASE))}</span></h3>
      <p class="lede">${h(t('costsIntro', { pct: v.deposits ? pct(costTotal / v.deposits, { sign: false }) : '—' }))}</p>
      ${stackBar(costs.map(([k, x], i) => ({ label: t(`cost_${k}`), value: x, color: SERIES[i] })), { format: x => money(x, BASE, { digits: x < 100 ? 2 : 0 }) }) || `<p class="empty">${h(t('noCosts'))}</p>`}
    </div>
    <div class="two-col">
      <div class="card">
        <h3 class="card-title">${h(t('closedTrades'))} <span class="count">${closed.length}</span></h3>
        ${
          closed.length
            ? `<div class="kpis">
          ${kpi(t('winRate'), pct(wins.length / closed.length, { digits: 0, sign: false }), t('winsOf', { w: wins.length, n: closed.length }))}
          ${kpi(t('avgReturn'), pct(closed.reduce((sum, c) => sum + c.pct, 0) / closed.length), '', dirClass(closed.reduce((sum, c) => sum + c.pct, 0)))}
          ${kpi(t('avgHeld'), t('days', { n: num(closed.reduce((sum, c) => sum + c.held, 0) / closed.length / 86_400_000, 1) }))}
        </div>
        <ul class="facts">
          ${best ? `<li>${h(t('bestTrade'))}: <button class="link" type="button" data-action="open" data-symbol="${h(best.symbol)}">${h(nameOf(best.symbol))}</button> <strong class="num ${dirClass(best.realized)}">${h(money(best.realized, BASE, { sign: true }))} (${h(pct(best.pct))})</strong></li>` : ''}
          ${worst && worst !== best ? `<li>${h(t('worstTrade'))}: <button class="link" type="button" data-action="open" data-symbol="${h(worst.symbol)}">${h(nameOf(worst.symbol))}</button> <strong class="num ${dirClass(worst.realized)}">${h(money(worst.realized, BASE, { sign: true }))} (${h(pct(worst.pct))})</strong></li>` : ''}
        </ul>`
            : `<p class="empty">${h(t('noClosed'))}</p>`
        }
      </div>
      <div class="card">
        <h3 class="card-title">${h(t('byMarket'))}</h3>
        ${
          marketRows.length
            ? `<ul class="bars-list">${marketRows
                .map(([m, x]) => `<li><span class="bar-label">${(MARKETS[m] || MARKETS.INTL).flag} ${h(marketLabel(m))}</span><span class="bar-track"><span class="bar ${dirClass(x)}" style="width:${(Math.abs(x) / maxAbs) * 100}%"></span></span><strong class="num ${dirClass(x)}">${h(money(x, BASE, { sign: true }))}</strong></li>`)
                .join('')}</ul><p class="note">${h(t('byMarketNote'))}</p>`
            : `<p class="empty">${h(t('nothingYet'))}</p>`
        }
      </div>
    </div>
    <div class="card">
      <h3 class="card-title">${h(t('benchTitle'))}</h3>
      <p class="lede">${h(t('benchIntro'))}</p>
      <div id="bench"></div>
    </div>`;
}

// You against simply buying one index fund with the same money on the same days.
const BENCHES = [
  { symbol: '0050.TW', currency: 'TWD' },
  { symbol: 'VOO', currency: 'USD' },
  { symbol: 'BTC-USD', currency: 'USD' },
  { symbol: 'XAU', currency: 'TWD' }
];
async function renderBench() {
  const box = $('bench');
  if (!box || !state.account) return;
  const v = valuation();
  const deposits = state.account.events.filter(e => e.type === 'deposit').map(e => ({ t: e.t, amount: e.amount }));
  const age = Date.now() - state.account.created;
  const range = age < 25 * 86_400_000 ? '1mo' : age < 170 * 86_400_000 ? '6mo' : age < 360 * 86_400_000 ? '1y' : '5y';
  const key = `${state.account.id}:${range}:${deposits.length}`;
  const draw = () => {
    const rows = [{ label: t('you'), value: v.netWorth, you: true }, ...(state.bench?.rows || [])];
    const put = v.deposits;
    const maxAbs = Math.max(0.0001, ...rows.map(r => Math.abs(r.value / put - 1)));
    box.innerHTML = `<ul class="bars-list">${rows
      .map(r => {
        const ret = Math.round((r.value / put - 1) * 1e5) / 1e5;
        return `<li class="${r.you ? 'you' : ''}"><span class="bar-label">${h(r.label)}</span><span class="bar-track"><span class="bar ${dirClass(ret)}" style="width:${(Math.abs(ret) / maxAbs) * 100}%"></span></span><strong class="num ${dirClass(ret)}">${h(pct(ret))}</strong></li>`;
      })
      .join('')}</ul>${state.bench ? '' : `<p class="note">${h(t('benchLoading'))}</p>`}`;
  };
  if (state.bench?.key === key && Date.now() - state.bench.at < 10 * 60_000) return draw();
  draw();
  try {
    const usd = await fetchChart(fxSymbol('USD'), range);
    const rows = [];
    for (const b of BENCHES) {
      const chart = await fetchChart(b.symbol, range);
      if (!chart?.points?.length) continue;
      let j = 0;
      const points = chart.points.map(([tt, c]) => {
        if (b.currency === BASE) return [tt, c];
        while (j + 1 < usd.points.length && usd.points[j + 1][0] <= tt) j++;
        return [tt, c * (usd.points[j]?.[1] ?? state.rates.USD)];
      });
      const last = state.quotes.get(b.symbol);
      const nowPrice = last ? last.price * (b.currency === BASE ? 1 : state.rates.USD) : null;
      rows.push({ label: `${nameOf(b.symbol)}${b.currency !== BASE ? ` (${t('inNtd')})` : ''}`, value: benchmarkValue(deposits, points, nowPrice) });
    }
    state.bench = { key, at: Date.now(), rows };
  } catch {
    state.bench = { key, at: Date.now(), rows: [] };
  }
  if ($('bench')) draw();
}

// ---- Guide tab ----------------------------------------------------------------------------

function fold(icon, title, body, open = false, id = title) {
  const isOpen = state.openFolds.has(id) || (open && !state.openFolds.has(`closed:${id}`));
  return `<details class="card fold" data-fold="${h(id)}"${isOpen ? ' open' : ''}><summary><span class="fold-icon">${icon}</span><h2>${h(title)}</h2></summary><div class="guide-text">${body}</div></details>`;
}
const para = key => `<p>${h(t(key))}</p>`;

function feeTable() {
  const rows = Object.entries(MARKETS).map(([id, m]) => {
    const cur = m.currency || '—';
    const taxes = [];
    for (const side of ['buy', 'sell'])
      for (const [kind, r] of Object.entries(m[side] || {})) {
        if (r.tax) taxes.push(`${t(side)}${kind === 'all' ? '' : `（${kindLabel(kind)}）`} ${rateText(r.tax)}`);
        if (r.fee && kind === 'all') taxes.push(`${t('exchangeFee')} ${rateText(r.fee)}`);
      }
    if (m.spread) taxes.push(t('feeSpread', { rate: rateText(m.spread) }));
    return `<tr><td>${m.flag} ${h(L(m))}</td><td>${h(cur)}</td><td class="num">${m.commission.rate ? h(rateText(m.commission.rate)) : '0'}${m.commission.min ? ` <small>(${h(t('minShort'))} ${h(money(m.commission.min, m.currency || 'USD'))})</small>` : ''}</td><td>${h(taxes.join('、') || '—')}</td><td class="num">${h(rateText(m.withholding || 0))}</td></tr>`;
  });
  return `<div class="table-wrap"><table class="table"><thead><tr><th>${h(t('market'))}</th><th>${h(t('currency'))}</th><th>${h(t('commission'))}</th><th>${h(t('taxesFees'))}</th><th>${h(t('divWithholding'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function fxTable() {
  const rows = Object.entries(CURRENCIES)
    .filter(([c]) => c !== BASE)
    .map(([c, info]) => `<tr><td>${info.flag} ${h(c)} · ${h(L(info))}</td><td class="num">${h(rateText(info.spread))}</td><td class="num">${h(rateText(info.spread * CLOSED_FX_MULTIPLIER))}</td><td class="num">${h(rateText(info.loanRate))}</td></tr>`);
  rows.unshift(`<tr><td>${CURRENCIES.TWD.flag} TWD · ${h(L(CURRENCIES.TWD))}</td><td class="num">—</td><td class="num">—</td><td class="num">${h(rateText(CURRENCIES.TWD.loanRate))}</td></tr>`);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>${h(t('currency'))}</th><th>${h(t('spread'))}</th><th>${h(t('spreadClosed'))}</th><th>${h(t('loanRateCol'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ---- Learn: lessons with live examples, quizzes, missions, glossary -------------------------

// Live numbers for the lessons' {placeholders}.
function lessonContext() {
  const q = sym => state.quotes.get(sym);
  const tsmc = q('2330.TW')?.price;
  const lot = tsmc ? tsmc * 1000 : null;
  const buy = lot ? tradeCostsFor('TW', 'buy', 'stock', lot) : null;
  const sell = lot ? tradeCostsFor('TW', 'sell', 'stock', lot) : null;
  const fv = (monthly, rate, years) => (rate ? monthly * (((1 + rate / 12) ** (years * 12) - 1) / (rate / 12)) : monthly * years * 12);
  return {
    tsmc: tsmc ? money(tsmc, BASE) : '—',
    tsmcLot: lot ? money(lot, BASE) : '—',
    tsmcFee: buy ? money(buy, BASE) : '—',
    tsmcSellCost: sell ? money(sell, BASE) : '—',
    roundTrip: lot ? (locale === 'zh' ? `${money(buy + sell, BASE)}（${pct((buy + sell) / lot, { sign: false })}）` : `${money(buy + sell, BASE)} (${pct((buy + sell) / lot, { sign: false })})`) : '—',
    tsmcStop: tsmc ? money(tsmc * 0.9, BASE) : '—',
    etf: q('0050.TW') ? money(q('0050.TW').price, BASE, { digits: 2 }) : '—',
    usd: state.rates.USD ? num(state.rates.USD, 2) : '—',
    us10y: q('^TNX') ? `${num(q('^TNX').price, 2)}%` : '—',
    btc: q('BTC-USD') ? money(q('BTC-USD').price, 'USD', { digits: 0 }) : '—',
    saved: money(fv(10_000, 0, 30), BASE),
    compound6: money(Math.round(fv(10_000, 0.06, 30) / 10_000) * 10_000, BASE)
  };
}
function tradeCostsFor(market, side, kind, gross) {
  return estimate({ market, kind, currency: BASE, side, qty: 1, price: gross }).costs;
}
const fillText = (text, ctx) => text.replace(/\{(\w+)\}/g, (m, k) => ctx[k] ?? m);

function lessonHtml(lesson, ctx) {
  const answered = state.learn.answers[lesson.id];
  const done = state.learn.done[lesson.id];
  const quiz = lesson.quiz;
  const tries = lesson.try
    .map(([kind, target]) =>
      kind === 'open'
        ? `<button class="ghost-button" type="button" data-action="open" data-symbol="${h(target)}">${h(t('tryOpen', { name: nameOf(target) }))}</button>`
        : `<button class="ghost-button" type="button" data-action="goto" data-tab="${h(target)}">${h(t('tryGoto', { tab: t(`tab_${target}`) }))}</button>`
    )
    .join('');
  const options = quiz.options
    .map((o, i) => {
      const cls = answered == null ? '' : i === quiz.answer ? ' right' : i === answered ? ' wrong' : '';
      return `<button class="quiz-option${cls}" type="button" data-action="quiz" data-lesson="${h(lesson.id)}" data-i="${i}" ${answered != null && done ? 'disabled' : ''}>${h(L(o))}</button>`;
    })
    .join('');
  const feedback = answered == null ? '' : `<p class="${answered === quiz.answer ? 'ok-msg' : 'warn'}">${h(answered === quiz.answer ? t('quizRight') : t('quizWrong'))} ${h(L(quiz.why))}</p>`;
  return `<details class="card fold lesson${done ? ' done' : ''}" data-fold="lesson:${h(lesson.id)}"${state.openFolds.has(`lesson:${lesson.id}`) ? ' open' : ''}>
    <summary><span class="fold-icon">${lesson.icon}</span><h2>${h(L(lesson.title))}</h2>${done ? '<span class="lesson-check" aria-label="done">✓</span>' : ''}</summary>
    <div class="guide-text">
      ${lesson.body[locale === 'zh' ? 'zh' : 'en'].map(p => `<p>${h(fillText(p, ctx))}</p>`).join('')}
      <div class="button-row">${tries}</div>
      <div class="quiz"><p class="quiz-q">🤔 ${h(L(quiz.q))}</p><div class="quiz-options">${options}</div>${feedback}</div>
    </div>
  </details>`;
}

function learnHtml() {
  const ctx = lessonContext();
  const doneCount = LESSONS.filter(l => state.learn.done[l.id]).length;
  const missions = MISSIONS.map(m => ({ ...m, ok: m.done(state.account) }));
  const missionCount = missions.filter(m => m.ok).length;
  const next = LESSONS.find(l => !state.learn.done[l.id]);
  return `
    <div class="card learn-hero">
      <h2>${h(t('learnTitle'))}</h2>
      <p>${h(t('learnIntro'))}</p>
      <div class="learn-progress">
        <div><span>${h(t('lessonsDone'))}</span><strong class="num">${doneCount} / ${LESSONS.length}</strong><div class="gauge"><span class="gauge-fill ok" style="width:${(doneCount / LESSONS.length) * 100}%"></span></div></div>
        <div><span>${h(t('missionsDone'))}</span><strong class="num">${missionCount} / ${MISSIONS.length}</strong><div class="gauge"><span class="gauge-fill ok" style="width:${(missionCount / MISSIONS.length) * 100}%"></span></div></div>
      </div>
      ${next ? `<button class="hero-button" type="button" data-action="lesson" data-lesson="${h(next.id)}">${h(doneCount ? t('continueLesson', { title: L(next.title) }) : t('startLesson'))}</button>` : `<p>${h(t('allLessonsDone'))}</p>`}
    </div>
    ${tmHtml()}
    <h2 class="section-heading">${h(t('lessonsTitle'))}</h2>
    ${LESSONS.map(l => lessonHtml(l, ctx)).join('')}
    <h2 class="section-heading">${h(t('missionsTitle'))}</h2>
    <div class="card"><p class="lede">${h(t('missionsIntro'))}</p><ul class="missions">${missions
      .map(m => `<li class="${m.ok ? 'done' : ''}"><span class="mission-box">${m.ok ? '✓' : ''}</span>${h(L(m))}</li>`)
      .join('')}</ul></div>
    ${fold('📖', t('glossaryTitle'), `<dl class="glossary">${GLOSSARY.map(([term, zh, en]) => `<div><dt>${h(term)}</dt><dd>${h(locale === 'zh' ? zh : en)}</dd></div>`).join('')}</dl>`, false, 'glossary')}
    <h2 class="section-heading">${h(t('referenceTitle'))}</h2>`;
}

// ---- Time machine -------------------------------------------------------------------

const TM_CHOICES = ['0050.TW', '0056.TW', '2330.TW', '2317.TW', 'VT', 'VOO', 'QQQ', 'AAPL', 'NVDA', 'BTC-USD', 'XAU'];
const TM_FIRST_YEAR = 2000;

function tmHtml() {
  const tm = state.tm;
  const choices = [...new Set([...TM_CHOICES, tm.symbol])];
  const year = new Date().getFullYear();
  const years = [];
  for (let y = year - 1; y >= TM_FIRST_YEAR; y--) years.push(y);
  return `<div class="card tm-card" id="time-machine">
    <h2>⏳ ${h(t('tmTitle'))}</h2>
    <p class="lede">${h(t('tmIntro'))}</p>
    <div class="tm-form">
      <label class="field"><span>${h(t('tmWhat'))}</span><select id="tm-symbol">${choices.map(sym => `<option value="${h(sym)}" ${sym === tm.symbol ? 'selected' : ''}>${h(nameOf(sym))} · ${h(bareSymbol(sym))}</option>`).join('')}</select></label>
      <label class="field"><span>${h(t('tmFrom'))}</span><select id="tm-start">${years.map(y => `<option value="${y}" ${String(y) === tm.start ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="field"><span>${h(tm.mode === 'monthly' ? t('tmMonthly') : t('tmAmount'))} (NT$)</span><input id="tm-amount" inputmode="numeric" autocomplete="off" value="${h(tm.amount)}" /></label>
      <div class="segmented" role="group"><button type="button" data-action="tm-mode" data-v="lump" aria-pressed="${tm.mode === 'lump'}">${h(t('tmLump'))}</button><button type="button" data-action="tm-mode" data-v="monthly" aria-pressed="${tm.mode === 'monthly'}">${h(t('tmDca'))}</button></div>
    </div>
    <button class="primary-button" type="button" data-action="tm-go" ${tm.loading ? 'disabled' : ''}>${h(tm.loading ? t('tmLoading') : t('tmGo'))}</button>
    <div id="tm-result">${tmResultHtml()}</div>
  </div>`;
}

function tmResultHtml() {
  const tm = state.tm;
  if (tm.error) return `<p class="warn">${h(t('tmError'))}</p>`;
  const r = tm.result;
  if (!r) return '';
  const dir = dirClass(r.gain);
  const late = r.start > Date.parse(`${r.asked}-02-01T00:00:00+08:00`);
  const facts = [
    r.annual != null ? t(r.mode === 'monthly' ? 'tmAnnualDca' : 'tmAnnual', { pct: pct(r.annual, { digits: 1 }) }) : '',
    t('tmDrawdown', { pct: pct(r.maxDrawdown, { digits: 0 }), from: monthYear(r.drawdownFrom ?? r.start), to: monthYear(r.drawdownTo ?? r.start) }),
    r.best && r.worst && r.yearly.length > 1 ? t('tmYears', { best: r.best[0], bestPct: pct(r.best[1], { digits: 0 }), worst: r.worst[0], worstPct: pct(r.worst[1], { digits: 0 }) }) : '',
    t('tmBank', { amount: money(r.bank, BASE), rate: pct(r.bankRate, { sign: false, digits: 1 }) })
  ].filter(Boolean);
  return `<div class="tm-result">
    <p class="tm-line">${h(t(r.mode === 'monthly' ? 'tmResultDca' : 'tmResult', { name: nameOf(r.symbol), date: monthYear(r.start), amount: money(r.mode === 'monthly' ? r.amount : r.putIn, BASE) }))}</p>
    <div class="kpis">
      ${kpi(t('tmPutIn'), money(r.putIn, BASE))}
      ${kpi(t('tmNow'), money(r.value, BASE), '', dir)}
      ${kpi(t('tmGain'), money(r.gain, BASE, { sign: true }), pct(r.ratio - 1), dir)}
    </div>
    <div id="tm-chart" class="chart-box"></div>
    <ul class="facts">${facts.map(f => `<li>${h(f)}</li>`).join('')}</ul>
    <p class="note">${h(r.maxDrawdown < -0.2 ? t('tmLessonDrop', { pct: pct(-r.maxDrawdown, { sign: false, digits: 0 }) }) : t('tmLessonCalm'))}</p>
    <p class="note">${h(t('tmNote'))}${late ? ` ${h(t('tmLate', { date: monthYear(r.start) }))}` : ''}</p>
  </div>`;
}

function renderTmChart() {
  const box = $('tm-chart');
  const r = state.tm.result;
  if (!box || !r) return;
  const width = Math.max(300, Math.round(box.clientWidth || 480));
  const value = r.series.map(([tt, v]) => [tt, v]);
  const put = r.series.map(([tt, , p]) => [tt, p]);
  const dir = dirClass(r.gain);
  const { svg, frame } = lineChart([{ points: value }, { points: put, cls: 'ref' }], { width, height: 200, dir, yFormat: x => compact(x), xFormat: tt => monthYear(tt) });
  box.innerHTML = `<ul class="legend-inline"><li><i class="sw ${dir}"></i>${h(t('tmNow'))}</li><li><i class="sw ref"></i>${h(t('tmPutIn'))}</li></ul>${svg}`;
  attachHover(box, [{ points: value }, { points: put }], frame, (i, tt, [v, p]) => `<strong class="num">${money(v, BASE)}</strong><span>${h(monthYear(tt))}</span><span class="chg ${dirClass(v - p)}">${money(v - p, BASE, { sign: true })}</span>`);
}

async function runTimeMachine() {
  const tm = state.tm;
  const amount = Math.round(Number(tm.amount));
  if (!(amount >= 100)) return toast(t('err_amount'), 'bad');
  tm.loading = true;
  tm.error = false;
  renderGuide();
  try {
    const symbol = tm.symbol;
    const chart = await fetchChart(symbol, 'max');
    const q = chart?.quote || state.quotes.get(symbol);
    const currency = METALS[symbol] ? BASE : q?.currency;
    const points = chart?.adjusted?.length > 1 ? chart.adjusted : chart?.points;
    if (!points?.length || !currency) throw new Error('no history');
    let fx = null;
    if (currency !== BASE) {
      await ensureRates([currency]);
      fx = (await fetchChart(fxSymbol(currency), 'max'))?.points || null;
      if (!fx?.length) throw new Error('no fx history');
    }
    const live = state.quotes.get(symbol);
    const result = timeMachine({
      points,
      fx,
      amount,
      start: Date.parse(`${tm.start}-01-01T00:00:00+08:00`),
      mode: tm.mode,
      price: live?.price ?? null,
      rate: currency === BASE ? 1 : state.rates[currency]
    });
    if (!result) throw new Error('no result');
    tm.result = { ...result, symbol, mode: tm.mode, amount, asked: tm.start };
  } catch {
    tm.error = true;
    tm.result = null;
  }
  tm.loading = false;
  if (state.tab === 'guide') {
    renderGuide();
    $('tm-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function answerQuiz(id, i) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) return;
  state.learn.answers[id] = i;
  if (i === lesson.quiz.answer) {
    state.learn.done[id] = true;
    toast(t('lessonDoneToast', { title: L(lesson.title) }), 'good');
  }
  saveLearn();
  renderGuide();
}

function renderGuide() {
  const collateral = Object.entries(COLLATERAL).map(([k, x]) => `${kindLabel(k)} ${pct(x, { digits: 0, sign: false })}`).join('、');
  $('guide-body').innerHTML = [
    learnHtml(),
    fold('🚀', t('g_start'), ['g_start1', 'g_start2', 'g_start3', 'g_start4'].map(para).join('')),
    fold('💸', t('g_fees'), `${para('g_fees1')}${feeTable()}${para('g_fees2')}`),
    fold('💱', t('g_fx'), `${para('g_fx1')}${fxTable()}${para('g_fx2')}`),
    fold('📝', t('g_orders'), ['g_orders1', 'g_orders2', 'g_orders3', 'g_orders4'].map(para).join('')),
    fold('💹', t('g_forex'), ['g_forex1', 'g_forex2', 'g_forex3'].map(para).join('')),
    fold('🕘', t('g_hours'), ['g_hours1', 'g_hours2'].map(para).join('')),
    fold('🏛️', t('g_bonds'), ['g_bonds1', 'g_bonds2', 'g_bonds3'].map(para).join('')),
    fold('📉', t('g_short'), ['g_short1', 'g_short2'].map(para).join('')),
    fold('🏦', t('g_loans'), `${para('g_loans1')}<p>${h(t('g_loans2', { list: collateral }))}</p><p>${h(t('g_loans3', { call: pct(MARGIN_CALL, { digits: 0, sign: false }), sell: pct(MARGIN_LIQUIDATE, { digits: 0, sign: false }) }))}</p>${para('g_loans4')}`),
    fold('💰', t('g_div'), `${para('g_div1')}<p>${h(t('g_div2', { rate: pct(NHI_RATE, { sign: false }), min: money(NHI_THRESHOLD, BASE) }))}</p>${para('g_div3')}`),
    fold('🥇', t('g_metal'), ['g_metal1', 'g_metal2'].map(para).join('')),
    fold('🪙', t('g_crypto'), ['g_crypto1', 'g_crypto2'].map(para).join('')),
    fold('📊', t('g_numbers'), ['g_numbers1', 'g_numbers2', 'g_numbers3'].map(para).join('')),
    fold('🛰️', t('g_data'), ['g_data1', 'g_data2', 'g_data3'].map(para).join('')),
    fold('⚙️', t('g_settings'), `<div class="setting"><span>${h(t('updownLabel'))}</span><div class="segmented" role="group"><button type="button" data-action="updown" data-v="tw" aria-pressed="${state.settings.updown === 'tw'}">${h(t('updownTw'))}</button><button type="button" data-action="updown" data-v="us" aria-pressed="${state.settings.updown === 'us'}">${h(t('updownUs'))}</button></div></div>
      ${appSettingsHtml()}
      ${state.account ? `<div class="setting"><span>${h(t('resetLabel'))}</span><button class="ghost-button danger" type="button" data-action="reset">${h(t('resetAccount'))}</button></div>` : ''}`),
    `<p class="disclaimer">${h(t('disclaimer'))}</p>`
  ].join('');
  renderTmChart();
}

// Installing the page as an app, and notifications for price alerts.
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function appSettingsHtml() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const install = standalone()
    ? `<p class="muted">${h(t('installed'))}</p>`
    : state.installPrompt
      ? `<button class="ghost-button" type="button" data-action="install">${h(t('installApp'))}</button>`
      : `<p class="muted">${h(ios ? t('installIos') : t('installOther'))}</p>`;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const notifyCtl =
    perm === 'granted'
      ? `<p class="muted">${h(t('notifyOn'))}</p>`
      : perm === 'default'
        ? `<button class="ghost-button" type="button" data-action="notify-on">${h(t('notifyEnable'))}</button>`
        : `<p class="muted">${h(perm === 'denied' ? t('alertNoNotify') : t('notifyUnsupported'))}</p>`;
  return `<div class="setting"><span>${h(t('installLabel'))}</span>${install}</div><div class="setting"><span>${h(t('notifyLabel'))}</span>${notifyCtl}</div>`;
}
async function installApp() {
  const p = state.installPrompt;
  if (!p) return;
  state.installPrompt = null;
  try {
    await p.prompt();
    await p.userChoice;
  } catch {}
  renderGuide();
}

// ---- Account setup ------------------------------------------------------------------------

function setupCardHtml() {
  return `<div class="card setup-card">
    <h3 class="card-title">${h(t('setupTitle'))}</h3>
    <p class="lede">${h(t('setupIntro'))}</p>
    <div class="presets">${START_PRESETS.map(x => `<button class="preset" type="button" data-action="start" data-amount="${x}"><strong class="num">${h(money(x, BASE))}</strong><small>${h(compact(x))}</small></button>`).join('')}</div>
    <form class="custom-start" data-form="start">
      <label class="field grow"><span>${h(t('customAmount'))}</span><input id="start-amount" inputmode="numeric" autocomplete="off" placeholder="${h(num(2_000_000))}" /></label>
      <button class="primary-button" type="submit">${h(t('openAccount'))}</button>
    </form>
    <p class="note">${h(t('setupRange', { min: money(MIN_START, BASE), max: money(MAX_START, BASE) }))}</p>
    <hr />
    <p class="muted">${h(t('haveCode'))}</p>
    <form class="custom-start" data-form="link">
      <label class="field grow"><span>${h(t('syncCode'))}</span><input id="link-code" autocomplete="off" autocapitalize="characters" placeholder="ABCD 2345" /></label>
      <button class="ghost-button" type="submit">${h(t('linkDevice'))}</button>
    </form>
  </div>`;
}

function openAccount(amount) {
  amount = Math.round(Number(String(amount).replace(/[,\s]/g, '')));
  if (!(amount >= MIN_START && amount <= MAX_START)) return toast(t('setupRange', { min: money(MIN_START, BASE), max: money(MAX_START, BASE) }), 'bad');
  commit(newAccount(amount));
  state.bench = null;
  if ($('setup').open) $('setup').close();
  toast(t('opened', { amount: money(amount, BASE) }), 'good');
  afterPrices();
  render();
  if (state.detail) renderDetail();
}

function showSetup() {
  $('setup-body').innerHTML = `<button class="icon-button sheet-close" type="button" data-action="close-setup" aria-label="${h(t('close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${setupCardHtml()}`;
  if (!$('setup').open) $('setup').showModal();
}

function askDeposit() {
  const text = prompt(t('depositPrompt'), '100000');
  if (text == null) return;
  const r = deposit(state.account, Number(String(text).replace(/[,\s]/g, '')));
  if (r.error) return toast(t('err_amount'), 'bad');
  commit(r.account);
  toast(t('depositDone', { amount: money(r.event.amount, BASE) }), 'good');
  render();
}

function resetAccount() {
  if (!confirm(t('resetConfirm'))) return;
  commit(null, { sync: false });
  state.bench = null;
  closeDetail();
  render();
  showSetup();
}

// ---- Sync and backups ---------------------------------------------------------------------

function loadSyncCode() {
  try {
    return localStorage.getItem(STORE.sync);
  } catch {
    return null;
  }
}
function saveSyncCode(code) {
  try {
    if (code) localStorage.setItem(STORE.sync, code);
    else localStorage.removeItem(STORE.sync);
  } catch {}
}

function syncCardHtml() {
  const sy = state.sync;
  const code = sy.code ? `${sy.code.slice(0, 4)} ${sy.code.slice(4)}` : '';
  return `<div class="card sync-card">
    <h3 class="card-title">${h(t('syncTitle'))}</h3>
    ${
      sy.code
        ? `<p>${h(t('syncOn'))}</p><p class="sync-code num">${h(code)}</p>
      <p class="muted">${h(sy.error ? t('syncError') : sy.at ? t('syncedAt', { time: dateTime(sy.at) }) : t('syncing'))}</p>
      <div class="button-row"><button class="ghost-button" type="button" data-action="sync-now" ${sy.busy ? 'disabled' : ''}>${h(t('syncNow'))}</button><button class="ghost-button" type="button" data-action="sync-off">${h(t('syncOff'))}</button></div>`
        : `<p class="lede">${h(t('syncIntro'))}</p>
      <div class="button-row"><button class="primary-button" type="button" data-action="sync-create" ${sy.busy ? 'disabled' : ''}>${h(t('syncCreate'))}</button></div>
      <form class="custom-start" data-form="link"><label class="field grow"><span>${h(t('syncCode'))}</span><input id="link-code" autocomplete="off" autocapitalize="characters" placeholder="ABCD 2345" /></label><button class="ghost-button" type="submit">${h(t('linkDevice'))}</button></form>`
    }
    ${sy.error && !sy.code ? `<p class="warn">${h(sy.error)}</p>` : ''}
    <hr />
    <div class="button-row"><button class="ghost-button" type="button" data-action="backup">${h(t('backup'))}</button><button class="ghost-button" type="button" data-action="restore">${h(t('restore'))}</button></div>
    <p class="note">${h(t('backupNote'))}</p>
  </div>`;
}

// Merges this device's account with the synced copy both ways. With no
// account here (just cleared, or a fresh browser) it only pulls when asked
// to: right after a reset the old copy mustn't come back.
async function syncNow({ pull = false } = {}) {
  const code = state.sync.code;
  if (!code || state.sync.busy || (!state.account && !pull)) return;
  state.sync.busy = true;
  try {
    const remote = await readSync(code);
    const merged = mergeAccounts(state.account, isAccount(remote) ? remote : null);
    if (merged && merged !== state.account) commit(merged, { sync: false });
    if (merged && JSON.stringify(merged) !== JSON.stringify(remote)) await writeSync(code, merged);
    state.sync.error = null;
    state.sync.at = Date.now();
  } catch (error) {
    state.sync.error = error.code === 'TOO_BIG' ? t('syncTooBig') : error.message;
  } finally {
    state.sync.busy = false;
    if (state.tab === 'portfolio') renderPortfolio();
  }
}

async function createSyncCode() {
  state.sync.busy = true;
  render();
  try {
    const code = await createSync(state.account);
    state.sync = { code, busy: false, error: null, at: Date.now() };
    saveSyncCode(code);
    toast(t('syncCreated'), 'good');
  } catch (error) {
    state.sync.busy = false;
    state.sync.error = t('syncFailed', { why: error.message });
  }
  render();
}

async function linkDevice(text) {
  const code = cleanPasscode(text);
  if (!PASSCODE_PATTERN.test(code)) return toast(t('badCode'), 'bad');
  try {
    const remote = await readSync(code);
    if (!isAccount(remote)) return toast(t('codeNotFound'), 'bad');
    if (state.account && state.account.id !== remote.id && state.account.events.length > 1 && !confirm(t('linkReplace'))) return;
    commit(state.account?.id === remote.id ? mergeAccounts(state.account, remote) : remote, { sync: false });
    state.sync = { code, busy: false, error: null, at: Date.now() };
    saveSyncCode(code);
    state.bench = null;
    if ($('setup').open) $('setup').close();
    toast(t('linked'), 'good');
    refresh();
    syncNow();
  } catch (error) {
    toast(t('syncFailed', { why: error.message }), 'bad');
  }
  render();
}

function syncOff() {
  if (!confirm(t('syncOffConfirm'))) return;
  state.sync = { code: null, busy: false, error: null, at: 0 };
  saveSyncCode(null);
  render();
}

function backup() {
  const blob = new Blob([JSON.stringify(state.account)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `stock-study-${taipeiDay(Date.now())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function restore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!isAccount(data)) throw new Error('not an account');
      if (state.account && state.account.id !== data.id && !confirm(t('restoreReplace'))) return;
      commit(state.account?.id === data.id ? mergeAccounts(state.account, data) : data);
      toast(t('restored'), 'good');
      render();
    } catch {
      toast(t('restoreFailed'), 'bad');
    }
  };
  input.click();
}

// ---- Page frame: tabs, status, rendering -----------------------------------------------------

function renderStatus() {
  let text;
  if (state.error && !state.loaded) text = t('statusError');
  else if (!state.loaded) text = t('statusLoading');
  else if (state.fromCache) text = `${state.online ? t('statusSaved') : t('statusOffline')} · ${t('statusUpdated', { time: dateTime(state.updated) })}`;
  else text = t('statusUpdated', { time: clock(state.updated) }) + (state.error ? ` · ${t('statusStale')}` : '');
  $('status').textContent = text;
  const notice = $('notice');
  notice.hidden = !(state.error && !state.loaded);
  notice.textContent = state.error && !state.loaded ? t('noticeNoData') : '';
}

function renderTabs() {
  for (const tab of TABS) {
    const button = $(`tab-${tab}`);
    button.setAttribute('aria-selected', String(state.tab === tab));
    button.querySelector('.tab-label').textContent = t(`tab_${tab}`);
    $(`panel-${tab}`).hidden = state.tab !== tab;
  }
  const open = state.account?.orders.filter(o => o.status === 'open').length || 0;
  const badge = $('tab-history').querySelector('.tab-badge');
  badge.hidden = !open;
  badge.textContent = open;
  const v = state.account && state.loaded ? valuation() : null;
  const alert = $('tab-fx').querySelector('.tab-badge');
  alert.hidden = !(v && v.margin !== 'ok');
  alert.textContent = '!';
}

function render() {
  renderStatus();
  renderTabs();
  if (state.tab === 'markets') renderMarkets();
  else if (state.tab === 'portfolio') renderPortfolio();
  else if (state.tab === 'fx') renderFx();
  else if (state.tab === 'history') renderHistory();
  else if (state.tab === 'guide') renderGuide();
  if (state.detail && $('detail').open) refreshDetailLive();
}

// The whole sheet again, where it was scrolled to.
function redrawDetail() {
  const scroll = $('detail').scrollTop;
  renderDetail();
  $('detail').scrollTop = scroll;
}

// Prices changed under an open sheet: update its numbers without touching
// what's being typed.
function refreshDetailLive() {
  const active = document.activeElement;
  if (active && $('detail').contains(active) && active.matches('input, select')) {
    renderTicket();
    return;
  }
  const scroll = $('detail').scrollTop;
  renderDetail();
  $('detail').scrollTop = scroll;
}

function showTab(tab) {
  state.tab = tab;
  try {
    history.replaceState(null, '', `#${tab}`);
  } catch {}
  window.scrollTo({ top: 0 });
  render();
  if (tab === 'markets' || tab === 'guide') refresh();
}

function renderStatic() {
  $('title').textContent = t('appName');
  document.title = t('appName');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('search').placeholder = t('searchPlaceholder');
  $('refresh').setAttribute('aria-label', t('refresh'));
  $('footer').textContent = t('footer');
  renderGuide();
}

// ---- Events ---------------------------------------------------------------------------------

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const d = state.detail;
  switch (a) {
    case 'cat':
      state.category = el.dataset.id;
      state.query = '';
      $('search').value = '';
      renderMarkets();
      refresh({ list: true });
      break;
    case 'open':
      openDetail(el.dataset.symbol);
      break;
    case 'close':
      closeDetail();
      break;
    case 'range':
      d.range = el.dataset.range;
      for (const b of document.querySelectorAll('[data-action="range"]')) b.setAttribute('aria-pressed', String(b.dataset.range === d.range));
      loadChart();
      break;
    case 'star':
      if (!state.account) return showSetup();
      commit(toggleWatch(state.account, d.symbol));
      renderDetail();
      if (state.tab === 'markets') renderMarkets();
      break;
    case 'side':
      d.side = el.dataset.side;
      d.qty = '';
      d.msg = null;
      renderTicket();
      break;
    case 'otype': {
      d.type = el.dataset.otype;
      const q = state.quotes.get(d.symbol);
      if (q) d.limit = d.stop = String(+q.price.toPrecision(6));
      d.msg = null;
      renderTicket();
      break;
    }
    case 'qty':
      d.qty = String(+Number(el.dataset.qty).toPrecision(12));
      d.msg = null;
      renderTicket();
      break;
    case 'place':
      placeFromTicket();
      break;
    case 'topup': {
      const r = exchange(state.account, { from: BASE, to: el.dataset.cur, amount: Number(el.dataset.need) }, { rates: state.rates, fxOpen: state.fxOpen, now: Date.now() });
      if (r.error) toast(errorText(r), 'bad');
      else {
        commit(r.account);
        toast(t('fxDone', { from: money(r.event.amount, BASE), to: money(r.event.received, r.event.to) }), 'good');
      }
      renderTicket();
      break;
    }
    case 'cancel':
      commit(cancelOrder(state.account, el.dataset.id));
      toast(t('cancelled'), '');
      render();
      if (state.detail) renderDetail();
      break;
    case 'goto':
      closeDetail();
      showTab(el.dataset.tab);
      break;
    case 'alloc':
      state.alloc = el.dataset.alloc;
      renderPortfolio();
      break;
    case 'fx-from':
      state.fx.from = el.dataset.cur;
      if (state.fx.to === state.fx.from) state.fx.to = state.fx.from === BASE ? 'USD' : BASE;
      showTab('fx');
      break;
    case 'fx-to':
      state.fx.to = el.dataset.cur;
      if (state.fx.from === state.fx.to) state.fx.from = BASE;
      renderFx();
      break;
    case 'fx-swap':
      [state.fx.from, state.fx.to] = [state.fx.to, state.fx.from];
      state.fx.amount = '';
      renderFx();
      break;
    case 'fx-max': {
      const have = Math.max(0, available(state.account, snap()).cash[state.fx.from] || 0);
      state.fx.amount = String(have);
      renderFx();
      break;
    }
    case 'fx-trade':
      state.category = 'fx';
      state.query = '';
      $('search').value = '';
      showTab('markets');
      refresh({ list: true });
      break;
    case 'fx-go':
      doExchange();
      break;
    case 'borrow':
      doBorrow();
      break;
    case 'repay':
      doRepay(false);
      break;
    case 'repay-all':
      doRepay(true);
      break;
    case 'hview':
      state.historyView = el.dataset.view;
      renderHistory();
      break;
    case 'afilter':
      state.activityFilter = el.dataset.f;
      state.activityShown = 60;
      renderHistory();
      break;
    case 'more':
      state.activityShown += 100;
      renderHistory();
      break;
    case 'start':
      openAccount(el.dataset.amount);
      break;
    case 'setup':
      showSetup();
      break;
    case 'close-setup':
      $('setup').close();
      break;
    case 'deposit':
      askDeposit();
      break;
    case 'reset':
      resetAccount();
      break;
    case 'quiz':
      answerQuiz(el.dataset.lesson, Number(el.dataset.i));
      break;
    case 'lesson': {
      const id = `lesson:${el.dataset.lesson}`;
      state.openFolds.add(id);
      renderGuide();
      document.querySelector(`[data-fold="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'updown':
      state.settings.updown = el.dataset.v;
      saveSettings();
      renderGuide();
      break;
    case 'chart-style':
      state.settings.chart = el.dataset.v;
      saveSettings();
      redrawDetail();
      break;
    case 'chart-ma':
      state.settings.ma = !state.settings.ma;
      saveSettings();
      redrawDetail();
      break;
    case 'alert-preset':
      state.alertPrice = el.dataset.v;
      refreshDetailLive();
      break;
    case 'alert-add':
      addAlert();
      break;
    case 'alert-off': {
      const a = state.account.alerts?.[el.dataset.id];
      if (a) commit(setAlert(state.account, { id: a.id, on: false }).account);
      render();
      if (state.detail) refreshDetailLive();
      break;
    }
    case 'plan-add':
      addPlan();
      break;
    case 'plan-off':
      if (!confirm(t('planStopConfirm'))) return;
      commit(setPlan(state.account, { id: el.dataset.id, on: false }).account);
      render();
      if (state.detail) refreshDetailLive();
      break;
    case 'tm-open':
      state.tm.symbol = el.dataset.symbol;
      state.tm.result = null;
      closeDetail();
      showTab('guide');
      document.getElementById('time-machine')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      runTimeMachine();
      break;
    case 'tm-mode':
      state.tm.mode = el.dataset.v;
      if (el.dataset.v === 'monthly' && Number(state.tm.amount) > 50_000) state.tm.amount = '5000';
      if (el.dataset.v === 'lump' && Number(state.tm.amount) < 10_000) state.tm.amount = '100000';
      state.tm.result = null;
      renderGuide();
      break;
    case 'tm-go':
      runTimeMachine();
      break;
    case 'install':
      installApp();
      break;
    case 'notify-on':
      askNotifications().then(renderGuide);
      break;
    case 'sync-create':
      createSyncCode();
      break;
    case 'sync-now':
      syncNow();
      break;
    case 'sync-off':
      syncOff();
      break;
    case 'backup':
      backup();
      break;
    case 'restore':
      restore();
      break;
  }
});

// Folding cards remember being opened or closed across redraws.
document.addEventListener(
  'toggle',
  event => {
    const id = event.target.dataset?.fold;
    if (!id) return;
    if (event.target.open) {
      state.openFolds.add(id);
      state.openFolds.delete(`closed:${id}`);
    } else {
      state.openFolds.delete(id);
      state.openFolds.add(`closed:${id}`);
    }
  },
  true
);

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'start') openAccount(form.querySelector('#start-amount').value);
  if (form.dataset.form === 'link') linkDevice(form.querySelector('#link-code').value);
});

// Typing: keep the caret where it was when the ticket redraws.
function keepCaret(redraw) {
  const active = document.activeElement;
  const id = active?.id;
  const pos = active?.selectionStart;
  redraw();
  const again = id && $(id);
  if (again) {
    again.focus();
    try {
      again.setSelectionRange(pos, pos);
    } catch {}
  }
}
const cleanNumber = value => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

document.addEventListener('input', event => {
  const el = event.target;
  const d = state.detail;
  switch (el.id) {
    case 'search':
      onSearchInput(el.value);
      break;
    case 't-qty':
      d.qty = cleanNumber(el.value);
      d.msg = null;
      keepCaret(renderTicket);
      break;
    case 't-limit':
      d.limit = cleanNumber(el.value);
      keepCaret(renderTicket);
      break;
    case 't-stop':
      d.stop = cleanNumber(el.value);
      keepCaret(renderTicket);
      break;
    case 'fx-amount':
      state.fx.amount = cleanNumber(el.value);
      keepCaret(renderFx);
      break;
    case 'loan-amount':
      state.loan.amount = cleanNumber(el.value);
      keepCaret(renderFx);
      break;
    case 'alert-price':
      state.alertPrice = cleanNumber(el.value);
      keepCaret(redrawDetail);
      break;
    case 'plan-amount':
      state.plan.amount = cleanNumber(el.value);
      keepCaret(redrawDetail);
      break;
    case 'tm-amount':
      state.tm.amount = cleanNumber(el.value);
      break;
  }
});

document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'fx-from' || el.id === 'fx-to') {
    state.fx[el.id === 'fx-from' ? 'from' : 'to'] = el.value;
    if (state.fx.from === state.fx.to) state.fx[el.id === 'fx-from' ? 'to' : 'from'] = el.value === BASE ? 'USD' : BASE;
    const c = el.value;
    if (!state.rates[c]) ensureRates([c]).then(renderFx).catch(() => {});
    renderFx();
  }
  if (el.id === 'loan-cur') {
    state.loan.currency = el.value;
    renderFx();
  }
  if (el.id === 'plan-day') state.plan.day = el.value;
  if (el.id === 'tm-symbol' || el.id === 'tm-start') {
    state.tm[el.id === 'tm-symbol' ? 'symbol' : 'start'] = el.value;
    state.tm.result = null;
    runTimeMachine();
  }
});

$('detail').addEventListener('close', () => (state.detail = null));
$('detail').addEventListener('click', event => {
  if (event.target === $('detail')) closeDetail();
});
$('setup').addEventListener('click', event => {
  if (event.target === $('setup')) $('setup').close();
});

for (const button of document.querySelectorAll('#tabs .tab')) button.addEventListener('click', () => showTab(button.dataset.tab));
$('refresh').addEventListener('click', () => refresh({ list: true }));
{
  const fromHash = location.hash.slice(1);
  if (TABS.includes(fromHash)) state.tab = fromHash;
}

// Phones: the status and refresh button move to a slim row at the top (the
// tabs are at the bottom).
{
  const phone = matchMedia('(max-width: 720px)');
  const place = () => {
    if (phone.matches) $('mobile-bar').append($('status'), $('refresh'));
    else {
      document.querySelector('.brand-text').append($('status'));
      document.querySelector('.appbar-inner').append($('refresh'));
    }
  };
  place();
  phone.addEventListener('change', place);
}

// Big numbers shrink (to 60% at most) to stay on one line.
const FIT_SELECTOR = '.stat-value, .big-price, .hero-value';
function fitNumbers(nodes) {
  for (const node of nodes) node.style.fontSize = '';
  const sizes = nodes.map(node => {
    const box = node.clientWidth;
    const need = node.scrollWidth;
    if (!box || need <= box + 0.5) return null;
    const full = parseFloat(getComputedStyle(node).fontSize);
    return Math.max(full * 0.6, Math.floor(((full * box) / need) * 10) / 10);
  });
  nodes.forEach((node, i) => sizes[i] && (node.style.fontSize = `${sizes[i]}px`));
}
if ('ResizeObserver' in window) {
  const resized = new ResizeObserver(entries => fitNumbers(entries.map(e => e.target)));
  const watch = new MutationObserver(() => {
    const nodes = [...document.querySelectorAll(FIT_SELECTOR)];
    for (const node of nodes) resized.observe(node);
    fitNumbers(nodes);
  });
  watch.observe(document.body, { childList: true, subtree: true });
}

// Redraw charts when the width changes (not when a phone's address bar hides).
let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    render();
    if (state.detail) renderChart();
  }, 150);
});

// ---- Start ----------------------------------------------------------------------------------

window.__stockStarted = true;
applySettings();
state.sync.code = loadSyncCode();
loadQuotes();
renderStatic();
render();
loadAccount().then(account => {
  state.account = account;
  state.accountReady = true;
  // Saved prices: the page is usable at once (and offline).
  if (state.fromCache) $('loading').hidden = true;
  if (!account && !state.sync.code) showSetup();
  render();
  backfillOrders()
    .catch(() => {})
    .finally(() => {
      state.backfilled = true;
      refresh({ list: true }).then(() => {
        $('loading').hidden = true;
        checkBonds();
        checkCorporateActions();
        checkPlans();
        checkAlertHistory();
      });
    });
  if (state.sync.code)
    syncNow({ pull: !account }).then(() => {
      if (!state.account) showSetup();
      render();
    });
});
// Hide the loading screen after at most 8 seconds whatever happens.
setTimeout(() => ($('loading').hidden = true), 8000);

setInterval(() => {
  if (document.visibilityState === 'visible') refresh().then(checkBonds);
}, QUOTE_REFRESH_MS);
// Monthly plans due today wait for their market's first price.
setInterval(() => {
  if (document.visibilityState === 'visible') checkPlans();
}, 10 * 60_000);

// ---- Offline and installable ----------------------------------------------------------

window.addEventListener('online', () => {
  state.online = true;
  refresh();
});
window.addEventListener('offline', () => {
  state.online = false;
  renderStatus();
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.tab === 'guide') renderGuide();
});
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(reg => {
      const urls = [location.href.split('#')[0], ...performance.getEntriesByType('resource').map(e => e.name)].filter(u => u.startsWith(location.origin));
      reg.active?.postMessage({ type: 'cache', urls });
    })
    .catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Back after a while: settle what happened meanwhile from the history first.
  state.backfilled = false;
  backfillOrders()
    .catch(() => {})
    .finally(() => {
      state.backfilled = true;
      refresh().then(() => {
        checkBonds();
        checkPlans();
      });
    });
  syncNow();
});
