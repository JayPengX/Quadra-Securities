// Each market's own rules: ticks, daily limits, board lots, lunch breaks,
// Stock Connect days, settlement on local business days, fees, and how long
// an order lasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tickSize, priceLimits, lotProblem, lotSize, atLunch, isOpen, settleDate, settleDays, tradeCosts, T1_EUROPE } from '../public/lib/markets.mjs';
import { newAccount, placeOrder, expireOrders, dayOrderEnd, replay, exchange, GTC_DAYS } from '../public/lib/account.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso, tz) => Date.parse(`${iso}${tz}`);

test('ticks: Hong Kong, Japan, Korea and China by price band', () => {
  assert.equal(tickSize('HK', 'stock', 385), 0.2);
  assert.equal(tickSize('HK', 'stock', 15), 0.01);
  assert.equal(tickSize('HK', 'stock', 0.3), 0.005);
  assert.equal(tickSize('JP', 'stock', 2500), 0.5);
  assert.equal(tickSize('KR', 'stock', 1500), 1);
  assert.equal(tickSize('KR', 'stock', 55_000), 100);
  assert.equal(tickSize('KR', 'etf', 55_000), 5);
  assert.equal(tickSize('CN', 'stock', 12.34), 0.01);
});

test('daily price limits: China 10% (20% on STAR and ChiNext), Korea 30%, Japan by yen band', () => {
  assert.deepEqual(priceLimits({ market: 'CN', kind: 'stock', prev: 10, symbol: '600519.SS' }), { up: 11, down: 9 });
  assert.deepEqual(priceLimits({ market: 'CN', kind: 'stock', prev: 10, symbol: '688981.SS' }), { up: 12, down: 8 });
  assert.deepEqual(priceLimits({ market: 'CN', kind: 'stock', prev: 10, symbol: '300750.SZ' }), { up: 12, down: 8 });
  assert.deepEqual(priceLimits({ market: 'KR', kind: 'stock', prev: 50_000, symbol: '005930.KS' }), { up: 65_000, down: 35_000 });
  assert.deepEqual(priceLimits({ market: 'JP', kind: 'stock', prev: 2_500, symbol: '7203.T' }), { up: 3_000, down: 2_000 });
  assert.equal(priceLimits({ market: 'US', kind: 'stock', prev: 100, symbol: 'AAPL' }), null);
});

test('board lots: Japan 100, China buys in 100s, Hong Kong by stock; odd remainders sell whole', () => {
  assert.equal(lotSize('JP', '7203.T', 'stock'), 100);
  assert.deepEqual(lotProblem('JP', '7203.T', 'stock', 'buy', 150), { lot: 100 });
  assert.equal(lotProblem('JP', '7203.T', 'stock', 'buy', 200), null);
  assert.deepEqual(lotProblem('CN', '600519.SS', 'stock', 'sell', 50, 150), { lot: 100 });
  assert.equal(lotProblem('CN', '600519.SS', 'stock', 'sell', 150, 150), null);
  assert.deepEqual(lotProblem('HK', '0005.HK', 'stock', 'buy', 100), { lot: 400 });
  assert.equal(lotProblem('HK', '0005.HK', 'stock', 'buy', 800), null);
  assert.equal(lotProblem('US', 'AAPL', 'stock', 'buy', 3), null);
  assert.equal(lotProblem('SG', 'D05.SI', 'stock', 'buy', 7), null);
});

test('lunch breaks and Stock Connect days', () => {
  const hk = { market: 'HK', kind: 'stock', session: { start: at('2026-09-30T09:30:00', '+08:00'), end: at('2026-09-30T16:00:00', '+08:00') } };
  assert.equal(atLunch('HK', at('2026-09-30T12:30:00', '+08:00')), true);
  assert.equal(isOpen(hk, at('2026-09-30T12:30:00', '+08:00')), false);
  assert.equal(isOpen(hk, at('2026-09-30T13:05:00', '+08:00')), true);
  assert.equal(atLunch('JP', at('2026-09-30T12:00:00', '+09:00')), true);
  assert.equal(atLunch('CN', at('2026-09-30T12:59:00', '+08:00')), true);
  assert.equal(atLunch('TW', at('2026-09-30T12:00:00', '+08:00')), false);
  // 1 July: Hong Kong is shut, Shanghai isn't: no Stock Connect, so no trading from abroad.
  const cn = { market: 'CN', kind: 'stock', session: { start: at('2026-07-01T09:30:00', '+08:00'), end: at('2026-07-01T15:00:00', '+08:00') } };
  assert.equal(isOpen(cn, at('2026-07-01T10:00:00', '+08:00')), false);
  assert.equal(isOpen({ ...cn, session: { start: at('2026-07-02T09:30:00', '+08:00'), end: at('2026-07-02T15:00:00', '+08:00') } }, at('2026-07-02T10:00:00', '+08:00')), true);
});

