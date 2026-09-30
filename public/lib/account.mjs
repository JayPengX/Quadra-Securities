// The practice brokerage account. Play money only.
//
// The account is a log: immutable events (deposits, exchanges, fills,
// dividends, splits, loans) plus orders, whose status moves forward (open →
// filled, cancelled or rejected). Everything else (cash in each currency,
// holdings, average costs, loans with their interest, what was paid in fees
// and taxes) is worked out by replaying the log, so two devices' copies merge
// by uniting their logs and nothing can count twice.
//
// Positions are signed: a negative quantity is a short sale (shares
// borrowed and sold, bought back later), which accrues a borrowing fee and
// counts as owed in the maintenance ratio.
import {
  BASE,
  COLLATERAL,
  CLOSED_FX_MULTIPLIER,
  MARGIN_CALL,
  MARGIN_LIQUIDATE,
  SHORT_FEE,
  SHORT_INITIAL,
  currencyInfo,
  dealPrice,
  divPayDays,
  settleDate,
  marketFill,
  isOddLot,
  oddLotOpen,
  CASH_RATE,
  NHI_RATE,
  NHI_THRESHOLD,
  onTick,
  priceLimits,
  tickSize,
  dividendTaxes,
  isOpen,
  isTradable,
  isShortable,
  qtyStep,
  roundCash,
  roundQty,
  tradeCosts,
  lotProblem,
  localDayOf
} from './markets.mjs';
import { nextTradingStart } from './holidays.mjs';
import { BONDS, couponDates } from './bonds.mjs';

export const ACCOUNT_VERSION = 1;
// Every new account opens with the same NT$100,000 (Quadra's base amount);
// the range below is only what an older, chosen start can be.
// What Securities itself gave a new account before Quadra paid the opening money.
export const START_AMOUNT = 100_000;
export const MIN_START = 10_000;
export const MAX_START = 1_000_000_000;
const YEAR_MS = 365 * 86_400_000;
const EPS = 1e-9;
// A buy order waiting for its price holds this much more than its estimate
// (a market order placed while the market is shut can open higher).
const RESERVE_BUFFER = 0.03;

export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// Taiwan date (YYYY-MM-DD) of a moment. Taiwan has no daylight saving time.
export function taipeiDay(t) {
  return new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
}

// start 0: an account funded by the Quadra pool alone (a pass that got its
// opening money from Quadra itself).
export function newAccount(start = START_AMOUNT, now = Date.now(), id = randomId()) {
  const amount = Math.round(Number(start));
  if (!(amount === 0 || (amount >= MIN_START && amount <= MAX_START))) throw new Error('start amount out of range');
  return {
    v: ACCOUNT_VERSION,
    id,
    created: now,
    events: amount ? [{ id: 'deposit:start', type: 'deposit', t: now, currency: BASE, amount }] : [],
    orders: [],
    snapshots: {},
    watch: {},
    income: { since: now }
  };
}

const byTime = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const add = (map, key, amount) => (map[key] = (map[key] || 0) + amount);

// ---- Quadra Plus ---------------------------------------------------------------
//
// A member (quadra.mjs PLUS.stock) pays part of the commission and FX spread,
// borrows cheaper and earns more on NT$ cash. Each counts by when it happens:
// a trade, exchange or loan by the moment it's made, cash interest by each
// Taiwan month the membership was paid for. The app keeps `months` current
// from the wallet (usePlus); with none, nothing here changes anything.
const PLUS_NONE = { months: new Set(), commission: 1, fxSpread: 1, cashRate: CASH_RATE, cashCap: 0, loanCut: 0 };
let plus = PLUS_NONE;
export function usePlus(settings) {
  plus = settings ? { ...PLUS_NONE, ...settings } : PLUS_NONE;
}
export const plusAt = (t = Date.now()) => plus.months.has(taipeiDay(t).slice(0, 7));
// NT$ cash interest between two moments, month by month, as rate × time:
// `base` on all the cash, and Plus's `extra` rate on the first cashCap only
// (like a Taiwan digital bank's high-interest tier).
function cashYield(from, to) {
  const out = { base: CASH_RATE * (to - from), extra: 0 };
  if (!plus.months.size) return out;
  for (let a = from; a < to; ) {
    const d = new Date(a + 8 * 3_600_000);
    const b = Math.min(to, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 8 * 3_600_000);
    if (plusAt(a)) out.extra += Math.max(0, plus.cashRate - CASH_RATE) * (b - a);
    a = b;
  }
  return out;
}

// ---- Replay ------------------------------------------------------------------

function accrue(s, t) {
  // NT$ cash earns the demand-deposit rate (Quadra Plus: more).
  const cash = s.cash[BASE] || 0;
  if (t > s.cashLast && cash > 0) {
    const y = cashYield(s.cashLast, t);
    s.cashInterest += (cash * y.base + Math.min(cash, plus.cashCap) * y.extra) / YEAR_MS;
  }
  s.cashLast = Math.max(s.cashLast, t);
  for (const p of Object.values(s.positions)) {
    if (p.qty < 0 && t > p.feeLast) p.borrowFee += (-p.cost * SHORT_FEE * (t - p.feeLast)) / YEAR_MS;
    p.feeLast = Math.max(p.feeLast ?? t, t);
  }
  for (const loan of Object.values(s.loans)) {
    if (t > loan.last && loan.balance > EPS) {
      const interest = (loan.balance * loan.rate * (t - loan.last)) / YEAR_MS;
      loan.balance += interest;
      loan.interest += interest;
    }
    loan.last = Math.max(loan.last, t);
  }
}

// Cash, holdings and loans as of `now`, and where the money went.
export function replay(account, now = Date.now()) {
  const s = {
    cash: { [BASE]: 0 },
    positions: {},
    loans: {},
    deposits: 0,
    // In NT$ at each event's own rate.
    paid: { commission: 0, tax: 0, fee: 0, fx: 0, withheld: 0, nhi: 0, borrow: 0 },
    dividends: 0,
    // Bank interest on NT$ cash: accrued so far, and paid out (net).
    cashInterest: 0,
    cashLast: account?.created ?? 0,
    interestEarned: 0,
    realized: 0,
    closed: [],
    held: {},
    log: []
  };
  for (const e of [...(account?.events || [])].sort(byTime)) {
    // The account as it stood at `now`: later events (a dividend still to be
    // paid, or a moment in the past being checked) don't count yet.
    if (e.t > now) break;
    accrue(s, e.t);
    switch (e.type) {
      case 'deposit':
        add(s.cash, e.currency, e.amount);
        s.deposits += e.amount * (e.twd || 1);
        break;
      case 'fx':
        add(s.cash, e.from, -e.amount);
        add(s.cash, e.to, e.received);
        s.paid.fx += e.spreadTWD || 0;
        break;
      case 'fill':
        applyFill(s, e);
        break;
      case 'split': {
        const p = s.positions[e.symbol];
        if (p) p.qty *= e.ratio;
        break;
      }
      case 'interest':
        add(s.cash, e.currency, e.net);
        s.interestEarned += e.net;
        s.paid.withheld += e.withheld || 0;
        s.paid.nhi += e.nhi || 0;
        break;
      case 'div':
        add(s.cash, e.currency, e.net);
        s.dividends += e.net * e.twd;
        s.paid.withheld += e.withheld * e.twd;
        s.paid.nhi += (e.nhi || 0) * e.twd;
        break;
      case 'borrow': {
        const loan = (s.loans[e.currency] ||= { currency: e.currency, balance: 0, rate: e.rate, interest: 0, last: e.t, borrowed: 0, repaid: 0 });
        loan.balance += e.amount;
        loan.borrowed += e.amount;
        loan.rate = e.rate;
        add(s.cash, e.currency, e.amount);
        break;
      }
      case 'repay': {
        const loan = s.loans[e.currency];
        if (!loan) break;
        loan.balance -= e.amount;
        loan.repaid += e.amount;
        if (loan.balance < 10 ** -currencyInfo(e.currency).digits / 2) loan.balance = 0;
        add(s.cash, e.currency, -e.amount);
        break;
      }
    }
    s.log.push(e);
  }
  accrue(s, now);
  for (const [cur, v] of Object.entries(s.cash)) if (Math.abs(v) < EPS) s.cash[cur] = 0;
  // Dividends past their ex-date and not paid yet: owed to the account (the
  // price already dropped by them), in NT$ at their own rate.
  s.receivable = (account?.events || []).filter(e => e.type === 'div' && e.ex != null && e.ex <= now && e.t > now).reduce((sum, e) => sum + e.net * (e.twd || 1), 0);
  return s;
}

