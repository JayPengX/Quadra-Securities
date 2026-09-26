import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newAccount, replay, placeOrder, processOrders, valuate, liquidationPlan, applyCorporateActions, applyBondCashflows, backfillPrice,
  fillFromHistory, netWorthSeries, exchange
} from '../public/lib/account.mjs';
import { BONDS, priceAt, curveYield, couponDates, bondQuote, bondSession, curveOf } from '../public/lib/bonds.mjs';
import { isOpen } from '../public/lib/markets.mjs';

const T0 = Date.UTC(2026, 8, 21, 2); // Monday 10:00 Taipei
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RATES = { TWD: 1, USD: 32 };
const quote = (symbol, price, over = {}) => {
  const at = over.at ?? T0;
  return {
    symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, pct: 0, dayHigh: price, dayLow: price,
    session: { start: at - HOUR, end: at + 4 * HOUR }, marketTime: at, line: [], ...over
  };
};
const val = (a, t, quotes) => valuate(replay(a, t), new Map(quotes), RATES);

test('short selling: proceeds in cash, owed at market, borrowing fee, profit when bought back lower', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  const q = quote('2330.TW', 2000);
  let v = val(a, T0, [['2330.TW', q]]);
  const r = placeOrder(a, { side: 'sell', qty: 100 }, { quote: q, rates: RATES, valuation: v, now: T0, id: 's' });
  assert.equal(r.error, undefined);
  assert.equal(r.order.short, true);
  a = r.account;
  let s = replay(a, T0);
  assert.equal(s.positions['2330.TW'].qty, -100);
  assert.equal(s.cash.TWD, 1_000_000 + 200_000 - 285 - 600);
  v = val(a, T0, [['2330.TW', q]]);
  assert.equal(v.shortTWD, 200_000);
  assert.ok(Math.abs(v.netWorth - (1_000_000 - 885)) < 1e-6);
  // A month later at 1,800: bought back, 3% a year on NT$199,115 for 30 days.
  const later = T0 + 30 * DAY;
  const q2 = quote('2330.TW', 1800, { at: later });
  const b = placeOrder(a, { side: 'buy', qty: 100 }, { quote: q2, rates: RATES, now: later, id: 'b' });
  s = replay(b.account, later);
  assert.equal(s.positions['2330.TW'], undefined);
  const fee = (199_115 * 0.03 * 30) / 365;
  assert.ok(Math.abs(s.paid.borrow - fee) < 1e-6);
  assert.ok(Math.abs(s.realized - (199_115 - 180_256 - fee)) < 1e-6);
  assert.equal(s.closed[0].short, true);
});

test('shorts need 150% cover to open, get called and bought back when the price runs up', () => {
  let a = newAccount(100_000, T0, 'acc');
  const q = quote('X.TW', 100);
  const v = val(a, T0, [['X.TW', q]]);
  const big = placeOrder(a, { side: 'sell', qty: 3000 }, { quote: q, rates: RATES, valuation: v, now: T0 });
  assert.equal(big.error, 'shortMargin');
  assert.ok(big.max > 1500 && big.max < 2100);
  a = placeOrder(a, { side: 'sell', qty: 1900 }, { quote: q, rates: RATES, valuation: v, now: T0, id: 's' }).account;
  const up = quote('X.TW', 135, { at: T0 + DAY });
  const v2 = val(a, T0 + DAY, [['X.TW', up]]);
  assert.equal(v2.margin, 'liquidate');
  assert.deepEqual(liquidationPlan(a, v2).map(p => [p.side, p.qty]), [['buy', 1900]]);
  // Crypto can be shorted too, funds and passbooks can't.
  assert.equal(placeOrder(a, { side: 'sell', qty: 1 }, { quote: { ...q, kind: 'metal', market: 'METAL' }, rates: RATES, valuation: v, now: T0 }).error, 'shares');
});

