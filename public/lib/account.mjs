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
  dividendTaxes,
  isOpen,
  isTradable,
  isShortable,
  qtyStep,
  roundCash,
  roundQty,
  tradeCosts
} from './markets.mjs';
import { BONDS, couponDates } from './bonds.mjs';

export const ACCOUNT_VERSION = 1;
export const START_PRESETS = [100_000, 500_000, 1_000_000, 3_000_000, 10_000_000];
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

export function newAccount(start, now = Date.now(), id = randomId()) {
  const amount = Math.round(Number(start));
  if (!(amount >= MIN_START && amount <= MAX_START)) throw new Error('start amount out of range');
  return {
    v: ACCOUNT_VERSION,
    id,
    created: now,
    events: [{ id: 'deposit:start', type: 'deposit', t: now, currency: BASE, amount }],
    orders: [],
    snapshots: {},
    watch: {}
  };
}

const byTime = (a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const add = (map, key, amount) => (map[key] = (map[key] || 0) + amount);

// ---- Replay ------------------------------------------------------------------

function accrue(s, t) {
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
    realized: 0,
    closed: [],
    held: {},
    log: []
  };
  for (const e of [...(account?.events || [])].sort(byTime)) {
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

// ---- Orders ------------------------------------------------------------------

// What a trade of `qty` at `price` costs or brings in, all in.
export function estimate({ market, kind, currency, side, qty, price }) {
  const deal = dealPrice(market, side, price);
  const gross = roundCash(deal * qty, currency);
  const costs = tradeCosts({ market, side, kind, gross, currency });
  const total = side === 'buy' ? gross + costs.total : gross - costs.total;
  return { price: deal, gross, ...costs, costs: costs.total, total };
}

// The price an open order fills at on this quote, or null. An order placed
// before the current session started also fills on the session's high or
// low having reached its price (the page can't watch every tick).
export function triggerPrice(order, quote, now) {
  if (!quote || !isOpen(quote, now)) return null;
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
  const s = replay(account, now);
  const avail = available(account, s);
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
    const ref = type === 'limit' ? order.limit : type === 'stop' ? Math.max(order.stop, quote.price) : quote.price;
    const est = estimate({ ...quote, side, qty, price: ref });
    const fillsNow = triggerPrice(order, quote, now) !== null;
    const reserve = roundCash(fillsNow || type === 'limit' ? est.total : est.total * (1 + RESERVE_BUFFER), quote.currency);
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

function updateOrder(account, order) {
  return { ...account, orders: account.orders.map(o => (o.id === order.id ? order : o)) };
}

// Fills `order` at `price`. The fill is dated `at` (a past moment when it's
// found in the price history); cash and shares are checked as of `now`.
function fillOrder(account, order, price, rates, now, at = now) {
  const est = estimate({ market: order.market, kind: order.kind, currency: order.currency, side: order.side, qty: order.qty, price });
  if (order.side === 'buy') {
    const s = replay(account, now);
    const avail = available(account, s);
    // This order's own hold is released as it fills.
    const have = (avail.cash[order.currency] || 0) + (order.reserve || 0);
    if (est.total > have + EPS) {
      const rejected = { ...order, status: 'rejected', reason: 'funds', rev: order.rev + 1, done: now };
      return { account: updateOrder(account, rejected), order: rejected, fill: null, error: 'funds', need: est.total, have };
    }
  } else if (!order.short || !isShortable(order.kind)) {
    const s = replay(account, now);
    const held = s.positions[order.symbol]?.qty || 0;
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
    quote: price,
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
  for (const order of account.orders.filter(o => o.status === 'open').sort(byTime)) {
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
  for (const b of bars) {
    if (b.t < order.t || !Number.isFinite(b.o)) continue;
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

export function fxSpread(from, to, fxOpen = true) {
  return Math.max(currencyInfo(from).spread, currencyInfo(to).spread) * (fxOpen ? 1 : CLOSED_FX_MULTIPLIER);
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
  const avail = available(account, replay(account, now));
  if ((avail.cash[from] || 0) + EPS < amount) return { error: 'funds', need: amount, have: Math.max(0, avail.cash[from] || 0), currency: from };
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
  const netWorth = assets - owed;
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

export function borrow(account, { currency, amount }, { valuation, rates, now = Date.now(), id = randomId() }) {
  amount = roundCash(Number(amount), currency);
  if (!(amount > 0)) return { error: 'amount' };
  if (!rates?.[currency]) return { error: 'noRate' };
  if (valuation.margin !== 'ok') return { error: 'margin' };
  if (amount * rates[currency] > valuation.capacity + EPS) return { error: 'capacity', capacity: valuation.capacity };
  const event = { id: `borrow:${id}`, type: 'borrow', t: now, currency, amount, rate: currencyInfo(currency).loanRate };
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
// its ex-date.
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
    const event = {
      id, type: 'div', t: d.date, symbol, name: info.name, market: info.market, kind: info.kind, currency: info.currency,
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
    const s = replay({ ...account, events: account.events.filter(e => e.t <= t) }, t);
    let nw = 0;
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
  const watch = { ...(a.watch || {}) };
  for (const [sym, w] of Object.entries(b.watch || {})) if (!watch[sym] || w.t > watch[sym].t) watch[sym] = w;
  return {
    ...a,
    events: [...events.values()].sort(byTime),
    orders: [...orders.values()].sort(byTime),
    snapshots,
    watch
  };
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