function applyFill(s, e) {
  const twd = e.twd || 1;
  s.paid.commission += e.commission * twd;
  s.paid.tax += e.tax * twd;
  s.paid.fee += e.fee * twd;
  const held = (s.held[e.symbol] ||= { first: e.t, realized: 0, bought: 0, sold: 0 });
  const buy = e.side === 'buy';
  add(s.cash, e.currency, buy ? -e.total : e.total);
  if (buy) held.bought += e.total * twd;
  else held.sold += e.total * twd;
  const p = (s.positions[e.symbol] ||= {
    symbol: e.symbol, name: e.name, kind: e.kind, market: e.market, currency: e.currency, qty: 0, cost: 0, costTWD: 0, first: e.t, borrowFee: 0, feeLast: e.t
  });
  p.last = e.price;
  let left = e.qty;
  // First, whatever this trade closes: a sale of shares held, or a purchase
  // that buys back a short.
  if (Math.abs(p.qty) > EPS && (p.qty > 0) !== buy) {
    const close = Math.min(left, Math.abs(p.qty));
    const share = close / Math.abs(p.qty);
    const cost = p.cost * share;
    const costTWD = p.costTWD * share;
    const part = (e.total * close) / e.qty;
    let realizedLocal = buy ? -cost - part : part - cost;
    let realized = buy ? -costTWD - part * twd : part * twd - costTWD;
    if (buy) {
      // Buying back pays the borrowing fee accrued on that part.
      const fee = p.borrowFee * share;
      p.borrowFee -= fee;
      add(s.cash, e.currency, -fee);
      s.paid.borrow += fee * twd;
      realizedLocal -= fee;
      realized -= fee * twd;
    }
    s.realized += realized;
    held.realized += realized;
    s.closed.push({
      id: e.id, t: e.t, symbol: e.symbol, name: e.name, market: e.market, kind: e.kind, currency: e.currency, qty: close, short: buy,
      proceeds: part, cost, realized, realizedLocal, pct: costTWD ? realized / Math.abs(costTWD) : 0, held: e.t - p.first
    });
    p.qty += buy ? close : -close;
    p.cost -= cost;
    p.costTWD -= costTWD;
    left -= close;
  }
  // Then what it opens or adds to: shares bought, or shares sold short.
  if (left > EPS) {
    const part = (e.total * left) / e.qty;
    if (Math.abs(p.qty) <= EPS) {
      p.first = e.t;
      p.feeLast = e.t;
    }
    p.qty += buy ? left : -left;
    p.cost += buy ? part : -part;
    p.costTWD += (buy ? part : -part) * twd;
  }
  if (Math.abs(p.qty) <= qtyStep(p.kind) / 2) delete s.positions[e.symbol];
}

// Cash and shares not already promised to open orders.
export function available(account, s) {
  const cash = { ...s.cash };
  const qty = {};
  for (const p of Object.values(s.positions)) qty[p.symbol] = p.qty;
  for (const o of account.orders || []) {
    if (o.status !== 'open') continue;
    if (o.side === 'buy') cash[o.currency] = (cash[o.currency] || 0) - (o.reserve || 0);
    else qty[o.symbol] = (qty[o.symbol] || 0) - o.qty;
  }
  return { cash, qty };
}

// Cash that can leave its market (be exchanged): what's available less sale
// proceeds that haven't settled yet (T+1, T+2).
export function unsettled(account, now = Date.now()) {
  const out = {};
  for (const e of account.events) if (e.type === 'fill' && e.side === 'sell' && e.settle > now && e.t <= now) add(out, e.currency, e.total);
  return out;
}
// When each currency's unsettled sale money is all settled: the latest
// pending settle moment per currency.
export function settlesBy(account, now = Date.now()) {
  const out = {};
  for (const e of account.events) if (e.type === 'fill' && e.side === 'sell' && e.settle > now && e.t <= now) out[e.currency] = Math.max(out[e.currency] || 0, e.settle);
  return out;
}
export function withdrawable(account, s, now = Date.now()) {
  const cash = available(account, s).cash;
  const pending = unsettled(account, now);
  for (const c of Object.keys(pending)) cash[c] = Math.max(0, Math.min(cash[c] || 0, (cash[c] || 0) - pending[c]));
  return cash;
}

// ---- Orders ------------------------------------------------------------------

// What a trade of `qty` at `price` costs or brings in, all in. `first`: the
// account's first trade ever, which pays no commission (the welcome offer,
// Quadra's: taxes and fees as usual). The app marks an account that hasn't
// traded (`withWelcome`); the offer is its first fill.
const traded = account => (account?.events || []).some(e => e.type === 'fill');
export const withWelcome = account => (account && !traded(account) && !account.welcome ? { ...account, welcome: true } : account);
export const firstTrade = account => account?.welcome === true && !traded(account);
export function estimate({ market, kind, currency, side, qty, price, t = Date.now(), dayTrade = false, first = false }) {
  const deal = dealPrice(market, side, price);
  const gross = roundCash(deal * qty, currency);
  const costs = tradeCosts({ market, side, kind, gross, currency, discount: first ? 0 : plusAt(t) ? plus.commission : 1, oddLot: isOddLot(market, kind, qty), dayTrade });
  const total = side === 'buy' ? gross + costs.total : gross - costs.total;
  return { price: deal, gross, ...costs, costs: costs.total, total };
}

// The price an open order fills at on this quote, or null. An order placed
// before the current session started also fills on the session's high or
// low having reached its price (the page can't watch every tick).
export function triggerPrice(order, quote, now) {
  if (!quote || !isOpen(quote, now)) return null;
  if (isOddLot(order.market, order.kind, order.qty) && !oddLotOpen(now)) return null;
  if (quote.kind !== 'crypto' && quote.session && quote.marketTime < quote.session.start) return null;
  const p = quote.price;
  const early = quote.session && order.t < quote.session.start;
  const lo = early && Number.isFinite(quote.dayLow) ? quote.dayLow : p;
  const hi = early && Number.isFinite(quote.dayHigh) ? quote.dayHigh : p;
  const buy = order.side === 'buy';
  switch (order.type) {
    case 'market':
      return p;
    case 'limit':
      if (buy) return p <= order.limit ? p : lo <= order.limit ? order.limit : null;
      return p >= order.limit ? p : hi >= order.limit ? order.limit : null;
    case 'stop':
      if (buy) return p >= order.stop ? p : hi >= order.stop ? Math.max(order.stop, p) : null;
      return p <= order.stop ? p : lo <= order.stop ? Math.min(order.stop, p) : null;
    default:
      return null;
  }
}

function checkQty(qty, kind) {
  if (!(qty > 0)) return 'qty';
  if (Math.abs(roundQty(qty, kind) - qty) > qtyStep(kind) * 1e-3) return 'qtyStep';
  return null;
}

// Good-till-cancelled orders last this long (brokers' 長效單: a month).
export const GTC_DAYS = 30;
// When a day order placed now ends: the close of the session it's for (the
// one under way, or the next one when the market is shut).
export function dayOrderEnd(quote, now = Date.now()) {
  const s = quote?.session;
  if (!s || !(s.end > s.start)) return now + 86_400_000;
  if (now < s.end && s.start - now < 20 * 3_600_000) return s.end;
  const start = nextTradingStart(quote.market, s.start, quote.tz, now);
  return start + (s.end - s.start);
}
// Orders past their end: expired, their cash or shares free again.
export function expireOrders(account, now = Date.now()) {
  const due = account.orders.filter(o => o.status === 'open' && o.expires && now >= o.expires && !o.forced);
  if (!due.length) return { account, expired: [] };
  let next = account;
  for (const o of due) next = updateOrder(next, { ...o, status: 'expired', rev: o.rev + 1, done: o.expires });
  return { account: next, expired: due };
}

