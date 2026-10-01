import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, placeOrder, processOrders, valuate } from '../public/lib/account.mjs';
import { creditAccount, creditCheck, openCredit, bestTier, terms, extendTerm, closeOutPlan, afterHours, dayTradeSellFirst, CREDIT_TIERS } from '../public/lib/credit.mjs';
import { tradeCosts } from '../public/lib/markets.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tpe = (d, hm) => Date.parse(`${d}T${hm}:00+08:00`);
const RATES = { TWD: 1, USD: 32 };
// Every account needs a credit account for margin and short selling.
const T0 = tpe('2028-03-01', '10:00'); // Wednesday
const quote = (symbol, price, at = T0, over = {}) => ({
  symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, pct: 0, dayHigh: price, dayLow: price,
  session: { start: tpe(new Date(at + 8 * HOUR).toISOString().slice(0, 10), '09:00'), end: tpe(new Date(at + 8 * HOUR).toISOString().slice(0, 10), '13:30') }, marketTime: at, line: [], ...over
});
const val = (a, t, quotes) => valuate(replay(a, t), new Map(quotes), RATES);

// An account opened `months` before T0 with `n` trades of NT$`each` in the last year.
function trader(months, n, each = 100_000) {
  const created = T0 - months * 31 * DAY;
  const a = newAccount(5_000_000, created, 'acc');
  const fills = Array.from({ length: n }, (_, i) => ({ id: `fill:h${i}`, type: 'fill', t: T0 - (i + 1) * DAY, symbol: 'H.TW', name: 'H', kind: 'stock', market: 'TW', currency: 'TWD', side: i % 2 ? 'sell' : 'buy', qty: 1000, price: each / 1000, gross: each, commission: 0, tax: 0, fee: 0, total: each, twd: 1 }));
  return { ...a, created, events: [...a.events, ...fills] };
}

test('a new account has no credit account; margin and shorts in Taiwan need one', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  assert.equal(creditAccount(a, T0).open, false);
  const q = quote('2330.TW', 1000);
  const v = val(a, T0, [['2330.TW', q]]);
  assert.equal(placeOrder(a, { side: 'buy', qty: 1000, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0 }).error, 'creditNeeded');
  assert.equal(placeOrder(a, { side: 'sell', qty: 1000 }, { quote: q, rates: RATES, valuation: v, now: T0 }).error, 'creditNeeded');
});

test('an older account still opens its credit account by the rules', () => {
  const old = newAccount(1_000_000, tpe('2026-09-01', '10:00'), 'acc');
  assert.deepEqual(creditAccount(old, T0), { open: false, limit: 0, since: null });
});

test('opening one: three months, ten trades, turnover of half the limit, and means above the first tier', () => {
  const young = trader(2, 12);
  assert.deepEqual(creditCheck(young, 500_000, 1e9, T0).needs.map(n => n.key), ['age']);
  const few = trader(6, 9);
  assert.deepEqual(creditCheck(few, 500_000, 1e9, T0).needs.map(n => n.key), ['trades']);
  // 12 trades of 100,000: 1.2M turnover, enough for 2M (half is 1M), not 3M.
  const ok = trader(6, 12);
  assert.equal(creditCheck(ok, 2_000_000, 1e9, T0).ok, true);
  assert.deepEqual(creditCheck(ok, 3_000_000, 1e9, T0).needs.map(n => n.key), ['turnover']);
  // 2M needs NT$600,000 of means.
  assert.deepEqual(creditCheck(ok, 2_000_000, 500_000, T0).needs.map(n => n.key), ['means']);
  assert.equal(bestTier(ok, 1e9, T0), 2_000_000);
  const opened = openCredit(ok, 1_000_000, 1e9, T0);
  assert.equal(creditAccount(opened.account, T0).limit, 1_000_000);
  assert.equal(openCredit(young, 500_000, 1e9, T0).error, 'credit');
  assert.ok(CREDIT_TIERS.includes(500_000));
});

test('融資 within the limit; a six-month term, 展延 in its last month, sold when past due', () => {
  let a = openCredit(trader(6, 12), 1_000_000, 1e9, T0).account;
  const q = quote('2330.TW', 1000);
  let v = val(a, T0, [['2330.TW', q]]);
  // 2,000 shares: NT$1.2M lent, over the 1M limit.
  const over = placeOrder(a, { side: 'buy', qty: 2000, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0 });
  assert.equal(over.error, 'creditLimit');
  const r = placeOrder(a, { side: 'buy', qty: 1000, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0, id: 'm' });
  assert.equal(r.error, undefined);
  a = r.account;
  const due = tpe('2028-09-01', '10:00');
  v = val(a, T0, [['2330.TW', q]]);
  assert.equal(terms(v, T0)[0].due, due);
  assert.equal(extendTerm(a, v, '2330.TW', T0 + DAY).error, 'termEarly');
  const inWindow = due - 10 * DAY;
  const ext = extendTerm(a, val(a, inWindow, [['2330.TW', q]]), '2330.TW', inWindow);
  assert.equal(ext.error, undefined);
  assert.equal(terms(val(ext.account, inWindow, [['2330.TW', q]]), inWindow)[0].due, tpe('2029-03-01', '10:00'));
  // Not extended: sold when due.
  const late = due + HOUR;
  assert.deepEqual(closeOutPlan(a, val(a, late, [['2330.TW', quote('2330.TW', 1000, late)]]), late).map(p => [p.side, p.qty, p.reason]), [['sell', 1000, 'due']]);
});

