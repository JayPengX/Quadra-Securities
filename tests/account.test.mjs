import test from 'node:test';
import assert from 'node:assert/strict';
// A credit account at the top tier, opened before T0 (the tests' trading is about the loans, not the limit).
const withCredit = (a, at) => ({ ...a, events: [...a.events, { id: 'credit:t', type: 'credit', t: at - 1, limit: 5_000_000 }] });
import {
  newAccount, replay, available, placeOrder, requiredCash, processOrders, cancelOrder, exchange, quoteExchange, amountFor, deposit, valuate,
  borrow, repay, repayAll, liquidationPlan, applyCorporateActions, mergeAccounts, recordSnapshot, benchmarkValue, triggerPrice,
  isAccount, toggleWatch, watched
} from '../public/lib/account.mjs';

const T0 = Date.UTC(2026, 8, 21, 2); // Monday 10:00 Taipei
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RATES = { TWD: 1, USD: 32, JPY: 0.2, HKD: 4 };

// A quote with an open session around `at`.
function quote(symbol, price, over = {}) {
  const at = over.at ?? T0;
  const market = over.market ?? (symbol.endsWith('.TW') ? 'TW' : over.kind === 'crypto' ? 'CRYPTO' : 'US');
  return {
    symbol, name: symbol, kind: 'stock', market, currency: market === 'TW' ? 'TWD' : 'USD', price, prev: price,
    pct: 0, dayHigh: price, dayLow: price, session: { start: at - HOUR, end: at + 4 * HOUR }, marketTime: at, line: [], ...over
  };
}
const closed = q => ({ ...q, session: { start: q.session.start + DAY, end: q.session.end + DAY }, marketTime: q.session.start - HOUR });
const ids = prefix => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

test('a new account holds the chosen NT$ and nothing else', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const s = replay(a, T0);
  assert.deepEqual(s.cash, { TWD: 1_000_000 });
  assert.equal(s.deposits, 1_000_000);
  assert.throws(() => newAccount(5, T0));
  assert.ok(isAccount(a));
  assert.ok(!isAccount({ v: 1 }));
});

test('buying Taiwan stock at market: price, commission, cash and holding', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const r = placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'o1' });
  assert.equal(r.error, undefined);
  assert.equal(r.order.status, 'filled');
  // A market order buys at the ask: half a tick (NT$2.5) above the last price.
  assert.equal(r.fill.price, 2477.5);
  assert.equal(r.fill.quote, 2475);
  assert.equal(r.fill.gross, 247_750);
  assert.equal(r.fill.commission, 353);
  const s = replay(r.account, T0);
  assert.equal(s.cash.TWD, 1_000_000 - 248_103);
  assert.equal(s.positions['2330.TW'].qty, 100);
  assert.equal(s.positions['2330.TW'].cost, 248_103);
});

test('an order held for a fresh price waits as a 委託單, then fills at the newer quote', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const r = placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100, fresh: true }, { quote: { ...quote('2330.TW', 2475), got: T0 - 60_000 }, rates: RATES, now: T0, id: 'h1' });
  assert.equal(r.order.status, 'open');
  assert.equal(r.fill, null);
  // The old quote (read before it was placed) doesn't fill it; a newer one does, at its price.
  const old = processOrders(r.account, new Map([['2330.TW', { ...quote('2330.TW', 2475), got: T0 - 60_000 }]]), RATES, T0 + 1_000);
  assert.equal(old.filled.length, 0);
  const fresh = processOrders(r.account, new Map([['2330.TW', { ...quote('2330.TW', 2480), got: T0 + 2_000 }]]), RATES, T0 + 2_000);
  assert.equal(fresh.filled.length, 1);
  assert.equal(fresh.filled[0].quote, 2480);
});