// A new order. Fills at once when its market is open and its price is met;
// otherwise it waits (and holds its cash or shares) until it fills or is
// cancelled. Returns { account, order, fill } or { error }.
export function placeOrder(account, req, { quote, rates, valuation, now = Date.now(), id = randomId() }) {
  const { side, type = 'market' } = req;
  if (!quote) return { error: 'noQuote' };
  if (!isTradable(quote.kind)) return { error: 'notTradable' };
  const qty = Number(req.qty);
  const qtyError = checkQty(qty, quote.kind);
  if (qtyError) return { error: qtyError };
  if (side !== 'buy' && side !== 'sell') return { error: 'side' };
  if (type === 'limit' && !(req.limit > 0)) return { error: 'limit' };
  if (type === 'stop' && !(req.stop > 0)) return { error: 'stop' };
  if (!rates?.[quote.currency]) return { error: 'noRate' };
  // The exchange's own rules: prices on its tick, limit orders inside
  // Taiwan's daily ±10%.
  for (const x of [type === 'limit' ? Number(req.limit) : null, type === 'stop' ? Number(req.stop) : null]) {
    if (x == null) continue;
    const tick = tickSize(quote.market, quote.kind, x);
    if (!onTick(x, tick)) return { error: 'tick', tick };
  }
  const band = priceLimits(quote);
  if (band && type === 'limit' && (req.limit > band.up + EPS || req.limit < band.down - EPS)) return { error: 'priceLimit', ...band };
  const s = replay(account, now);
  const avail = available(account, s);
  // Board lots (Japan 100, China's buys 100, Hong Kong each stock's own).
  const lot = lotProblem(quote.market, quote.symbol, quote.kind, side, qty, Math.max(0, avail.qty[quote.symbol] || 0));
  if (lot) return { error: 'lot', lot: lot.lot };
  // China's T+1: shares bought today can be sold from the next trading day.
  if (side === 'sell' && quote.market === 'CN') {
    const today = localDayOf(now, 'CN');
    const boughtToday = account.events.filter(e => e.type === 'fill' && e.symbol === quote.symbol && e.side === 'buy' && e.t <= now && localDayOf(e.t, 'CN') === today).reduce((sum, e) => sum + e.qty, 0);
    const can = Math.max(0, (avail.qty[quote.symbol] || 0) - boughtToday);
    if (qty > can + EPS) return { error: 'tPlus1', can };
  }
  const order = {
    id,
    symbol: quote.symbol,
    name: quote.name,
    kind: quote.kind,
    market: quote.market,
    currency: quote.currency,
    side,
    type,
    qty,
    t: now,
    status: 'open',
    rev: 1
  };
  if (type === 'limit') order.limit = Number(req.limit);
  if (type === 'stop') order.stop = Number(req.stop);
  if (req.forced) order.forced = true;
  // How long it lasts: a day order ends with its session (what exchanges
  // and brokers do by default); good-till-cancelled lasts GTC_DAYS. Crypto
  // and currency pairs never close, so theirs are GTC.
  order.tif = req.tif === 'gtc' || quote.kind === 'crypto' || quote.kind === 'fx' ? 'gtc' : 'day';
  order.expires = order.tif === 'gtc' ? now + GTC_DAYS * 86_400_000 : dayOrderEnd(quote, now);
  if (side === 'sell') {
    const have = Math.max(0, avail.qty[quote.symbol] || 0);
    const short = qty - have;
    if (short > EPS) {
      // Selling more than is held sells the rest short.
      if (!isShortable(quote.kind)) return { error: 'shares', have };
      if (!valuation) return { error: 'noValuation' };
      if (valuation.margin !== 'ok') return { error: 'margin' };
      const value = short * quote.price * rates[quote.currency];
      const owed = valuation.debtTWD + valuation.shortTWD + value;
      if ((valuation.assets + value) / owed < SHORT_INITIAL - EPS) {
        const room = Math.max(0, (valuation.assets - SHORT_INITIAL * (valuation.debtTWD + valuation.shortTWD)) / (SHORT_INITIAL - 1));
        return { error: 'shortMargin', max: roundQty(have + room / (quote.price * rates[quote.currency]), quote.kind) };
      }
      order.short = true;
    }
  } else {
    // The most it can cost: a limit order at its limit, a stop order at its
    // stop or the price, a market order at the price (plus a margin while it
    // waits for the market to open).
    const { reserve } = requiredCash(order, quote, now);
    const have = avail.cash[quote.currency] || 0;
    if (reserve > have + EPS) return { error: 'funds', need: reserve, have: Math.max(0, have), currency: quote.currency };
    order.reserve = reserve;
  }
  let next = { ...account, orders: [...(account.orders || []), order] };
  const price = triggerPrice(order, quote, now);
  if (price === null) return { account: next, order, fill: null };
  const filled = fillOrder(next, order, price, rates, now);
  return { account: filled.account, order: filled.order, fill: filled.fill, error: filled.error, need: filled.need, have: filled.have };
}

// What a buy order needs in its currency, the very figure placeOrder checks:
// { est (the all-in estimate), reserve (what's held until it fills),
// buffer (the part of reserve above the estimate, returned when it fills) }.
// A limit order holds its limit's cost; an order that fills right away its
// cost; one that waits for its market (a market or stop order while it's
// shut) holds 3% more, since it can open higher.
export function requiredCash(order, quote, now = Date.now()) {
  const last = order.type === 'stop' ? Math.max(Number(order.stop), quote.price) : quote.price;
  const ref = order.type === 'limit' ? Number(order.limit) : marketFill(quote.market, quote.kind, 'buy', last);
  const est = estimate({ market: quote.market, kind: quote.kind, currency: quote.currency, side: 'buy', qty: order.qty, price: ref });
  const fillsNow = triggerPrice({ ...order, side: 'buy', t: now }, quote, now) !== null;
  const reserve = roundCash(fillsNow || order.type === 'limit' ? est.total : est.total * (1 + RESERVE_BUFFER), quote.currency);
  return { est, reserve, buffer: Math.max(0, reserve - est.total), fillsNow, ref };
}

function updateOrder(account, order) {
  return { ...account, orders: account.orders.map(o => (o.id === order.id ? order : o)) };
}

// Fills `order` at `price`. The fill is dated `at` (a past moment when it's
// found in the price history); cash and shares are checked as of `now`.
function fillOrder(account, order, price, rates, now, at = now) {
  // A market (or triggered stop) order crosses the spread: it buys at the
  // ask and sells at the bid. A limit order fills at its price or better.
  const quote = price;
  if (order.type !== 'limit') price = marketFill(order.market, order.kind, order.side, price);
  else price = order.side === 'buy' ? Math.min(price, order.limit) : Math.max(price, order.limit);
  // A Taiwan stock sold the day it was bought pays the day-trade tax.
  const dayTrade = order.side === 'sell' && order.market === 'TW' && account.events.some(e => e.type === 'fill' && e.symbol === order.symbol && e.side === 'buy' && e.t <= at && localDayOf(e.t, 'TW') === localDayOf(at, 'TW'));
  const est = estimate({ market: order.market, kind: order.kind, currency: order.currency, side: order.side, qty: order.qty, price, t: at, dayTrade, first: firstTrade(account) });
  // A fill found in the past must have fitted the cash (or shares) at that
  // moment and still fit today's.
  const moments = at < now ? [at, now] : [now];
  if (order.side === 'buy' && !order.forced) {
    // This order's own hold is released as it fills.
    const have = Math.min(...moments.map(tt => (available(account, replay(account, tt)).cash[order.currency] || 0))) + (order.reserve || 0);
    if (est.total > have + EPS) {
      const rejected = { ...order, status: 'rejected', reason: 'funds', rev: order.rev + 1, done: now };
      return { account: updateOrder(account, rejected), order: rejected, fill: null, error: 'funds', need: est.total, have };
    }
  } else if (order.side === 'sell' && (!order.short || !isShortable(order.kind))) {
    const held = Math.min(...moments.map(tt => replay(account, tt).positions[order.symbol]?.qty || 0));
    if (held + EPS < order.qty) {
      const rejected = { ...order, status: 'rejected', reason: 'shares', rev: order.rev + 1, done: now };
      return { account: updateOrder(account, rejected), order: rejected, fill: null, error: 'shares' };
    }
  }
  const fill = {
    id: `fill:${order.id}`,
    type: 'fill',
    t: at,
    orderId: order.id,
    symbol: order.symbol,
    name: order.name,
    kind: order.kind,
    market: order.market,
    currency: order.currency,
    side: order.side,
    qty: order.qty,
    price: est.price,
    quote,
    settle: settleDate(order.market, at),
    gross: est.gross,
    commission: est.commission,
    tax: est.tax,
    fee: est.fee,
    total: est.total,
    twd: rates[order.currency]
  };
  if (order.forced) fill.forced = true;
  const done = { ...order, status: 'filled', rev: order.rev + 1, done: at, fillId: fill.id, price: est.price };
  const next = updateOrder({ ...account, events: [...account.events, fill] }, done);
  return { account: next, order: done, fill };
}

export function cancelOrder(account, orderId, now = Date.now()) {
  const order = account.orders.find(o => o.id === orderId);
  if (!order || order.status !== 'open') return account;
  return updateOrder(account, { ...order, status: 'cancelled', rev: order.rev + 1, done: now });
}

// Fills every open order whose price is met on these quotes.
export function processOrders(account, quotes, rates, now = Date.now()) {
  let next = account;
  const filled = [];
  const rejected = [];
  for (const order of account.orders.filter(o => o.status === 'open' && !(o.expires && now >= o.expires && !o.forced)).sort(byTime)) {
    const quote = quotes.get(order.symbol);
    if (!quote || !rates?.[order.currency]) continue;
    const price = triggerPrice(order, quote, now);
    if (price === null) continue;
    const r = fillOrder(next, order, price, rates, now);
    next = r.account;
    if (r.fill) filled.push(r.fill);
    else rejected.push(r.order);
  }
  return { account: next, filled, rejected };
}