test('a short pays the dividends', () => {
  let a = newAccount(1_000_000, T0, 'acc');
  const q = quote('0056.TW', 40, { kind: 'etf' });
  a = placeOrder(a, { side: 'sell', qty: 1000 }, { quote: q, rates: RATES, valuation: val(a, T0, [['0056.TW', q]]), now: T0, id: 's' }).account;
  const r = applyCorporateActions(a, '0056.TW', { dividends: [{ date: T0 + DAY, amount: 1 }], splits: [] }, { rates: RATES, now: T0 + 2 * DAY });
  assert.equal(r.added[0].net, -1000);
  assert.equal(r.added[0].withheld, 0);
});

test('bond math: a bond at its own coupon yield on a coupon date is worth par; accrued interest grows between', () => {
  const b = BONDS['UST-10Y'];
  const cpn = couponDates(b, Date.UTC(2027, 0, 1));
  assert.equal(new Date(cpn[0]).toISOString().slice(0, 10), '2026-08-15');
  assert.equal(new Date(cpn[1]).toISOString().slice(0, 10), '2027-02-15');
  const p = priceAt(b, 5.125, cpn[0]);
  assert.ok(Math.abs(p.dirty - 100) < 1e-9);
  const mid = priceAt(b, 5.125, (cpn[0] + cpn[1]) / 2);
  assert.ok(Math.abs(mid.accrued - 5.125 / 4) < 0.01);
  // Higher yields, lower prices; longer bonds move more.
  assert.ok(priceAt(b, 6.125, cpn[0]).clean < 93);
  assert.ok(priceAt(BONDS['UST-2Y'], 5.5, cpn[0]).clean > 97);
  // A bill: no coupon, priced at a discount.
  assert.ok(priceAt(BONDS['UST-3M'], 4, Date.UTC(2026, 8, 24)).dirty < 100);
  assert.equal(curveYield([[2, 4], [10, 5]], 6), 4.5);
  assert.equal(curveYield([[2, 4], [10, 5]], 30), 5);
});

test('bond quotes: one bond in its currency, US from the live curve, others from the reference', () => {
  const now = Date.UTC(2026, 8, 25, 15);
  const quotes = new Map([['^IRX', { price: 4.07 }], ['2YY=F', { price: 4.5 }], ['^FVX', { price: 5.0 }], ['^TNX', { price: 5.18 }], ['^TYX', { price: 5.5 }]]);
  const us = bondQuote(BONDS['UST-10Y'], curveOf('US', quotes), null, now);
  assert.equal(us.currency, 'USD');
  assert.equal(us.kind, 'govbond');
  assert.ok(us.price > 950 && us.price < 1010);
  assert.ok(Math.abs(us.bond.yield - 5.18) < 0.01);
  const tw = bondQuote(BONDS['TWGB-10Y'], curveOf('TW'), null, now);
  assert.equal(tw.currency, 'TWD');
  assert.ok(tw.price > 95_000 && tw.price < 101_000);
  assert.equal(curveOf('US', new Map()), null);
  // Bonds trade on weekdays in their own business hours.
  const saturday = Date.UTC(2026, 8, 26, 15);
  assert.equal(isOpen({ ...us, session: bondSession(BONDS['UST-10Y'], saturday) }, saturday), false);
  assert.equal(isOpen(us, now), true);
});