test('what the ticket says an order holds is exactly what placing it needs (held for a fresh price)', () => {
  const q = { ...quote('2330.TW', 2475), got: T0 };
  const need = requiredCash({ type: 'market', qty: 100, waitFresh: 1 }, q, T0).reserve;
  // A small cushion over the estimate, not the 3% of an order waiting for its market.
  const est = requiredCash({ type: 'market', qty: 100 }, q, T0).reserve;
  assert.ok(need > est && need <= Math.ceil(est * 1.005) + 1);
  const exact = newAccount(need, T0, 'acc');
  assert.equal(placeOrder(exact, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100, fresh: true }, { quote: q, rates: RATES, now: T0, id: 'x1' }).error, undefined);
  const less = newAccount(need - 1, T0, 'acc');
  assert.equal(placeOrder(less, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100, fresh: true }, { quote: q, rates: RATES, now: T0, id: 'x2' }).error, 'funds');
});

test('融資買進: the broker lends 60% of a Taiwan buy as it fills; selling repays it first', () => {
  const a = withCredit(newAccount(1_000_000, T0, 'acc'), T0);
  const q = quote('2330.TW', 2475);
  const v = valuate(replay(a, T0), new Map([['2330.TW', q]]), RATES);
  const r = placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 1000, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0, id: 'm1' });
  assert.equal(r.error, undefined);
  assert.equal(r.order.status, 'filled');
  const s = replay(r.account, T0);
  const total = r.fill.total;
  // 40% one's own, 60% lent, tied to the stock.
  assert.equal(r.fill.financed, Math.round(total * 0.6));
  assert.equal(s.loans.TWD.balance, Math.round(total * 0.6));
  assert.equal(s.positions['2330.TW'].financed, Math.round(total * 0.6));
  assert.equal(Math.round(s.cash.TWD), Math.round(1_000_000 - total + total * 0.6));
  // Half sold: half the loan repaid out of the proceeds.
  const v2 = valuate(s, new Map([['2330.TW', q]]), RATES);
  const sell = placeOrder(r.account, { symbol: '2330.TW', side: 'sell', type: 'market', qty: 500 }, { quote: q, rates: RATES, valuation: v2, now: T0 + 1000, id: 's1' });
  assert.equal(sell.fill.repaid, Math.round(total * 0.3));
  const s2 = replay(sell.account, T0 + 1000);
  assert.ok(Math.abs(s2.loans.TWD.balance - total * 0.3) < 2);
  assert.ok(Math.abs(s2.positions['2330.TW'].financed - total * 0.3) < 2);
  // Not what a broker lends against: refused.
  const btc = { ...quote('BTC-USD', 60_000), kind: 'crypto', market: 'CRYPTO', currency: 'USD' };
  assert.equal(placeOrder(a, { symbol: 'BTC-USD', side: 'buy', type: 'market', qty: 0.01, margin: true }, { quote: btc, rates: RATES, valuation: v, now: T0, id: 'm2' }).error, 'notMarginable');
});

test('an overdraft collected by a sale: a cover order is forced and marked as such', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  const q = quote('2330.TW', 2475);
  a = placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100 }, { quote: q, rates: RATES, now: T0, id: 'b1' }).account;
  const r = placeOrder(a, { symbol: '2330.TW', side: 'sell', type: 'market', qty: 10, forced: true, cover: true }, { quote: q, rates: RATES, now: T0 + 1000, id: 'c1' });
  assert.equal(r.order.cover, true);
  assert.equal(r.fill.cover, true);
  assert.equal(r.fill.forced, true);
});