test('day trading sold first: a year open and ten trades; what is not bought back by the close is bought back for you', () => {
  const young = trader(6, 12);
  assert.equal(dayTradeSellFirst(young, T0), false);
  let a = trader(13, 12);
  assert.equal(dayTradeSellFirst(a, T0), true);
  const q = quote('2330.TW', 1000);
  const r = placeOrder(a, { side: 'sell', type: 'limit', limit: 1000, qty: 1000 }, { quote: q, rates: RATES, valuation: val(a, T0, [['2330.TW', q]]), now: T0, id: 'd' });
  assert.equal(r.error, undefined);
  assert.equal(r.fill.dayShort, true);
  // Day-trade tax: half of 0.3%.
  assert.equal(r.fill.tax, 1500);
  a = r.account;
  const close = tpe('2028-03-01', '13:31');
  assert.deepEqual(closeOutPlan(a, val(a, close, [['2330.TW', quote('2330.TW', 1000, close)]]), close).map(p => [p.side, p.qty, p.reason]), [['buy', 1000, 'dayTrade']]);
  assert.deepEqual(closeOutPlan(a, val(a, T0 + HOUR, [['2330.TW', q]]), T0 + HOUR), []);
});

test('after-hours: an order after the close matches once at 14:30, at the close', () => {
  assert.equal(afterHours(tpe('2028-03-01', '13:00')), null);
  assert.ok(afterHours(tpe('2028-03-01', '13:45')));
  assert.equal(afterHours(tpe('2028-03-04', '13:45')), null); // a Saturday
  const a = newAccount(1_000_000, T0, 'acc');
  const at = tpe('2028-03-01', '13:50');
  const q = quote('2330.TW', 1000, tpe('2028-03-01', '13:30'));
  const r = placeOrder(a, { side: 'buy', type: 'limit', limit: 1005, qty: 300 }, { quote: q, rates: RATES, now: at, id: 'a' });
  assert.equal(r.error, undefined);
  assert.equal(r.fill, null);
  assert.equal(r.order.after, tpe('2028-03-01', '14:30'));
  assert.equal(processOrders(r.account, new Map([['2330.TW', q]]), RATES, tpe('2028-03-01', '14:00')).filled.length, 0);
  const done = processOrders(r.account, new Map([['2330.TW', q]]), RATES, tpe('2028-03-01', '14:30'));
  assert.equal(done.filled.length, 1);
  assert.equal(done.filled[0].price, 1000);
  assert.equal(done.filled[0].after, true);
});

test('fees: the minimum applies after the discount; free is free', () => {
  // 2.8折 of 0.1425% on NT$10,000 is NT$3.99: the NT$20 minimum still.
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 10_000, currency: 'TWD', discount: 0.28 }).commission, 20);
  // On NT$1,000,000: 1,425 × 0.28 = 399.
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 1_000_000, currency: 'TWD', discount: 0.28 }).commission, 399);
  // Odd lots: NT$1 minimum.
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 500, currency: 'TWD', oddLot: true }).commission, 1);
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 1_000_000, currency: 'TWD', discount: 0 }).commission, 0);
});

test('no credit account: no margin or borrowed shorts in any market, and the broker closes any it holds', () => {
  const a = newAccount(1_000_000, T0, 'acc');
  const us = quote('AAPL', 200, T0, { market: 'US', currency: 'USD', session: { start: T0 - HOUR, end: T0 + 5 * HOUR } });
  const v = val(a, T0, [['AAPL', us]]);
  assert.equal(placeOrder(a, { side: 'buy', qty: 10, margin: true }, { quote: us, rates: RATES, valuation: v, now: T0 }).error, 'creditNeeded');
  assert.equal(placeOrder(a, { side: 'sell', qty: 10 }, { quote: us, rates: RATES, valuation: v, now: T0 }).error, 'creditNeeded');
  // A currency pair sold is no borrowing: still allowed.
  const pair = quote('EURUSD=X', 1.1, T0, { kind: 'fx', market: 'FX', currency: 'USD', session: null });
  assert.notEqual(placeOrder(a, { side: 'sell', qty: 1000 }, { quote: pair, rates: RATES, valuation: val(a, T0, [['EURUSD=X', pair]]), now: T0 }).error, 'creditNeeded');
  // 融資 held without a credit account (bought while it had one, an event later gone): sold.
  const opened = { ...a, events: [...a.events, { id: 'credit:x', type: 'credit', t: T0, limit: 5_000_000 }] };
  const q = quote('2330.TW', 1000);
  const bought = placeOrder(opened, { side: 'buy', qty: 1000, margin: true }, { quote: q, rates: RATES, valuation: val(opened, T0, [['2330.TW', q]]), now: T0, id: 'm' }).account;
  const without = { ...bought, events: bought.events.filter(e => e.type !== 'credit') };
  assert.deepEqual(closeOutPlan(without, val(without, T0 + HOUR, [['2330.TW', q]]), T0 + HOUR).map(p => [p.symbol, p.side, p.qty, p.reason]), [['2330.TW', 'sell', 1000, 'noCredit']]);
  assert.deepEqual(closeOutPlan(bought, val(bought, T0 + HOUR, [['2330.TW', q]]), T0 + HOUR), []);
});