test('bonds pay coupons (less the issuer’s tax) and repay at maturity', () => {
  let a = newAccount(1_000_000, Date.UTC(2026, 0, 5), 'acc');
  const t = Date.UTC(2026, 0, 6, 3);
  const b = BONDS['TWGB-2Y'];
  const q = { ...bondQuote(b, curveOf('TW'), null, t), session: { start: t - HOUR, end: t + HOUR } };
  a = placeOrder(a, { side: 'buy', qty: 3 }, { quote: q, rates: RATES, now: t, id: 'b' }).account;
  const end = Date.UTC(2028, 6, 1);
  const r = applyBondCashflows(a, 'TWGB-2Y', { rates: RATES, now: end });
  const coupons = r.added.filter(e => e.coupon);
  assert.equal(coupons.length, 3);
  assert.equal(coupons[0].gross, 4125);
  assert.equal(coupons[0].withheld, 413); // NT$ to the dollar
  const mature = r.added.find(e => e.id === 'mature:TWGB-2Y');
  assert.equal(mature.total, 300_000);
  const s = replay(r.account, end);
  assert.equal(s.positions['TWGB-2Y'], undefined);
  assert.equal(applyBondCashflows(r.account, 'TWGB-2Y', { rates: RATES, now: end }).added.length, 0);
});

test('orders placed while the page was closed fill from the price history, at that time', () => {
  const order = { t: T0, side: 'buy', type: 'limit', limit: 95 };
  const bars = [{ t: T0 - 300_000, o: 90, h: 90, l: 90 }, { t: T0 + 300_000, o: 99, h: 100, l: 97 }, { t: T0 + 600_000, o: 96, h: 97, l: 94 }];
  assert.deepEqual(backfillPrice(order, bars), { t: T0 + 600_000, price: 95 });
  assert.deepEqual(backfillPrice({ ...order, limit: 100 }, bars), { t: T0 + 300_000, price: 99 });
  assert.deepEqual(backfillPrice({ t: T0, side: 'sell', type: 'stop', stop: 98 }, bars), { t: T0 + 300_000, price: 98 });
  assert.deepEqual(backfillPrice({ t: T0, side: 'buy', type: 'market' }, bars), { t: T0 + 300_000, price: 99 });
  assert.equal(backfillPrice({ ...order, limit: 80 }, bars), null);
  let a = newAccount(1_000_000, T0 - DAY, 'acc');
  const shut = { ...quote('2330.TW', 2000), session: { start: T0 + DAY, end: T0 + DAY + HOUR }, marketTime: T0 - HOUR };
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 1950, qty: 10 }, { quote: shut, rates: RATES, now: T0, id: 'o' }).account;
  const r = fillFromHistory(a, 'o', { t: T0 + 2 * HOUR, price: 1950 }, 1, T0 + 3 * DAY);
  assert.equal(r.fill.t, T0 + 2 * HOUR);
  assert.equal(r.fill.price, 1950);
  assert.equal(r.account.orders[0].status, 'filled');
});

test('net worth history from daily closes', () => {
  let a = newAccount(100_000, T0, 'acc');
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 32_000 }, { rates: RATES, now: T0 + 1, id: 'x' }).account;
  a = placeOrder(a, { side: 'buy', qty: 100 }, { quote: quote('0050.TW', 100), rates: RATES, now: T0 + 2, id: 'b' }).account;
  const days = [T0 - DAY, T0 + HOUR, T0 + DAY, T0 + 2 * DAY];
  const closes = { '0050.TW': [100, 110, 120] };
  const series = netWorthSeries(a, days, (sym, t) => closes[sym][Math.round((t - T0) / DAY)] ?? null, (cur, t) => (cur === 'USD' ? 32 + Math.round((t - T0) / DAY) : 1));
  assert.equal(series.length, 3);
  // Only what had happened by each day counts (the purchase came after the first day's end).
  const before = netWorthSeries(a, [T0 - 1], () => 100, cur => (cur === 'USD' ? 32 : 1));
  assert.deepEqual(before, []);
  // After the exchange, before the purchase: cash only.
  const early = netWorthSeries(a, [T0 + 1], () => 999, cur => (cur === 'USD' ? 32 : 1));
  assert.equal(early[0][1], 68_000 + 998 * 32);
  assert.equal(series[0][1], 57_980 + 998 * 32 + 10_000);
  assert.equal(series[2][1], 57_980 + 998 * 34 + 12_000);
  assert.equal(series[0][2], 100_000);
  void processOrders;
});