test('a default: 7% penalty, and no margin or shorting for 5 years; a missed margin call sells what was bought on margin', async () => {
  const { penaltyEvent, defaulted, callPlan, DEFAULT_BAN } = await import('../public/lib/account.mjs');
  let a = newAccount(1_000_000, T0, 'acc');
  const q = quote('2330.TW', 2475);
  const fine = penaltyEvent(10_000, T0);
  assert.equal(fine.amount, 700);
  a = { ...a, events: [...a.events, fine], defaultAt: T0 };
  assert.equal(replay(a, T0).cash.TWD, 1_000_000 - 700);
  assert.ok(defaulted(a, T0 + DEFAULT_BAN - 1) && !defaulted(a, T0 + DEFAULT_BAN));
  const v = valuate(replay(a, T0), new Map([['2330.TW', q]]), RATES);
  assert.equal(placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0, id: 'd1' }).error, 'defaulted');
  // 斷頭: a holding bought on margin is sold whole.
  let b = withCredit(newAccount(1_000_000, T0, 'acc2'), T0);
  const vb = valuate(replay(b, T0), new Map([['2330.TW', q]]), RATES);
  b = placeOrder(b, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 1000, margin: true }, { quote: q, rates: RATES, valuation: vb, now: T0, id: 'm1' }).account;
  const plan = callPlan(b, valuate(replay(b, T0), new Map([['2330.TW', q]]), RATES));
  assert.deepEqual(plan.map(p => [p.symbol, p.side, p.qty, p.forced]), [['2330.TW', 'sell', 1000, true]]);
});

test('the welcome offer: an account marked by the app pays no commission on its first trade, only then', async () => {
  const { withWelcome, firstTrade } = await import('../public/lib/account.mjs');
  const a = withWelcome(newAccount(1_000_000, T0, 'acc'));
  assert.equal(firstTrade(a), true);
  const r = placeOrder(a, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'o1' });
  assert.equal(r.fill.commission, 0);
  assert.equal(firstTrade(r.account), false);
  assert.equal(withWelcome(r.account), r.account);
  const r2 = placeOrder(r.account, { symbol: '2330.TW', side: 'buy', type: 'market', qty: 100 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0 + 1, id: 'o2' });
  assert.equal(r2.fill.commission, 353);
});

test('not enough cash, not enough shares, bad quantities', () => {
  const a = newAccount(100_000, T0, 'acc');
  const q = quote('2330.TW', 2475);
  assert.equal(placeOrder(a, { side: 'buy', qty: 100 }, { quote: q, rates: RATES, now: T0 }).error, 'funds');
  // Selling what isn't held is a short sale: it needs the account's valuation, and a shortable kind.
  assert.equal(placeOrder(a, { side: 'sell', qty: 1 }, { quote: q, rates: RATES, now: T0 }).error, 'noValuation');
  assert.equal(placeOrder(a, { side: 'sell', qty: 1 }, { quote: { ...q, kind: 'fund' }, rates: RATES, now: T0 }).error, 'shares');
  assert.equal(placeOrder(a, { side: 'buy', qty: 1.5 }, { quote: q, rates: RATES, now: T0 }).error, 'qtyStep');
  assert.equal(placeOrder(a, { side: 'buy', qty: 0 }, { quote: q, rates: RATES, now: T0 }).error, 'qty');
  assert.equal(placeOrder(a, { side: 'buy', qty: 1 }, { quote: { ...q, kind: 'index' }, rates: RATES, now: T0 }).error, 'notTradable');
  // US stock with only NT$: needs dollars first.
  assert.equal(placeOrder(a, { side: 'buy', qty: 1 }, { quote: quote('AAPL', 300), rates: RATES, now: T0 }).error, 'funds');
});

test('exchanging NT$ for US$: the spread is the cost, twice as wide while FX is shut', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const q = quoteExchange('TWD', 'USD', 320_000, RATES, true);
  assert.equal(q.received, 9980);
  assert.ok(Math.abs(q.spreadTWD - 640) < 1e-6);
  assert.equal(quoteExchange('TWD', 'USD', 320_000, RATES, false).received, 9960);
  const r = exchange(a, { from: 'TWD', to: 'USD', amount: 320_000 }, { rates: RATES, now: T0, id: 'x' });
  const s = replay(r.account, T0);
  assert.equal(s.cash.TWD, 680_000);
  assert.equal(s.cash.USD, 9980);
  assert.ok(Math.abs(s.paid.fx - 640) < 1e-6);
  assert.equal(exchange(a, { from: 'TWD', to: 'USD', amount: 2_000_000 }, { rates: RATES, now: T0 }).error, 'funds');
  const need = amountFor('TWD', 'USD', 1000, RATES);
  assert.ok(quoteExchange('TWD', 'USD', need, RATES).received >= 1000);
  assert.ok(quoteExchange('TWD', 'USD', need - 1, RATES).received < 1000);
});

