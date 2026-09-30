// Stock Study: rendering and wiring. The rules live in lib/ (account.mjs for
// the ledger, markets.mjs for fees and hours, quotes.mjs for prices).
import {
  newAccount, replay, available, placeOrder, processOrders, cancelOrder, exchange, quoteExchange, amountFor, valuate, borrow, repay, repayAll, liquidationPlan, applyCorporateActions, applyBondCashflows, backfillPrice, fillFromHistory, netWorthSeries, mergeAccounts, recordSnapshot, benchmarkValue, isAccount, toggleWatch, watched, estimate, setPlan, activePlans, dedupePlans, planRuns, nextPlanRun, runPlan, planOrderId, setAlert, activeAlerts, alertsFor, checkAlerts, alertHitInBars, markAlertHit, marginHistory, pendingDividends, applyIncome, startIncome, applyCashInterest, unsettled, settlesBy, withdrawable, nextPayday, START_AMOUNT, PLAN_MIN, taipeiDay, applyPool, ownCash, mergeDistinct, requiredCash, incomeSummary, usePlus, plusAt, loanRateAt, fxSpread, coverPlan, expireOrders, GTC_DAYS
} from './lib/account.mjs';
import {
  BASE, CURRENCIES, MARKETS, METALS, MARGIN_CALL, MARGIN_LIQUIDATE, SHORT_FEE, currencyInfo, isOpen, isTradable, isShortable, qtyStep, roundQty, dealPrice, delayOf, tickSize, onTick, priceLimits, marketFill, isOddLot, oddLotOpen, CASH_RATE, lotSize, lunchOf, atLunch, limitShare, settleDays
} from './lib/markets.mjs';
import { BONDS } from './lib/bonds.mjs';
import { nextTradingStart, upcomingHolidays, localDay } from './lib/holidays.mjs';
import { fetchQuotes, fetchChart, fetchBars, fetchCorporateActions, fetchFundamentals, searchSymbols, fxSymbol } from './lib/quotes.mjs';
import { CATEGORIES, OVERVIEW, TRACKERS, catalogInfo, searchCatalog } from './lib/catalog.mjs';
import { money, price as fmtPrice, pct, qty as fmtQty, num, compact, dateTime, date as fmtDate, shortDate, clock, weekdayClock, monthYear, escapeHtml as h, setFormatLocale } from './lib/format.mjs';
import { sparkline, lineChart, attachHover, candleChart, attachCandleHover, donut, miniBars, stackBar, SERIES } from './lib/chart.mjs';
import { timeMachine, movingAverage } from './lib/timemachine.mjs';
import { detectLocale, makeT } from './lib/i18n.mjs';
import { pack, unpack } from './lib/codec.mjs';
import { forYou, movers, wantedSymbols } from './lib/foryou.mjs';
import {
  APPS, appUrl, describeEntry, installGate, watchUpdates, quadraSession, tabBar, topActions, recordAffinity, activityPatch, affinity, notify, notifyOn, kindOn, schedulePush, ask, translate, paydayFor, PLUS, plusMonths, plusCard, openPlus, affinityPatch
} from './lib/quadra.mjs';

const $ = id => document.getElementById(id);
const TABS = ['markets', 'portfolio', 'fx', 'history'];
const QUOTE_REFRESH_MS = 45_000;
const LIST_REFRESH_MS = 90_000;
const ACTIONS_EVERY_MS = 12 * 3_600_000;
const STORE = {
  account: 'stockStudy.account',
  sync: 'stockStudy.syncCode',
  settings: 'stockStudy.settings',
  actions: 'stockStudy.actionsChecked',
  quotes: 'stockStudy.quotes',
  marginNotice: 'stockStudy.marginNotice'
};

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
  crossFx: new Set(Object.entries(CURRENCIES).filter(([, c]) => c.cross).map(([code]) => code)),
  fxOpen: true,
  loaded: false,
  error: null,
  updated: 0,
  category: 'overview',
  query: '',
  search: { query: '', results: [], loading: false },
  detail: null,
  // mode 'pay': the amount is what you give; 'get': what you want to receive.
  fx: { from: BASE, to: 'USD', amount: '', mode: 'pay', view: 'exchange' },
  loan: { currency: BASE, amount: '', mode: 'borrow' },
  alloc: 'kind',
  historyView: 'activity',
  activityFilter: 'all',
  activityShown: 60,
  bench: null,
  settings: loadSettings(),
  // Which folding cards are open (they survive redraws).
  openFolds: new Set(),
  // The Quadra Pass session (quadra.mjs) and its wallet: the one money pool.
  sync: { busy: false, error: null, at: 0 },
  wallet: null,
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
function saveSettings() {
  try {
    localStorage.setItem(STORE.settings, JSON.stringify(state.settings));
  } catch {}
  applySettings();
}
function applySettings() {
  document.body.dataset.updown = state.settings.updown;
}

// The account is kept with the Quadra Pass (synced); this device keeps a
// copy under the pass so the app opens at once, and offline.
const accountKey = () => `${STORE.account}:${q.pass}`;
async function loadAccount() {
  // (Also the copy older versions kept under the pass itself.)
  for (const key of [accountKey(), q.oldPass ? `${STORE.account}:${q.oldPass}` : ''].filter(Boolean)) {
    try {
      const saved = await unpack(localStorage.getItem(key));
      if (isAccount(saved)) return saved;
    } catch {}
  }
  return null;
}
// The copy Quadra Securities kept on the device before accounts moved onto
// the pass (left in place as a backup): folded in when it is the same
// account, or when the pass's account has nothing in it yet.
async function oldDeviceAccount(account) {
  try {
    const old = await unpack(localStorage.getItem(STORE.account));
    if (!isAccount(old) || !(old.events || []).length) return account;
    if (!account) return old;
    if (old.id === account.id) return mergeAccounts(account, old);
    if (!(account.events || []).length) return mergeDistinct(account, old);
  } catch {}
  return account;
}

let saveTimer;
let syncTimer;
function commit(account, { sync = true } = {}) {
  state.account = account;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncPush, 3000);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      if (state.account) localStorage.setItem(accountKey(), await pack(state.account));
      else localStorage.removeItem(accountKey());
    } catch {}
  }, 200);
  if (sync && q.pass) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1200);
  }
}

