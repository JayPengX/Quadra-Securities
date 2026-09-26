import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tradeCosts, marketOf, kindOf, normalizeCurrency, dividendTaxes, isOpen, roundQty, dealPrice, MARKETS, CURRENCIES } from '../public/lib/markets.mjs';
import { parseSpark, parseChart, parseSearch, metalQuote, fxSymbol } from '../public/lib/quotes.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('Taiwan: 0.1425% commission, at least NT$20, fractions dropped; sell tax by kind', () => {
  assert.deepEqual(
    [tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 10_000, currency: 'TWD' }).commission, tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 1_000_000, currency: 'TWD' }).commission],
    [20, 1425]
  );
  const stock = tradeCosts({ market: 'TW', side: 'sell', kind: 'stock', gross: 247_500, currency: 'TWD' });
  assert.equal(stock.commission, 352);
  assert.equal(stock.tax, 742);
  assert.equal(tradeCosts({ market: 'TW', side: 'sell', kind: 'etf', gross: 100_000, currency: 'TWD' }).tax, 100);
  assert.equal(tradeCosts({ market: 'TW', side: 'sell', kind: 'bond', gross: 100_000, currency: 'TWD' }).tax, 0);
  assert.equal(tradeCosts({ market: 'TW', side: 'buy', kind: 'stock', gross: 100_000, currency: 'TWD' }).tax, 0);
});

test('abroad: minimum commissions, stamp duties and sell fees', () => {
  assert.equal(tradeCosts({ market: 'US', side: 'buy', kind: 'stock', gross: 341.07, currency: 'USD' }).commission, 3);
  const us = tradeCosts({ market: 'US', side: 'sell', kind: 'stock', gross: 100_000, currency: 'USD' });
  assert.equal(us.commission, 100);
  assert.equal(us.fee, 2.78);
  const hk = tradeCosts({ market: 'HK', side: 'buy', kind: 'stock', gross: 100_000, currency: 'HKD' });
  assert.deepEqual([hk.commission, hk.tax, hk.fee], [250, 100, 8.5]);
  assert.equal(tradeCosts({ market: 'HK', side: 'buy', kind: 'etf', gross: 100_000, currency: 'HKD' }).tax, 0);
  assert.equal(tradeCosts({ market: 'UK', side: 'buy', kind: 'stock', gross: 1000, currency: 'GBP' }).tax, 5);
  assert.equal(tradeCosts({ market: 'UK', side: 'sell', kind: 'stock', gross: 1000, currency: 'GBP' }).tax, 0);
  assert.equal(tradeCosts({ market: 'CRYPTO', side: 'buy', kind: 'crypto', gross: 1000, currency: 'USD' }).total, 1);
  assert.equal(tradeCosts({ market: 'METAL', side: 'buy', kind: 'metal', gross: 1000, currency: 'TWD' }).total, 0);
  assert.ok(dealPrice('METAL', 'buy', 100) > 100 && dealPrice('METAL', 'sell', 100) < 100);
  assert.equal(dealPrice('US', 'buy', 100), 100);
});

test('every market has a currency with a flag and FX spread, and a commission', () => {
  for (const [id, m] of Object.entries(MARKETS)) {
    assert.ok(m.commission && m.commission.rate >= 0, id);
    if (m.currency) assert.ok(CURRENCIES[m.currency], `${id} currency ${m.currency}`);
  }
});

test('symbols to markets and kinds', () => {
  assert.equal(marketOf('2330.TW'), 'TW');
  assert.equal(marketOf('6488.TWO'), 'TW');
  assert.equal(marketOf('AAPL'), 'US');
  assert.equal(marketOf('BRK-B'), 'US');
  assert.equal(marketOf('HSBA.L'), 'UK');
  assert.equal(marketOf('0700.HK'), 'HK');
  assert.equal(marketOf('BTC-USD', 'crypto'), 'CRYPTO');
  assert.equal(marketOf('PETR4.SA'), 'INTL');
  assert.equal(kindOf('ETF', '00679B.TWO'), 'bond');
  assert.equal(kindOf('ETF', '0050.TW'), 'etf');
  assert.equal(kindOf('CRYPTOCURRENCY', 'BTC-USD'), 'crypto');
  assert.equal(kindOf('EQUITY', 'XAU'), 'metal');
  assert.deepEqual(normalizeCurrency('GBp'), { currency: 'GBP', factor: 100 });
  assert.equal(roundQty(0.123456789, 'crypto'), 0.12345678);
  assert.equal(roundQty(10.9, 'stock'), 10);
});