test('buy abroad, sell later: realized profit in NT$ includes the currency move', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 320_000 }, { rates: RATES, now: T0, id: 'x' }).account;
  // Limit orders at the price: no spread, so only the fees and the currency move count.
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 300, qty: 10 }, { quote: quote('AAPL', 300), rates: RATES, now: T0 + 1, id: 'b' }).account;
  let s = replay(a, T0 + 1);
  assert.equal(s.cash.USD, 9980 - 3003);
  const later = T0 + 30 * DAY;
  const rates2 = { ...RATES, USD: 33 };
  const r = placeOrder(a, { side: 'sell', type: 'limit', limit: 330, qty: 10 }, { quote: quote('AAPL', 330, { at: later }), rates: rates2, now: later, id: 's' });
  s = replay(r.account, later);
  assert.equal(s.positions.AAPL, undefined);
  const proceeds = 3300 - 3.3 - 0.07;
  assert.ok(Math.abs(s.cash.USD - (9980 - 3003 + proceeds)) < 1e-6);
  assert.ok(Math.abs(s.realized - (proceeds * 33 - 3003 * 32)) < 1e-6);
  assert.equal(s.closed.length, 1);
});

test('orders placed while the market is shut wait, hold their cash and fill at the open', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const shut = closed(quote('2330.TW', 2475));
  const r = placeOrder(a, { side: 'buy', type: 'market', qty: 100 }, { quote: shut, rates: RATES, now: T0, id: 'm' });
  assert.equal(r.order.status, 'open');
  assert.equal(r.fill, null);
  assert.ok(r.order.reserve > 247_852);
  const avail = available(r.account, replay(r.account, T0));
  assert.equal(avail.cash.TWD, 1_000_000 - r.order.reserve);
  // Still shut: nothing happens.
  assert.equal(processOrders(r.account, new Map([['2330.TW', shut]]), RATES, T0 + HOUR).filled.length, 0);
  // Next morning it opens at 2500.
  const open = quote('2330.TW', 2500, { at: T0 + DAY });
  const p = processOrders(r.account, new Map([['2330.TW', open]]), RATES, T0 + DAY);
  assert.equal(p.filled.length, 1);
  // At the ask: half a tick above the opening price.
  assert.equal(p.filled[0].price, 2502.5);
  assert.equal(p.account.orders[0].status, 'filled');
  // Cancelled orders free their cash.
  const c = cancelOrder(r.account, 'm', T0 + 5);
  assert.equal(available(c, replay(c, T0)).cash.TWD, 1_000_000);
});

test('limit and stop orders trigger on price, or on the day range when placed before the session', () => {
  const o = (side, type, lim, t = T0) => ({ side, type, [type === 'limit' ? 'limit' : 'stop']: lim, t });
  const q = quote('X', 100, { dayLow: 95, dayHigh: 104 });
  assert.equal(triggerPrice(o('buy', 'limit', 101), q, T0), 100);
  assert.equal(triggerPrice(o('buy', 'limit', 99), q, T0), null);
  assert.equal(triggerPrice(o('buy', 'limit', 96, T0 - 2 * HOUR), q, T0), 96);
  assert.equal(triggerPrice(o('sell', 'limit', 103, T0 - 2 * HOUR), q, T0), 103);
  assert.equal(triggerPrice(o('sell', 'limit', 103), q, T0), null);
  assert.equal(triggerPrice(o('sell', 'stop', 101), q, T0), 100);
  assert.equal(triggerPrice(o('sell', 'stop', 97), q, T0), null);
  assert.equal(triggerPrice(o('buy', 'stop', 99), q, T0), 100);
  assert.equal(triggerPrice(o('buy', 'market'), closed(q), T0), null);
  // Crypto never closes.
  assert.equal(triggerPrice(o('buy', 'market'), { ...closed(q), kind: 'crypto' }, T0), 100);
});