// What to be told while the app is closed (the Worker watches the prices):
// price alerts and open orders reaching their price, and each monthly plan's
// day. The app catches up on the rest when it's opened.
let pushTimer = 0;
function syncPush() {
  const account = state.account;
  if (!account) return;
  const now = Date.now();
  const items = [];
  for (const a of activeAlerts(account)) {
    if (a.hit || BONDS[a.symbol]) continue;
    items.push({ at: a.since, until: a.since + 30 * 86_400_000, title: `🔔 ${t('alertTitle')}`, body: t(a.op === 'above' ? 'alertHitAbove' : 'alertHitBelow', { name: nameOf(a.symbol), price: fmtPrice(a.price, state.quotes.get(a.symbol)?.currency) }), tag: `alert:${a.id}`, hash: 'portfolio', kind: 'alert', check: { yahoo: a.symbol, op: a.op, price: a.price } });
  }
  for (const o of account.orders.filter(x => x.status === 'open' && !BONDS[x.symbol] && (x.type === 'limit' || x.type === 'stop'))) {
    const price = Number(o.type === 'limit' ? o.limit : o.stop);
    if (!(price > 0)) continue;
    const op = (o.type === 'limit') === (o.side === 'buy') ? 'below' : 'above';
    items.push({ at: o.t, until: o.t + 30 * 86_400_000, title: t('noticeReached'), body: t('noticeReachedBody', { side: t(o.side).toLowerCase(), name: nameOf(o.symbol), price: fmtPrice(price, o.currency) }), tag: `fill:${o.id}`, hash: 'history', kind: 'fill', check: { yahoo: o.symbol, op, price } });
  }
  for (const p of activePlans(account)) {
    const next = nextPlanRun(p, now);
    if (next) items.push({ at: next + 9 * 3_600_000, title: t('noticePlanTitle'), body: t('noticePlanDay', { name: nameOf(p.symbol), amount: money(p.amount, BASE) }), tag: `plan:${p.id}:${next}`, hash: 'portfolio', kind: 'fill' });
  }
  // Dividends on the way: the day each is paid.
  for (const e of pendingDividends(account, now)) {
    items.push({ at: e.t, title: t('noticeDivPayTitle'), body: t('noticeDivPayBody', { name: nameOf(e.symbol), amount: money(e.net, e.currency) }), tag: `div:${e.symbol}:${e.t}`, hash: 'portfolio', kind: 'income' });
  }
  schedulePush(q, items);
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
  // A batch with a pair Yahoo doesn't have can fail as a whole: the rest
  // are then tried through US$ below.
  absorb(await fetchQuotes(missing.flatMap(fxSymbolsFor)).catch(() => new Map()));
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
    if (state.tab === 'markets' && (list || now - (state.listAt.get('home') || 0) > LIST_REFRESH_MS)) {
      for (const sym of homeSymbols()) symbols.add(sym);
      state.listAt.set('home', now);
    }
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
  // Day orders past their session end (and month-old GTC ones) lapse first.
  const ex = expireOrders(account, now);
  account = ex.account;
  for (const o of ex.expired) accountNotice('order', t('toastExpired', { name: nameOf(o.symbol) }), { tag: `order:${o.id}`, hash: 'history' });
  const r = processOrders(account, state.quotes, state.rates, now);
  account = r.account;
  for (const f of r.filled) filledNotice(t('toastFilled', { side: t(f.side), qty: fmtQty(f.qty), name: nameOf(f.symbol), price: fmtPrice(f.price, f.currency) }), f);
  for (const o of r.rejected) accountNotice('order', t('toastRejected', { name: nameOf(o.symbol), why: t(`err_${o.reason}`) }), { tone: 'bad', tag: `order:${o.id}`, hash: 'history' });
  if (r.filled.some(f => f.forced)) account = repayAll(account, state.rates, state.fxOpen, now);
  let v = valuate(replay(account, now), state.quotes, state.rates);
  for (const plan of liquidationPlan(account, v)) {
    const placed = placeOrder(account, plan, { quote: state.quotes.get(plan.symbol), rates: state.rates, now });
    if (placed.account) {
      account = placed.account;
      accountNotice('margin', t('toastForced', { name: nameOf(plan.symbol) }), { tone: 'bad', tag: `forced:${plan.symbol}:${now}`, hash: 'fx' });
    }
  }
  if (account !== state.account) {
    if (account.orders.some(o => o.forced && o.status === 'filled' && o.done === now)) account = repayAll(account, state.rates, state.fxOpen, now);
    v = valuate(replay(account, now), state.quotes, state.rates);
  }
  if (v.margin === 'call' && !v.missingRates.length && !v.stale.length) marginCallNotice(account, v);
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
// The kit's notices (quadra.mjs): a banner while the app is on screen, a
// system notice when it isn't (once turned on in the account sheet).
function alertFired(a, { late = false } = {}) {
  const text = alertText(a) + (late ? ` · ${dateTime(a.hit.t)}` : '');
  notify(q, { title: `🔔 ${t('alertTitle')}`, body: text, tag: `alert:${a.id}:${a.hit?.t || ''}`, hash: 'portfolio', kind: 'alert' });
}
// An order filled: a toast on screen, a notice when the app is in the background.
function filledNotice(text, fill) {
  if (!kindOn('stock', 'fill')) return;
  if (document.visibilityState === 'visible') return toast(text, 'good', 'history');
  notify(q, { title: t('noticeFilled'), body: t('noticeFilledBody', { side: t(fill.side), name: nameOf(fill.symbol), qty: fmtQty(fill.qty), price: fmtPrice(fill.price, fill.currency) }), tag: `fill:${fill.id}`, hash: 'history', kind: 'fill' });
}
// What happened in the account (an order lapsed, a forced sale, a dividend
// in): a toast while the app is on screen (tap: where it happened), a
// system notice when it isn't. Each has its kind of notice in the account
// sheet (kit NOTICE_KINDS.stock); a kind turned off there shows neither.
const NOTICE_TITLE = { fill: 'noticeFilled', order: 'noticeOrderTitle', margin: 'noticeMarginTitle', income: 'noticeIncomeTitle' };
function accountNotice(kind, text, { tone = 'good', tag = '', hash = '' } = {}) {
  if (!kindOn('stock', kind)) return;
  if (document.visibilityState === 'visible') return toast(text, tone, hash);
  notify(q, { title: t(NOTICE_TITLE[kind]), body: text, tag, hash, kind });
}
// Margin below 130%: told once a day (the fx tab's badge stays until it's fixed).
function marginCallNotice(account, v) {
  const mark = `${account.id}:${taipeiDay(Date.now())}`;
  try {
    if (localStorage.getItem(STORE.marginNotice) === mark) return;
    localStorage.setItem(STORE.marginNotice, mark);
  } catch {}
  accountNotice('margin', t('noticeMarginBody', { ratio: `${Math.floor(v.ratio * 100)}%` }), { tone: 'bad', tag: `margin:${mark}`, hash: 'fx' });
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

// ---- Payday: new money on the 1st of every month -------------------------------------

function checkIncome() {
  if (!state.account) return;
  const r = applyIncome(startIncome(state.account));
  const i = applyCashInterest(r.account);
  if (i.account === state.account) return;
  commit(i.account);
  for (const e of i.added) accountNotice('income', t('toastInterest', { amount: money(e.net, BASE) }), { tag: `interest:${e.id || e.t}`, hash: 'portfolio' });
  if (!r.added.length) return render();
  const total = r.added.reduce((sum, e) => sum + e.amount, 0);
  toast(r.added.length > 1 ? t('toastPaydays', { n: r.added.length, amount: money(total, BASE) }) : t('toastPayday', { amount: money(total, BASE) }), 'good');
  render();
}

// ---- Monthly plans (定期定額) ----------------------------------------------------

// Every month's buy that is due and not done: bought at the first price on
// or after its day (from the price history), at that moment's rate.
let plansRunning = false;
async function checkPlans() {
  if (!state.account || plansRunning || !state.backfilled) return;
  plansRunning = true;
  try {
    // The copies a repeated tap left: one plan a symbol.
    const once = dedupePlans(state.account);
    if (once !== state.account) commit(once);
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
        if (r.fill) accountNotice('fill', t('toastPlan', { name: nameOf(plan.symbol), qty: fmtQty(r.fill.qty), price: fmtPrice(r.fill.price, r.fill.currency), time: fmtDate(r.fill.t) }), { tag: `plan:${plan.id}:${run.month}`, hash: 'history' });
        else if (r.order?.status === 'rejected') accountNotice('order', t('toastPlanSkipped', { name: nameOf(plan.symbol), why: t(`err_${r.order.reason}`) }), { tone: 'bad', tag: `plan:${plan.id}:${run.month}`, hash: 'portfolio' });
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
      accountNotice('income', e.coupon ? t('toastCoupon', { name: nameOf(symbol), amount: money(e.net, e.currency) }) : t('toastMatured', { name: nameOf(symbol), amount: money(e.total, e.currency) }), { tag: `bond:${symbol}:${e.t}`, hash: 'portfolio' });
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
    if (f.fill) filledNotice(t('toastFilledAt', { side: t(f.fill.side), name: nameOf(f.fill.symbol), qty: fmtQty(f.fill.qty), price: fmtPrice(f.fill.price, f.fill.currency), time: dateTime(f.fill.t) }), f.fill);
    else if (f.order?.status === 'rejected') accountNotice('order', t('toastRejected', { name: nameOf(f.order.symbol), why: t(`err_${f.order.reason}`) }), { tone: 'bad', tag: `order:${f.order.id}`, hash: 'history' });
  }
  if (state.account?.orders.some(o => o.forced && o.status === 'filled')) commit(repayAll(state.account, state.rates, state.fxOpen, Date.now()));
}

// A loan or short that broke the liquidation line while the page was closed
// is sold at that moment, from the price history since the last visit.
async function checkMarginHistory() {
  const account = state.account;
  if (!account) return;
  const s = replay(account);
  const owes = Object.values(s.loans).some(l => l.balance > 1e-9) || Object.values(s.positions).some(p => p.qty < 0);
  if (!owes) return;
  const seen = Math.max(account.created, ...Object.values(account.snapshots || {}).map(x => x.t), ...account.events.map(e => (e.t <= Date.now() ? e.t : 0)));
  if (Date.now() - seen < 30 * 60_000) return;
  const symbols = Object.keys(s.positions).filter(sym => !BONDS[sym]);
  const currencies = [...new Set([...Object.values(s.positions).map(p => p.currency), ...Object.keys(s.loans), ...Object.keys(s.cash)])].filter(c => c !== BASE);
  try {
    const [bars, fx] = await Promise.all([
      Promise.all(symbols.map(sym => fetchBars(sym, seen).catch(() => []))),
      Promise.all(currencies.map(c => fetchBars(fxSymbol(c), seen - 5 * 86_400_000).catch(() => [])))
    ]);
    const series = new Map(symbols.map((sym, i) => [sym, bars[i]]));
    const rates = new Map(currencies.map((c, i) => [c, fx[i]]));
    const last = (list, t) => {
      let v = null;
      for (const b of list || []) {
        if (b.t > t) break;
        v = b.c;
      }
      return v;
    };
    const times = [...new Set(bars.flat().map(b => b.t))].filter(t => t > seen && t < Date.now()).sort((a, b) => a - b);
    const r = marginHistory(state.account, { times, priceAt: (sym, t) => last(series.get(sym), t), rateAt: (c, t) => last(rates.get(c), t) ?? state.rates[c] });
    if (!r.forced.length) return;
    commit(r.account);
    for (const f of r.forced) accountNotice('margin', t('toastForcedAt', { name: nameOf(f.symbol), qty: fmtQty(f.qty), price: fmtPrice(f.price, f.currency), time: dateTime(f.t) }), { tone: 'bad', tag: `forced:${f.symbol}:${f.t}`, hash: 'history' });
    render();
  } catch {}
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
    if (e.type === 'div' && e.t > Date.now()) accountNotice('income', t('toastDividendPending', { name: nameOf(e.symbol), amount: money(e.net, e.currency), date: fmtDate(e.t) }), { tag: `div:${e.symbol}:${e.t}:ex`, hash: 'portfolio' });
    else if (e.type === 'div') accountNotice('income', t('toastDividend', { name: nameOf(e.symbol), amount: money(e.net, e.currency) }), { tag: `div:${e.symbol}:${e.t}`, hash: 'portfolio' });
    else toast(t('toastSplit', { name: nameOf(e.symbol), ratio: num(e.ratio, 4) }), 'good', 'portfolio');
  }
  if (credited.length) render();
}

function setBusy(busy) {
  $('refresh').disabled = busy;
}

// ---- Toasts -------------------------------------------------------------------------

// Toasts that come together (catching up on fills, plans, interest after a
// while away) show as one: the first two, then how many more (tap for all).
let toastBatch = null;
// `hash`: the tab a tap on it opens.
function toast(text, kind = '', hash = '') {
  if (toastBatch) return void toastBatch.push([text, kind, hash]);
  toastBatch = [[text, kind, hash]];
  setTimeout(() => {
    const list = toastBatch;
    toastBatch = null;
    if (list.length <= 2) return list.forEach(([x, k, go]) => showToast(x, k, [], go));
    showToast(list[0][0], list[0][1], list.slice(1));
  }, 500);
}
function showToast(text, kind = '', more = [], hash = '') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}${hash && !more.length ? ' go' : ''}`;
  el.textContent = text;
  if (hash && !more.length)
    el.addEventListener('click', () => {
      el.remove();
      if (TABS.includes(hash) && state.tab !== hash) showTab(hash);
    });
  let open = false;
  if (more.length) {
    const tail = document.createElement('small');
    tail.className = 'toast-more';
    tail.textContent = t('toastMore', { n: more.length });
    el.append(tail);
    el.addEventListener('click', () => {
      if (open) return el.remove();
      open = true;
      tail.remove();
      const ul = document.createElement('ul');
      for (const [x] of more) ul.append(Object.assign(document.createElement('li'), { textContent: x }));
      el.append(ul);
    });
  }
  box.append(el);
  const wait = more.length ? 7000 : 4200;
  setTimeout(() => !open && el.classList.add('out'), wait);
  setTimeout(() => !open && el.remove(), wait + 500);
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
// When a closed market opens next: Yahoo's session moved past weekends and
// the market's holidays (holidays.mjs) to the next trading day.
// The market's own rules for this security, in a line: its lot, daily
// limit, lunch break, settlement, and anything special.
function marketRules(q) {
  const parts = [];
  const lot = lotSize(q.market, q.symbol, q.kind);
  if (lot > 1) parts.push(t('ruleLot', { n: fmtQty(lot) }));
  else if (q.market === 'TW' && ['stock', 'etf', 'bond'].includes(q.kind)) parts.push(t('ruleTwLot'));
  const share = limitShare(q);
  if (share) parts.push(t('ruleLimit', { p: Math.round(share * 100) }));
  else if (q.market === 'JP' && q.kind === 'stock') parts.push(t('ruleLimitJp'));
  const lunch = lunchOf(q.market);
  if (lunch) {
    const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    parts.push(t('ruleLunch', { from: hm(lunch[0]), to: hm(lunch[1]) }));
  }
  const n = settleDays(q.market);
  parts.push(n ? t('ruleSettle', { n }) : t('ruleInstant'));
  if (q.market === 'CN') parts.push(t('ruleCn'));
  if (q.market === 'TW' && q.kind === 'stock') parts.push(t('ruleDayTrade'));
  if (q.kind !== 'crypto' && q.kind !== 'fx') parts.push(t('ruleDayOrder'));
  return parts.join(' · ');
}

function nextOpen(q, now) {
  if (!q.session) return null;
  const market = q.market === 'BOND' ? BONDS[q.symbol]?.issuer : q.market;
  return nextTradingStart(market, q.session.start, q.tz, now);
}
// The market's next holidays, for the detail sheet.
function holidayLine(q) {
  if (!q || q.kind === 'crypto' || q.market === 'FX') return '';
  const market = q.market === 'BOND' ? BONDS[q.symbol]?.issuer : q.market;
  const days = upcomingHolidays(market, localDay(Date.now(), q.tz), 4);
  if (!days.length) return '';
  const fmt = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
  return days.map(d => fmt.format(new Date(`${d}T00:00:00Z`))).join('、');
}

function marketStatus(q) {
  if (!q) return '';
  if (q.kind === 'crypto') return `<span class="mkt-status open">${statusDot(q)}${h(t('always'))}</span>`;
  const now = Date.now();
  if (q.session && now >= q.session.start && now < q.session.end && atLunch(q.market, now)) return `<span class="mkt-status">${statusDot(q)}${h(t('atLunch'))} <small>(${h(t('localTime'))} ${h(clock(now, q.tz))})</small></span>`;
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

// The home screen's rows: for you, today's movers, and popular lists, each a
// row that scrolls sideways (the full lists stay below, by category).
const homeSymbols = () => {
  const out = new Set(forYouSymbols());
  for (const [id, n] of [['tw', 10], ['us', 10], ['twetf', 6], ['usetf', 6], ['crypto', 8]]) for (const [sym] of (CATEGORIES.find(c => c.id === id)?.items || []).slice(0, n)) out.add(sym);
  return out;
};
const forYouSymbols = () =>
  wantedSymbols({ aff: affinityMap(), held: Object.keys(snap()?.positions || {}), watched: watched(state.account) });
let affMemo = { at: 0, map: {} };
function affinityMap() {
  if (Date.now() - affMemo.at > 30_000) affMemo = { at: Date.now(), map: affinity(state.wallet) };
  return affMemo.map;
}
function recCard(symbol, why) {
  const q = state.quotes.get(symbol);
  const info = catalogInfo(symbol);
  const whyText = why ? t(why.key, { what: why.what ? kindOrCat(why.what) : '' }) : '';
  return `<button class="q-rec" type="button" data-action="open" data-symbol="${h(symbol)}">
    ${whyText ? `<span class="q-rec-why">${h(whyText)}</span>` : ''}
    <p class="q-rec-title">${h(nameOf(symbol, q))}</p>
    <p class="q-rec-sub">${flagOf(symbol, q)} ${h(bareSymbol(symbol))}${info ? ` · ${h(L(CATEGORIES.find(c => c.id === info.category)))}` : ''}</p>
    <span class="q-rec-foot"><span class="q-rec-big">${q ? fmtPrice(q.price, q.currency) : '…'}</span>${pctPill(q)}</span>
    ${q ? `<span class="rec-spark">${sparkline(q.line, q.kind === 'crypto' ? null : q.prev, { width: 200, height: 30 })}</span>` : ''}
  </button>`;
}
const kindOrCat = id => {
  const cat = CATEGORIES.find(c => c.id === id);
  return cat ? L(cat) : t(`kind_${id}`);
};
function recRow(title, cards, { sub = '', cat = '' } = {}) {
  if (!cards.length) return '';
  return `<section class="q-section home-row">
    <div class="q-section-head"><h2>${h(title)}</h2>${cat ? `<button type="button" data-action="cat" data-id="${h(cat)}">${h(t('seeAll'))}</button>` : ''}</div>
    ${sub ? `<p class="row-sub-note">${h(sub)}</p>` : ''}
    <div class="q-recs">${cards.join('')}</div>
  </section>`;
}
// What can be bought right now: NT$-counted cash plus what margin lends.
function buyingPower(v) {
  const cashTWD = v.cash.reduce((sum, c) => sum + Math.max(0, c.twd || 0), 0);
  return Math.max(0, cashTWD + (v.margin === 'ok' ? v.capacity : 0));
}

// The markets home: your money at a glance, what's for you, today's movers.
// The full lists stay below, by category.
function renderHomeRows() {
  const box = $('home-rows');
  if (!box) return;
  if (state.query) return void (box.innerHTML = '');
  const held = Object.keys(snap()?.positions || {});
  const recs = forYou({ quotes: state.quotes, held, watched: watched(state.account), wallet: state.wallet, aff: affinityMap(), n: 10 });
  const v = state.account ? valuation() : null;
  const base = v ? v.netWorth - v.dayChange : 0;
  const summary = v
    ? `<button class="acct-strip" type="button" data-action="goto" data-tab="portfolio">
        <span class="acct-main"><small>${h(t('netWorth'))}${plusAt() ? ' <b class="acct-plus">✦ PLUS</b>' : ''}</small><strong class="num">${h(money(v.netWorth, BASE))}</strong></span>
        <span class="acct-day ${dirClass(v.dayChange)}"><small>${h(t('today'))}</small><strong class="num">${h(money(v.dayChange, BASE, { sign: true }))}</strong><em class="num">${base ? h(pct(v.dayChange / base)) : '—'}</em></span>
      </button>
      ${overdrawnBy(v) >= 1 ? `<button class="od-strip" type="button" data-action="goto" data-tab="portfolio">${h(t('odStrip', { v: money(overdrawnBy(v), BASE) }))} ›</button>` : `<div class="power-strip"><span>${h(t('buyingPower'))} <strong class="num">${h(money(buyingPower(v), BASE))}</strong></span></div>`}`
    : '';
  const moverRow = q => `<button class="mover" type="button" data-action="open" data-symbol="${h(q.symbol)}"><span class="mover-name">${h(nameOf(q.symbol, q))}</span><span class="mover-price num">${fmtPrice(q.price, q.currency)}</span>${pctPill(q)}</button>`;
  const up = movers(state.quotes, { up: true }).slice(0, 5);
  const down = movers(state.quotes, { up: false }).slice(0, 5);
  const moversHtml =
    up.length || down.length
      ? `<section class="q-section home-row"><div class="q-section-head"><h2>${h(t('moversTitle'))}</h2></div>
          <div class="movers">
            <div class="movers-col"><p class="movers-head">${h(t('moversUp'))}</p>${up.map(moverRow).join('') || `<p class="muted">—</p>`}</div>
            <div class="movers-col"><p class="movers-head">${h(t('moversDown'))}</p>${down.map(moverRow).join('') || `<p class="muted">—</p>`}</div>
          </div></section>`
      : '';
  box.innerHTML = [summary, recRow(t('forYou'), recs.map(r => recCard(r.symbol, r.why)), { sub: t('forYouSub') }), moversHtml].join('');
}

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

  renderHomeRows();
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
  // A long list opens on its first rows; the rest a tap away.
  const cap = state.listAll === state.category ? Infinity : LIST_SHOWN;
  const more = symbols.length - Math.min(cap, symbols.length);
  $('quote-list').innerHTML =
    (symbols.slice(0, cap).map(s => quoteRow(s)).join('') || `<p class="empty">${h(t('nothingHere'))}</p>`) +
    (more > 0 ? `<button class="list-more" type="button" data-action="list-all">${h(t('listAll', { n: symbols.length }))}</button>` : '');
}
const LIST_SHOWN = 15;

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
  track(null, symbolKeys(symbol), 1);
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

// Kinds with a company or fund behind them (P/E, holdings).
const ABOUT_KINDS = new Set(['stock', 'etf', 'bond', 'fund']);
async function loadAbout(symbol) {
  const q = state.quotes.get(symbol);
  if (!q || !ABOUT_KINDS.has(q.kind) || BONDS[symbol]) return;
  const have = state.about.get(symbol);
  if (have && (have.loading || Date.now() - have.at < 30 * 60_000)) return;
  state.about.set(symbol, { loading: true, at: Date.now() });
  const facts = await fetchFundamentals(symbol).catch(() => null);
  state.about.set(symbol, { loading: false, at: Date.now(), facts });
  if (state.detail?.symbol === symbol) refreshDetailLive();
  // What it does, in the reader's language (Yahoo writes it in English).
  if (facts?.summary && locale !== 'en') {
    const text = await translate(facts.summary, 'zh-TW', 'en');
    if (text !== facts.summary) {
      state.about.set(symbol, { ...state.about.get(symbol), summaryLocal: text });
      if (state.detail?.symbol === symbol) refreshDetailLive();
    }
  }
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
      <div class="price-meta">${marketStatus(q)}${q.marketTime ? ` · <span>${h(t('asOf', { time: dateTime(q.marketTime) }))}</span>` : ''} · ${delayOf(q.market) ? `<span class="delay-tag" title="${h(t('delayHelp'))}">${h(t('delayed', { n: delayOf(q.market) }))}</span>` : `<span class="delay-tag live" title="${h(t('liveHelp'))}">${h(t('livePrice'))}</span>`}</div>
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
    ...(holidayLine(q) ? [[t('holidaysNext'), holidayLine(q)]] : []),
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
    ...(q.session && holidayLine(q) ? [[t('holidaysNext'), holidayLine(q)]] : []),
    ...(isTradable(q.kind) ? [[t('costs'), feeSummary(q)]] : []),
    ...(isTradable(q.kind) ? [[t('rulesFact'), marketRules(q)]] : []),
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
  return [alertCardHtml(symbol, q), canPlan(q) ? planCardHtml(symbol, q) : ''].join('');
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
    ${'Notification' in window && !notifyOn() ? `<p class="note">${h(t('alertNotifyNote'))}</p>` : ''}`,
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
  if (!state.account) return;
  const price = Number(state.alertPrice);
  const r = setAlert(state.account, { symbol: d.symbol, op: price > q.price ? 'above' : 'below', price });
  if (r.error) return toast(t(`err_${r.error}`), 'bad');
  commit(r.account);
  state.alertPrice = '';
  toast(t('alertSet'), 'good');
  refreshDetailLive();
}