test('settlement: local business days, the market’s holidays skipped, Europe T+1 from 2027-10-11', () => {
  // A US sale on Tuesday: Wednesday, end of day in New York.
  assert.equal(settleDate('US', at('2026-09-29T10:00:00', '-04:00')), at('2026-09-30T23:59:59', '-04:00'));
  // Taiwan, Thursday 9/24: Friday 9/25 (Mid-Autumn) and Monday 9/28 are holidays, so T+2 is Wednesday.
  assert.equal(settleDate('TW', at('2026-09-24T10:00:00', '+08:00')), at('2026-09-30T23:59:59', '+08:00'));
  // Hong Kong across 1 October (a holiday there).
  assert.equal(settleDate('HK', at('2026-09-30T10:00:00', '+08:00')), at('2026-10-05T23:59:59', '+08:00'));
  assert.equal(settleDays('UK', T1_EUROPE - DAY), 2);
  assert.equal(settleDays('UK', T1_EUROPE + DAY), 1);
  assert.equal(settleDays('US'), 1);
  assert.equal(settleDate('CRYPTO', 5), 5);
});

test('fees: SEC fee, Korea’s 0.20%, Swiss stamp duty, India’s stamp duty, Taiwan odd lots and day trades', () => {
  assert.equal(tradeCosts({ market: 'US', side: 'sell', kind: 'stock', gross: 1_000_000, currency: 'USD' }).fee, 20.6);
  assert.equal(tradeCosts({ market: 'KR', side: 'sell', kind: 'stock', gross: 1_000_000, currency: 'KRW' }).tax, 2_000);
  assert.equal(tradeCosts({ market: 'CH', side: 'buy', kind: 'stock', gross: 10_000, currency: 'CHF' }).tax, 7.5);
  assert.equal(tradeCosts({ market: 'IN', side: 'buy', kind: 'stock', gross: 100_000, currency: 'INR' }).tax, 115);
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 5_000, currency: 'TWD', oddLot: true }).commission, 7);
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 5_000, currency: 'TWD' }).commission, 20);
  assert.equal(tradeCosts({ market: 'TW', side: 'sell', kind: 'stock', gross: 100_000, currency: 'TWD', dayTrade: true }).tax, 150);
  assert.equal(tradeCosts({ market: 'TW', side: 'sell', kind: 'stock', gross: 100_000, currency: 'TWD' }).tax, 300);
  assert.equal(tradeCosts({ market: 'TW', side: 'sell', kind: 'etf', gross: 100_000, currency: 'TWD', dayTrade: true }).tax, 100);
});

const twQuote = (price, now) => ({
  symbol: '2330.TW', name: '台積電', kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, tz: 'Asia/Taipei', marketTime: now,
  session: { start: at('2026-09-30T09:00:00', '+08:00'), end: at('2026-09-30T13:30:00', '+08:00') }
});

test('orders: day orders end with their session, GTC lasts a month, crypto never expires by day', () => {
  const now = at('2026-09-30T10:00:00', '+08:00');
  const a = newAccount(5_000_000, now - DAY, 'o');
  const day = placeOrder(a, { side: 'buy', type: 'limit', limit: 900, qty: 1000 }, { quote: twQuote(1000, now), rates: { TWD: 1 }, now, id: 'd' });
  assert.equal(day.order.tif, 'day');
  assert.equal(day.order.expires, at('2026-09-30T13:30:00', '+08:00'));
  const gtc = placeOrder(day.account, { side: 'buy', type: 'limit', limit: 900, qty: 1000, tif: 'gtc' }, { quote: twQuote(1000, now), rates: { TWD: 1 }, now, id: 'g' });
  assert.equal(gtc.order.expires, now + GTC_DAYS * DAY);
  // After the close the day order is gone and its cash is free; the GTC one stays.
  const r = expireOrders(gtc.account, at('2026-09-30T13:31:00', '+08:00'));
  assert.deepEqual(r.expired.map(o => o.id), ['d']);
  assert.equal(r.account.orders.find(o => o.id === 'd').status, 'expired');
  assert.equal(r.account.orders.find(o => o.id === 'g').status, 'open');
  // Placed after the close: good for the next session (Thursday 10/1).
  const late = at('2026-09-30T20:00:00', '+08:00');
  assert.equal(dayOrderEnd(twQuote(1000, late), late), at('2026-10-01T13:30:00', '+08:00'));
  const usd = exchange(a, { from: 'TWD', to: 'USD', amount: 100_000 }, { rates: { TWD: 1, USD: 32 }, now: now - 1 }).account;
  const btc = placeOrder(usd, { side: 'buy', type: 'limit', limit: 1, qty: 0.01 }, { quote: { symbol: 'BTC-USD', kind: 'crypto', market: 'CRYPTO', currency: 'USD', price: 60_000, prev: 60_000 }, rates: { TWD: 1, USD: 32 }, now, id: 'c' });
  assert.equal(btc.order.tif, 'gtc');
});