test('a buy that no longer fits the cash when it fills is rejected', () => {
  let a = newAccount(260_000, T0, 'acc');
  a = placeOrder(a, { side: 'buy', type: 'market', qty: 100 }, { quote: closed(quote('2330.TW', 2475)), rates: RATES, now: T0, id: 'm' }).account;
  const p = processOrders(a, new Map([['2330.TW', quote('2330.TW', 2700, { at: T0 + DAY })]]), RATES, T0 + DAY);
  assert.equal(p.filled.length, 0);
  assert.equal(p.rejected[0].reason, 'funds');
  assert.equal(replay(p.account, T0 + DAY).cash.TWD, 260_000);
});

test('valuation in NT$: holdings, cash, day change, allocation, currency exposure', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 320_000 }, { rates: RATES, now: T0, id: 'x' }).account;
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 300, qty: 10 }, { quote: quote('AAPL', 300), rates: RATES, now: T0, id: 'b' }).account;
  const quotes = new Map([['AAPL', { ...quote('AAPL', 310, { at: T0 + DAY }), prev: 305, pct: 310 / 305 - 1 }]]);
  const v = valuate(replay(a, T0 + DAY), quotes, RATES);
  assert.equal(v.positions[0].valueTWD, 3100 * 32);
  assert.equal(v.cashTWD, 680_000 + (9980 - 3003) * 32);
  assert.ok(Math.abs(v.netWorth - (v.cashTWD + v.holdingsTWD)) < 1e-6);
  assert.ok(Math.abs(v.totalReturn - (v.netWorth - 1_000_000)) < 1e-6);
  assert.equal(v.dayChange, 5 * 10 * 32);
  assert.ok(v.byCurrency.USD > 0 && v.byCurrency.TWD === 680_000);
  assert.equal(v.byKind.stock, 3100 * 32);
  assert.equal(v.margin, 'ok');
  assert.equal(v.ratio, Infinity);
});

test('loans: borrowing power from holdings, interest by the day, repaying', () => {
  let a = newAccount(2_000_000, T0, 'acc');
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 2475, qty: 400 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'b' }).account;
  const quotes = new Map([['2330.TW', quote('2330.TW', 2475)]]);
  let v = valuate(replay(a, T0), quotes, RATES);
  assert.equal(v.capacity, 990_000 * 0.6);
  assert.equal(borrow(a, { currency: 'TWD', amount: 700_000 }, { valuation: v, rates: RATES, now: T0 }).error, 'capacity');
  a = borrow(a, { currency: 'TWD', amount: 500_000 }, { valuation: v, rates: RATES, now: T0, id: 'l' }).account;
  const year = T0 + 365 * DAY;
  const s = replay(a, year);
  assert.ok(Math.abs(s.loans.TWD.balance - 500_000 * 1.065) < 1e-6);
  v = valuate(s, quotes, RATES);
  assert.ok(Math.abs(v.debtTWD - 532_500) < 1e-6);
  assert.ok(Math.abs(v.paid.interest - 32_500) < 1e-6);
  const r = repay(a, { currency: 'TWD', amount: 10_000_000 }, { now: year, id: 'r' });
  assert.equal(r.event.amount, 532_500);
  const after = replay(r.account, year);
  assert.equal(after.loans.TWD.balance, 0);
  assert.ok(Math.abs(after.cash.TWD - (2_000_000 - 990_000 - 1410 + 500_000 - 532_500)) < 1e-6);
});