let planAddedAt = 0;
function addPlan() {
  const d = state.detail;
  const q = state.quotes.get(d.symbol);
  if (!state.account || Date.now() - planAddedAt < 2000) return;
  planAddedAt = Date.now();
  // The keyboard away, so the sheet redraws with the plan in place.
  document.activeElement?.blur?.();
  const r = setPlan(state.account, { symbol: d.symbol, amount: state.plan.amount, day: state.plan.day, name: q.name, kind: q.kind, market: q.market, currency: q.currency });
  if (r.error) return toast(t(`err_${r.error}`), 'bad');
  commit(r.account);
  // Rewards' mission: a monthly plan set up.
  track('plan', symbolKeys(d.symbol), 2);
  toast(t('planSet', { date: fmtDate(nextPlanRun(r.plan)) }), 'good');
  redrawDetail();
}

// ---- Detail sheet: what the company does, its numbers, news ------------------------

// Yahoo's sectors, in Chinese (by name and by fund-weighting id).
const SECTORS_ZH = {
  Technology: '科技', 'Financial Services': '金融', Healthcare: '醫療保健', 'Consumer Cyclical': '非必需消費', 'Consumer Defensive': '必需消費',
  'Communication Services': '通訊服務', Industrials: '工業', Energy: '能源', Utilities: '公用事業', 'Real Estate': '不動產', 'Basic Materials': '原物料'
};
const SECTOR_IDS = {
  technology: 'Technology', financial_services: 'Financial Services', healthcare: 'Healthcare', consumer_cyclical: 'Consumer Cyclical',
  consumer_defensive: 'Consumer Defensive', communication_services: 'Communication Services', industrials: 'Industrials', energy: 'Energy',
  utilities: 'Utilities', realestate: 'Real Estate', basic_materials: 'Basic Materials'
};
const sectorName = name => (locale === 'zh' ? SECTORS_ZH[name] || name : name);
const RATINGS = ['strong_buy', 'buy', 'hold', 'underperform', 'sell'];

// Big amounts, short: NT$64.18兆 / US$4.98T.
const compactMoney = (x, cur) => `${currencyInfo(cur).symbol || `${cur} `}${compact(x)}`;