test('orders: board lots and China’s T+1 are the exchange’s, and a Taiwan day trade pays half the tax', () => {
  const now = at('2026-09-30T10:00:00', '+08:00');
  const a = newAccount(10_000_000, now - DAY, 'r');
  const jp = { symbol: '7203.T', name: 'Toyota', kind: 'stock', market: 'JP', currency: 'JPY', price: 2500, prev: 2500, tz: 'Asia/Tokyo', marketTime: now, session: { start: now - HOUR, end: now + 4 * HOUR } };
  assert.equal(placeOrder(a, { side: 'buy', type: 'market', qty: 50 }, { quote: jp, rates: { TWD: 1, JPY: 0.21 }, now, id: 'j' }).error, 'lot');
  // China: bought Tuesday morning, can't be sold until Wednesday.
  const tue = at('2026-09-29T10:00:00', '+08:00');
  const cn = { symbol: '600519.SS', name: 'Moutai', kind: 'stock', market: 'CN', currency: 'CNY', price: 1500, prev: 1500, tz: 'Asia/Shanghai', marketTime: tue, session: { start: tue - HOUR, end: tue + 4 * HOUR } };
  const rates = { TWD: 1, CNY: 4.4 };
  const funded = exchange(newAccount(10_000_000, tue - DAY, 'cn'), { from: 'TWD', to: 'CNY', amount: 1_000_000 }, { rates, now: tue - 1 }).account;
  const bought = placeOrder(funded, { side: 'buy', type: 'limit', limit: 1500, qty: 100 }, { quote: cn, rates, now: tue, id: 'c1' });
  assert.ok(bought.fill);
  assert.equal(placeOrder(bought.account, { side: 'sell', type: 'limit', limit: 1500, qty: 100 }, { quote: cn, rates, now: tue + HOUR, id: 'c2' }).error, 'tPlus1');
  const wed = { ...cn, marketTime: tue + DAY, session: { start: tue + DAY - HOUR, end: tue + DAY + 4 * HOUR } };
  assert.ok(placeOrder(bought.account, { side: 'sell', type: 'limit', limit: 1500, qty: 100 }, { quote: wed, rates, now: tue + DAY, id: 'c3' }).fill);
  // Taiwan: bought and sold the same day, 0.15% tax.
  const tw = twQuote(1000, now);
  const b = placeOrder(a, { side: 'buy', type: 'limit', limit: 1000, qty: 1000 }, { quote: tw, rates: { TWD: 1 }, now, id: 't1' });
  const sold = placeOrder(b.account, { side: 'sell', type: 'limit', limit: 1000, qty: 1000 }, { quote: tw, rates: { TWD: 1 }, now: now + HOUR, id: 't2' });
  assert.equal(sold.fill.tax, 1500);
  assert.ok(replay(sold.account, now + HOUR).cash.TWD > 0);
});

test('margin lends what brokers lend: Taiwan 60% (OTC 50%), Reg T 50% elsewhere, nothing on crypto, funds, gold, A-shares', async () => {
  const { collateralRate } = await import('../public/lib/markets.mjs');
  assert.equal(collateralRate('stock', 'TW', '2330.TW'), 0.6);
  assert.equal(collateralRate('stock', 'TW', '6488.TWO'), 0.5);
  assert.equal(collateralRate('etf', 'TW', '0050.TW'), 0.6);
  assert.equal(collateralRate('stock', 'US', 'AAPL'), 0.5);
  assert.equal(collateralRate('stock', 'CN', '600519.SS'), 0);
  assert.equal(collateralRate('stock', 'IN', 'RELIANCE.NS'), 0);
  for (const kind of ['crypto', 'fund', 'metal', 'fx']) assert.equal(collateralRate(kind, 'US', 'X'), 0, kind);
  assert.equal(collateralRate('govbond', 'BOND', 'UST10'), 0.9);
  // Borrow, buy, borrow again: with 60% the loans add up to 1.5× one's own money at most.
  let own = 100, loan = 0;
  for (let i = 0; i < 200; i++) loan += Math.max(0, 0.6 * (own + loan) - loan);
  assert.ok(Math.abs(loan - 150) < 1e-6);
});

test('a loan is kept out of the pool only while it may still be cash; never counted twice', async () => {
  const { borrowedCash } = await import('../public/lib/account.mjs');
  const loan = amount => ({ TWD: { currency: 'TWD', balance: amount } });
  // A cash loan not spent: it stays here.
  assert.equal(borrowedCash({ cash: { TWD: 150_000 }, loans: loan(50_000), positions: {} }), 50_000);
  // 融資 (the position's financed): the loan bought shares, the cash left is one's own.
  assert.equal(borrowedCash({ cash: { TWD: 60_000 }, loans: loan(60_000), positions: { '2330.TW': { currency: 'TWD', financed: 60_000 } } }), 0);
  // A loan from before 融資 was tied to purchases, spent on shares: only the cash still there.
  assert.equal(borrowedCash({ cash: { TWD: 22, USD: 0 }, loans: loan(46_708.64), positions: { '0050.TW': { currency: 'TWD', financed: 0 } } }), 22);
  // A loan in dollars, cash in dollars.
  assert.equal(borrowedCash({ cash: { USD: 100 }, loans: { USD: { currency: 'USD', balance: 300 } }, positions: {} }, { USD: 32 }), 3_200);
});