test('margin call and forced sale when holdings fall; the sale pays the loan back', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = placeOrder(a, { side: 'buy', qty: 400 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'b' }).account;
  let v = valuate(replay(a, T0), new Map([['2330.TW', quote('2330.TW', 2475)]]), RATES);
  a = borrow(a, { currency: 'TWD', amount: 590_000 }, { valuation: v, rates: RATES, now: T0, id: 'l' }).account;
  a = placeOrder(a, { side: 'buy', qty: 240 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'b2' }).account;
  const crash = quote('2330.TW', 900, { at: T0 + DAY });
  v = valuate(replay(a, T0 + DAY), new Map([['2330.TW', crash]]), RATES);
  assert.equal(v.margin, 'liquidate');
  const plan = liquidationPlan(a, v);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].qty, 640);
  const sold = placeOrder(a, plan[0], { quote: crash, rates: RATES, now: T0 + DAY, id: 'f' });
  assert.equal(sold.fill.forced, true);
  const paid = repayAll(sold.account, RATES, true, T0 + DAY);
  const s = replay(paid, T0 + DAY);
  // Under 100% the sale can't cover it all: every dollar goes to the loan.
  assert.ok(s.loans.TWD.balance > 0 && s.loans.TWD.balance < 20_000);
  assert.ok(Math.abs(s.cash.TWD) < 1);
  // A milder fall only calls.
  const dip = valuate(replay(a, T0 + DAY), new Map([['2330.TW', quote('2330.TW', 1000)]]), RATES);
  assert.equal(dip.margin, 'call');
  assert.equal(liquidationPlan(a, dip).length, 0);
});

test('repayAll exchanges other cash to pay a foreign-currency loan', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = placeOrder(a, { side: 'buy', qty: 100 }, { quote: quote('2330.TW', 2475), rates: RATES, now: T0, id: 'b' }).account;
  const v = valuate(replay(a, T0), new Map([['2330.TW', quote('2330.TW', 2475)]]), RATES);
  a = borrow(a, { currency: 'USD', amount: 1000 }, { valuation: v, rates: RATES, now: T0, id: 'l' }).account;
  a = exchange(a, { from: 'USD', to: 'TWD', amount: 1000 }, { rates: RATES, now: T0, id: 'x' }).account;
  const paid = repayAll(a, RATES, true, T0 + DAY);
  const s = replay(paid, T0 + DAY);
  assert.equal(s.loans.USD.balance, 0);
  assert.ok(s.cash.USD >= 0 && s.cash.USD < 1);
});

test('dividends while held: split-adjusted amounts, US withholding, NT$ at today’s rate; splits multiply shares', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 320_000 }, { rates: RATES, now: T0, id: 'x' }).account;
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 900, qty: 10 }, { quote: quote('NVDA', 900), rates: RATES, now: T0, id: 'b' }).account;
  const split = { date: T0 + 10 * DAY, ratio: 10 };
  const actions = {
    splits: [split],
    // Yahoo lists the pre-split dividend already divided by 10.
    dividends: [{ date: T0 - DAY, amount: 0.004 }, { date: T0 + 5 * DAY, amount: 0.004 }, { date: T0 + 20 * DAY, amount: 0.01 }, { date: T0 + 400 * DAY, amount: 1 }]
  };
  const r = applyCorporateActions(a, 'NVDA', actions, { rates: RATES, now: T0 + 30 * DAY });
  assert.deepEqual(r.added.map(e => e.type), ['split', 'div', 'div']);
  const [, before, after] = r.added;
  assert.equal(before.shares, 10);
  assert.ok(Math.abs(before.perShare - 0.04) < 1e-12);
  assert.equal(before.gross, 0.4);
  assert.equal(before.withheld, 0.12);
  assert.equal(after.shares, 100);
  assert.equal(after.gross, 1);
  const s = replay(r.account, T0 + 30 * DAY);
  assert.equal(s.positions.NVDA.qty, 100);
  assert.equal(s.positions.NVDA.cost, 9009);
  // Applying again adds nothing.
  assert.equal(applyCorporateActions(r.account, 'NVDA', actions, { rates: RATES, now: T0 + 30 * DAY }).added.length, 0);
});