function aboutHtml(symbol, q) {
  if (!ABOUT_KINDS.has(q.kind) || BONDS[symbol]) return '';
  const a = state.about.get(symbol);
  const fund = q.kind !== 'stock';
  const icon = fund ? '📦' : '🏢';
  const title = fund ? t('aboutFund') : t('aboutCompany');
  if (!a || a.loading) return fold(icon, title, `<p class="muted">${h(t('aboutLoading'))}</p>`, true, 'about');
  const f = a.facts;
  const body = !f ? `<p class="muted">${h(t('aboutNone'))}</p>` : fund ? fundAboutHtml(f, q) : stockAboutHtml(f, q);
  // In the reader's language once translated; the English original a tap away.
  const local = a.summaryLocal && locale !== 'en';
  const summary = f?.summary
    ? `<details class="summary-text"><summary>${h(t('whatItDoes'))}</summary>${local ? `<p>${h(a.summaryLocal)}</p><details class="summary-orig"><summary>${h(t('originalText'))}</summary><p lang="en">${h(f.summary)}</p></details>` : `<p lang="en">${h(f.summary)}</p>`}${f.website ? `<p><a href="${h(f.website)}" target="_blank" rel="noopener">${h(f.website.replace(/^https?:\/\//, ''))}</a></p>` : ''}</details>`
    : '';
  return fold(icon, title, `${body}${summary}<p class="note">${h(t('aboutSource'))}</p>`, true, 'about');
}

// One quick read: a label, a verdict and the number behind it.
const verdict = (label, word, tone, detail) => `<div class="verdict ${tone}"><span>${h(label)}</span><strong>${h(word)}</strong><small class="num">${h(detail)}</small></div>`;
const band = (x, lo, hi) => (x < lo ? 0 : x <= hi ? 1 : 2);

// A group of numbers, each with a line on what it means.
function factGroup(title, rows) {
  const list = rows.filter(([, v]) => v != null && v !== '');
  if (!list.length) return '';
  return `<h3 class="about-h">${h(title)}</h3><dl class="about-grid">${list.map(([k, v, e]) => `<div><dt>${h(t(k))}</dt><dd class="num">${h(v)}</dd>${e ? `<p>${h(t(e))}</p>` : ''}</div>`).join('')}</dl>`;
}

function stockAboutHtml(f, q) {
  const cur = f.currency || q.currency;
  const rc = f.reportCurrency || cur;
  const inTwd = (x, c) => (x != null && c !== BASE && state.rates[c] ? ` (≈ ${compactMoney(x * state.rates[c], BASE)})` : '');
  const pctOf = (x, digits = 1) => (x != null ? pct(x, { sign: false, digits }) : null);
  const profile = [
    f.sector ? `${sectorName(f.sector)}${f.industry ? ` · ${f.industry}` : ''}` : '',
    [f.city, f.country].filter(Boolean).join(', '),
    f.ceo ? t('ceoIs', { name: f.ceo }) : '',
    f.employees ? t('employeesN', { n: num(f.employees) }) : ''
  ].filter(Boolean);
  // The quick read.
  const v = [];
  if (f.pe > 0) v.push(verdict(t('vValue'), [t('vCheap'), t('vFair'), t('vPricey')][band(f.pe, 15, 30)], ['good', 'mid', 'warn'][band(f.pe, 15, 30)], `${t('peRatio')} ${num(f.pe, 1)}`));
  else if (f.eps != null && f.eps < 0) v.push(verdict(t('vValue'), t('vLoss'), 'warn', `EPS ${fmtPrice(f.eps, cur)}`));
  if (f.margin != null) v.push(verdict(t('vProfit'), f.margin < 0 ? t('vLoss') : [t('vThin'), t('vOk'), t('vStrong')][band(f.margin, 0.05, 0.2)], f.margin < 0 ? 'warn' : ['warn', 'mid', 'good'][band(f.margin, 0.05, 0.2)], `${t('profitMargin')} ${pctOf(f.margin)}`));
  if (f.growth != null) v.push(verdict(t('vGrowth'), f.growth < 0 ? t('vShrinking') : f.growth > 0.15 ? t('vFast') : t('vSteady'), f.growth < 0 ? 'warn' : f.growth > 0.15 ? 'good' : 'mid', `${t('revenueGrowth')} ${pct(f.growth, { digits: 1 })}`));
  v.push(verdict(t('vDividend'), !f.dividendYield ? t('vNoDiv') : [t('vSmallDiv'), t('vSomeDiv'), t('vHighDiv')][band(f.dividendYield, 0.01, 0.04)], !f.dividendYield ? 'info' : ['info', 'mid', 'good'][band(f.dividendYield, 0.01, 0.04)], `${t('divYield')} ${pctOf(f.dividendYield || 0, 2)}`));
  if (f.debtToEquity != null || (f.cash != null && f.debt != null)) {
    const netCash = f.cash != null && f.debt != null && f.cash >= f.debt;
    const b = f.debtToEquity != null ? band(f.debtToEquity, 50, 150) : 1;
    v.push(verdict(t('vBalance'), netCash ? t('vNetCash') : [t('vSolid'), t('vOk'), t('vHeavy')][b], netCash || b === 0 ? 'good' : b === 1 ? 'mid' : 'warn', f.debtToEquity != null ? `${t('debtToEquity')} ${num(f.debtToEquity, 0)}%` : ''));
  }
  if (f.beta != null) v.push(verdict(t('vRisk'), [t('vCalm'), t('vMarket'), t('vWild')][band(f.beta, 0.8, 1.3)], ['good', 'mid', 'warn'][band(f.beta, 0.8, 1.3)], `Beta ${num(f.beta, 2)}`));
  const quick = v.length ? `<div class="verdicts">${v.join('')}</div><p class="note">${h(t('verdictNote'))}</p>` : '';
  // Coming up.
  const now = Date.now();
  const soon = [
    f.earningsDate > now - 86_400_000 ? `📣 ${t('nextEarnings', { date: fmtDate(f.earningsDate) })}` : '',
    f.exDividendDate > now - 86_400_000 ? `💰 ${t('nextExDiv', { date: fmtDate(f.exDividendDate) })}` : ''
  ].filter(Boolean);
  return `
    ${profile.length ? `<p class="about-profile">${profile.map(x => `<span>${h(x)}</span>`).join('')}</p>` : ''}
    ${quick}
    ${soon.length ? `<ul class="about-soon">${soon.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
    ${financialsHtml(f, rc)}
    ${targetHtml(f, q)}
    ${factGroup(t('gValue'), [
      ['marketCap', f.marketCap != null ? compactMoney(f.marketCap, cur) + inTwd(f.marketCap, cur) : null, 'marketCapHelp'],
      ['peRatio', f.pe != null ? num(f.pe, 1) : null, 'peHelp'],
      ['forwardPe', f.forwardPe != null ? num(f.forwardPe, 1) : null, 'forwardPeHelp'],
      ['eps', f.eps != null ? `${fmtPrice(f.eps, cur)} ${cur}` : null, 'epsHelp'],
      ['pbRatio', f.pb != null ? num(f.pb, 2) : null, 'pbHelp']
    ])}
    ${factGroup(t('gProfit'), [
      ['grossMargin', pctOf(f.grossMargin), 'grossMarginHelp'],
      ['operatingMargin', pctOf(f.operatingMargin), 'operatingMarginHelp'],
      ['profitMargin', pctOf(f.margin), 'profitMarginHelp'],
      ['roe', pctOf(f.roe), 'roeHelp'],
      ['revenueGrowth', f.growth != null ? pct(f.growth, { digits: 1 }) : null, 'revenueGrowthHelp'],
      ['earningsGrowth', f.earningsGrowth != null ? pct(f.earningsGrowth, { digits: 1 }) : null, 'earningsGrowthHelp']
    ])}
    ${factGroup(t('gDividend'), [
      ['divYield', f.dividendYield != null ? pctOf(f.dividendYield, 2) : null, 'divYieldHelp'],
      ['dividendRate', f.dividendRate ? `${fmtPrice(f.dividendRate, cur)} ${cur}` : null, 'dividendRateHelp'],
      ['payoutRatio', f.payoutRatio ? pctOf(f.payoutRatio, 0) : null, 'payoutRatioHelp'],
      ['avgYield5', f.avgYield5 ? pctOf(f.avgYield5, 2) : null, 'avgYield5Help']
    ])}
    ${factGroup(t('gBalance'), [
      ['cashHeld', f.cash != null ? compactMoney(f.cash, rc) : null, 'cashHeldHelp'],
      ['debtOwed', f.debt != null ? compactMoney(f.debt, rc) : null, 'debtOwedHelp'],
      ['debtToEquity', f.debtToEquity != null ? `${num(f.debtToEquity, 0)}%` : null, 'debtToEquityHelp'],
      ['freeCashflow', f.freeCashflow != null ? compactMoney(f.freeCashflow, rc) : null, 'freeCashflowHelp']
    ])}
    ${factGroup(t('gRisk'), [
      ['change52', f.change52 != null ? `${pct(f.change52, { digits: 1 })}${f.sp52 != null ? ` · ${t('vsSp', { pct: pct(f.sp52, { digits: 1 }) })}` : ''}` : null, 'change52Help'],
      ['beta', f.beta != null ? num(f.beta, 2) : null, 'betaHelp']
    ])}`;
}

// Revenue and profit over the last four years (or quarters).
function financialsHtml(f, rc) {
  const quarterly = state.aboutPeriod === 'quarter' && f.quarterly.length;
  const rows = quarterly ? f.quarterly : f.yearly;
  if (rows.length < 2) return '';
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 22, b: 26 };
  const max = Math.max(...rows.flatMap(r => [r.revenue, r.earnings || 0]), 1);
  const min = Math.min(0, ...rows.map(r => r.earnings || 0));
  const Y = x => pad.t + ((max - x) / (max - min)) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / rows.length;
  const bw = Math.min(40, slot * 0.32);
  const bars = rows
    .map((r, i) => {
      const x = pad.l + slot * i + slot / 2;
      const rev = `<rect class="fin-rev" x="${x - bw - 2}" y="${Y(r.revenue)}" width="${bw}" height="${Y(0) - Y(r.revenue)}" rx="3"/><text class="fin-label" x="${x - bw / 2 - 2}" y="${Y(r.revenue) - 5}" text-anchor="middle">${h(compact(r.revenue))}</text>`;
      const e = r.earnings || 0;
      const earn = `<rect class="fin-earn${e < 0 ? ' neg' : ''}" x="${x + 2}" y="${Math.min(Y(e), Y(0))}" width="${bw}" height="${Math.abs(Y(0) - Y(e))}" rx="3"/><text class="fin-label" x="${x + bw / 2 + 2}" y="${(e < 0 ? Y(e) + 12 : Y(e) - 5)}" text-anchor="middle">${h(compact(e))}</text>`;
      return `${rev}${earn}<text class="axis-label" x="${x}" y="${H - 8}" text-anchor="middle">${h(r.label)}</text>`;
    })
    .join('');
  const first = rows[0];
  const last = rows.at(-1);
  const growth = first.revenue > 0 ? last.revenue / first.revenue - 1 : null;
  return `<div class="about-fin">
    <div class="card-head"><h3 class="about-h">📊 ${h(t('finTitle'))} <small>(${h(rc)})</small></h3>
      ${f.quarterly.length ? `<div class="segmented small" role="group"><button type="button" data-action="about-period" data-v="year" aria-pressed="${!quarterly}">${h(t('finYear'))}</button><button type="button" data-action="about-period" data-v="quarter" aria-pressed="${Boolean(quarterly)}">${h(t('finQuarter'))}</button></div>` : ''}
    </div>
    <ul class="legend-inline"><li><i class="sw fin-rev"></i>${h(t('finRevenue'))}</li><li><i class="sw fin-earn"></i>${h(t('finEarnings'))}</li></ul>
    <svg class="chart-svg fin-chart" viewBox="0 0 ${W} ${H}" role="img"><line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>${bars}</svg>
    ${growth != null ? `<p class="note">${h(t(quarterly ? 'finGrowthQ' : 'finGrowthY', { from: first.label, to: last.label, pct: pct(growth, { digits: 0 }) }))}</p>` : ''}
  </div>`;
}

// What analysts expect the price to be in a year, against today's.
function targetHtml(f, q) {
  const tg = f.target;
  if (!tg?.mean || !tg.low || !tg.high || !(q.price > 0)) return '';
  const lo = Math.min(tg.low, q.price);
  const hi = Math.max(tg.high, q.price);
  const x = v => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  const cur = q.currency;
  const rating = RATINGS.includes(tg.rating) ? t(`rating_${tg.rating}`) : null;
  return `<div class="about-target">
    <h3 class="about-h">🎯 ${h(t('targetTitle'))}</h3>
    <p>${h(t('targetLine', { n: tg.analysts || '?', mean: fmtPrice(tg.mean, cur), pct: pct(tg.mean / q.price - 1, { digits: 0 }) }))}${rating ? ` · ${h(t('ratingIs', { rating }))}` : ''}</p>
    <div class="target-bar"><span class="target-range" style="left:${x(tg.low)};right:calc(100% - ${x(tg.high)})"></span><i class="target-mean" style="left:${x(tg.mean)}" title="${h(t('targetMean'))}"></i><i class="target-now" style="left:${x(q.price)}" title="${h(t('targetNow'))}"></i></div>
    <div class="target-scale num"><span>${h(t('targetLow'))} ${h(fmtPrice(tg.low, cur))}</span><span>${h(t('targetNow'))} ${h(fmtPrice(q.price, cur))}</span><span>${h(t('targetHigh'))} ${h(fmtPrice(tg.high, cur))}</span></div>
  </div>`;
}

function fundAboutHtml(f, q) {
  const cur = f.currency || q.currency;
  const sizeTwd = f.totalAssets != null ? f.totalAssets * (cur === BASE ? 1 : state.rates[cur] || 0) : null;
  const top = f.holdings?.[0]?.weight || 0;
  const top10 = (f.holdings || []).reduce((sum, x) => sum + x.weight, 0);
  const v = [];
  if (f.expenseRatio != null) v.push(verdict(t('vCost'), f.expenseRatio < 0.002 ? t('vVeryCheap') : f.expenseRatio < 0.006 ? t('vOk') : t('vPricey'), f.expenseRatio < 0.002 ? 'good' : f.expenseRatio < 0.006 ? 'mid' : 'warn', `${t('expenseRatio')} ${pct(f.expenseRatio, { sign: false, digits: 2 })}`));
  if (sizeTwd) v.push(verdict(t('vSize'), sizeTwd > 3e10 ? t('vBig') : sizeTwd > 3e9 ? t('vMid') : t('vSmall'), sizeTwd > 3e10 ? 'good' : sizeTwd > 3e9 ? 'mid' : 'warn', compactMoney(sizeTwd, BASE)));
  if (f.holdings?.length) v.push(verdict(t('vSpread'), top > 0.3 || top10 > 0.65 ? t('vConcentrated') : t('vDiversified'), top > 0.3 || top10 > 0.65 ? 'warn' : 'good', t('top10Share', { pct: pct(top10, { sign: false, digits: 0 }) })));
  v.push(verdict(t('vDividend'), !f.dividendYield ? t('vNoDiv') : [t('vSmallDiv'), t('vSomeDiv'), t('vHighDiv')][band(f.dividendYield, 0.01, 0.04)], !f.dividendYield ? 'info' : ['info', 'mid', 'good'][band(f.dividendYield, 0.01, 0.04)], `${t('divYield')} ${pct(f.dividendYield || 0, { sign: false })}`));
  const returns = [
    ['retYtd', f.ytd],
    ['ret3y', f.return3y],
    ['ret5y', f.return5y]
  ].filter(([, x]) => x != null);
  const sectors = f.sectors?.length
    ? `<h3 class="about-h">🧩 ${h(t('sectorMix'))}</h3>${stackBar(
        (f.sectors.length > 8 ? [...f.sectors.slice(0, 7), { id: 'others', weight: f.sectors.slice(7).reduce((sum, x) => sum + x.weight, 0) }] : f.sectors).map((x, i) => ({
          label: x.id === 'others' ? t('others') : sectorName(SECTOR_IDS[x.id] || x.id),
          value: x.weight,
          color: SERIES[i]
        })),
        { format: () => '' }
      )}`
    : '';
  const mix = f.mix && (f.mix.bond > 0.02 || f.mix.cash > 0.02) ? `<p class="muted">${h(t('assetMix', { stock: pct(f.mix.stock, { sign: false, digits: 0 }), bond: pct(f.mix.bond, { sign: false, digits: 0 }), cash: pct(f.mix.cash, { sign: false, digits: 0 }) }))}</p>` : '';
  const holdings = f.holdings?.length
    ? `<h3 class="about-h">🏆 ${h(t('topHoldings'))}</h3><ul class="bars-list holdings">${f.holdings
        .map(x => `<li><button class="link bar-label" type="button" data-action="open" data-symbol="${h(x.symbol)}">${h(catalogInfo(x.symbol) ? nameOf(x.symbol) : x.name)}</button><span class="bar-track"><span class="bar flat" style="width:${Math.min(100, (x.weight / f.holdings[0].weight) * 100)}%"></span></span><strong class="num">${h(pct(x.weight, { sign: false, digits: 1 }))}</strong></li>`)
        .join('')}</ul><p class="note">${h(t('topHoldingsNote', { pct: pct(top10, { sign: false, digits: 0 }) }))}</p>`
    : '';
  const profile = [f.family, f.category, f.inception ? t('since', { date: fmtDate(f.inception) }) : ''].filter(Boolean);
  return `
    ${profile.length ? `<p class="about-profile">${profile.map(x => `<span>${h(x)}</span>`).join('')}</p>` : ''}
    ${v.length ? `<div class="verdicts">${v.join('')}</div><p class="note">${h(t('verdictNote'))}</p>` : ''}
    ${returns.length ? `<div class="kpis about-returns">${returns.map(([k, x]) => kpi(t(k), pct(x, { digits: 1 }), '', dirClass(x))).join('')}</div>` : ''}
    ${sectors}${mix}${holdings}
    ${factGroup(t('gFund'), [
      ['expenseRatio', f.expenseRatio != null ? pct(f.expenseRatio, { sign: false, digits: 2 }) : null, 'expenseRatioHelp'],
      ['fundSize', f.totalAssets != null ? compactMoney(f.totalAssets, cur) + (sizeTwd && cur !== BASE ? ` (≈ ${compactMoney(sizeTwd, BASE)})` : '') : null, 'fundSizeHelp'],
      ['divYield', f.dividendYield != null ? pct(f.dividendYield, { sign: false }) : null, 'divYieldHelp'],
      ['peRatio', f.pe != null ? num(f.pe, 1) : null, 'peFundHelp'],
      ['beta', f.beta != null ? num(f.beta, 2) : null, 'betaHelp']
    ])}`;
}

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
  // What it fills at: a limit at its price; a market (or triggered stop)
  // order at the ask to buy or the bid to sell.
  const last = d.type === 'stop' ? (d.side === 'buy' ? Math.max(Number(d.stop), q.price) : Number(d.stop)) || q.price : q.price;
  const ref = d.type === 'limit' ? Number(d.limit) : marketFill(q.market, q.kind, d.side, last);
  const est = qty > 0 && ref > 0 ? estimate({ market: q.market, kind: q.kind, currency: q.currency, side: d.side, qty, price: ref }) : null;
  const cash = Math.max(0, avail.cash[q.currency] || 0);
  const shares = Math.max(0, avail.qty[d.symbol] || 0);
  // Largest quantity whose held amount fits the cash, NT$ that could be
  // exchanged for it included.
  const fromTwd = q.currency !== BASE && state.rates[q.currency] ? quoteExchange(BASE, q.currency, Math.max(0, avail.cash[BASE] || 0), state.rates, state.fxOpen)?.received || 0 : 0;
  const spendable = cash + fromTwd;
  const holdFor = n => requiredCash({ type: d.type, qty: n, limit: Number(d.limit), stop: Number(d.stop) }, q, Date.now()).reserve;
  let max = 0;
  if (ref > 0) {
    const step = qtyStep(q.kind);
    const perUnit = dealPrice(q.market, 'buy', ref) * (1 + ((MARKETS[q.market] || MARKETS.INTL).commission.rate || 0) + 0.006) * 1.03;
    max = roundQty(spendable / perUnit, q.kind);
    while (max > 0 && holdFor(max) > spendable) max = roundQty(max - (step >= 1 ? 1 : max * 0.001), q.kind);
  }
  // Exactly what the order will hold (placeOrder checks the same figure):
  // the estimate, plus a 3% buffer when it has to wait for its market.
  const req = d.side === 'buy' && est ? requiredCash({ type: d.type, qty, limit: Number(d.limit), stop: Number(d.stop) }, q, Date.now()) : null;
  const need = req ? req.reserve : 0;
  const short = d.side === 'buy' && est ? Math.max(0, need - cash) : 0;
  // Short of this currency but holding NT$: the exchange that covers it
  // (spread included), done with the order in one tap.
  let topUp = null;
  if (short > 0 && q.currency !== BASE && state.rates[q.currency]) {
    const pay = amountFor(BASE, q.currency, short, state.rates, state.fxOpen);
    if (pay) topUp = { need: pay, get: short, enough: (avail.cash[BASE] || 0) >= pay, have: avail.cash[BASE] || 0 };
  }
  // Still short (or buying in NT$): borrow it on margin, in the order's
  // currency, done with the order in one tap. Also how big a buy margin allows.
  const v0 = d.side === 'buy' ? valuation() : null;
  const rateCur = q.currency === BASE ? 1 : state.rates[q.currency];
  const capCur = v0 && v0.margin === 'ok' && rateCur ? (v0.capacity / rateCur) * 0.98 : 0;
  const marginBuy = short > 0 && !topUp?.enough && capCur >= short ? { amount: Math.min(capCur, short * 1.01), rate: loanRateAt(q.currency) } : null;
  let maxMargin = 0;
  if (d.side === 'buy' && capCur > 0 && ref > 0) {
    const perUnit = dealPrice(q.market, 'buy', ref) * (1 + ((MARKETS[q.market] || MARKETS.INTL).commission.rate || 0) + 0.006) * 1.03;
    maxMargin = roundQty((Math.max(0, cash) + capCur) / perUnit, q.kind);
  }
  // How much can be sold short on top of what's held.
  let shortRoom = 0;
  if (d.side === 'sell' && isShortable(q.kind) && state.rates[q.currency]) {
    const v = valuation();
    const room = Math.max(0, (v.assets - 1.5 * (v.debtTWD + v.shortTWD)) / 0.5);
    shortRoom = v.margin === 'ok' ? roundQty(room / (q.price * state.rates[q.currency]), q.kind) : 0;
  }
  return { q, est, cash, shares, max, short, topUp, qty, ref, last, shortRoom, req, need, marginBuy, maxMargin };
}

function renderTicket() {
  const box = $('ticket');
  const d = state.detail;
  if (!box || !d) return;
  if (!state.account) {
    box.innerHTML = `<div class="card ticket"><p>${h(t('needAccount'))}</p><div class="spinner"></div></div>`;
    return;
  }
  const { q, est, cash, shares, max, short, topUp, qty, ref, last, shortRoom, req, need, marginBuy, maxMargin } = ticketInfo();
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
  // Board-lot markets: sizes in whole lots.
  const lot = lotSize(q.market, q.symbol, q.kind);
  if (lot > 1) {
    const lots = n => [t('lotsN', { n }), n * lot];
    presets.splice(0, presets.length, ...(d.side === 'sell' ? [[t('all'), roundQty(shares, q.kind)], lots(1)] : [[t('max'), Math.floor(max / lot) * lot], lots(1), lots(5), lots(10)]));
  }
  // With margin room: the most a buy can be, borrowing the rest.
  if (d.side === 'buy' && q.kind !== 'govbond' && maxMargin > max) presets.splice(1, 0, [t('maxMargin'), maxMargin]);
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
  if (short > 0 && !topUp?.enough && !marginBuy) problems.push(t('notEnoughCash', { cur: q.currency, have: money(cash, q.currency), short: money(short, q.currency) }));
  if (d.qty && Math.abs(roundQty(qty, q.kind) - qty) > qtyStep(q.kind) * 1e-3) problems.push(t('err_qtyStep'));
  // The exchange's rules for the price typed.
  const typed = d.type === 'limit' ? Number(d.limit) : d.type === 'stop' ? Number(d.stop) : null;
  const band = priceLimits(q);
  if (typed > 0) {
    const tick = tickSize(q.market, q.kind, typed);
    if (!onTick(typed, tick)) problems.push(t('err_tick', { tick: num(tick, 4, 0) }));
    else if (band && d.type === 'limit' && (typed > band.up + 1e-9 || typed < band.down - 1e-9)) problems.push(t('err_priceLimit', { down: fmtPrice(band.down, q.currency), up: fmtPrice(band.up, q.currency) }));
  }
  const canPlace = est && !problems.length && !(short > 0);
  const rate = state.rates[q.currency];
  box.innerHTML = `<div class="card ticket">
    <div class="ticket-top">
      <div class="segmented side-toggle" role="group">
        <button type="button" data-action="side" data-side="buy" class="buy" aria-pressed="${d.side === 'buy'}">${h(t('buy'))}</button>
        <button type="button" data-action="side" data-side="sell" class="sell" aria-pressed="${d.side === 'sell'}">${h(t('sell'))}</button>
      </div>
      <div class="segmented" role="group">${['market', 'limit', 'stop'].map(x => `<button type="button" data-action="otype" data-otype="${x}" aria-pressed="${d.type === x}">${h(t(`otype_${x}`))}</button>`).join('')}</div>
      ${d.type !== 'market' && q.kind !== 'crypto' && q.kind !== 'fx' ? `<div class="segmented tif" role="group">${['day', 'gtc'].map(x => `<button type="button" data-action="tif" data-tif="${x}" aria-pressed="${(d.tif || 'day') === x}">${h(t(`tif_${x}`, { n: GTC_DAYS }))}</button>`).join('')}</div>` : ''}
    </div>
    <p class="note">${h(typeHint)}</p>
    <div class="ticket-fields">
      <label class="field"><span>${h(t('quantity'))} (${h(unit)})</span><input id="t-qty" inputmode="decimal" autocomplete="off" value="${h(d.qty)}" placeholder="0" /></label>
      ${d.type === 'limit' ? `<label class="field"><span>${h(t('limitPrice'))} (${h(q.currency)})</span><input id="t-limit" inputmode="decimal" autocomplete="off" value="${h(d.limit)}" /></label>` : ''}
      ${d.type === 'stop' ? `<label class="field"><span>${h(t('stopPrice'))} (${h(q.currency)})</span><input id="t-stop" inputmode="decimal" autocomplete="off" value="${h(d.stop)}" /></label>` : ''}
    </div>
    <div class="qty-presets">${presets.filter(([, v]) => v > 0).map(([label, v]) => `<button class="chip small" type="button" data-action="qty" data-qty="${v}">${h(label)}${label === t('max') || label === t('all') || label === t('maxMargin') ? ` <small>${h(fmtQty(v))}</small>` : ''}</button>`).join('')}</div>
    ${d.type !== 'market' && (band || tickSize(q.market, q.kind, q.price)) ? `<p class="muted">${h([band ? t('limitBand', { down: fmtPrice(band.down, q.currency), up: fmtPrice(band.up, q.currency) }) : '', tickSize(q.market, q.kind, q.price) ? t('tickIs', { tick: num(tickSize(q.market, q.kind, q.price), 4, 0) }) : ''].filter(Boolean).join(' · '))}</p>` : ''}
    <p class="muted">${h(d.side === 'buy' ? t('cashAvail', { amount: money(cash, q.currency) }) : t('sharesAvail', { qty: fmtQty(shares), unit }))}${q.market === 'TW' && q.kind !== 'metal' ? ` · ${h(t('lotNote'))}` : ''}</p>
    ${
      est
        ? `<dl class="preview">${lines.map(([k, v]) => `<div><dt>${h(k)}</dt><dd class="num">${h(v)}</dd></div>`).join('')}
        <div class="preview-total"><dt>${h(d.side === 'buy' ? t('totalCost') : t('totalProceeds'))}</dt><dd class="num"><strong>${h(money(est.total, q.currency))}</strong>${rate && q.currency !== BASE ? `<small>≈ ${h(money(est.total * rate, BASE))}</small>` : ''}</dd></div>
        ${req && req.buffer > 0 ? `<div class="preview-held"><dt>${h(t('heldUntilFill'))}<small>${h(t('bufferNote'))}</small></dt><dd class="num"><strong>${h(money(need, q.currency))}</strong></dd></div>` : ''}
        ${d.side === 'buy' ? `<div class="preview-have ${short > 0 ? 'short' : ''}"><dt>${h(t('youHave', { amount: '' }).trim())}</dt><dd class="num">${h(money(cash, q.currency))}</dd></div>` : ''}</dl>
        ${est.commission && !plusAt() ? `<button class="q-plus-hint fee-plus" type="button" data-action="plus">${h(t('feePlus', { v: money(q.market === 'TW' ? Math.floor(est.commission * PLUS.stock.commission) : est.commission * PLUS.stock.commission, q.currency) }))}</button>` : ''}`
        : ''
    }
    ${shorting && isShortable(q.kind) && !problems.length ? `<p class="note">${h(t('shortNote', { qty: fmtQty(qty - shares), unit, fee: rateText(SHORT_FEE) }))}</p>` : ''}
    ${problems.map(p => `<p class="warn">${h(p)}</p>`).join('')}
    ${topUp?.enough ? `<p class="note">${h(t('autoFxLine', { pay: money(topUp.need, BASE), get: money(topUp.get, q.currency) }))}</p>` : ''}
    ${marginBuy ? `<p class="note margin-line">${h(t('marginLine', { v: money(marginBuy.amount, q.currency), rate: pct(marginBuy.rate, { digits: 2, sign: false }) }))}</p>` : ''}
    ${!open ? `<p class="note">${h(q.kind === 'metal' ? t('closedMetal') : t('closedQueue'))}</p>` : ''}
    ${qty > 0 && isOddLot(q.market, q.kind, qty) ? `<p class="note">${h(open && !oddLotOpen(Date.now()) ? t('oddLotWait') : t('oddLotNote'))}</p>` : ''}
    ${d.type !== 'limit' && est ? `<p class="note">${h(t('spreadNote', { price: fmtPrice(ref, q.currency), last: fmtPrice(last, q.currency) }))}</p>` : ''}
    ${pricesLive() ? '' : `<p class="warn">${h(t('waitLive'))}</p>`}
    ${
      topUp?.enough && est && !problems.length
        ? `<button class="primary-button place ${d.side}" type="button" data-action="place-fx" data-need="${topUp.need}" ${pricesLive() ? '' : 'disabled'}>${h(t('autoFx'))}</button>`
        : marginBuy && est && !problems.length
        ? `<button class="primary-button place ${d.side}" type="button" data-action="place-margin" data-amount="${marginBuy.amount}" ${pricesLive() ? '' : 'disabled'}>${h(t('marginBuy'))}</button>`
        : `<button class="primary-button place ${d.side}" type="button" data-action="place" ${canPlace && pricesLive() ? '' : 'disabled'}>${h(d.side === 'buy' ? t('placeBuy') : t('placeSell'))}</button>`
    }
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
  if (d.type !== 'market' && d.tif === 'gtc') req.tif = 'gtc';
  const r = placeOrder(state.account, req, { quote: q, rates: state.rates, valuation: valuation(), now: Date.now() });
  if (r.error && !r.account) {
    d.msg = { kind: 'bad', text: errorText(r) };
  } else {
    commit(r.account);
    track('trade', symbolKeys(d.symbol), 3);
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
    case 'unsettled':
      return t('err_unsettled', { have: money(r.have ?? 0, r.currency || BASE) });
    case 'tick':
      return t('err_tick', { tick: num(r.tick, 4, 0) });
    case 'priceLimit': {
      const cur = state.quotes.get(state.detail?.symbol)?.currency || BASE;
      return t('err_priceLimit', { down: fmtPrice(r.down, cur), up: fmtPrice(r.up, cur) });
    }
    case 'lot':
      return t('err_lot', { lot: fmtQty(r.lot) });
    case 'tPlus1':
      return t('err_tPlus1', { can: fmtQty(r.can) });
    default:
      return t(`err_${r.error}`);
  }
}

// ---- Portfolio tab ----------------------------------------------------------------------

// NT$ cash below zero: the Quadra pool is overdrawn (1% a month, charged by
// the Worker). What it takes to cover it, and the sales that would.
const overdrawnBy = v => Math.max(0, -(v.cash.find(c => c.currency === BASE)?.amount ?? 0));
function overdraftHtml(v) {
  const owed = overdrawnBy(v);
  if (owed < 1) return '';
  const { plan, covered } = coverPlan(v, owed);
  const rows = plan.map(x => `<li><span>${h(nameOf(x.symbol))}</span><span class="num">${h(t('coverSell', { qty: fmtQty(x.qty) }))}${x.all ? ` · ${h(t('coverAll'))}` : ''}</span><strong class="num">≈ ${h(money(x.twd, BASE))}</strong></li>`).join('');
  return `<div class="card overdraft-card">
    <div class="od-head"><strong>${h(t('odTitle', { v: money(owed, BASE) }))}</strong><small>${h(t('odSub'))}</small></div>
    ${plan.length ? `<ul class="od-plan">${rows}</ul><button class="primary-button block" type="button" data-action="cover" ${pricesLive() ? '' : 'disabled'}>${h(t(covered ? 'coverGo' : 'coverGoPart'))}</button>` : `<p class="note">${h(t('odNothing'))}</p>`}
  </div>`;
}

function renderPortfolio() {
  const box = $('portfolio-body');
  if (!state.account) {
    box.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
    return;
  }
  const v = valuation();
  const s = snap();
  const incomplete = v.missingRates.length || !state.loaded;
  const open = state.account.orders.filter(o => o.status === 'open');
  const avail = available(state.account, s);
  const unsettledNow = unsettled(state.account);
  // Money held for open buy orders isn't spendable, so cash shows without it.
  const heldFor = c => Math.max(0, c.amount - (avail.cash[c.currency] ?? c.amount));
  const heldTWD = v.cash.reduce((sum, c) => sum + (c.amount ? (heldFor(c) / c.amount) * c.twd : 0), 0);
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
        <span>${h(t('cash'))} <strong class="num">${h(money(v.cashTWD - heldTWD, BASE))}</strong></span>
        ${heldTWD > 0.5 ? `<span>${h(t('openOrders'))} <strong class="num">${h(money(heldTWD, BASE))}</strong></span>` : ''}
        <span>${h(t('holdings'))} <strong class="num">${h(money(v.longTWD, BASE))}</strong></span>
        ${v.receivable > 0 ? `<span>${h(t('pendingDivTitle'))} <strong class="num">${h(money(v.receivable, BASE))}</strong></span>` : ''}
        ${v.shortTWD > 0 ? `<span>${h(t('shorts'))} <strong class="num">−${h(money(v.shortTWD, BASE))}</strong></span>` : ''}
        ${v.debtTWD > 0 ? `<span>${h(t('loans'))} <strong class="num">−${h(money(v.debtTWD, BASE))}</strong></span>` : ''}
      </div>
      <p class="hero-payday">💵 ${h(t('nextPayday', { amount: money(paydayFor(state.wallet), BASE), date: fmtDate(nextPayday(Date.now())) }))}</p>
      <div class="button-row hero-actions">
        <button class="hero-button" type="button" data-action="goto" data-tab="markets">${h(t('goTrade'))}</button>
        <button class="hero-button" type="button" data-action="goto" data-tab="fx">${h(t('goFx'))}</button>
      </div>
    </div>
    ${overdraftHtml(v)}
    ${plusAt() ? '' : '<div id="plus-slot" class="plus-slot"></div>'}
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
      ${v.positions.length ? `<div class="positions">${v.positions.map(positionRow).join('')}</div>` : `<div class="empty">${h(t('noPositions'))}<div class="button-row center"><button class="ghost-button" type="button" data-action="goto" data-tab="markets">${h(t('goTrade'))}</button></div></div>`}
    </div>
    ${open.length ? `<div class="card"><h3 class="card-title">${h(t('openOrders'))} <span class="count">${open.length}</span></h3>${open.map(orderRow).join('')}</div>` : ''}
    ${cashCardHtml(v, heldTWD, unsettledNow, heldFor)}
    ${incomeCardHtml(v)}
    ${plansListHtml()}
    ${alertsListHtml()}
  `;
  $('plus-slot')?.append(plusCard(q));
  renderNetWorthChart(v, s);
}

// Cash: what's spendable now, what's held for orders or still settling, and
// each currency's wallet. The NT$ wallet is the Quadra balance itself.
function cashCardHtml(v, heldTWD, unsettledNow, heldFor) {
  const settlingTWD = Object.entries(unsettledNow).reduce((sum, [c, x]) => sum + x * (state.rates[c] ?? 0), 0);
  const free = v.cashTWD - heldTWD;
  const settleAt = settlesBy(state.account);
  return `<div class="card cash-card">
    <div class="card-head"><h3 class="card-title">💵 ${h(t('wallets'))}</h3><strong class="num cash-total">${h(money(free, BASE))}</strong></div>
    <div class="cash-chips">
      ${heldTWD > 0.5 ? `<span class="cash-chip"><small>${h(t('cashHeld'))}</small><strong class="num">${h(money(heldTWD, BASE))}</strong></span>` : ''}
      ${settlingTWD > 0.5 ? `<span class="cash-chip"><small>${h(t('cashSettling'))}</small><strong class="num">${h(money(settlingTWD, BASE))}</strong></span>` : ''}
      <span class="cash-chip"><small>${h(t('cashInterestRate'))}</small><strong class="num">${h(pct(CASH_RATE, { digits: 2, sign: false }))}</strong></span>
    </div>
    <div class="wallets">${v.cash.map(c => walletRow(c, heldFor(c), unsettledNow[c.currency] || 0, settleAt[c.currency])).join('')}${v.loans.map(loanWalletRow).join('')}</div>
    <p class="note">${h(t('poolNote'))}</p>
  </div>`;
}

// Income: dividends, coupons and cash interest over the last year, month by
// month, and what's on the way.
function incomeCardHtml(v) {
  const inc = incomeSummary(state.account);
  const list = pendingDividends(state.account);
  if (!inc.total && !list.length) return '';
  const yieldPct = v.longTWD > 0 ? inc.last12 / v.longTWD : 0;
  const top = Object.entries(inc.payers).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parts = [['incomeDiv', inc.div], ['incomeCoupon', inc.coupon], ['incomeInterest', inc.interest]].filter(([, x]) => x >= 0.5);
  return `<div class="card income-card">
    <div class="card-head"><h3 class="card-title">💰 ${h(t('incomeTitle'))}</h3></div>
    <div class="kpis">
      ${kpi(t('income12'), money(inc.last12, BASE), yieldPct ? t('incomeYield', { pct: pct(yieldPct, { digits: 2, sign: false }) }) : '')}
      ${kpi(t('incomeYtd'), money(inc.ytd, BASE))}
      ${inc.pending >= 0.5 ? kpi(t('pendingDivTitle'), money(inc.pending, BASE), '', 'up') : ''}
    </div>
    ${miniBars(inc.months, { format: x => money(x, BASE) })}
    ${inc.last12 ? `<div class="mini-bars-scale"><span>${h(monthYear(Date.parse(`${inc.months[0][0]}-15`)))}</span><span>${h(monthYear(Date.now()))}</span></div>` : ''}
    ${parts.length ? `<p class="income-split">${parts.map(([k, x]) => `<span>${h(t(k))} <strong class="num">${h(money(x, BASE))}</strong></span>`).join('')}</p>` : ''}
    ${top.length ? `<p class="muted">${h(t('incomeTop'))} ${top.map(([sym, x]) => `<button class="link" type="button" data-action="open" data-symbol="${h(sym)}">${h(nameOf(sym))}</button> <span class="num">${h(money(x, BASE))}</span>`).join('、')}</p>` : ''}
    ${list
      .map(e => `<div class="order-row"><span class="side-tag div">💰</span><span class="row-main"><span class="row-title"><button class="link" type="button" data-action="open" data-symbol="${h(e.symbol)}">${h(nameOf(e.symbol))}</button></span><span class="row-sub">${h(t('pendingDivLine', { ex: fmtDate(e.ex), pay: fmtDate(e.t), qty: fmtQty(e.shares) }))}</span></span><strong class="num up-ink">+${h(money(e.net, e.currency))}</strong></div>`)
      .join('')}
    ${list.length ? `<p class="note">${h(t('pendingDivNote'))}</p>` : ''}
  </div>`;
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
    <span class="row-spark">${q?.line?.length > 1 ? sparkline(q.line, q.kind === 'crypto' ? null : q.prev) : ''}</span>
    <span class="row-value"><strong class="num">${h(money(p.valueTWD, BASE))}</strong><small class="num">${h(t('weight', { w: pct(p.weight, { digits: 1, sign: false }) }))}</small></span>
    <span class="row-pl"><strong class="num ${dirClass(p.pl)}">${h(money(p.pl, BASE, { sign: true }))}</strong><small class="num ${dirClass(p.pl)}">${h(pct(p.plPct))}</small><small class="num ${dirClass(p.dayTWD)}">${h(t('todayShort'))} ${h(money(p.dayTWD, BASE, { sign: true }))}</small></span>
  </button>`;
}

function walletRow(c, reserved = 0, settling = 0, settleAt = 0) {
  const info = currencyInfo(c.currency);
  if (reserved > 1e-9 && c.amount) c = { ...c, amount: c.amount - reserved, twd: c.twd * (1 - reserved / c.amount) };
  return `<button class="wallet" type="button" data-action="fx-from" data-cur="${h(c.currency)}">
    <span class="wallet-flag">${info.flag}</span>
    <span class="wallet-main"><strong>${h(c.currency)}</strong><small>${h(L(info))}</small></span>
    <span class="wallet-amt"><strong class="num">${h(money(c.amount, c.currency))}</strong>${c.currency !== BASE ? `<small class="num">≈ ${h(money(c.twd, BASE))}</small>` : ''}${reserved > 1e-9 ? `<small class="num">${h(t('reserved', { amount: money(reserved, c.currency) }))}</small>` : ''}${settling > 1e-9 ? `<small class="num">${h(t('settling', { amount: money(settling, c.currency) }))}${settleAt ? ` · ${h(t('settleBy', { date: shortDate(settleAt) }))}` : ''}</small>` : ''}</span>
  </button>`;
}

function loanWalletRow(l) {
  const info = currencyInfo(l.currency);
  return `<button class="wallet debt" type="button" data-action="fx-view-go" data-view="loans">
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
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  return donut(parts, { format: x => money(x, BASE), center: compactMoney(total, BASE), sub: t('allocTotal') }) || `<p class="empty">${h(t('nothingYet'))}</p>`;
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
  const status = o.status === 'open' ? (q && !isOpen(q) ? t('waitingOpen') : t('waitingPrice')) + (o.expires ? ` · ${t(o.tif === 'gtc' ? 'tifUntil' : 'tifDayUntil', { time: o.tif === 'gtc' ? fmtDate(o.expires) : weekdayClock(o.expires) })}` : '') : t(`status_${o.status}`);
  return `<div class="order-row" role="button" tabindex="0" data-action="open" data-symbol="${h(o.symbol)}">
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

// 換匯・融資: three views, one at a time (exchange, the rates board, loans),
// so the page is never one long scroll.
function renderFx() {
  const box = $('fx-body');
  const f = state.fx;
  const view = f.view || 'exchange';
  const tabs = `<div class="segmented fx-views" role="tablist">${[
    ['exchange', t('fxViewExchange')],
    ['rates', t('fxViewRates')],
    ['loans', t('fxViewLoans')]
  ]
    .map(([k, label]) => `<button type="button" data-action="fx-view" data-view="${k}" aria-pressed="${view === k}">${h(label)}</button>`)
    .join('')}</div>`;
  box.innerHTML = `${tabs}${view === 'rates' ? ratesHtml() : view === 'loans' ? loansHtml() : exchangeHtml()}`;
}

function exchangeHtml() {
  const f = state.fx;
  const s = snap();
  if (!state.account || !s) return `<div class="card"><p>${h(t('needAccount'))}</p><div class="spinner"></div></div>`;
  const amount = fxPayAmount();
  const q = amount > 0 ? quoteExchange(f.from, f.to, amount, state.rates, state.fxOpen) : null;
  // Unsettled sale proceeds can't be exchanged yet.
  const have = Math.max(0, withdrawable(state.account, s)[f.from] || 0);
  const haveTo = Math.max(0, withdrawable(state.account, s)[f.to] || 0);
  const waiting = unsettled(state.account)[f.from] || 0;
  const mid = state.rates[f.from] && state.rates[f.to] ? state.rates[f.from] / state.rates[f.to] : null;
  const spread = fxSpread(f.from, f.to, state.fxOpen);
  const tooMuch = amount > have + 1e-9;
  const usd = state.quotes.get(fxSymbol('USD'));
  const pay = f.mode === 'get';
  // The side you type in is an input; the other shows the result.
  const payBox = pay
    ? `<strong class="fx-result num">${q ? h(money(amount, f.from)) : '—'}</strong>`
    : `<input id="fx-amount" class="fx-input num" inputmode="decimal" autocomplete="off" value="${h(f.amount)}" placeholder="0" aria-label="${h(t('amount'))}" />`;
  const getBox = pay
    ? `<input id="fx-amount" class="fx-input num" inputmode="decimal" autocomplete="off" value="${h(f.amount)}" placeholder="0" aria-label="${h(t('fxWantAmount'))}" />`
    : `<strong class="fx-result num">${q ? h(money(q.received, f.to)) : '—'}</strong>`;
  const wallets = Object.entries(withdrawable(state.account, s))
    .filter(([, v]) => v > 0.005)
    .sort(([a], [b]) => (a === BASE ? -1 : b === BASE ? 1 : 0));
  return `<div class="fx-page">
    ${wallets.length ? `<div class="fx-wallets">${wallets.map(([c, v]) => `<button type="button" class="fx-wallet${c === f.from ? ' on' : ''}" data-action="fx-from" data-cur="${h(c)}"><span>${currencyInfo(c).flag} ${h(c)}</span><strong class="num">${h(money(v, c))}</strong></button>`).join('')}</div>` : ''}
    <div class="card fx-card">
      <div class="fx-side">
        <div class="fx-side-top"><span>${h(t('fxYouPayLabel'))}</span><button class="link-button" type="button" data-action="fx-mode" data-mode="${pay ? 'pay' : 'get'}">${h(pay ? t('fxTypePay') : t('fxTypeGet'))}</button></div>
        <div class="fx-side-row"><select id="fx-from" class="fx-cur">${currencyOptions(f.from)}</select>${payBox}</div>
        <div class="fx-side-foot"><span class="muted">${h(t('fxAvailable', { amount: money(have, f.from) }))}</span>
          ${pay ? '' : `<span class="fx-quick">${[0.25, 0.5, 1].map(x => `<button class="chip small" type="button" data-action="fx-pct" data-pct="${x}">${x === 1 ? h(t('all')) : `${x * 100}%`}</button>`).join('')}</span>`}
        </div>
      </div>
      <button class="fx-swap" type="button" data-action="fx-swap" aria-label="${h(t('swap'))}">⇅</button>
      <div class="fx-side">
        <div class="fx-side-top"><span>${h(t('fxYouGetLabel'))}</span></div>
        <div class="fx-side-row"><select id="fx-to" class="fx-cur">${currencyOptions(f.to)}</select>${getBox}</div>
        <div class="fx-side-foot"><span class="muted">${h(t('fxYouHave', { amount: money(haveTo, f.to) }))}</span></div>
      </div>
      <dl class="preview fx-preview">
        <div><dt>${h(t('yourRate'))}</dt><dd class="num">${q ? h(rateLine(f.from, f.to, q.rate)) : mid ? h(rateLine(f.from, f.to, mid)) : '—'}</dd></div>
        <div><dt>${h(t('spread'))}</dt><dd class="num">${h(pct(spread, { digits: 2, sign: false }))}${state.fxOpen ? '' : ` <small>${h(t('closedDouble'))}</small>`}</dd></div>
        ${q ? `<div><dt>${h(t('fxCost'))}</dt><dd class="num">${h(money(q.spreadTWD, BASE, { digits: q.spreadTWD < 10 ? 2 : 0 }))}</dd></div>` : ''}
      </dl>
      ${spread > 0 && !plusAt() ? `<button class="q-plus-hint fee-plus" type="button" data-action="plus">${h(t('fxPlus', { v: pct(spread * PLUS.stock.fxSpread, { digits: 2, sign: false }) }))}</button>` : ''}
      ${tooMuch ? `<p class="warn">${h(t('notEnoughCur', { cur: f.from, have: money(have, f.from) }))}</p>` : ''}
      ${waiting > 0 ? `<p class="note">${h(t('unsettledNote', { amount: money(waiting, f.from), date: shortDate(settlesBy(state.account)[f.from]) }))}</p>` : ''}
      ${pricesLive() ? '' : `<p class="warn">${h(t('waitLive'))}</p>`}
      <button class="primary-button block" type="button" data-action="fx-go" ${q && q.received > 0 && !tooMuch && f.from !== f.to && pricesLive() ? '' : 'disabled'}>${h(q && !tooMuch ? t('fxConfirm', { from: money(amount, f.from), to: money(q.received, f.to) }) : t('doExchange'))}</button>
      <p class="note">${h(state.fxOpen ? t('fxOpenNote') : t('fxClosedNote'))}${usd?.marketTime ? ` ${h(t('asOf', { time: dateTime(usd.marketTime) }))}` : ''}</p>
    </div>
  </div>`;
}

function ratesHtml() {
  return `<div class="card">
    <p class="lede">${h(t('ratesIntro'))}</p>
    <div class="rates">${Object.keys(CURRENCIES).filter(c => c !== BASE).map(rateRow).join('')}</div>
    <div class="button-row"><button class="ghost-button" type="button" data-action="fx-trade">💱 ${h(t('fxTradeButton'))}</button></div>
  </div>`;
}

// What leaves the `from` wallet: the typed amount, or (typing what you want
// to receive) what it takes to get that much after the spread.
function fxPayAmount() {
  const f = state.fx;
  const typed = Number(f.amount);
  if (!(typed > 0)) return 0;
  if (f.mode !== 'get') return typed;
  return amountFor(f.from, f.to, typed, state.rates, state.fxOpen) || 0;
}

function rateRow(c) {
  const q = state.quotes.get(fxSymbol(c));
  const info = currencyInfo(c);
  const sp = fxSpread(c, BASE, state.fxOpen);
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
  if (!state.account) return `<div class="card"><p>${h(t('needAccount'))}</p><div class="spinner"></div></div>`;
  const v = valuation();
  const l = state.loan;
  const s = snap();
  const loan = s.loans[l.currency];
  const avail = available(state.account, s);
  const rate = loanRateAt(l.currency);
  const amount = Number(l.amount);
  const capacityCur = state.rates[l.currency] ? v.capacity / state.rates[l.currency] : 0;
  const limit = v.debtTWD + v.capacity;
  const used = limit > 0 ? Math.min(1, v.debtTWD / limit) : 0;
  const repaying = l.mode === 'repay';
  const canBorrow = amount > 0 && v.margin === 'ok' && amount <= capacityCur + 1e-9;
  const canRepay = loan?.balance > 0 && amount > 0;
  return `<div class="fx-page">
    <div class="card loan-hero">
      <div class="loan-hero-top">
        <div><span class="muted">${h(t('borrowed'))}</span><strong class="num loan-big">${h(money(v.debtTWD, BASE))}</strong></div>
        <div class="loan-ratio ${v.margin === 'ok' ? '' : 'down-ink'}"><span class="muted">${h(t('maintenance'))}</span><strong class="num">${v.debtTWD > 0 ? h(pct(v.ratio, { digits: 0, sign: false })) : '—'}</strong><small>${h(v.debtTWD > 0 ? t(`margin_${v.margin}`) : t('noLoans'))}</small></div>
      </div>
      <div class="loan-bar" role="img" aria-label="${h(t('loanUsed', { pct: pct(used, { digits: 0, sign: false }) }))}"><i style="width:${(used * 100).toFixed(1)}%"></i></div>
      <div class="loan-legend"><span>${h(t('loanUsed', { pct: pct(used, { digits: 0, sign: false }) }))}</span><span>${h(t('canBorrow'))} <strong class="num">${h(money(v.capacity, BASE))}</strong></span></div>
      <div class="loan-facts">
        <div><span class="muted">${h(t('collateral'))}</span><strong class="num">${h(money(v.collateral, BASE))}</strong><small>${h(t('collateralSub'))}</small></div>
        <div><span class="muted">${h(t('interestAccrued'))}</span><strong class="num">${h(money(v.interestTWD || 0, BASE, { digits: (v.interestTWD || 0) < 10 ? 2 : 0 }))}</strong></div>
      </div>
      ${v.debtTWD > 0 ? gauge(v.ratio) : ''}
    </div>
    <div class="card loan-card">
      <div class="segmented" role="group">
        <button type="button" data-action="loan-mode" data-mode="borrow" aria-pressed="${!repaying}">${h(t('borrow'))}</button>
        <button type="button" data-action="loan-mode" data-mode="repay" aria-pressed="${repaying}">${h(t('repay'))}</button>
      </div>
      <div class="fx-side">
        <div class="fx-side-row"><select id="loan-cur" class="fx-cur">${currencyOptions(l.currency)}</select><input id="loan-amount" class="fx-input num" inputmode="decimal" autocomplete="off" value="${h(l.amount)}" placeholder="0" aria-label="${h(t('amount'))}" /></div>
        <div class="fx-side-foot"><span class="muted">${h(repaying ? (loan?.balance > 0 ? t('owed', { amount: money(loan.balance, l.currency) }) : t('noLoanCur', { cur: l.currency })) : t('loanTerms', { rate: pct(rate, { digits: 2, sign: false }), cap: money(capacityCur, l.currency) }))}</span>${!repaying && !plusAt() ? `<button class="q-plus-hint" type="button" data-action="plus">${h(t('loanPlus', { v: pct(Math.max(0, rate - PLUS.stock.loanCut), { digits: 2, sign: false }) }))}</button>` : ''}</div>
      </div>
      ${!repaying && amount > 0 ? `<p class="muted">${h(t('interestPerDay', { amount: money((amount * rate) / 365, l.currency, { digits: 2 }) }))}</p>` : ''}
      ${repaying
        ? `<div class="button-row"><button class="primary-button grow" type="button" data-action="repay" ${canRepay ? '' : 'disabled'}>${h(t('repay'))}</button>${loan?.balance > 0 ? `<button class="ghost-button" type="button" data-action="repay-all" ${(avail.cash[l.currency] || 0) > 0 ? '' : 'disabled'}>${h(t('repayAll'))}</button>` : ''}</div>`
        : `<button class="primary-button block" type="button" data-action="borrow" ${canBorrow ? '' : 'disabled'}>${h(t('borrow'))}</button>`}
      <p class="note">${h(t('loansIntro'))}</p>
    </div>
    ${v.loans.length ? `<div class="card"><h3 class="card-title">${h(t('yourLoans'))}</h3><div class="wallets">${v.loans.map(x => `<div class="wallet debt"><span class="wallet-flag">${currencyInfo(x.currency).flag}</span><span class="wallet-main"><strong>${h(x.currency)}</strong><small>${h(t('loanRate', { rate: pct(x.rate, { digits: 2, sign: false }) }))} · ${h(t('interestSoFar', { amount: money(x.interest, x.currency, { digits: 2 }) }))}</small></span><span class="wallet-amt"><strong class="num down-ink">−${h(money(x.balance, x.currency))}</strong>${x.currency !== BASE ? `<small class="num">≈ −${h(money(x.twd, BASE))}</small>` : ''}</span></div>`).join('')}</div></div>` : ''}
  </div>`;
}

function doExchange() {
  if (!pricesLive()) return;
  const f = state.fx;
  const r = exchange(state.account, { from: f.from, to: f.to, amount: fxPayAmount() }, { rates: state.rates, fxOpen: state.fxOpen, now: Date.now() });
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
      title = `${nameOf(e.symbol, q)} ${e.coupon ? t('couponPaid') : t('dividend')}${e.t > Date.now() ? ` · ${t('pendingTag')}` : ''}`;
      sub = [`${fmtQty(e.shares)} × ${fmtPrice(e.perShare, e.currency)}`, e.withheld ? `${t('withheld')} ${money(e.withheld, e.currency)}` : '', e.nhi ? `${t('nhi')} ${money(e.nhi, e.currency)}` : ''].filter(Boolean).join(' · ');
      amount = `<strong class="num ${e.net < 0 ? '' : 'up-ink'}">${e.net < 0 ? '' : '+'}${h(money(e.net, e.currency))}</strong>`;
      break;
    case 'interest':
      icon = '<span class="side-tag div">🏦</span>';
      title = t('interestRow');
      sub = [t('interestRate', { rate: pct(e.rate, { sign: false, digits: 2 }) }), e.withheld ? `${t('withheld')} ${money(e.withheld, BASE)}` : '', e.nhi ? `${t('nhi')} ${money(e.nhi, BASE)}` : ''].filter(Boolean).join(' · ');
      amount = `<strong class="num up-ink">+${h(money(e.net, BASE))}</strong>`;
      break;
    case 'split':
      icon = '<span class="side-tag div">✂️</span>';
      title = `${nameOf(e.symbol, q)} ${t('split')} ${num(e.ratio, 4)} : 1`;
      sub = t('splitNote');
      break;
    case 'deposit':
      icon = '<span class="side-tag div">🏦</span>';
      title = e.pool ? describeEntry(e, locale) : e.id === 'deposit:start' || e.start ? t('openedWith') : e.income ? t('payday') : e.game ? t('gameIncome', { game: t(`sg_${e.game}`) }) : t('deposited');
      icon = e.pool ? `<span class="side-tag div">${appIcon(e.app)}</span>` : e.game ? '<span class="side-tag div">🎮</span>' : icon;
      sub = e.pool ? t('poolDepositSub') : '';
      amount = `<strong class="num ${e.amount < 0 ? 'down-ink' : ''}">${e.amount < 0 ? '' : '+'}${h(money(e.amount, e.currency))}</strong>`;
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
  const [tag, attrs] = activityTarget(e);
  return `<${tag} ${attrs} class="activity-row">
    ${icon}<span class="row-main"><span class="row-title">${h(title)}</span><span class="row-sub">${h(dateTime(e.t))}${sub ? ` · ${h(sub)}` : ''}</span></span>
    <span class="row-amt">${amount}</span></${tag}>`;
}

// Where a record takes you when tapped: its stock's page, the exchange (the
// two currencies set), the loans, the mini games, the portfolio, or the
// Quadra app the money came from (signed in).
function activityTarget(e) {
  const button = attrs => ['button', `type="button" ${attrs}`];
  if (e.symbol && e.type !== 'deposit') return button(`data-action="open" data-symbol="${h(e.symbol)}"`);
  if (e.type === 'fx') return button(`data-action="fx-pair" data-from="${h(e.from)}" data-to="${h(e.to)}"`);
  if (e.type === 'interest' || e.type === 'borrow' || e.type === 'repay') return button('data-action="fx-view-go" data-view="loans"');
  if (e.type === 'deposit' && e.pool && APPS[e.app]) return ['a', `href="${h(appUrl(e.app))}"`];
  if (e.type === 'deposit' && e.game) return button('data-action="goto" data-tab="guide"');
  if (e.type === 'deposit') return button('data-action="goto" data-tab="portfolio"');
  return ['div', ''];
}

const ACTIVITY_FILTERS = {
  all: () => true,
  trades: e => e.type === 'fill',
  fx: e => e.type === 'fx',
  income: e => e.type === 'div' || e.type === 'split' || e.type === 'interest',
  loans: e => e.type === 'borrow' || e.type === 'repay',
  cash: e => e.type === 'deposit' && !ACTIVITY_FILTERS.apps(e),
  // Money moved by the other Quadra apps (bets, games, rewards): one line per
  // app and day under 全部, each record here (one app at a time, or all).
  apps: e => e.type === 'deposit' && Boolean(e.pool) && Boolean(APPS[e.app]) && e.app !== 'stock'
};
const APP_ICONS = { odds: '🎯', match: '🏟️', vocab: '🎁', orbit: '🪐' };
const appIcon = app => APP_ICONS[app] || '🔄';
// A day's records from one other app, as one line.
function appDayRow(app, list) {
  const sum = list.reduce((a, e) => a + (e.amount || 0), 0);
  return `<button type="button" class="activity-row" data-action="afilter" data-f="apps" data-app="${h(app)}">
    <span class="side-tag div">${appIcon(app)}</span><span class="row-main"><span class="row-title">${h(APPS[app]?.short || app)}</span><span class="row-sub">${h(t('appRecords', { n: list.length }))}</span></span>
    <span class="row-amt"><strong class="num ${sum < 0 ? 'down-ink' : ''}">${sum < 0 ? '' : '+'}${h(money(sum, BASE))}</strong></span></button>`;
}

function renderHistory() {
  const box = $('history-body');
  if (!state.account) {
    box.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
    return;
  }
  const views = ['activity', 'orders', 'stats'];
  const tabs = `<div class="segmented history-tabs" role="group">${views.map(x => `<button type="button" data-action="hview" data-view="${x}" aria-pressed="${state.historyView === x}">${h(t(`hview_${x}`))}</button>`).join('')}</div>`;
  if (state.historyView === 'tm') {
    box.innerHTML = `${tabs}${tmHtml()}`;
    renderTmChart();
    return;
  }
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
  const f = ACTIVITY_FILTERS[state.activityFilter] ? state.activityFilter : 'all';
  const app = f === 'apps' ? state.activityApp || '' : '';
  const all = [...state.account.events].sort((a, b) => b.t - a.t);
  const apps = [...new Set(all.filter(ACTIVITY_FILTERS.apps).map(e => e.app))].filter(Boolean);
  const events = all.filter(ACTIVITY_FILTERS[f]).filter(e => !app || e.app === app);
  // Under 全部, the other apps' records fold into a line per app and day
  // (and don't count against the rows shown).
  const own = f === 'all' ? events.filter(e => !ACTIVITY_FILTERS.apps(e)) : events;
  const shown = own.slice(0, state.activityShown);
  const until = shown.length < own.length ? shown.at(-1).t : -Infinity;
  const groups = new Map();
  const group = day => (groups.has(day) ? groups.get(day) : groups.set(day, { rows: [], apps: new Map() }).get(day));
  for (const e of shown) group(taipeiDay(e.t)).rows.push(e);
  if (f === 'all')
    for (const e of events.filter(x => ACTIVITY_FILTERS.apps(x) && x.t >= until)) {
      const g = group(taipeiDay(e.t));
      if (!g.apps.has(e.app)) g.apps.set(e.app, []);
      g.apps.get(e.app).push(e);
    }
  const days = [...groups].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const appChips =
    f === 'apps' && apps.length > 1
      ? `<div class="chips filter-chips app-chips">${['', ...apps].map(k => `<button class="chip" type="button" data-action="afilter" data-f="apps" data-app="${h(k)}" aria-pressed="${app === k}">${h(k ? APPS[k]?.short || k : t('af_all'))}</button>`).join('')}</div>`
      : '';
  box.innerHTML = `${tabs}
    <div class="chips filter-chips">${Object.keys(ACTIVITY_FILTERS).map(k => `<button class="chip" type="button" data-action="afilter" data-f="${k}" data-app="" aria-pressed="${f === k}">${h(t(`af_${k}`))}</button>`).join('')}</div>
    ${appChips}
    ${days.map(([day, g]) => `<h3 class="day-head">${h(dayLabel(day))}</h3><div class="card list-card">${g.rows.map(activityRow).join('')}${[...g.apps].map(([a, list]) => appDayRow(a, list)).join('')}</div>`).join('') || `<p class="empty">${h(t('nothingYet'))}</p>`}
    ${own.length > shown.length ? `<button class="ghost-button more" type="button" data-action="more">${h(t('showMore', { n: own.length - shown.length }))}</button>` : ''}`;
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
`;
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

// A folding card that remembers being opened or closed across redraws.
function fold(icon, title, body, open = false, id = title) {
  const isOpen = state.openFolds.has(id) || (open && !state.openFolds.has(`closed:${id}`));
  return `<details class="card fold" data-fold="${h(id)}"${isOpen ? ' open' : ''}><summary><span class="fold-icon">${icon}</span><h2>${h(title)}</h2></summary><div class="guide-text">${body}</div></details>`;
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
  if (state.tab === 'history') renderHistory();
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
  if (state.tab === 'history') {
    renderHistory();
    $('tm-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---- The Quadra Pass: the account lives with it ------------------------------------------
//
// Signing in is required (quadra.mjs shows the sign-in screen). The account
// is this app's data on the pass; the pass's wallet is the one Quadra money
// pool, which this account's NT$ cash shows: the other apps' money (Play's
// bets and winnings, Rewards' earnings, Quadra's own pay, transfers)
// arrives as pool deposits, and this account's own NT$ goes back to the
// wallet as its figure.

const q = quadraSession('stock', { lang: locale });

// The first time this pass opens Securities: an account of its own, funded
// by the pool (a pass from before Quadra paid the opening money gets
// Securities' own NT$100,000, as it always did).
function ensureAccount(wallet) {
  if (state.account) return;
  const fundedByQuadra = (wallet?.entries || []).some(e => e.id === 'eco:start');
  commit(newAccount(fundedByQuadra ? 0 : START_AMOUNT), { sync: false });
  state.bench = null;
}

// Merges this device's account with the pass's copy both ways. Syncs run one
// after another: a write on its way never lands after a newer one.
let syncChain = Promise.resolve();
let syncQueued = false;
function syncNow({ pull = false } = {}) {
  if (!q.pass || syncQueued) return syncChain;
  syncQueued = true;
  syncChain = syncChain.then(async () => {
    syncQueued = false;
    if (!q.active) return;
    state.sync.busy = true;
    try {
      await mergeRemote(await q.read({ data: true, inbox: true }), { pull });
    } catch (error) {
      if (error.code !== 'ECO_SESSION_MOVED') state.sync.error = error.code === 'TOO_BIG' ? t('syncTooBig') : error.message;
    } finally {
      state.sync.busy = false;
      render();
    }
  });
  return syncChain;
}

async function mergeRemote(remote, { pull = false } = {}) {
  if (!remote) return;
  const theirs = remote.payload ? await unpack(remote.payload).catch(() => null) : null;
  // A copy on the pass that can't be read is never saved over.
  if (remote.payload && !isAccount(theirs)) throw new Error('unreadable account');
  let account = state.account;
  const their = isAccount(theirs) ? theirs : null;
  if (account && their && account.id !== their.id) account = mergeDistinct(their, account);
  else account = mergeAccounts(account, their);
  for (const item of remote.inbox || []) {
    const other = await unpack(item.payload).catch(() => null);
    if (isAccount(other)) account = mergeDistinct(account, other);
  }
  let wallet = remote.wallet || q.wallet;
  if (!account) {
    ensureAccount(wallet);
    account = state.account;
  }
  account = applyPool(account, wallet).account;
  const figure = ownCash(account, replay(account));
  // What the holdings are worth (less loans and shorts), for the monthly
  // allowance, which goes by the whole account's worth: sent once prices are
  // in, again when it moves 2% (or NT$1,000).
  const prev = wallet?.snap?.stock;
  const v = state.loaded ? valuate(replay(account), state.quotes, state.rates) : null;
  const holdings = v && !v.missingRates.length ? Math.round(v.netWorth - v.cashTWD) : prev?.holdings;
  const moved = Number.isFinite(holdings) && !(Math.abs((prev?.holdings ?? Infinity) - holdings) < Math.max(1_000, Math.abs(holdings) * 0.02));
  const snapPatch = prev?.cash === figure && !moved ? undefined : { stock: { cash: figure, ...(Number.isFinite(holdings) ? { holdings } : {}), t: Date.now() } };
  const changed = !their || JSON.stringify(account) !== JSON.stringify(their);
  if (account !== state.account) commit(account, { sync: false });
  if (changed || snapPatch || (remote.inbox || []).length) {
    const payload = changed ? await pack(account) : undefined;
    if (payload && payload.length > 1_000_000) throw Object.assign(new Error('too big'), { code: 'TOO_BIG' });
    const patch = { snap: snapPatch, settings: { ...affinityPatch('stock').settings } };
    const res = await q.write({ payload, wallet: patch });
    wallet = res.wallet || wallet;
  }
  for (const item of remote.inbox || []) await q.dropInbox(item.id).catch(() => {});
  state.wallet = wallet;
  state.sync.error = null;
  state.sync.at = Date.now();
}

// What the person does here, for Rewards' missions and every app's
// recommendations (quadra.mjs).
function track(action, keys = [], weight = 1) {
  if (keys.length) recordAffinity('stock', keys, weight);
  if (!action || !q.active) return;
  q.write({ wallet: activityPatch(q.wallet, 'stock', action) }).catch(() => {});
}
const symbolKeys = symbol => {
  const info = catalogInfo(symbol);
  const quote = state.quotes.get(symbol);
  return [`sym:${symbol}`, info?.category ? `cat:${info.category}` : null, quote?.kind ? `kind:${quote.kind}` : null, quote?.market ? `mkt:${quote.market}` : null];
};

// This app's own settings, in the account sheet.
function settingsEl() {
  const box = document.createElement('div');
  const paint = () => {
    box.innerHTML = `<h3 class="q-sheet-h">${h(t('g_settings'))}</h3>
      <div class="q-rows settings-rows">
        <div class="setting-row"><span>${h(t('updownLabel'))}</span><div class="segmented small" role="group"><button type="button" data-set="updown" data-v="tw" aria-pressed="${state.settings.updown === 'tw'}">${h(t('updownTw'))}</button><button type="button" data-set="updown" data-v="us" aria-pressed="${state.settings.updown === 'us'}">${h(t('updownUs'))}</button></div></div>
        <p class="note">${h(t('notifyNote'))}</p>
      </div>`;
  };
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    if (b.dataset.set === 'updown') {
      state.settings.updown = b.dataset.v;
      saveSettings();
      render();
    }
    paint();
  });
  paint();
  return box;
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

const TAB_ICONS = { markets: 'home', portfolio: 'wallet', fx: 'exchange', history: 'history' };
const tabNav = tabBar({ tabs: TABS.map(id => ({ id, label: t(`tab_${id}`), icon: TAB_ICONS[id] })), onSelect: (tab, { again }) => !again && showTab(tab) });
function renderTabs() {
  tabNav.select(state.tab);
  tabNav.badge('history', state.account?.orders.filter(o => o.status === 'open').length || 0, { tone: 'warn' });
  const v = state.account && state.loaded ? valuation() : null;
  tabNav.badge('fx', v && v.margin !== 'ok' ? '!' : '', { tone: 'warn' });
}

function render() {
  renderStatus();
  renderTabs();
  if (state.tab === 'markets') renderMarkets();
  else if (state.tab === 'portfolio') renderPortfolio();
  else if (state.tab === 'fx') renderFx();
  else if (state.tab === 'history') renderHistory();
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
// A finger on the screen: the live redraw waits, so the button it's on
// is still there when the tap lands.
let pressedAt = 0;
document.addEventListener('pointerdown', () => (pressedAt = Date.now()), true);
document.addEventListener('click', () => (pressedAt = 0), true);
function refreshDetailLive() {
  if (Date.now() - pressedAt < 800) return void setTimeout(refreshDetailLive, 800 - (Date.now() - pressedAt) + 20);
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
  render();
  if (tab === 'markets' || tab === 'guide') refresh();
}

function renderStatic() {
  $('title').textContent = t('appName');
  document.title = t('appName');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('search').placeholder = t('searchPlaceholder');
}

// ---- Events ---------------------------------------------------------------------------------

// Links to the other Quadra apps arrive signed in (quadra.mjs's go).
document.addEventListener('click', event => {
  const link = event.target.closest('[data-go]');
  if (!link) return;
  event.preventDefault();
  q.go(link.dataset.go, link.dataset.hash || '');
});

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
      // From a 「全部」 link: straight down to that list.
      if (el.closest('.q-section-head')) requestAnimationFrame(() => $('categories')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      break;
    case 'plus':
      openPlus(q);
      break;
    case 'cover': {
      // Sell what the plan says, at market, one order each.
      const v = valuation();
      const { plan } = coverPlan(v, overdrawnBy(v));
      let account = state.account;
      let sold = 0;
      for (const x of plan) {
        const quote = state.quotes.get(x.symbol);
        const r = placeOrder(account, { symbol: x.symbol, side: 'sell', type: 'market', qty: x.qty }, { quote, rates: state.rates, valuation: valuate(replay(account), state.quotes, state.rates), now: Date.now() });
        if (r.account) {
          account = r.account;
          sold++;
        }
      }
      if (sold) {
        commit(account);
        track('trade', [], 1);
        toast(t('coverDone', { n: sold }), 'good');
      }
      render();
      break;
    }
    case 'list-all':
      state.listAll = state.category;
      renderMarkets();
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
      if (!state.account) return;
      commit(toggleWatch(state.account, d.symbol));
      track('watch', symbolKeys(d.symbol), 2);
      renderDetail();
      if (state.tab === 'markets') renderMarkets();
      break;
    case 'side':
      d.side = el.dataset.side;
      d.qty = '';
      d.msg = null;
      renderTicket();
      break;
    case 'tif':
      d.tif = el.dataset.tif;
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
    case 'place-fx': {
      const cur = state.quotes.get(d.symbol)?.currency;
      const r = exchange(state.account, { from: BASE, to: cur, amount: Number(el.dataset.need) }, { rates: state.rates, fxOpen: state.fxOpen, now: Date.now() });
      if (r.error) {
        d.msg = { kind: 'bad', text: errorText(r) };
        renderTicket();
        break;
      }
      commit(r.account);
      toast(t('autoFxDone', { pay: money(r.event.amount, BASE), get: money(r.event.received, r.event.to) }), 'good');
      placeFromTicket();
      break;
    }
    case 'place-margin': {
      const cur = state.quotes.get(d.symbol)?.currency;
      const r = borrow(state.account, { currency: cur, amount: Number(el.dataset.amount) }, { valuation: valuation(), rates: { ...state.rates, [BASE]: 1 }, now: Date.now() });
      if (r.error) {
        d.msg = { kind: 'bad', text: errorText(r) };
        renderTicket();
        break;
      }
      commit(r.account);
      toast(t('marginDone', { v: money(r.event.amount, cur) }), 'good');
      placeFromTicket();
      break;
    }
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
      state.fx.view = 'exchange';
      showTab('fx');
      break;
    case 'fx-pair':
      state.fx.from = el.dataset.from;
      state.fx.to = el.dataset.to;
      state.fx.view = 'exchange';
      showTab('fx');
      break;
    case 'fx-to':
      state.fx.to = el.dataset.cur;
      if (state.fx.from === state.fx.to) state.fx.from = BASE;
      state.fx.view = 'exchange';
      renderFx();
      break;
    case 'fx-view':
      state.fx.view = el.dataset.view;
      renderFx();
      break;
    case 'fx-view-go':
      state.fx.view = el.dataset.view;
      showTab('fx');
      break;
    case 'fx-pct': {
      const have = Math.max(0, withdrawable(state.account, snap())[state.fx.from] || 0);
      const digits = currencyInfo(state.fx.from).digits ?? 2;
      state.fx.mode = 'pay';
      state.fx.amount = String(Math.floor(have * Number(el.dataset.pct) * 10 ** digits) / 10 ** digits);
      renderFx();
      break;
    }
    case 'loan-mode':
      state.loan.mode = el.dataset.mode;
      state.loan.amount = '';
      renderFx();
      break;
    case 'fx-swap':
      [state.fx.from, state.fx.to] = [state.fx.to, state.fx.from];
      state.fx.amount = '';
      renderFx();
      break;
    case 'fx-mode':
      state.fx.mode = el.dataset.mode === 'get' ? 'get' : 'pay';
      state.fx.amount = '';
      renderFx();
      break;
    case 'fx-max': {
      const have = Math.max(0, withdrawable(state.account, snap())[state.fx.from] || 0);
      state.fx.mode = 'pay';
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
      state.activityApp = el.dataset.app || '';
      state.activityShown = 60;
      renderHistory();
      break;
    case 'more':
      state.activityShown += 100;
      renderHistory();
      break;
    case 'chart-style':
      state.settings.chart = el.dataset.v;
      saveSettings();
      redrawDetail();
      break;
    case 'about-period':
      state.aboutPeriod = el.dataset.v;
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
    case 'plan-off': {
      const id = el.dataset.id;
      ask({ lang: locale, icon: '📅', title: t('planStopTitle'), body: t('planStopConfirm'), ok: t('planStop'), danger: true }).then(yes => {
        if (!yes || !state.account) return;
        commit(setPlan(state.account, { id, on: false }).account);
        render();
        if (state.detail) refreshDetailLive();
      });
      break;
    }
    case 'tm-open':
      state.tm.symbol = el.dataset.symbol;
      state.tm.result = null;
      closeDetail();
      state.historyView = 'tm';
      showTab('history');
      document.getElementById('time-machine')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      runTimeMachine();
      break;
    case 'tm-mode':
      state.tm.mode = el.dataset.v;
      if (el.dataset.v === 'monthly' && Number(state.tm.amount) > 50_000) state.tm.amount = '5000';
      if (el.dataset.v === 'lump' && Number(state.tm.amount) < 10_000) state.tm.amount = '100000';
      state.tm.result = null;
      renderHistory();
      break;
    case 'tm-go':
      runTimeMachine();
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

{
  const fromHash = location.hash.slice(1);
  if (TABS.includes(fromHash)) state.tab = fromHash;
}
// A notice's banner (or a link) that points at a tab while the app is open.
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (TABS.includes(tab) && tab !== state.tab) showTab(tab);
});
// The same top-right in every Quadra app: help, refresh, then the account.
topActions(q, { refresh: () => refresh({ list: true }), extra: settingsEl });

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
// Phones and tablets: from the home screen only. Always the newest deploy.
const gated = installGate('stock', locale);
watchUpdates({ current: document.querySelector('meta[name="build-version"]')?.content, key: 'stockStudy', cachePrefix: 'stock-study-' });
applySettings();
loadQuotes();
renderStatic();
// Quadra Plus: the months paid for, from the wallet, into the ledger's perks.
function syncPlus(wallet) {
  const months = plusMonths(wallet);
  usePlus(months.size ? { months, ...PLUS.stock } : null);
  memo.at = 0;
}
q.on('wallet', wallet => {
  state.wallet = wallet;
  syncPlus(wallet);
  // Money the other apps moved arrives in this account's NT$ cash.
  if (state.account) {
    const pooled = applyPool(state.account, wallet);
    if (pooled.added.length) {
      commit(pooled.account);
      for (const e of pooled.added.filter(x => x.kind !== 'stake' && x.kind !== 'payout')) toast(`${describeEntry(e, locale)} ${money(e.amount, BASE, { sign: true })}`, e.amount >= 0 ? 'good' : '');
    }
  }
  renderStatus();
  if (state.tab === 'portfolio') renderPortfolio();
});
q.on('active', live => {
  if (live) {
    syncNow();
    refresh();
  }
});

async function boot() {
  const first = await q.start();
  state.wallet = first.wallet || q.wallet;
  syncPlus(state.wallet);
  state.account = await loadAccount();
  // The pass's own copy, merged in (and the account made, the first time).
  if (first && !first.offline) await (syncChain = syncChain.then(() => mergeRemote(first)).catch(error => (state.sync.error = error.message)));
  const recovered = await oldDeviceAccount(state.account);
  if (recovered && recovered !== state.account) {
    commit(recovered, { sync: false });
    syncNow();
  }
  if (!state.account) ensureAccount(q.wallet);
  state.accountReady = true;
  if (state.fromCache) $('loading').hidden = true;
  checkIncome();
  render();
  backfillOrders()
    .catch(() => {})
    .then(checkMarginHistory)
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
}
if (!gated) boot();
// Hide the loading screen after at most 8 seconds whatever happens.
setTimeout(() => ($('loading').hidden = true), 8000);

setInterval(() => {
  if (document.visibilityState === 'visible' && q.active) refresh().then(checkBonds);
}, QUOTE_REFRESH_MS);
// What the other apps did (bets, rewards, pay) arrives with the wallet
// (quadra.mjs checks it every minute); the account itself every few.
setInterval(() => {
  if (document.visibilityState === 'visible' && q.active && state.account) syncNow();
}, 3 * 60_000);
// Monthly plans due today wait for their market's first price.
setInterval(() => {
  if (document.visibilityState !== 'visible' || !q.active) return;
  checkIncome();
  checkPlans();
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
  if (document.visibilityState !== 'visible' || !state.accountReady) return;
  // Back after a while: settle what happened meanwhile from the history first.
  state.backfilled = false;
  backfillOrders()
    .catch(() => {})
    .then(checkMarginHistory)
    .finally(() => {
      state.backfilled = true;
      checkIncome();
      refresh().then(() => {
        checkBonds();
        checkPlans();
      });
    });
  syncNow();
});