test('dividend taxes: US withholding, Taiwan NHI premium over NT$20,000', () => {
  assert.equal(dividendTaxes('US', 100).withheld, 30);
  assert.deepEqual(dividendTaxes('TW', 19_999), { withheld: 0, nhi: 0, net: 19_999 });
  assert.equal(dividendTaxes('TW', 50_000).nhi, 1055);
  assert.equal(dividendTaxes('HK', 1000).net, 1000);
});

test('spark: quotes with currency, kind, market and session (a Saturday: all closed but crypto)', () => {
  const q = parseSpark(fixture('yahoo-spark-2026-09-26.json'));
  assert.equal(q.size, 20);
  const tsmc = q.get('2330.TW');
  assert.equal(tsmc.currency, 'TWD');
  assert.equal(tsmc.kind, 'stock');
  assert.equal(tsmc.market, 'TW');
  assert.equal(tsmc.price, 2475);
  assert.equal(tsmc.prev, 2500);
  assert.ok(Math.abs(tsmc.pct + 0.01) < 1e-9);
  assert.ok(tsmc.line.length > 3);
  const saturday = Date.UTC(2026, 8, 26, 6);
  assert.equal(isOpen(tsmc, saturday), false);
  assert.equal(isOpen(q.get('BTC-USD'), saturday), true);
  assert.equal(q.get('SPY').kind, 'etf');
  assert.equal(q.get('^GSPC').kind, 'index');
  assert.equal(q.get('GC=F').kind, 'future');
  assert.equal(q.get('USDTWD=X').kind, 'fx');
  assert.equal(isOpen(tsmc, (tsmc.session.start + tsmc.session.end) / 2), true);
});

test('London prices in pence become pounds; passbook gold in NT$ a gram', () => {
  const q = parseSpark(fixture('yahoo-spark-fx-2026-09-26.json'));
  const hsbc = q.get('HSBA.L');
  assert.equal(hsbc.currency, 'GBP');
  assert.ok(Math.abs(hsbc.price - 15.122) < 1e-9);
  assert.ok(q.get(fxSymbol('JPY')).price > 0.1);
  const main = parseSpark(fixture('yahoo-spark-2026-09-26.json'));
  const gold = metalQuote('XAU', main.get('GC=F'), main.get('USDTWD=X'));
  assert.equal(gold.currency, 'TWD');
  assert.equal(gold.kind, 'metal');
  // US$4,321.2 an ounce at 31.695 = about NT$4,403 a gram.
  assert.ok(Math.abs(gold.price - (4321.2 * 31.695) / 31.1034768) < 1e-6);
});

test('charts: dividends and splits', () => {
  const nvda = parseChart(fixture('yahoo-chart-nvda-5y.json'));
  assert.equal(nvda.splits.length, 1);
  assert.equal(nvda.splits[0].ratio, 10);
  assert.ok(nvda.dividends.length > 10);
  assert.ok(nvda.points.length > 50);
  const div = parseChart(fixture('yahoo-chart-0056-1y.json'));
  assert.ok(div.dividends.every(d => d.amount > 0.5));
});

test('search keeps stocks, funds, crypto and the like, not options', () => {
  const r = parseSearch({ quotes: [{ symbol: '2330.TW', quoteType: 'EQUITY', shortname: 'TSMC', exchDisp: 'Taiwan' }, { symbol: 'X261120P0', quoteType: 'OPTION' }] });
  assert.deepEqual(r.map(x => [x.symbol, x.market]), [['2330.TW', 'TW']]);
});