// When an order waiting while the page was closed would have filled: the
// first price bar after it was placed that reaches its price (bars:
// [{ t, o, h, l, c }], oldest first). A gap through the price fills at the
// bar's open, like a real order.
export function backfillPrice(order, bars) {
  const odd = isOddLot(order.market, order.kind, order.qty);
  for (const b of bars) {
    if (order.expires && b.t >= order.expires) break;
    if (b.t < order.t || !Number.isFinite(b.o)) continue;
    if (odd && !oddLotOpen(b.t)) continue;
    const buy = order.side === 'buy';
    if (order.type === 'market') return { t: b.t, price: b.o };
    if (order.type === 'limit') {
      if (buy && b.l <= order.limit) return { t: b.t, price: Math.min(b.o, order.limit) };
      if (!buy && b.h >= order.limit) return { t: b.t, price: Math.max(b.o, order.limit) };
    } else if (order.type === 'stop') {
      if (buy && b.h >= order.stop) return { t: b.t, price: Math.max(b.o, order.stop) };
      if (!buy && b.l <= order.stop) return { t: b.t, price: Math.min(b.o, order.stop) };
    }
  }
  return null;
}

// Fills an open order at a price found in the history, dated then. `twd`:
// NT$ per unit of its currency at that moment.
export function fillFromHistory(account, orderId, { t, price }, twd, now = Date.now()) {
  const order = account.orders.find(o => o.id === orderId && o.status === 'open');
  if (!order || !(twd > 0)) return { account };
  const r = fillOrder(account, order, price, { [order.currency]: twd }, now, Math.min(t, now));
  return { account: r.account, fill: r.fill, order: r.order };
}

// ---- Currency exchange -------------------------------------------------------

export function fxSpread(from, to, fxOpen = true, t = Date.now()) {
  return Math.max(currencyInfo(from).spread, currencyInfo(to).spread) * (fxOpen ? 1 : CLOSED_FX_MULTIPLIER) * (plusAt(t) ? plus.fxSpread : 1);
}

// What `amount` of `from` buys in `to`: the middle rate less the spread,
// rounded down to the currency's smallest unit.
export function quoteExchange(from, to, amount, rates, fxOpen = true) {
  if (!rates?.[from] || !rates?.[to] || from === to || !(amount > 0)) return null;
  const mid = rates[from] / rates[to];
  const spread = fxSpread(from, to, fxOpen);
  const f = 10 ** currencyInfo(to).digits;
  const received = Math.floor(amount * mid * (1 - spread) * f + 1e-7) / f;
  return { from, to, amount, mid, spread, rate: received / amount, received, spreadTWD: amount * rates[from] - received * rates[to] };
}

// How much `from` it takes to receive `need` of `to`.
export function amountFor(from, to, need, rates, fxOpen = true) {
  if (!rates?.[from] || !rates?.[to] || !(need > 0)) return null;
  const f = 10 ** currencyInfo(from).digits;
  let amount = Math.ceil(((need / (rates[from] / rates[to])) / (1 - fxSpread(from, to, fxOpen))) * f - 1e-7) / f;
  // Rounding can leave it a unit short.
  for (let i = 0; i < 3 && quoteExchange(from, to, amount, rates, fxOpen).received < need; i++) amount += 1 / f;
  return Math.round(amount * f) / f;
}

export function exchange(account, { from, to, amount }, { rates, fxOpen = true, now = Date.now(), id = randomId() }) {
  amount = roundCash(Number(amount), from);
  const q = quoteExchange(from, to, amount, rates, fxOpen);
  if (!q) return { error: 'fx' };
  if (!(q.received > 0)) return { error: 'tooSmall' };
  const free = withdrawable(account, replay(account, now), now);
  if ((free[from] || 0) + EPS < amount) {
    const pending = unsettled(account, now)[from] || 0;
    return { error: pending > EPS ? 'unsettled' : 'funds', need: amount, have: Math.max(0, free[from] || 0), currency: from };
  }
  const event = {
    id: `fx:${id}`,
    type: 'fx',
    t: now,
    from,
    to,
    amount,
    received: q.received,
    rate: q.rate,
    mid: q.mid,
    spread: q.spread,
    spreadTWD: q.spreadTWD,
    twdFrom: rates[from],
    twdTo: rates[to]
  };
  return { account: { ...account, events: [...account.events, event] }, event };
}

// Add money (NT$) to the account; tracked apart from returns.
export function deposit(account, amount, now = Date.now(), id = randomId()) {
  amount = Math.round(Number(amount));
  if (!(amount > 0 && amount <= MAX_START)) return { error: 'amount' };
  const event = { id: `deposit:${id}`, type: 'deposit', t: now, currency: BASE, amount };
  return { account: { ...account, events: [...account.events, event] }, event };
}

// ---- Valuation ---------------------------------------------------------------

// Everything in NT$ at today's prices and rates. A holding with no quote is
// valued at its last trade price and listed in `stale`.
export function valuate(s, quotes, rates) {
  const rate = cur => rates?.[cur] ?? null;
  const out = { cash: [], positions: [], loans: [], stale: [], missingRates: [] };
  let cashTWD = 0;
  for (const [currency, amount] of Object.entries(s.cash)) {
    const r = rate(currency);
    if (r === null) out.missingRates.push(currency);
    const twd = amount * (r ?? 0);
    cashTWD += twd;
    if (Math.abs(amount) > EPS || currency === BASE) out.cash.push({ currency, amount, twd });
  }
  let longTWD = 0;
  let shortTWD = 0;
  let feesTWD = 0;
  let dayChange = 0;
  let collateral = 0;
  for (const p of Object.values(s.positions)) {
    const q = quotes?.get?.(p.symbol);
    const r = rate(p.currency);
    if (r === null) out.missingRates.push(p.currency);
    if (!q) out.stale.push(p.symbol);
    const price = q?.price ?? p.last ?? Math.abs(p.cost / p.qty);
    const value = price * p.qty;
    const valueTWD = value * (r ?? 0);
    const fee = (p.borrowFee || 0) * (r ?? 0);
    const pl = valueTWD - p.costTWD - fee;
    // Today's move, in NT$ at today's rate (a position opened today moves
    // from its own price, not yesterday's close).
    const from = q ? (p.first > (q.session?.start ?? Infinity) ? Math.abs(p.cost / p.qty) : q.prev) : price;
    const day = (price - from) * p.qty * (r ?? 0);
    dayChange += day;
    if (p.qty > 0) {
      longTWD += valueTWD;
      collateral += valueTWD * (COLLATERAL[p.kind] ?? 0.5);
    } else {
      shortTWD -= valueTWD;
      feesTWD += fee;
    }
    out.positions.push({
      ...p,
      short: p.qty < 0,
      quote: q || null,
      price,
      avg: Math.abs(p.cost / p.qty),
      value,
      valueTWD,
      pl,
      plLocal: value - p.cost - (p.borrowFee || 0),
      plPct: p.costTWD ? pl / Math.abs(p.costTWD) : 0,
      dayTWD: day,
      dayPct: q ? q.pct : 0
    });
  }
  let debtTWD = feesTWD;
  for (const loan of Object.values(s.loans)) {
    if (loan.balance <= EPS) continue;
    const twd = loan.balance * (rate(loan.currency) ?? 0);
    debtTWD += twd;
    out.loans.push({ ...loan, twd });
  }
  const assets = cashTWD + longTWD;
  const owed = debtTWD + shortTWD;
  const receivable = s.receivable || 0;
  const netWorth = assets + receivable - owed;
  for (const p of out.positions) p.weight = assets ? Math.abs(p.valueTWD) / assets : 0;
  out.positions.sort((a, b) => Math.abs(b.valueTWD) - Math.abs(a.valueTWD));
  out.cash.sort((a, b) => (a.currency === BASE ? -1 : b.currency === BASE ? 1 : b.twd - a.twd));
  const interestTWD = Object.values(s.loans).reduce((sum, l) => sum + l.interest * (rate(l.currency) ?? 0), 0);
  const ratio = owed > EPS ? assets / owed : Infinity;
  return {
    ...out,
    cashTWD,
    holdingsTWD: longTWD - shortTWD,
    longTWD,
    shortTWD,
    assets,
    debtTWD,
    owed,
    netWorth,
    receivable,
    deposits: s.deposits,
    totalReturn: netWorth - s.deposits,
    totalReturnPct: s.deposits ? netWorth / s.deposits - 1 : 0,
    dayChange,
    unrealized: out.positions.reduce((sum, p) => sum + p.pl, 0),
    realized: s.realized,
    dividends: s.dividends,
    interestTWD,
    paid: { ...s.paid, interest: interestTWD, borrow: s.paid.borrow + feesTWD },
    collateral,
    capacity: Math.max(0, collateral - debtTWD - shortTWD * 0.5),
    ratio,
    margin: ratio < MARGIN_LIQUIDATE ? 'liquidate' : ratio < MARGIN_CALL ? 'call' : 'ok',
    byKind: groupBy(out.positions.filter(p => !p.short), p => p.kind, cashTWD),
    byCurrency: currencyExposure(s, out.positions, rates)
  };
}

function groupBy(positions, key, cashTWD) {
  const groups = {};
  for (const p of positions) groups[key(p)] = (groups[key(p)] || 0) + p.valueTWD;
  if (cashTWD > EPS) groups.cash = cashTWD;
  return groups;
}

