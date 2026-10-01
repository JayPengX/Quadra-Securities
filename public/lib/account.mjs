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
  collateralRate,
  CLOSED_FX_MULTIPLIER,
  MARGIN_CALL,
  MARGIN_LIQUIDATE,
  MARGIN_RESTORE,
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
import { nextTradingStart, isTradingDay } from './holidays.mjs';
import { TD_MIN, tdRate, addMonths, tdInterest, incomeTaxes, lendable, LEND_RATE, LEND_LOT, LEND_RECALL, LEND_TERM_DAYS, addWeekdays, lendFee } from './savings.mjs';
import { BONDS, couponDates } from './bonds.mjs';
import { creditAccount, creditUsed, dayTradeSellFirst, termDue, afterHours, SHORT_DEPOSIT, SHORT_HANDLING } from './credit.mjs';

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
const FRESH_BUFFER = 0.005;

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
// A member (quadra.mjs PLUS.stock) pays part of the commission and FX spread
// and borrows cheaper, each by the moment the trade, exchange or loan is
// made. The app keeps `months` current from the wallet (usePlus); with
// none, nothing here changes anything.
const PLUS_NONE = { months: new Set(), commission: 1, fxSpread: 1, loanCut: 0 };
let plus = PLUS_NONE;
export function usePlus(settings) {
  plus = settings ? { ...PLUS_NONE, ...settings } : PLUS_NONE;
}
export const plusAt = (t = Date.now()) => plus.months.has(taipeiDay(t).slice(0, 7));

// ---- Replay ------------------------------------------------------------------