test('merging two devices: logs unite, an order filled anywhere is filled, a fresh start wins', () => {
  const base = newAccount(1_000_000, T0, 'acc');
  const shut = closed(quote('2330.TW', 2475));
  const withOrder = placeOrder(base, { side: 'buy', qty: 10 }, { quote: shut, rates: RATES, now: T0, id: 'o' }).account;
  // Device A fills it, device B cancels it and exchanges money.
  const a = processOrders(withOrder, new Map([['2330.TW', quote('2330.TW', 2475, { at: T0 + DAY })]]), RATES, T0 + DAY).account;
  let b = cancelOrder(withOrder, 'o', T0 + 2);
  b = exchange(b, { from: 'TWD', to: 'USD', amount: 32_000 }, { rates: RATES, now: T0 + 3, id: 'x' }).account;
  const m1 = mergeAccounts(a, b);
  const m2 = mergeAccounts(b, a);
  assert.deepEqual(replay(m1, T0 + DAY), replay(m2, T0 + DAY));
  assert.equal(m1.orders[0].status, 'filled');
  const s = replay(m1, T0 + DAY);
  assert.equal(s.positions['2330.TW'].qty, 10);
  assert.equal(s.cash.USD, 998);
  const fresh = newAccount(50_000, T0 + 9 * DAY, 'new');
  assert.equal(mergeAccounts(m1, fresh).id, 'new');
  assert.equal(mergeAccounts(fresh, m1).id, 'new');
  // Watchlists: the later change wins.
  const w1 = toggleWatch(base, 'AAPL', T0 + 1);
  const w2 = toggleWatch(w1, 'AAPL', T0 + 2);
  assert.deepEqual(watched(mergeAccounts(w1, w2)), []);
  assert.deepEqual(watched(mergeAccounts(w2, toggleWatch(w2, 'AAPL', T0 + 3))), ['AAPL']);
});

test('deposits count as money put in, not as returns; snapshots and benchmarks', () => {
  let a = newAccount(100_000, T0, 'acc');
  a = deposit(a, 50_000, T0 + DAY, 'd').account;
  const s = replay(a, T0 + DAY);
  assert.equal(s.deposits, 150_000);
  const v = valuate(s, new Map(), RATES);
  assert.equal(v.totalReturn, 0);
  let snap = recordSnapshot(a, T0, 100_000, 100_000);
  assert.equal(recordSnapshot(snap, T0 + 60_000, 1, 1), snap);
  snap = recordSnapshot(snap, T0 + DAY, 150_500, 150_000);
  assert.equal(Object.keys(snap.snapshots).length, 2);
  const points = [[T0, 100], [T0 + DAY, 110], [T0 + 2 * DAY, 121]];
  assert.ok(Math.abs(benchmarkValue([{ t: T0, amount: 100 }, { t: T0 + DAY, amount: 110 }], points) - 242) < 1e-9);
});

test('crypto in fractions, gold passbook at the bank’s spread', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 320_000 }, { rates: RATES, now: T0, id: 'x' }).account;
  const btc = { ...closed(quote('BTC-USD', 80_000)), kind: 'crypto', market: 'CRYPTO' };
  const r = placeOrder(a, { side: 'buy', type: 'limit', limit: 80_000, qty: 0.05 }, { quote: btc, rates: RATES, now: T0, id: 'c' });
  assert.equal(r.fill.gross, 4000);
  assert.equal(r.fill.commission, 4);
  const gold = { ...quote('XAU', 4400), kind: 'metal', market: 'METAL', currency: 'TWD' };
  const g = placeOrder(r.account, { side: 'buy', qty: 10 }, { quote: gold, rates: RATES, now: T0, id: 'g' });
  assert.equal(g.fill.gross, 44_264);
  assert.equal(g.fill.commission, 0);
  assert.equal(placeOrder(r.account, { side: 'buy', qty: 0.5 }, { quote: gold, rates: RATES, now: T0 }).error, 'qtyStep');
  void ids;
});