// How much of the account (holdings, cash, less loans) is in each currency.
function currencyExposure(s, positions, rates) {
  const out = {};
  for (const [cur, amount] of Object.entries(s.cash)) out[cur] = (out[cur] || 0) + amount * (rates?.[cur] ?? 0);
  for (const p of positions) out[p.currency] = (out[p.currency] || 0) + p.valueTWD;
  for (const loan of Object.values(s.loans)) out[loan.currency] = (out[loan.currency] || 0) - loan.balance * (rates?.[loan.currency] ?? 0);
  for (const k of Object.keys(out)) if (Math.abs(out[k]) < 0.5) delete out[k];
  return out;
}

// ---- Loans -------------------------------------------------------------------

// The yearly rate a loan taken now carries (Quadra Plus: less).
export const loanRateAt = (currency, t = Date.now()) => Math.max(0, currencyInfo(currency).loanRate - (plusAt(t) ? plus.loanCut : 0));
export function borrow(account, { currency, amount }, { valuation, rates, now = Date.now(), id = randomId() }) {
  amount = roundCash(Number(amount), currency);
  if (!(amount > 0)) return { error: 'amount' };
  if (!rates?.[currency]) return { error: 'noRate' };
  if (valuation.margin !== 'ok') return { error: 'margin' };
  if (amount * rates[currency] > valuation.capacity + EPS) return { error: 'capacity', capacity: valuation.capacity };
  const event = { id: `borrow:${id}`, type: 'borrow', t: now, currency, amount, rate: loanRateAt(currency, now) };
  return { account: { ...account, events: [...account.events, event] }, event };
}

export function repay(account, { currency, amount }, { now = Date.now(), id = randomId() } = {}) {
  const s = replay(account, now);
  const loan = s.loans[currency];
  if (!loan || loan.balance <= EPS) return { error: 'noLoan' };
  const avail = available(account, s).cash[currency] || 0;
  const f = 10 ** currencyInfo(currency).digits;
  // Paying "everything" pays the interest accrued to this moment, rounded up.
  const owed = Math.ceil(loan.balance * f - 1e-7) / f;
  amount = Math.min(roundCash(Number(amount), currency), owed);
  if (!(amount > 0)) return { error: 'amount' };
  if (amount > avail + EPS) return { error: 'funds', need: amount, have: Math.max(0, avail), currency };
  const event = { id: `repay:${id}`, type: 'repay', t: now, currency, amount };
  return { account: { ...account, events: [...account.events, event] }, event };
}

// Pays off every loan it can: first from cash in the loan's own currency,
// then by exchanging NT$ and other cash. Used after a forced sale.
export function repayAll(account, rates, fxOpen, now = Date.now()) {
  let next = account;
  let seq = 0;
  const nextId = () => `${now.toString(36)}${(seq++).toString(36)}`;
  for (const currency of Object.keys(replay(next, now).loans)) {
    for (let round = 0; round < 12; round++) {
      const s = replay(next, now);
      const loan = s.loans[currency];
      if (!loan || loan.balance <= EPS) break;
      const avail = available(next, s).cash;
      const own = avail[currency] || 0;
      if (own > EPS) {
        const r = repay(next, { currency, amount: Math.min(own, loan.balance + 1) }, { now, id: nextId() });
        if (r.error) break;
        next = r.account;
        continue;
      }
      // Other cash, NT$ first, then the largest.
      const sources = Object.entries(avail)
        .filter(([c, v]) => c !== currency && v > EPS && rates?.[c])
        .sort(([a, va], [b, vb]) => (a === BASE ? -1 : b === BASE ? 1 : vb * rates[b] - va * rates[a]));
      if (!sources.length) break;
      const [from, has] = sources[0];
      const need = amountFor(from, currency, Math.ceil(loan.balance * 100) / 100, rates, fxOpen);
      const x = exchange(next, { from, to: currency, amount: Math.min(has, need) }, { rates, fxOpen, now, id: nextId() });
      if (x.error) break;
      next = x.account;
    }
  }
  return next;
}

// Below the liquidation ratio, the broker sells: the largest holdings first,
// until what's sold covers the debt. Returns the orders to place (none while
// earlier forced sales are still open).
export function liquidationPlan(account, valuation) {
  if (valuation.margin !== 'liquidate') return [];
  if (account.orders.some(o => o.status === 'open' && o.forced)) return [];
  // Every short is bought back; then holdings are sold, largest first,
  // until what's sold covers the loans.
  const plan = valuation.positions.filter(p => p.short).map(p => ({ symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true }));
  let covered = valuation.cashTWD - valuation.shortTWD;
  for (const p of valuation.positions.filter(x => !x.short)) {
    if (covered >= valuation.debtTWD * 1.02) break;
    plan.push({ symbol: p.symbol, side: 'sell', type: 'market', qty: p.qty, forced: true });
    covered += p.valueTWD;
  }
  return plan;
}

// Selling to cover an overdraft (the Quadra pool below zero, NT$ cash
// negative): the fewest sales that raise `owedTWD` (plus 1% for costs), from
// the largest holdings down, each only as much as it needs (rounded up to
// what can be traded). Holdings with no price now are skipped.
export function coverPlan(valuation, owedTWD) {
  const plan = [];
  let left = owedTWD * 1.01;
  const longs = valuation.positions.filter(p => !p.short && p.qty > 0 && p.valueTWD > 0 && isTradable(p.kind)).sort((a, b) => b.valueTWD - a.valueTWD);
  for (const p of longs) {
    if (left <= 0) break;
    const unit = p.valueTWD / p.qty;
    const step = qtyStep(p.kind);
    let qty = Math.min(p.qty, Math.ceil(left / unit / step) * step);
    qty = roundQty(qty, p.kind);
    if (!(qty > 0)) continue;
    plan.push({ symbol: p.symbol, qty, twd: qty * unit, all: qty >= p.qty });
    left -= qty * unit;
  }
  return { plan, covered: left <= 0 };
}

// While the page was closed, a loan or a short could have fallen below the
// liquidation ratio and recovered since; a broker would have sold then. This
// walks `times` (the moments prices are known for, oldest first), values
// the account at each with priceAt(symbol, t) and rateAt(currency, t), and
// where it's below the line, buys shorts back and sells holdings at that
// moment's prices, dated then, and repays the loans. Returns the forced fills.
export function marginHistory(account, { times, priceAt, rateAt }) {
  let next = account;
  const forced = [];
  for (const t of times) {
    const s = replay(next, t);
    const owes = Object.values(s.loans).some(l => l.balance > EPS) || Object.values(s.positions).some(p => p.qty < -EPS);
    if (!owes) continue;
    const rates = { [BASE]: 1 };
    const currencies = new Set([...Object.keys(s.cash), ...Object.keys(s.loans), ...Object.values(s.positions).map(p => p.currency)]);
    let known = true;
    for (const c of currencies) {
      if (c === BASE) continue;
      rates[c] = rateAt(c, t);
      if (!(rates[c] > 0)) known = false;
    }
    if (!known) continue;
    const quotes = new Map();
    for (const p of Object.values(s.positions)) {
      const price = priceAt(p.symbol, t) ?? p.last;
      quotes.set(p.symbol, { symbol: p.symbol, price, prev: price, kind: p.kind, market: p.market, currency: p.currency });
    }
    const v = valuate(s, quotes, rates);
    if (v.margin !== 'liquidate') continue;
    for (const plan of liquidationPlan(next, v)) {
      const p = s.positions[plan.symbol];
      const order = {
        id: `forced:${plan.symbol}:${t}`, symbol: plan.symbol, name: p.name, kind: p.kind, market: p.market, currency: p.currency,
        side: plan.side, type: 'market', qty: plan.qty, t, status: 'open', rev: 1, forced: true, reserve: 0
      };
      const r = fillOrder({ ...next, orders: [...next.orders, order] }, order, quotes.get(plan.symbol).price, rates, t, t);
      next = r.account;
      if (r.fill) forced.push(r.fill);
    }
    next = repayAll(next, rates, true, t);
  }
  return { account: next, forced };
}

// ---- Dividends and splits ----------------------------------------------------

function sharesAt(account, symbol, t) {
  let qty = 0;
  for (const e of [...account.events].sort(byTime)) {
    if (e.t >= t) break;
    if (e.symbol !== symbol) continue;
    if (e.type === 'fill') qty += e.side === 'buy' ? e.qty : -e.qty;
    else if (e.type === 'split') qty *= e.ratio;
  }
  return Math.abs(qty) > EPS ? qty : 0;
}