function accrue(s, t) {
  // NT$ cash earns the demand-deposit rate.
  const cash = s.cash[BASE] || 0;
  if (t > s.cashLast && cash > 0) s.cashInterest += (cash * CASH_RATE * (t - s.cashLast)) / YEAR_MS;
  s.cashLast = Math.max(s.cashLast, t);
  for (const p of Object.values(s.positions)) {
    if (p.qty < 0 && t > p.feeLast && !p.credit && !p.dayShort) p.borrowFee += (-p.cost * SHORT_FEE * (t - p.feeLast)) / YEAR_MS;
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
    paid: { commission: 0, tax: 0, fee: 0, fx: 0, withheld: 0, nhi: 0, borrow: 0, penalty: 0, lendCut: 0 },
    // Time deposits (定存) open now, and shares lent (借券出借), by event id.
    tds: {},
    lent: {},
    lendIncome: 0,
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
      // 違約金: charged on a default (an overdraft sold for).
      case 'penalty':
        add(s.cash, e.currency, -e.amount);
        s.paid.penalty += e.amount * (e.twd || 1);
        break;
      case 'td':
        add(s.cash, BASE, -e.amount);
        s.tds[e.id] = e;
        break;
      case 'tdend':
        if (!s.tds[e.td]) break;
        delete s.tds[e.td];
        add(s.cash, BASE, e.amount + e.net);
        s.interestEarned += e.net;
        s.paid.withheld += e.withheld || 0;
        s.paid.nhi += e.nhi || 0;
        break;
      case 'lend':
        s.lent[e.id] = { ...e };
        break;
      case 'recall':
        if (s.lent[e.lend]) s.lent[e.lend].back = e.back;
        break;
      case 'lendpay':
        if (!s.lent[e.lend]) break;
        delete s.lent[e.lend];
        add(s.cash, BASE, e.net);
        s.lendIncome += e.net;
        s.paid.lendCut += e.cut || 0;
        s.paid.withheld += e.withheld || 0;
        s.paid.nhi += e.nhi || 0;
        break;
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
        // A purchase's own loan (融資): what of the holding is financed.
        if (e.symbol && s.positions[e.symbol]) {
          const p = s.positions[e.symbol];
          // 融資's six-month term runs from the first loan on the holding.
          if (!(p.financed > 0)) Object.assign(p, { loanSince: e.t, loanExt: 0, loanDue: termDue(e.t) });
          p.financed = (p.financed || 0) + e.amount;
        }
        break;
      }
      // 展延: the term of a 融資 holding or a 融券 short, six months more.
      case 'extend': {
        const p = s.positions[e.symbol];
        if (p?.qty > 0 && p.loanDue) {
          p.loanExt = (p.loanExt || 0) + 1;
          p.loanDue = termDue(p.loanSince, p.loanExt);
        } else if (p?.qty < 0 && p.shortDue) {
          p.shortExt = (p.shortExt || 0) + 1;
          p.shortDue = termDue(p.first, p.shortExt);
        }
        break;
      }
      // An old cash loan tied to the purchase it paid for (linkOldLoans).
      case 'link':
        if (s.positions[e.symbol]) s.positions[e.symbol].financed = (s.positions[e.symbol].financed || 0) + e.amount;
        break;
      case 'repay': {
        const loan = s.loans[e.currency];
        if (!loan) break;
        loan.balance -= e.amount;
        loan.repaid += e.amount;
        if (loan.balance < 10 ** -currencyInfo(e.currency).digits / 2) loan.balance = 0;
        add(s.cash, e.currency, -e.amount);
        if (e.symbol && s.positions[e.symbol]) {
          const p = s.positions[e.symbol];
          p.financed = Math.max(0, (p.financed || 0) - e.amount);
          if (p.financed < 0.5) delete p.loanDue;
        }
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
    if (buy && (p.shortDeposit || p.shortHeld)) {
      // A 融券 bought back: that part's deposit and held sale money come back.
      const back = (p.shortDeposit + p.shortHeld) * share;
      p.shortDeposit -= p.shortDeposit * share;
      p.shortHeld -= p.shortHeld * share;
      add(s.cash, e.currency, back);
    }
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
      if (!buy && e.credit) Object.assign(p, { credit: true, shortExt: 0, shortDue: termDue(e.t), shortDeposit: 0, shortHeld: 0 });
      if (!buy && e.dayShort) p.dayShort = true;
    }
    // 融券: the seller's 90% deposit and the sale money stay with the broker.
    if (!buy && e.credit) {
      const deposit = roundCash((SHORT_DEPOSIT * e.gross * left) / e.qty, e.currency);
      p.shortDeposit = (p.shortDeposit || 0) + deposit;
      p.shortHeld = (p.shortHeld || 0) + part;
      add(s.cash, e.currency, -(deposit + part));
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
  // Lent shares (until they're back) can't be sold.
  for (const l of Object.values(s.lent || {})) qty[l.symbol] = (qty[l.symbol] || 0) - l.qty;
  for (const o of account.orders || []) {
    if (o.status !== 'open') continue;
    if (o.side === 'buy') cash[o.currency] = (cash[o.currency] || 0) - (o.reserve || 0);
    else {
      qty[o.symbol] = (qty[o.symbol] || 0) - o.qty;
      // A 融券 order waiting holds its 90% deposit.
      if (o.deposit) cash[o.currency] = (cash[o.currency] || 0) - o.deposit;
    }
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
  // Taiwan's after-hours sessions: one match at 14:30, at the close.
  if (order.after) {
    if (!quote || now < order.after || !(quote.marketTime >= order.after - 3_600_000)) return null;
    const close = quote.price;
    if (order.type === 'limit') return order.side === 'buy' ? (order.limit >= close ? close : null) : order.limit <= close ? close : null;
    return order.type === 'market' ? close : null;
  }
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
  // Sold to collect an overdraft the account didn't cover in time.
  if (req.cover) order.cover = true;
  // Held for a fresh price: it fills only at a quote read after it was
  // placed (processOrders), never at the figure on screen.
  if (req.fresh) order.waitFresh = now;
  // 融資買進: a buy the broker lends part of (the holding's loan value,
  // collateralRate), the shares bought its collateral. Only buys of what it
  // lends against, and only with the account's margin in order. The loan is
  // made when it fills (fillOrder), never as cash beforehand.
  if (req.margin) {
    if (side !== 'buy') return { error: 'side' };
    if (defaulted(account, now)) return { error: 'defaulted' };
    const rate = collateralRate(quote.kind, quote.market, quote.symbol);
    if (!(rate > 0)) return { error: 'notMarginable' };
    if (!valuation || valuation.margin !== 'ok' || account.call) return { error: 'margin' };
    // 融資 in any market needs the credit account (as a broker's 複委託
    // does); Taiwan's is also within its limit.
    const credit = creditAccount(account, now);
    if (!credit.open) return { error: 'creditNeeded' };
    if (quote.market === 'TW') {
      const loan = quote.price * qty * rate;
      const room = credit.limit - creditUsed(valuation).loan;
      if (loan > room + EPS) return { error: 'creditLimit', room: Math.max(0, Math.floor(room)), limit: credit.limit };
    }
    order.margin = rate;
  }
  // After Taiwan's close and before 14:30: the after-hours sessions (盤後定價,
  // 盤後零股), limit or market orders, matched once at 14:30 at the close;
  // what doesn't match ends with the day.
  if (quote.market === 'TW' && !req.forced) {
    const after = afterHours(now);
    if (after && type !== 'stop') {
      order.after = after.match;
      order.tif = 'day';
    }
  }
  // How long it lasts: a day order ends with its session (what exchanges
  // and brokers do by default); good-till-cancelled lasts GTC_DAYS. Crypto
  // and currency pairs never close, so theirs are GTC.
  if (!order.after) order.tif = req.tif === 'gtc' || quote.kind === 'crypto' || quote.kind === 'fx' ? 'gtc' : 'day';
  order.expires = order.after ? order.after + 9 * 3_600_000 : order.tif === 'gtc' ? now + GTC_DAYS * 86_400_000 : dayOrderEnd(quote, now);
  if (side === 'sell') {
    const have = Math.max(0, avail.qty[quote.symbol] || 0);
    const short = qty - have;
    if (short > EPS) {
      // Selling more than is held sells the rest short.
      if (!isShortable(quote.kind)) return { error: 'shares', have };
      if (!valuation) return { error: 'noValuation' };
      if (valuation.margin !== 'ok') return { error: 'margin' };
      if (defaulted(account, now)) return { error: 'defaulted' };
      // Elsewhere, borrowing to sell needs the credit account too (a
      // currency pair borrows nothing: selling it is taking its other side).
      if (quote.market !== 'TW' && quote.kind !== 'fx' && !creditAccount(account, now).open) return { error: 'creditNeeded' };
      // Taiwan: 融券 through the credit account (a 90% deposit, within its
      // limit), or else a day trade sold first (現股當沖) that must be bought
      // back by the close.
      if (quote.market === 'TW') {
        const credit = creditAccount(account, now);
        if (credit.open) {
          const room = credit.limit - creditUsed(valuation).short;
          if (short * quote.price > room + EPS) return { error: 'creditLimit', room: Math.max(0, Math.floor(room)), limit: credit.limit };
          const deposit = roundCash(SHORT_DEPOSIT * short * quote.price, quote.currency);
          const cash = avail.cash[quote.currency] || 0;
          if (deposit > cash + EPS) return { error: 'funds', need: deposit, have: Math.max(0, cash), currency: quote.currency };
          order.short = true;
          order.credit = true;
          order.deposit = deposit;
        } else if (dayTradeSellFirst(account, now) && !order.after && twSession(now)) {
          order.short = true;
          order.dayShort = true;
          order.tif = 'day';
        } else return { error: 'creditNeeded' };
      }
      const value = short * quote.price * rates[quote.currency];
      const owed = valuation.debtTWD + valuation.shortTWD + value;
      if (!order.credit && !order.dayShort && (valuation.assets + value) / owed < SHORT_INITIAL - EPS) {
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
  const price = order.waitFresh ? null : triggerPrice(order, quote, now);
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
  // What's held above the estimate: nothing for a limit order (its limit is
  // its most); RESERVE_BUFFER while it waits for its market; FRESH_BUFFER
  // for one held a moment for a fresh price (the price may tick up).
  const extra = order.type === 'limit' ? 0 : !fillsNow ? RESERVE_BUFFER : order.waitFresh ? FRESH_BUFFER : 0;
  // On margin, only one's own part is held (自備款); the broker lends the rest.
  const own = order.margin ? 1 - order.margin : 1;
  const reserve = roundCash(est.total * own * (1 + extra), quote.currency);
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
  const dayTrade = order.side === 'sell' && order.market === 'TW' && (order.dayShort || account.events.some(e => e.type === 'fill' && e.symbol === order.symbol && e.side === 'buy' && e.t <= at && localDayOf(e.t, 'TW') === localDayOf(at, 'TW')));
  let est = estimate({ market: order.market, kind: order.kind, currency: order.currency, side: order.side, qty: order.qty, price, t: at, dayTrade, first: firstTrade(account) });
  // 融券手續費: 0.08% of what's sold short (Taiwan drops the fraction).
  if (order.credit) {
    const held = Math.max(0, replay(account, at).positions[order.symbol]?.qty || 0);
    const handling = Math.floor((est.gross * Math.max(0, order.qty - held)) / order.qty * SHORT_HANDLING);
    if (handling > 0) est = { ...est, fee: est.fee + handling, costs: est.costs + handling, total: est.total - handling, handling };
  }
  // A fill found in the past must have fitted the cash (or shares) at that
  // moment and still fit today's.
  const moments = at < now ? [at, now] : [now];
  if (order.side === 'buy' && !order.forced) {
    // This order's own hold is released as it fills.
    const have = Math.min(...moments.map(tt => (available(account, replay(account, tt)).cash[order.currency] || 0))) + (order.reserve || 0);
    const lent = order.margin ? roundCash(est.total * order.margin, order.currency) : 0;
    if (est.total - lent > have + EPS) {
      const rejected = { ...order, status: 'rejected', reason: 'funds', rev: order.rev + 1, done: now };
      return { account: updateOrder(account, rejected), order: rejected, fill: null, error: 'funds', need: est.total - lent, have };
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
  if (order.cover) fill.cover = true;
  if (order.credit) fill.credit = true;
  if (order.dayShort) fill.dayShort = true;
  if (est.handling) fill.handling = est.handling;
  if (order.after) fill.after = true;
  const extra = [];
  // 融資買進: the loan for this purchase, made as it fills, tied to the stock.
  if (order.side === 'buy' && order.margin) {
    const amount = roundCash(est.total * order.margin, order.currency);
    if (amount > 0) {
      fill.financed = amount;
      extra.push({ id: `loan:${order.id}`, type: 'borrow', t: at, currency: order.currency, amount, rate: loanRateAt(order.currency, at), symbol: order.symbol });
    }
  }
  // Selling shares bought on margin repays their loan first (融資賣出,
  // 償還): that share of what's financed, out of the proceeds.
  if (order.side === 'sell') {
    const s0 = replay(account, at);
    const pos = s0.positions[order.symbol];
    const loan = s0.loans[order.currency];
    if (pos?.financed > 0 && pos.qty > 0 && loan?.balance > 0) {
      const amount = roundCash(Math.min(pos.financed * Math.min(1, order.qty / pos.qty), loan.balance, est.total), order.currency);
      if (amount > 0) {
        fill.repaid = amount;
        extra.push({ id: `repay:${order.id}`, type: 'repay', t: at, currency: order.currency, amount, symbol: order.symbol });
      }
    }
  }
  const done = { ...order, status: 'filled', rev: order.rev + 1, done: at, fillId: fill.id, price: est.price };
  const next = updateOrder({ ...account, events: [...account.events, fill, ...extra] }, done);
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
    if (order.waitFresh && !(quote.got >= order.waitFresh)) continue;
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

// ---- Time deposits (定存) and securities lending (借券出借) ----------------------
// (savings.mjs has the terms.)

// NT$ cash settled and not held for orders: what can go into a deposit.
const freeCash = (account, s, now) => Math.max(0, withdrawable(account, s, now)[BASE] || 0);

export function openDeposit(account, { amount, months, renew = false }, now = Date.now(), id = randomId()) {
  amount = Math.round(Number(amount));
  const rate = tdRate(Number(months));
  if (rate == null) return { error: 'tdTerm' };
  if (!(amount >= TD_MIN)) return { error: 'tdMin', min: TD_MIN };
  const have = freeCash(account, replay(account, now), now);
  if (amount > have + EPS) return { error: 'funds', need: amount, have, currency: BASE };
  const event = { id: `td:${id}`, type: 'td', t: now, currency: BASE, amount, months: Number(months), rate, ends: addMonths(now, Number(months)), renew: Boolean(renew) };
  return { account: { ...account, events: [...account.events, event] }, event };
}

function tdEnd(td, at) {
  const { gross, early } = tdInterest(td, at);
  return { id: `tdend:${td.id.slice(3)}`, type: 'tdend', t: at, td: td.id, currency: BASE, amount: td.amount, interest: gross, ...incomeTaxes(gross), early };
}

// 解約: closed before maturity, at the early rate.
export function breakDeposit(account, tdId, now = Date.now()) {
  const td = replay(account, now).tds[tdId];
  if (!td) return { error: 'tdGone' };
  const event = tdEnd(td, now);
  return { account: { ...account, events: [...account.events, event] }, event };
}

// Deposits that reached maturity: paid back (dated then), and rolled over
// at the rate posted then when they were set to.
export function matureDeposits(account, now = Date.now()) {
  let next = account;
  for (let guard = 0; guard < 240; guard++) {
    const s = replay(next, now);
    const due = Object.values(s.tds).filter(td => td.ends <= now).sort((a, b) => a.ends - b.ends)[0];
    if (!due) break;
    const events = [tdEnd(due, due.ends)];
    if (due.renew) {
      events.push({ ...due, id: `${due.id}r`, t: due.ends, rate: tdRate(due.months) ?? due.rate, ends: addMonths(due.ends, due.months) });
    }
    next = { ...next, events: [...next.events, ...events] };
  }
  return next;
}

// Before 2026-10-01 10:49 Taipei a 融資 buy borrowed the shortfall as a
// plain cash loan ('borrow:<id>', no symbol) and placed the order: the loan
// paid for the shares but wasn't tied to them, so selling didn't repay it
// first and a margin call didn't know them as bought on margin. Each such
// loan is tied, once, to the buy placed within LINK_WINDOW after it (a
// 'link' event, dated when it's made: what happened before stays as it
// was): newest loans first, no more than the loan still owed, the buy's
// cost or the shares' cost now. Loans already paid off are left alone.
const LINK_BEFORE = Date.UTC(2026, 9, 1, 2, 49);
const LINK_WINDOW = 5 * 60_000;
export function linkOldLoans(account, now = Date.now()) {
  const done = new Set(account.events.filter(e => e.type === 'link').map(e => e.borrow));
  // Loans from before one was paid off in full are gone with it.
  const cleared = cur => Math.max(0, ...account.events.filter(e => e.type === 'repay' && !e.symbol && e.currency === cur && !(replay(account, e.t).loans[cur]?.balance >= 1)).map(e => e.t));
  const old = account.events.filter(e => e.type === 'borrow' && !e.symbol && e.id.startsWith('borrow:') && e.t < LINK_BEFORE && !done.has(e.id) && e.t > cleared(e.currency)).sort((a, b) => b.t - a.t);
  if (!old.length) return account;
  const s = replay(account, now);
  const owed = Object.fromEntries(Object.entries(s.loans).map(([cur, l]) => [cur, Math.max(0, l.balance)]));
  for (const p of Object.values(s.positions)) owed[p.currency] = Math.max(0, (owed[p.currency] || 0) - (p.financed || 0));
  const room = Object.fromEntries(Object.values(s.positions).filter(p => p.qty > 0).map(p => [p.symbol, Math.max(0, p.cost - (p.financed || 0))]));
  const used = {};
  const links = [];
  for (const b of old) {
    const order = account.orders.filter(o => o.side === 'buy' && o.currency === b.currency && o.status === 'filled' && o.t >= b.t && o.t - b.t <= LINK_WINDOW).sort((x, y) => x.t - y.t)[0];
    const fill = order && account.events.find(e => e.id === order.fillId);
    if (!fill) continue;
    const amount = roundCash(Math.min(b.amount, fill.total - (used[order.id] || 0), owed[b.currency] || 0, room[order.symbol] || 0), b.currency);
    if (!(amount > 0)) continue;
    used[order.id] = (used[order.id] || 0) + amount;
    owed[b.currency] -= amount;
    room[order.symbol] -= amount;
    links.push({ id: `link:${b.id.slice(7)}`, type: 'link', t: now, borrow: b.id, symbol: order.symbol, currency: b.currency, amount });
  }
  return links.length ? { ...account, events: [...account.events, ...links] } : account;
}

// Shares of a holding that can be lent now: whole lots, settled, not lent
// already, not promised to a sell order, not bought on margin.
export function lendableQty(account, symbol, now = Date.now()) {
  const s = replay(account, now);
  const p = s.positions[symbol];
  if (!p || p.qty <= 0 || !lendable(p.market, p.kind) || p.financed > 0) return 0;
  const free = available(account, s).qty[symbol] || 0;
  const settling = account.events.filter(e => e.type === 'fill' && e.symbol === symbol && e.side === 'buy' && e.t <= now && e.settle > now).reduce((sum, e) => sum + e.qty, 0);
  return Math.max(0, Math.floor((Math.min(free, p.qty - settling) + EPS) / LEND_LOT) * LEND_LOT);
}

export function lendShares(account, { symbol, qty, price }, now = Date.now(), id = randomId()) {
  const s = replay(account, now);
  const p = s.positions[symbol];
  if (!p || !lendable(p.market, p.kind)) return { error: 'notLendable' };
  if (p.financed > 0) return { error: 'lendFinanced' };
  qty = Number(qty);
  if (!(qty >= LEND_LOT) || qty % LEND_LOT) return { error: 'lendLot', lot: LEND_LOT };
  const can = lendableQty(account, symbol, now);
  if (qty > can + EPS) return { error: 'lendQty', can };
  if (!(price > 0)) return { error: 'noQuote' };
  const event = { id: `lend:${id}`, type: 'lend', t: now, symbol, name: p.name, market: p.market, kind: p.kind, currency: p.currency, qty, price, rate: LEND_RATE[p.kind] };
  return { account: { ...account, events: [...account.events, event] }, event };
}

function lendEnd(lend, at, back) {
  const key = lend.id.slice(5);
  const fee = lendFee(lend, back);
  return [
    { id: `recall:${key}`, type: 'recall', t: at, lend: lend.id, back },
    { id: `lendpay:${key}`, type: 'lendpay', t: back, lend: lend.id, symbol: lend.symbol, currency: BASE, ...fee }
  ];
}

// 召回: the shares come back (and the fee is paid) in LEND_RECALL business days.
export function recallShares(account, lendId, now = Date.now()) {
  const l = replay(account, now).lent[lendId];
  if (!l) return { error: 'lendGone' };
  if (l.back) return { account, back: l.back };
  const back = addWeekdays(now, LEND_RECALL);
  return { account: { ...account, events: [...account.events, ...lendEnd(l, now, back)] }, back };
}

// Contracts past their term end by themselves (dated then).
export function matureLending(account, now = Date.now()) {
  const s = replay(account, now);
  const due = Object.values(s.lent).filter(l => !l.back && l.t + LEND_TERM_DAYS * 86_400_000 <= now);
  if (!due.length) return account;
  return { ...account, events: [...account.events, ...due.flatMap(l => lendEnd(l, l.t + LEND_TERM_DAYS * 86_400_000, l.t + LEND_TERM_DAYS * 86_400_000))] };
}

// Everything lent is called back (a default or a margin call: the broker
// needs the shares to sell).
export function recallAll(account, now = Date.now()) {
  let next = account;
  for (const id of Object.keys(replay(account, now).lent)) next = recallShares(next, id, now).account || next;
  return next;
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
  // 融券 collateral the broker holds (the deposit and the sale money): the
  // account's own, counted in its assets.
  let shortCashTWD = 0;
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
      collateral += valueTWD * collateralRate(p.kind, p.market, p.symbol);
    } else {
      shortTWD -= valueTWD;
      feesTWD += fee;
      shortCashTWD += ((p.shortDeposit || 0) + (p.shortHeld || 0)) * (r ?? 0);
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
  const assets = cashTWD + longTWD + shortCashTWD;
  const owed = debtTWD + shortTWD;
  const receivable = s.receivable || 0;
  // Time deposits are the bank's, not collateral: in net worth, not assets.
  const tds = Object.values(s.tds || {}).sort((a, b) => a.ends - b.ends);
  const savedTWD = tds.reduce((sum, td) => sum + td.amount, 0);
  const lentByPos = {};
  for (const l of Object.values(s.lent || {})) lentByPos[l.symbol] = (lentByPos[l.symbol] || 0) + l.qty;
  for (const p of out.positions) p.lent = lentByPos[p.symbol] || 0;
  const netWorth = assets + receivable + savedTWD - owed;
  for (const p of out.positions) p.weight = assets ? Math.abs(p.valueTWD) / assets : 0;
  out.positions.sort((a, b) => Math.abs(b.valueTWD) - Math.abs(a.valueTWD));
  out.cash.sort((a, b) => (a.currency === BASE ? -1 : b.currency === BASE ? 1 : b.twd - a.twd));
  const interestTWD = Object.values(s.loans).reduce((sum, l) => sum + l.interest * (rate(l.currency) ?? 0), 0);
  const ratio = owed > EPS ? assets / owed : Infinity;
  return {
    ...out,
    cashTWD,
    shortCashTWD,
    tds,
    savedTWD,
    lent: Object.values(s.lent || {}).sort((a, b) => a.t - b.t),
    lendIncome: s.lendIncome || 0,
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

export function repay(account, { currency, amount, symbol }, { now = Date.now(), id = randomId() } = {}) {
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
  // Paid against one holding's 融資 (補繳, 現金償還): that holding's loan goes down.
  if (symbol) event.symbol = symbol;
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
// A default (an overdraft the account let run past its deadline, sold for)
// is on its record: DEFAULT_PENALTY of what was owed is charged (違約金, the
// most Taiwan's rules allow), and for DEFAULT_BAN no 融資 and no short
// selling (a broker's credit account goes with a default).
export const DEFAULT_PENALTY = 0.07;
export const DEFAULT_BAN = 5 * 365 * 86_400_000;
export const defaulted = (account, now = Date.now()) => Boolean(account?.defaultAt) && now - account.defaultAt < DEFAULT_BAN;
export const penaltyEvent = (owedTWD, now = Date.now()) => ({ id: `penalty:${now}`, type: 'penalty', t: now, currency: BASE, amount: Math.ceil(owedTWD * DEFAULT_PENALTY - 1e-6) });

// A margin call not met by its deadline (斷頭): every short bought back and
// every holding bought on margin sold whole; with loans from before 融資 was
// tied to purchases, holdings largest first until the loans are covered.
export function callPlan(account, valuation) {
  if (account.orders.some(o => o.status === 'open' && o.forced)) return [];
  const plan = valuation.positions.filter(p => p.short).map(p => ({ symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true }));
  const financed = valuation.positions.filter(p => !p.short && p.financed > 0);
  for (const p of financed) plan.push({ symbol: p.symbol, side: 'sell', type: 'market', qty: p.qty, forced: true });
  // (Bought on margin, so never lent.)
  let covered = valuation.cashTWD - valuation.shortTWD + financed.reduce((sum, p) => sum + p.valueTWD, 0);
  for (const p of valuation.positions.filter(x => !x.short && !(x.financed > 0) && x.qty - (x.lent || 0) > EPS)) {
    if (covered >= valuation.debtTWD * 1.02) break;
    const qty = p.qty - (p.lent || 0);
    plan.push({ symbol: p.symbol, side: 'sell', type: 'market', qty, forced: true });
    covered += (p.valueTWD * qty) / p.qty;
  }
  return plan;
}

// ---- 追繳: a margin call, as Taiwan's brokers run it -------------------------------
//
// The ratio is judged on closing prices: a dip under 130% while Taiwan is
// trading calls nothing yet. After the close it's a call (追繳通知), due by
// the close of the second business day after. Paying cash against the loans
// (補繳), repaying or selling can meet it; it's cancelled only back at 166%.
// At the deadline: under 130% still, the margin holdings are sold from the
// next business day (the orders wait for its open); between 130% and 166%
// nothing is sold yet, but the call stands, and a later fall under 130% is
// sold the next business day with no new grace.
const twTime = (day, hm) => Date.parse(`${day}T${hm}:00+08:00`);
export const twSession = t => {
  const day = taipeiDay(t);
  return isTradingDay('TW', day) && t >= twTime(day, '09:00') && t < twTime(day, '13:30');
};
// The last Taiwan close at or before `t`.
export function lastTwClose(t) {
  let day = taipeiDay(t);
  for (let i = 0; i < 40; i++) {
    if (isTradingDay('TW', day) && twTime(day, '13:30') <= t) return twTime(day, '13:30');
    day = taipeiDay(twTime(day, '12:00') - 86_400_000);
  }
  return t;
}
// The deadline of a call issued at `t`: the close of the second business day
// after the close it was judged on.
export function callDeadline(t) {
  let x = lastTwClose(t);
  for (let n = 0, i = 0; n < 2 && i < 40; i++) {
    x += 86_400_000;
    if (isTradingDay('TW', taipeiDay(x))) n++;
  }
  return x;
}
// NT$ to pay against the loans to bring the ratio back to 166% (補繳金額):
// paying x takes x off both sides, (assets − x) / (owed − x) = 166%. Only
// loans can be paid down; a call from shorts beyond that needs buying back.
export function callNeed(v) {
  if (!(v.owed > EPS) || v.ratio >= MARGIN_RESTORE) return 0;
  return Math.max(0, Math.ceil((MARGIN_RESTORE * v.owed - v.assets) / (MARGIN_RESTORE - 1)));
}
// Where a call stands at a check: { call (to keep on the account, or null),
// sell (sell the margin holdings now), event ('issued' | 'met' | 'cleared' |
// 'intraday' | null) }.
export function callState(call, v, now = Date.now()) {
  if (!(v.owed > EPS)) return { call: null, sell: false, event: call ? 'cleared' : null };
  if (call && v.ratio >= MARGIN_RESTORE) return { call: null, sell: false, event: 'met' };
  if (!call) {
    if (v.ratio >= MARGIN_CALL) return { call: null, sell: false, event: null };
    if (twSession(now)) return { call: null, sell: false, event: 'intraday' };
    return { call: { since: now, due: callDeadline(now), need: callNeed(v) }, sell: false, event: 'issued' };
  }
  const due = call.due ?? callDeadline(call.since);
  return { call: { ...call, due }, sell: now >= due && v.ratio < MARGIN_CALL, event: null };
}

// Pays up to `amountTWD` of the loans from the account's own cash (補繳 or
// 現金償還): NT$ loans first, each against the holdings bought on margin
// (largest loan first, then any loan not tied to one); a loan in another
// currency from cash in it, then by exchanging NT$. Returns { account, paid }.
export function payDown(account, amountTWD, { rates, fxOpen = true, now = Date.now() } = {}) {
  let next = account;
  let left = Math.max(0, Number(amountTWD) || 0);
  let seq = 0;
  const nextId = () => `pd${now.toString(36)}${(seq++).toString(36)}`;
  const first = replay(account, now);
  const currencies = Object.keys(first.loans).filter(c => first.loans[c].balance > EPS && rates?.[c]).sort((a, b) => (a === BASE ? -1 : b === BASE ? 1 : 0));
  for (const currency of currencies) {
    const r = rates[currency];
    for (let round = 0; round < 24 && left >= 0.5; round++) {
      const s = replay(next, now);
      const loan = s.loans[currency];
      if (!loan || loan.balance <= EPS) break;
      const avail = available(next, s).cash;
      const own = Math.max(0, avail[currency] || 0);
      const want = Math.min(loan.balance, left / r);
      if (own > EPS) {
        const tied = Object.values(s.positions).filter(p => p.currency === currency && p.financed > EPS).sort((a, b) => b.financed - a.financed)[0];
        const amount = Math.min(own, want, tied ? tied.financed : Infinity);
        const x = repay(next, { currency, amount, symbol: tied?.symbol }, { now, id: nextId() });
        if (x.error) break;
        next = x.account;
        left -= x.event.amount * r;
        continue;
      }
      if (currency === BASE) break;
      const has = Math.max(0, avail[BASE] || 0);
      if (has <= EPS) break;
      const fx = exchange(next, { from: BASE, to: currency, amount: Math.min(has, amountFor(BASE, currency, want, rates, fxOpen)) }, { rates, fxOpen, now, id: nextId() });
      if (fx.error) break;
      next = fx.account;
    }
  }
  return { account: next, paid: Math.max(0, Number(amountTWD) || 0) - Math.max(0, left) };
}

export function liquidationPlan(account, valuation) {
  if (valuation.margin !== 'liquidate') return [];
  if (account.orders.some(o => o.status === 'open' && o.forced)) return [];
  // Every short is bought back; then holdings are sold, largest first,
  // until what's sold covers the loans.
  const plan = valuation.positions.filter(p => p.short).map(p => ({ symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true }));
  let covered = valuation.cashTWD - valuation.shortTWD;
  // Lent shares can't be sold until they're back (recallAll calls them).
  for (const p of valuation.positions.filter(x => !x.short && x.qty - (x.lent || 0) > EPS)) {
    if (covered >= valuation.debtTWD * 1.02) break;
    const qty = p.qty - (p.lent || 0);
    plan.push({ symbol: p.symbol, side: 'sell', type: 'market', qty, forced: true });
    covered += (p.valueTWD * qty) / p.qty;
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
    const free = p.qty - (p.lent || 0);
    let qty = Math.min(free, Math.ceil(left / unit / step) * step);
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
  const out = { total: 0, ytd: 0, last12: 0, div: 0, coupon: 0, interest: 0, lending: 0, pending: 0, months, payers: {} };
  for (const e of account?.events || []) {
    if (!['div', 'interest', 'tdend', 'lendpay'].includes(e.type)) continue;
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
    if (e.type === 'interest' || e.type === 'tdend') out.interest += twd;
    else if (e.type === 'lendpay') out.lending += twd;
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
// quadra.mjs): money the other apps put in or took out (Play's bets and
// winnings, Quadra's pay and Plus) arrives here as NT$ deposits with
// fixed ids ('x:<entry id>', `pool: true`), counted as money put in or taken
// out rather than as return. What this account shares back is its own part:
// its NT$ cash less those deposits.

// The pool's deposits as the wallet has them: its entries from the other
// apps that aren't in the log yet, added, and a deposit whose entry the
// wallet no longer has (the store's clean-up retired it) gone.
export function applyPool(account, wallet) {
  if (!account || !wallet) return { account, added: [] };
  const ids = new Set((wallet.entries || []).map(e => `x:${e.id}`));
  const kept = account.events.filter(e => !e.pool || ids.has(e.id));
  const have = new Set(kept.map(e => e.id));
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
  if (!added.length && kept.length === account.events.length) return { account, added };
  return { account: { ...account, events: [...kept, ...added] }, added };
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