// Credits the dividends and applies the splits of `symbol` that happened
// while it was held. Yahoo's dividend amounts are adjusted for later splits,
// so each is scaled back to the shares of its own day. A dividend counts on
// its ex-date (shares held then) and is paid on its market's usual pay day.
export function applyCorporateActions(account, symbol, { dividends = [], splits = [] }, { rates, now = Date.now() }) {
  const fills = account.events.filter(e => e.type === 'fill' && e.symbol === symbol);
  if (!fills.length) return { account, added: [] };
  const first = Math.min(...fills.map(e => e.t));
  const info = fills[0];
  const have = new Set(account.events.map(e => e.id));
  let next = account;
  const added = [];
  for (const sp of splits) {
    const id = `split:${symbol}:${taipeiDay(sp.date)}`;
    if (sp.date <= first || sp.date > now || have.has(id) || !(sp.ratio > 0) || sp.ratio === 1) continue;
    if (!sharesAt(next, symbol, sp.date)) continue;
    const event = { id, type: 'split', t: sp.date, symbol, ratio: sp.ratio };
    next = { ...next, events: [...next.events, event] };
    added.push(event);
  }
  const rate = rates?.[info.currency];
  if (!rate) return { account: next, added };
  for (const d of dividends) {
    const id = `div:${symbol}:${taipeiDay(d.date)}`;
    if (d.date <= first || d.date > now || have.has(id) || !(d.amount > 0)) continue;
    const shares = sharesAt(next, symbol, d.date);
    if (!shares) continue;
    const later = splits.filter(sp => sp.date > d.date).reduce((k, sp) => k * sp.ratio, 1);
    const perShare = d.amount * later;
    const gross = roundCash(shares * perShare, info.currency);
    if (!gross) continue;
    // A short position pays the dividend to the lender, untaxed.
    const taxes = gross > 0 ? dividendTaxes(info.market, gross) : { withheld: 0, nhi: 0, net: gross };
    // Owed from the ex-date, paid some days later (until then it's pending).
    const event = {
      id, type: 'div', t: d.date + divPayDays(info.market) * 86_400_000, ex: d.date, symbol, name: info.name, market: info.market, kind: info.kind, currency: info.currency,
      shares, perShare, gross, withheld: taxes.withheld, nhi: taxes.nhi, net: roundCash(taxes.net, info.currency), twd: rate
    };
    next = { ...next, events: [...next.events, event] };
    added.push(event);
  }
  return { account: next, added };
}

// ---- Government bonds: coupons and repayment -----------------------------------

// Credits each coupon paid while the bond was held (less the issuer's tax)
// and, once it matures, repays the face value (a sale at par, no costs).
export function applyBondCashflows(account, symbol, { rates, now = Date.now() }) {
  const bond = BONDS[symbol];
  const fills = account.events.filter(e => e.type === 'fill' && e.symbol === symbol);
  if (!bond || !fills.length) return { account, added: [] };
  const rate = rates?.[bond.currency];
  if (!rate) return { account, added: [] };
  const first = Math.min(...fills.map(e => e.t));
  const info = fills[0];
  const have = new Set(account.events.map(e => e.id));
  let next = account;
  const added = [];
  const perBond = (bond.face * bond.coupon) / 100 / bond.freq;
  if (perBond > 0) {
    for (const d of couponDates(bond, first)) {
      const id = `cpn:${symbol}:${taipeiDay(d)}`;
      if (d <= first || d > now || have.has(id)) continue;
      const shares = sharesAt(next, symbol, d);
      if (!(shares > 0)) continue;
      const gross = roundCash(shares * perBond, bond.currency);
      const withheld = roundCash(gross * bond.tax, bond.currency);
      const event = {
        id, type: 'div', coupon: true, t: d, symbol, name: info.name, market: 'BOND', kind: 'govbond', currency: bond.currency,
        shares, perShare: perBond, gross, withheld, nhi: 0, net: roundCash(gross - withheld, bond.currency), twd: rate
      };
      next = { ...next, events: [...next.events, event] };
      added.push(event);
    }
  }
  const matureId = `mature:${symbol}`;
  if (now >= bond.maturity && !have.has(matureId)) {
    const shares = sharesAt(next, symbol, bond.maturity + 1);
    if (shares > 0) {
      const total = roundCash(shares * bond.face, bond.currency);
      const event = {
        id: matureId, type: 'fill', maturity: true, t: bond.maturity + 1, orderId: null, symbol, name: info.name, kind: 'govbond', market: 'BOND',
        currency: bond.currency, side: 'sell', qty: shares, price: bond.face, quote: bond.face, gross: total, commission: 0, tax: 0, fee: 0, total, twd: rate
      };
      next = { ...next, events: [...next.events, event] };
      added.push(event);
    }
  }
  return { account: next, added };
}

// ---- History: net worth over time, benchmarks --------------------------------

// Net worth at the end of each of `days`, rebuilt from the log and each
// day's closing prices and rates: priceAt(symbol, t) and rateAt(currency, t)
// return null when unknown (the last trade price is used then).
export function netWorthSeries(account, days, priceAt, rateAt) {
  const out = [];
  for (const t of days) {
    if (t < account.created) continue;
    const s = replay(account, t);
    let nw = s.receivable || 0;
    let ok = true;
    for (const [cur, amount] of Object.entries(s.cash)) {
      if (!amount) continue;
      const r = rateAt(cur, t);
      if (!r) ok = false;
      nw += amount * (r || 0);
    }
    for (const p of Object.values(s.positions)) {
      const r = rateAt(p.currency, t);
      if (!r) ok = false;
      nw += p.qty * (priceAt(p.symbol, t) ?? p.last) * (r || 0) - (p.borrowFee || 0) * (r || 0);
    }
    for (const loan of Object.values(s.loans)) nw -= loan.balance * (rateAt(loan.currency, t) || 0);
    if (ok) out.push([t, nw, s.deposits]);
  }
  return out;
}

// Records today's net worth (and money put in) once every 10 minutes at most.
export function recordSnapshot(account, now, netWorth, deposits) {
  const day = taipeiDay(now);
  const last = account.snapshots?.[day];
  if (last && now - last.t < 10 * 60_000) return account;
  return { ...account, snapshots: { ...(account.snapshots || {}), [day]: { t: now, nw: Math.round(netWorth), dep: Math.round(deposits) } } };
}

// What the same deposits would be worth in one benchmark: each deposit buys
// it at the price of its day (points: [t, price in NT$], oldest first).
export function benchmarkValue(deposits, points, price) {
  if (!points?.length) return null;
  let units = 0;
  for (const d of deposits) {
    let p = points[0][1];
    for (const [t, c] of points) {
      if (t > d.t) break;
      p = c;
    }
    // Deposited after the last point (today): at today's price.
    if (price != null && d.t > points.at(-1)[0]) p = price;
    units += d.amount / p;
  }
  return units * (price ?? points.at(-1)[1]);
}

// ---- Merge (sync) ------------------------------------------------------------

const STATUS_RANK = { open: 0, cancelled: 1, rejected: 1, filled: 2 };

// Two copies of the account become one. A copy started over (a new id) wins
// if it's the newer start.
export function mergeAccounts(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.id !== b.id) return b.created > a.created ? b : a;
  const events = new Map();
  for (const e of [...a.events, ...b.events]) if (!events.has(e.id)) events.set(e.id, e);
  const orders = new Map();
  for (const o of [...a.orders, ...b.orders]) {
    const had = orders.get(o.id);
    if (!had) orders.set(o.id, o);
    else {
      const rank = STATUS_RANK[o.status] - STATUS_RANK[had.status];
      if (rank > 0 || (rank === 0 && (o.rev || 0) > (had.rev || 0))) orders.set(o.id, o);
    }
  }
  // An order with a fill anywhere is filled.
  for (const e of events.values()) {
    if (e.type !== 'fill') continue;
    const o = orders.get(e.orderId);
    if (o && o.status !== 'filled') orders.set(o.id, { ...o, status: 'filled', rev: (o.rev || 0) + 1, done: e.t, fillId: e.id, price: e.price });
  }
  const snapshots = { ...(a.snapshots || {}) };
  for (const [day, snap] of Object.entries(b.snapshots || {})) if (!snapshots[day] || snap.t > snapshots[day].t) snapshots[day] = snap;
  const latest = (x = {}, y = {}) => {
    const out = { ...x };
    for (const [k, v] of Object.entries(y)) if (!out[k] || v.t > out[k].t) out[k] = v;
    return out;
  };
  const merged = {
    ...a,
    events: [...events.values()].sort(byTime),
    orders: [...orders.values()].sort(byTime),
    snapshots,
    watch: latest(a.watch, b.watch)
  };
  if (a.plans || b.plans) merged.plans = latest(a.plans, b.plans);
  // Paydays began at the earlier of the two.
  if (a.income || b.income) merged.income = { since: Math.min(a.income?.since ?? Infinity, b.income?.since ?? Infinity) };
  if (a.alerts || b.alerts) merged.alerts = latest(a.alerts, b.alerts);
  return merged;
}

// A saved copy, checked: anything that isn't an account is refused.
export function isAccount(value) {
  return Boolean(value && typeof value === 'object' && value.v === ACCOUNT_VERSION && typeof value.id === 'string' && Array.isArray(value.events) && Array.isArray(value.orders));
}

export function toggleWatch(account, symbol, now = Date.now()) {
  const on = !account.watch?.[symbol]?.on;
  return { ...account, watch: { ...(account.watch || {}), [symbol]: { on, t: now } } };
}
export const watched = account => Object.entries(account?.watch || {}).filter(([, w]) => w.on).sort((a, b) => a[1].t - b[1].t).map(([s]) => s);

// ---- Monthly plans (定期定額) --------------------------------------------------
//
// A plan buys `amount` NT$ worth of one symbol on day `day` of every month
// (the first price on or after that day, 00:00 Taiwan time). A foreign
// symbol's NT$ is exchanged first, at that moment's rate. Each month's buy
// is an order with a fixed id (plan:<plan>:<YYYY-MM>), so a month runs once
// however many devices catch up on it. Plans merge like the watchlist: the
// latest change wins.

export const PLAN_MIN = 1000;
export const PLAN_MAX_CATCHUP = 24;

export function setPlan(account, { id, symbol, amount, day, on = true, name, kind, market, currency }, now = Date.now()) {
  // One plan a symbol: starting another changes the one there is.
  id ||= Object.values(account.plans || {}).find(p => p.on && p.symbol === symbol)?.id || randomId();
  amount = Math.round(Number(amount));
  day = Math.round(Number(day));
  const old = account.plans?.[id];
  if (on && !(amount >= PLAN_MIN && amount <= MAX_START)) return { error: 'planAmount' };
  if (on && !(day >= 1 && day <= 28)) return { error: 'planDay' };
  const plan = { ...(old || {}), id, symbol: symbol ?? old?.symbol, amount: amount || old?.amount, day: day || old?.day, on, t: now, since: old?.since ?? now };
  for (const [k, v] of Object.entries({ name, kind, market, currency })) if (v) plan[k] = v;
  return { account: { ...account, plans: { ...(account.plans || {}), [id]: plan } }, plan };
}

export const activePlans = account => Object.values(account?.plans || {}).filter(p => p.on).sort((a, b) => a.since - b.since);

// Plans started more than once for a symbol (a tap that registered several
// times): the first kept, the rest stopped. Returns the account unchanged when
// there are none.
export function dedupePlans(account, now = Date.now()) {
  const seen = new Set();
  let plans = null;
  for (const p of activePlans(account)) {
    if (!seen.has(p.symbol)) {
      seen.add(p.symbol);
      continue;
    }
    plans ||= { ...account.plans };
    plans[p.id] = { ...p, on: false, t: now };
  }
  return plans ? { ...account, plans } : account;
}

// The Taiwan midnight a month's buy is due: YYYY-MM-DD 00:00 +08:00.
export function planDue(month, day) {
  return Date.parse(`${month}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
}
const monthOf = t => taipeiDay(t).slice(0, 7);
const nextMonth = month => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Every buy due since the plan started, up to now: [{ month, t }].
export function planRuns(plan, now = Date.now()) {
  const out = [];
  if (!plan?.on) return out;
  let month = monthOf(plan.since);
  if (planDue(month, plan.day) < plan.since) month = nextMonth(month);
  for (let i = 0; i < 1200; i++) {
    const t = planDue(month, plan.day);
    if (t > now) break;
    out.push({ month, t });
    month = nextMonth(month);
  }
  return out.slice(-PLAN_MAX_CATCHUP);
}

// When the plan buys next.
export function nextPlanRun(plan, now = Date.now()) {
  let month = monthOf(Math.max(now, plan.since));
  for (let i = 0; i < 3; i++) {
    const t = planDue(month, plan.day);
    if (t > now && t >= plan.since) return t;
    month = nextMonth(month);
  }
  return null;
}

export const planOrderId = (plan, month) => `plan:${plan.id}:${month}`;

// Runs one month's buy at `price` (the first price at or after its due
// time, at moment `at`), `twd` NT$ per unit of its currency then. The NT$
// budget is exchanged (for a foreign symbol) and spent on as many units as
// it covers after costs. Not enough NT$ or too small for one unit: the
// month's order is recorded as rejected, so it isn't tried again.
export function runPlan(account, plan, run, { price, twd, at = run.t, quote }, now = Date.now()) {
  const id = planOrderId(plan, run.month);
  if (account.orders.some(o => o.id === id)) return { account };
  const meta = { symbol: plan.symbol, name: quote?.name || plan.name, kind: quote?.kind || plan.kind, market: quote?.market || plan.market, currency: quote?.currency || plan.currency };
  const order = { id, ...meta, side: 'buy', type: 'market', qty: 0, t: at, status: 'open', rev: 1, plan: plan.id, reserve: 0 };
  const reject = reason => {
    const rejected = { ...order, status: 'rejected', reason, rev: 2, done: at };
    return { account: { ...account, orders: [...account.orders, rejected] }, order: rejected };
  };
  if (!(price > 0) || !(twd > 0) || !meta.currency) return { account };
  const avail = available(account, replay(account, now));
  if ((avail.cash[BASE] || 0) + EPS < plan.amount) return reject('funds');
  const rates = { [BASE]: 1, [meta.currency]: twd };
  let budget = plan.amount;
  let fx = null;
  if (meta.currency !== BASE) {
    fx = quoteExchange(BASE, meta.currency, plan.amount, rates, true);
    if (!fx?.received) return reject('tooSmall');
    budget = fx.received;
  }
  // Sized at the ask it will actually pay.
  const ask = marketFill(meta.market, meta.kind, 'buy', price);
  let qty = roundQty(budget / ask, meta.kind);
  const first = qty > 0 ? estimate({ ...meta, side: 'buy', qty, price: ask }).total : 0;
  if (first > budget) qty = roundQty((qty * budget) / first, meta.kind);
  while (qty > 0 && estimate({ ...meta, side: 'buy', qty, price: ask }).total > budget + EPS) qty = roundQty(qty - (qtyStep(meta.kind) >= 1 ? 1 : qty * 0.001), meta.kind);
  if (!(qty > 0)) return reject('tooSmall');
  let next = account;
  if (fx) {
    // Only what the units need is exchanged: the rest stays in NT$.
    const cost = estimate({ ...meta, side: 'buy', qty, price: ask }).total;
    const need = amountFor(BASE, meta.currency, cost, rates, true);
    const r = exchange(next, { from: BASE, to: meta.currency, amount: Math.min(plan.amount, need) }, { rates, fxOpen: true, now: at, id: `plan:${plan.id}:${run.month}` });
    if (r.error) return reject(r.error === 'funds' ? 'funds' : 'tooSmall');
    next = r.account;
  }
  const open = { ...order, qty };
  next = { ...next, orders: [...next.orders, open] };
  const r = fillOrder(next, open, price, rates, now, at);
  return { account: r.account, order: r.order, fill: r.fill };
}

// ---- Price alerts --------------------------------------------------------------
//
// "Tell me when TSMC goes above / below X": checked on every price update
// and, for the time the page was closed, against the price bars since.
// Alerts merge like the watchlist (the latest change wins).

export function setAlert(account, { id = randomId(), symbol, op, price, on = true, note }, now = Date.now()) {
  const old = account.alerts?.[id];
  price = Number(price ?? old?.price);
  op = op ?? old?.op;
  if (on && !(price > 0)) return { error: 'alertPrice' };
  if (op !== 'above' && op !== 'below') return { error: 'alertPrice' };
  const alert = { id, symbol: symbol ?? old?.symbol, op, price, on, t: now, since: on && !old?.on ? now : old?.since ?? now };
  if (note) alert.note = note;
  if (on) delete alert.hit;
  return { account: { ...account, alerts: { ...(account.alerts || {}), [id]: alert } }, alert };
}

export const activeAlerts = account => Object.values(account?.alerts || {}).filter(a => a.on).sort((a, b) => a.since - b.since);
export const alertsFor = (account, symbol) => Object.values(account?.alerts || {}).filter(a => a.symbol === symbol && (a.on || a.hit)).sort((a, b) => b.t - a.t);

const crossed = (a, price) => (a.op === 'above' ? price >= a.price : price <= a.price);

// Alerts whose price is reached on these quotes: they turn off, marked hit.
export function checkAlerts(account, quotes, now = Date.now()) {
  const hits = [];
  let alerts = account.alerts;
  for (const a of activeAlerts(account)) {
    const q = quotes.get(a.symbol);
    if (!q || !Number.isFinite(q.price) || !crossed(a, q.price)) continue;
    const hit = { ...a, on: false, t: now, hit: { t: now, price: q.price } };
    alerts = { ...alerts, [a.id]: hit };
    hits.push(hit);
  }
  return hits.length ? { account: { ...account, alerts }, hits } : { account, hits };
}

// When a price alert would have gone off in these bars (oldest first).
export function alertHitInBars(alert, bars) {
  for (const b of bars) {
    if (b.t < alert.since) continue;
    if (alert.op === 'above' && b.h >= alert.price) return { t: b.t, price: Math.max(b.o, alert.price) };
    if (alert.op === 'below' && b.l <= alert.price) return { t: b.t, price: Math.min(b.o, alert.price) };
  }
  return null;
}

export function markAlertHit(account, id, { t, price }, now = Date.now()) {
  const a = account.alerts?.[id];
  if (!a?.on) return account;
  return { ...account, alerts: { ...account.alerts, [id]: { ...a, on: false, t: now, hit: { t, price } } } };
}

// ---- Bank interest on NT$ cash ------------------------------------------------------

// Pay days: June 21 and December 21, 00:00 Taiwan time.
function interestDays(from, to) {
  const out = [];
  for (let y = new Date(from + 8 * 3_600_000).getUTCFullYear(); y <= new Date(to + 8 * 3_600_000).getUTCFullYear(); y++)
    for (const m of [6, 12]) {
      const t = Date.UTC(y, m - 1, 21) - 8 * 3_600_000;
      if (t > from && t <= to) out.push(t);
    }
  return out;
}

// Interest earned on NT$ cash since the last payment, paid on each pay day
// up to `now`. A payment of NT$20,000 or more has 10% tax withheld and the
// 2.11% NHI premium taken, as a Taiwan bank would.
export function applyCashInterest(account, now = Date.now()) {
  const have = new Set(account.events.filter(e => e.type === 'interest').map(e => e.id));
  let next = account;
  const added = [];
  for (const t of interestDays(account.created, now)) {
    const id = `int:${taipeiDay(t).slice(0, 7)}`;
    if (have.has(id)) continue;
    const s = replay(next, t);
    const paid = next.events.filter(e => e.type === 'interest' && e.t < t).reduce((sum, e) => sum + e.gross, 0);
    const gross = Math.floor(s.cashInterest - paid);
    if (gross < 1) continue;
    const withheld = gross >= NHI_THRESHOLD ? Math.floor(gross * 0.1) : 0;
    const nhi = gross >= NHI_THRESHOLD ? Math.floor(gross * NHI_RATE) : 0;
    const event = { id, type: 'interest', t, currency: BASE, gross, withheld, nhi, net: gross - withheld - nhi, rate: CASH_RATE };
    next = { ...next, events: [...next.events, event] };
    added.push(event);
  }
  return { account: next, added };
}

// ---- Payday: new money every month ---------------------------------------------
//
// No adding money by hand: like a salary, new NT$ arrives on its own on the
// 1st of every month (00:00 Taiwan time), paid when the app is opened: the
// same ECONOMY.monthly (NT$5,000) for every account (Quadra's economy;
// it used to be 3% of a chosen start). Each payday is a deposit with a fixed id (pay:YYYY-MM), paid
// once however many devices catch up on it. `income.since`: when paydays
// began (the account's opening, or when an older account first got them).

export const INCOME_RATE = 0.03;
const TPE = 8 * 3_600_000;

// Dividends owed (past their ex-date) but not paid yet.
export const pendingDividends = (account, now = Date.now()) => account.events.filter(e => e.type === 'div' && !e.coupon && e.t > now).sort((a, b) => a.t - b.t);

// Income: dividends, bond coupons and cash interest paid in, in NT$ (at the
// rate of the day each was paid). `months`: the last 12 Taiwan months, oldest
// first, as [YYYY-MM, NT$]; `pending`: dividends owed but not paid yet.
export function incomeSummary(account, now = Date.now()) {
  const month = t => taipeiDay(t).slice(0, 7);
  const thisMonth = month(now);
  const [y, m] = thisMonth.split('-').map(Number);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push([d.toISOString().slice(0, 7), 0]);
  }
  const index = new Map(months.map(([k], i) => [k, i]));
  const out = { total: 0, ytd: 0, last12: 0, div: 0, coupon: 0, interest: 0, pending: 0, months, payers: {} };
  for (const e of account?.events || []) {
    if (e.type !== 'div' && e.type !== 'interest') continue;
    const twd = e.net * (e.twd || 1);
    if (e.t > now) {
      if (e.type === 'div') out.pending += twd;
      continue;
    }
    out.total += twd;
    const k = month(e.t);
    if (k.slice(0, 4) === thisMonth.slice(0, 4)) out.ytd += twd;
    if (!index.has(k)) continue;
    months[index.get(k)][1] += twd;
    out.last12 += twd;
    if (e.type === 'interest') out.interest += twd;
    else if (e.coupon) out.coupon += twd;
    else out.div += twd;
    if (e.type === 'div') out.payers[e.symbol] = (out.payers[e.symbol] || 0) + twd;
  }
  return out;
}

export const startAmount = account => account?.events.find(e => e.id === 'deposit:start')?.amount || 0;

// NT$ a month.
// Securities' own monthly pay before Quadra's payday (months up to 2026-09):
// NT$5,000, what it was then. Quadra's payday is ECONOMY.monthly.
export function incomeAmount() {
  return 5_000;
}

// The first payday after `t`: the next 1st, 00:00 Taiwan time.
export function nextPayday(t) {
  const d = new Date(t + TPE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - TPE;
}

// Paydays due up to `now` and not yet paid, added as deposits.
// From this Taiwan month on, pay comes from Quadra itself into the pool
// (Shared-Proxy's eco.js, PAY_FROM_MONTH), whichever app is opened.
export const INCOME_UNTIL_MONTH = '2026-10';

export function applyIncome(account, now = Date.now()) {
  const since = account?.income?.since;
  if (since == null) return { account, added: [] };
  const have = new Set(account.events.filter(e => e.income).map(e => e.id));
  const amount = incomeAmount(startAmount(account));
  const added = [];
  for (let t = nextPayday(Math.max(since, account.created)), n = 0; t <= now && n < 1200; t = nextPayday(t), n++) {
    const id = `pay:${taipeiDay(t).slice(0, 7)}`;
    if (taipeiDay(t).slice(0, 7) >= INCOME_UNTIL_MONTH) break;
    if (have.has(id) || amount <= 0) continue;
    added.push({ id, type: 'deposit', income: true, t, currency: BASE, amount });
  }
  if (!added.length) return { account, added };
  return { account: { ...account, events: [...account.events, ...added] }, added };
}

// Paydays from now on for an account opened before they existed.
export const startIncome = (account, now = Date.now()) => (account.income ? account : { ...account, income: { since: now } });

// ---- The Quadra pool -----------------------------------------------------------
//
// With a Quadra Pass this account's NT$ cash is the shared money pool (see
// quadra.mjs): money the other apps put in or took out (Sportsbook's bets
// and winnings, Words' rewards, transfers) arrives here as NT$ deposits with
// fixed ids ('x:<entry id>', `pool: true`), counted as money put in or taken
// out rather than as return. What this account shares back is its own part:
// its NT$ cash less those deposits.

// The wallet's entries from the other apps that aren't in the log yet, added.
export function applyPool(account, wallet) {
  if (!account || !wallet) return { account, added: [] };
  const have = new Set(account.events.map(e => e.id));
  const added = [];
  for (const e of wallet.entries || []) {
    if (e.app === 'stock') continue;
    const id = `x:${e.id}`;
    if (have.has(id) || !(Math.abs(e.amount) > 0)) continue;
    const event = { id, type: 'deposit', pool: true, app: e.app, kind: e.kind, t: e.t, currency: BASE, amount: e.amount };
    if (e.note) event.note = e.note;
    if (e.peer) event.peer = e.peer;
    added.push(event);
  }
  if (!added.length) return { account, added };
  return { account: { ...account, events: [...account.events, ...added] }, added };
}

// This account's own part of the pool: spendable NT$ (open orders' cash
// held back) less what came from the other apps.
export function ownCash(account, s, now = Date.now()) {
  const cash = available(account, s).cash[BASE] || 0;
  const pooled = account.events.filter(e => e.pool && e.t <= now).reduce((sum, e) => sum + e.amount, 0);
  return Math.round((cash - pooled) * 100) / 100;
}

// Without the pool (a pass unlinked from this device).
export const stripPool = account => (account ? { ...account, events: account.events.filter(e => !e.pool) } : account);

// Another, separate account folded in (the Quadra merge tool): both logs,
// with the second's fixed ids ('deposit:start', 'pay:…', 'int:…') renamed so
// both count, and its old pool deposits left out (the merge carried that
// money over already).
export function mergeDistinct(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.id === b.id) return mergeAccounts(a, b);
  const tag = `m${b.id}`;
  const have = new Set(a.events.map(e => e.id));
  const events = b.events
    .filter(e => !e.pool)
    .map(e => (have.has(e.id) || /^(deposit:start|pay:|int:)/.test(e.id) ? { ...e, id: `${tag}:${e.id}`, ...(e.id === 'deposit:start' ? { start: true } : {}) } : e));
  const merged = mergeAccounts(a, { ...b, id: a.id, created: a.created, events, snapshots: {} });
  return { ...merged, created: Math.min(a.created, b.created) };
}
