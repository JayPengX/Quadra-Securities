import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  newAccount, replay, setPlan, planRuns, nextPlanRun, runPlan, activePlans, setAlert, checkAlerts, alertHitInBars, markAlertHit, activeAlerts,
  mergeAccounts, planDue
} from '../public/lib/account.mjs';
import { timeMachine, movingAverage, valueAt } from '../public/lib/timemachine.mjs';
import { parseFundamentals, parseChart } from '../public/lib/quotes.mjs';
import { candleChart } from '../public/lib/chart.mjs';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-10T10:00:00+08:00');
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('a monthly plan is due on its day every month from the next one on', () => {
  const a = setPlan(newAccount(100_000, T0, 'acc'), { id: 'p', symbol: '0050.TW', amount: 5000, day: 5 }, T0).account;
  const plan = a.plans.p;
  assert.deepEqual(planRuns(plan, T0), []);
  assert.equal(nextPlanRun(plan, T0), Date.parse('2026-02-05T00:00:00+08:00'));
  const runs = planRuns(plan, Date.parse('2026-04-06T00:00:00+08:00'));
  assert.deepEqual(runs.map(r => r.month), ['2026-02', '2026-03', '2026-04']);
  assert.equal(runs[0].t, planDue('2026-02', 5));
  assert.equal(setPlan(a, { symbol: 'X', amount: 10, day: 5 }).error, 'planAmount');
  assert.equal(setPlan(a, { symbol: 'X', amount: 5000, day: 31 }).error, 'planDay');
  const off = setPlan(a, { id: 'p', on: false }, T0 + DAY).account;
  assert.deepEqual(activePlans(off), []);
  assert.deepEqual(planRuns(off.plans.p, T0 + 400 * DAY), []);
});

test('a plan buys as many shares as its NT$ covers after costs, once per month', () => {
  let a = setPlan(newAccount(100_000, T0, 'acc'), { id: 'p', symbol: '0050.TW', amount: 5000, day: 5, name: '0050', kind: 'etf', market: 'TW', currency: 'TWD' }, T0).account;
  const run = planRuns(a.plans.p, T0 + 30 * DAY)[0];
  const r = runPlan(a, a.plans.p, run, { price: 100, twd: 1, at: run.t + 2 * 3_600_000 }, T0 + 30 * DAY);
  assert.equal(r.fill.qty, 49);
  assert.ok(r.fill.total <= 5000);
  assert.equal(r.order.plan, 'p');
  a = r.account;
  const again = runPlan(a, a.plans.p, run, { price: 100, twd: 1 }, T0 + 30 * DAY);
  assert.equal(again.account, a);
  assert.equal(replay(a).positions['0050.TW'].qty, 49);
});

test('a foreign plan exchanges only what the shares need; too little money is recorded as skipped', () => {
  let a = setPlan(newAccount(100_000, T0, 'acc'), { id: 'p', symbol: 'VOO', amount: 50_000, day: 5, name: 'VOO', kind: 'etf', market: 'US', currency: 'USD' }, T0).account;
  const [run] = planRuns(a.plans.p, T0 + 30 * DAY);
  const r = runPlan(a, a.plans.p, run, { price: 600, twd: 32 }, T0 + 30 * DAY);
  assert.equal(r.fill.qty, 2);
  const s = replay(r.account);
  assert.ok(s.cash.USD >= 0 && s.cash.USD < 5);
  assert.ok(s.cash.TWD > 100_000 - 50_000);
  const fx = r.account.events.find(e => e.type === 'fx');
  assert.equal(fx.t, run.t);
  const poor = setPlan(newAccount(10_000, T0, 'b'), { id: 'p', symbol: 'VOO', amount: 20_000, day: 5, kind: 'etf', market: 'US', currency: 'USD' }, T0).account;
  const skipped = runPlan(poor, poor.plans.p, run, { price: 600, twd: 32 }, T0 + 30 * DAY);
  assert.equal(skipped.order.status, 'rejected');
  assert.equal(skipped.order.reason, 'funds');
  const tiny = setPlan(newAccount(10_000, T0, 'c'), { id: 'p', symbol: 'VOO', amount: 1000, day: 5, kind: 'etf', market: 'US', currency: 'USD' }, T0).account;
  assert.equal(runPlan(tiny, tiny.plans.p, run, { price: 600, twd: 32 }, T0 + 30 * DAY).order.reason, 'tooSmall');
});

test('price alerts go off once, on a quote or in the bars since they were set', () => {
  let a = setAlert(newAccount(100_000, T0, 'acc'), { id: 'x', symbol: '2330.TW', op: 'below', price: 1000 }, T0).account;
  assert.equal(activeAlerts(a).length, 1);
  let r = checkAlerts(a, new Map([['2330.TW', { price: 1100 }]]), T0 + 1);
  assert.equal(r.hits.length, 0);
  r = checkAlerts(a, new Map([['2330.TW', { price: 990 }]]), T0 + 2);
  assert.equal(r.hits.length, 1);
  assert.equal(r.account.alerts.x.on, false);
  assert.equal(r.account.alerts.x.hit.price, 990);
  assert.equal(checkAlerts(r.account, new Map([['2330.TW', { price: 900 }]]), T0 + 3).hits.length, 0);
  const alert = a.alerts.x;
  const bars = [
    { t: T0 - DAY, o: 900, h: 950, l: 880, c: 900 },
    { t: T0 + DAY, o: 1050, h: 1060, l: 1010, c: 1020 },
    { t: T0 + 2 * DAY, o: 1020, h: 1030, l: 980, c: 990 }
  ];
  assert.deepEqual(alertHitInBars(alert, bars), { t: T0 + 2 * DAY, price: 1000 });
  assert.equal(markAlertHit(a, 'x', { t: T0 + 2 * DAY, price: 1000 }).alerts.x.hit.t, T0 + 2 * DAY);
  assert.equal(setAlert(a, { symbol: 'X', op: 'above', price: 0 }).error, 'alertPrice');
});

test('plans and alerts merge across devices, the latest change winning', () => {
  const base = newAccount(100_000, T0, 'acc');
  const phone = setAlert(setPlan(base, { id: 'p', symbol: 'VOO', amount: 3000, day: 5 }, T0 + 1).account, { id: 'a', symbol: 'VOO', op: 'above', price: 700 }, T0 + 2).account;
  const laptop = setPlan(base, { id: 'p', symbol: 'VOO', amount: 6000, day: 5 }, T0 + 5).account;
  const m = mergeAccounts(phone, laptop);
  assert.equal(m.plans.p.amount, 6000);
  assert.equal(m.alerts.a.price, 700);
});

test('time machine: a lump sum, monthly buying, drawdown and the bank', () => {
  const m = t => Date.parse(`${t}-01T00:00:00Z`);
  const points = [['2020-01', 100], ['2020-02', 50], ['2020-03', 80], ['2021-01', 120], ['2022-01', 200]].map(([d, p]) => [m(d), p]);
  const now = m('2022-01') + DAY;
  const lump = timeMachine({ points, amount: 100_000, start: m('2020-01'), now, price: 200 });
  assert.equal(lump.putIn, 100_000);
  assert.ok(Math.abs(lump.value - 200_000) < 1e-6);
  assert.ok(Math.abs(lump.maxDrawdown + 0.5) < 1e-9);
  assert.ok(lump.annual > 0.4 && lump.annual < 0.42);
  const monthly = timeMachine({ points, amount: 10_000, start: m('2020-01'), mode: 'monthly', now, price: 200 });
  assert.equal(monthly.putIn, 50_000);
  const units = 100 + 200 + 125 + 10_000 / 120 + 50;
  assert.ok(Math.abs(monthly.value - units * 200) < 1e-6);
  assert.ok(monthly.bank > 50_500 && monthly.bank < 51_500);
  const usd = timeMachine({ points, fx: [[m('2020-01'), 30], [m('2021-06'), 28]], amount: 30_000, start: m('2020-01'), now, price: 200, rate: 28 });
  assert.ok(Math.abs(usd.value - 10 * 200 * 28) < 1e-6);
  assert.equal(valueAt(points, m('2020-02') + 5), 50);
  assert.deepEqual(movingAverage([[1, 1], [2, 2], [3, 3], [4, 4]], 3), [[3, 2], [4, 3]]);
});

test('company numbers parse for a stock and a fund', () => {
  const tsmc = parseFundamentals(fixture('summary-2330.TW.json'));
  assert.equal(tsmc.currency, 'TWD');
  assert.ok(tsmc.pe > 5 && tsmc.pe < 100);
  assert.ok(tsmc.marketCap > 1e12);
  assert.equal(tsmc.sector, 'Technology');
  const etf = parseFundamentals(fixture('summary-0050.TW.json'));
  assert.ok(etf.expenseRatio > 0 && etf.expenseRatio < 0.01);
  assert.equal(etf.holdings[0].symbol, '2330.TW');
  assert.ok(etf.holdings[0].weight > 0.3);
  assert.equal(tsmc.yearly.length, 4);
  assert.ok(tsmc.target.mean > 0 && tsmc.target.analysts > 0);
  assert.equal(tsmc.reportCurrency, 'TWD');
  assert.ok(tsmc.earningsDate > 0);
  const voo = parseFundamentals(fixture('summary-VOO.json'));
  assert.equal(voo.sectors[0].id, 'technology');
  assert.ok(voo.mix.stock > 0.9 && voo.return5y > 0);
});

test('candles draw from chart bars, with volume', () => {
  const chart = parseChart(fixture('yahoo-chart-0056-1y.json'));
  assert.ok(chart.bars.length > 100);
  assert.ok(chart.bars.some(b => b.v > 0));
  assert.ok(chart.adjusted.length > 100);
  const { svg, frame } = candleChart(chart.bars.slice(-60), { lines: [{ points: movingAverage(chart.bars.map(b => [b.t, b.c]), 20), cls: 'ma1' }] });
  assert.equal((svg.match(/class="candle /g) || []).length, 60);
  assert.match(svg, /class="vol /);
  assert.match(svg, /class="line ma1"/);
  assert.equal(frame.count, 60);
});

test('currency pairs trade in their second currency, long or short, for a spread only', async () => {
  const { placeOrder, valuate, exchange } = await import('../public/lib/account.mjs');
  const { marketOf, isTradable, isShortable } = await import('../public/lib/markets.mjs');
  assert.equal(marketOf('EURUSD=X', 'fx'), 'FX');
  assert.ok(isTradable('fx') && isShortable('fx'));
  const rates = { TWD: 1, USD: 32 };
  const at = Date.parse('2026-09-22T10:00:00+08:00');
  const q = { symbol: 'EURUSD=X', name: 'EUR/USD', kind: 'fx', market: 'FX', currency: 'USD', price: 1.14, prev: 1.14, session: { start: at - 3_600_000, end: at + 3_600_000 }, marketTime: at };
  let a = exchange(newAccount(1_000_000, at, 'fx'), { from: 'TWD', to: 'USD', amount: 500_000 }, { rates, now: at, id: 'x' }).account;
  const r = placeOrder(a, { side: 'buy', qty: 10_000 }, { quote: q, rates, now: at, id: 'b' });
  assert.equal(r.fill.commission, 0);
  assert.ok(Math.abs(r.fill.price - 1.14 * 1.0002) < 1e-12);
  assert.ok(Math.abs(r.fill.total - 11_402.28) < 0.01);
  a = r.account;
  const up = { ...q, price: 1.16 };
  const v = valuate(replay(a, at), new Map([['EURUSD=X', up]]), rates);
  assert.ok(Math.abs(v.positions[0].value - 11_600) < 1e-6);
  const short = placeOrder(a, { side: 'sell', qty: 20_000 }, { quote: up, rates, valuation: v, now: at + 1, id: 's' });
  assert.equal(short.order.short, true);
  assert.equal(replay(short.account, at + 1).positions['EURUSD=X'].qty, -10_000);
});

test('new money arrives on the 1st of every month, 3% of the start, once each', async () => {
  const { incomeAmount, applyIncome, nextPayday, startIncome } = await import('../public/lib/account.mjs');
  assert.equal(incomeAmount(1_000_000), 30_000);
  assert.equal(incomeAmount(100_000), 3000);
  assert.equal(incomeAmount(10_000), 300);
  assert.equal(incomeAmount(1234), 37);
  const created = Date.parse('2026-09-10T15:00:00+08:00');
  assert.equal(nextPayday(created), Date.parse('2026-10-01T00:00:00+08:00'));
  const a = newAccount(1_000_000, created, 'inc');
  assert.equal(applyIncome(a, created + DAY).added.length, 0);
  const r = applyIncome(a, Date.parse('2026-12-15T09:00:00+08:00'));
  assert.deepEqual(r.added.map(e => [e.id, e.amount]), [['pay:2026-10', 30_000], ['pay:2026-11', 30_000], ['pay:2026-12', 30_000]]);
  assert.equal(applyIncome(r.account, Date.parse('2026-12-15T09:00:00+08:00')).added.length, 0);
  assert.equal(replay(r.account, Date.parse('2026-12-15T09:00:00+08:00')).deposits, 1_090_000);
  // Two devices catching up separately don't pay twice.
  const phone = applyIncome(a, Date.parse('2026-11-02T00:00:00+08:00')).account;
  const laptop = applyIncome(a, Date.parse('2027-01-02T00:00:00+08:00')).account;
  assert.equal(mergeAccounts(phone, laptop).events.filter(e => e.income).length, 4);
  // An account from before paydays starts getting them from now on.
  const old = { ...a, income: undefined };
  assert.equal(applyIncome(old, Date.parse('2027-01-02T00:00:00+08:00')).added.length, 0);
  const now = Date.parse('2026-12-20T00:00:00+08:00');
  assert.deepEqual(applyIncome(startIncome(old, now), Date.parse('2027-01-02T00:00:00+08:00')).added.map(e => e.id), ['pay:2027-01']);
});

test('Taiwan and US price rules: ticks, and the ±10% daily limit', async () => {
  const { tickSize, onTick, priceLimits } = await import('../public/lib/markets.mjs');
  const { placeOrder } = await import('../public/lib/account.mjs');
  assert.equal(tickSize('TW', 'stock', 2475), 5);
  assert.equal(tickSize('TW', 'stock', 250.5), 0.5);
  assert.equal(tickSize('TW', 'stock', 45.3), 0.05);
  assert.equal(tickSize('TW', 'etf', 112.4), 0.05);
  assert.equal(tickSize('US', 'stock', 341.07), 0.01);
  assert.ok(onTick(2480, 5) && !onTick(2482, 5) && onTick(45.35, 0.05));
  assert.deepEqual(priceLimits({ market: 'TW', kind: 'stock', prev: 2500 }), { up: 2750, down: 2250 });
  assert.deepEqual(priceLimits({ market: 'TW', kind: 'stock', prev: 263 }), { up: 289, down: 237 });
  const at = Date.parse('2026-09-22T10:00:00+08:00');
  const q = { symbol: '2330.TW', name: 'TSMC', kind: 'stock', market: 'TW', currency: 'TWD', price: 2475, prev: 2500, session: { start: at - 3_600_000, end: at + 3_600_000 }, marketTime: at };
  const a = newAccount(10_000_000, at, 't');
  const opts = { quote: q, rates: { TWD: 1 }, now: at };
  assert.equal(placeOrder(a, { side: 'buy', type: 'limit', limit: 2472, qty: 1000 }, opts).error, 'tick');
  assert.equal(placeOrder(a, { side: 'buy', type: 'limit', limit: 2200, qty: 1000 }, opts).error, 'priceLimit');
  assert.equal(placeOrder(a, { side: 'buy', type: 'limit', limit: 2400, qty: 1000 }, opts).order.status, 'open');
});

test('dividends are owed on the ex-date and paid on the market’s pay day', async () => {
  const { applyCorporateActions, pendingDividends, placeOrder } = await import('../public/lib/account.mjs');
  const at = Date.parse('2026-06-01T10:00:00+08:00');
  const q = { symbol: '2330.TW', name: 'TSMC', kind: 'stock', market: 'TW', currency: 'TWD', price: 2000, prev: 2000, session: { start: at - 3_600_000, end: at + 3_600_000 }, marketTime: at };
  let a = placeOrder(newAccount(10_000_000, at, 'd'), { side: 'buy', qty: 1000 }, { quote: q, rates: { TWD: 1 }, now: at, id: 'b' }).account;
  const ex = Date.parse('2026-06-12T00:00:00+08:00');
  const now = ex + 5 * DAY;
  a = applyCorporateActions(a, '2330.TW', { dividends: [{ date: ex, amount: 6 }] }, { rates: { TWD: 1 }, now }).account;
  const [d] = pendingDividends(a, now);
  assert.equal(d.ex, ex);
  assert.equal(d.t, ex + 28 * DAY);
  const cash = t => replay(a, t).cash.TWD;
  assert.equal(cash(now), cash(at + 1));
  assert.equal(cash(d.t) - cash(now), 6000);
  assert.equal(replay(a, now).receivable, 6000);
  assert.equal(replay(a, d.t).receivable, 0);
  assert.equal(replay(a, ex - 1).receivable, 0);
  assert.deepEqual(pendingDividends(a, d.t), []);
});

test('a margin loan that broke the line while away is sold then, at that moment’s price', async () => {
  const { marginHistory, borrow, placeOrder, valuate } = await import('../public/lib/account.mjs');
  const at = Date.parse('2026-09-01T10:00:00+08:00');
  const q = { symbol: 'X.TW', name: 'X', kind: 'stock', market: 'TW', currency: 'TWD', price: 100, prev: 100, session: { start: at - 3_600_000, end: at + 3_600_000 }, marketTime: at };
  const rates = { TWD: 1 };
  let a = newAccount(100_000, at, 'm');
  a = placeOrder(a, { side: 'buy', qty: 990 }, { quote: q, rates, now: at, id: 'b1' }).account;
  const v = valuate(replay(a, at), new Map([['X.TW', q]]), rates);
  a = borrow(a, { currency: 'TWD', amount: Math.floor(v.capacity) }, { valuation: v, rates, now: at + 1, id: 'l' }).account;
  a = placeOrder(a, { side: 'buy', qty: Math.floor(v.capacity / 101) }, { quote: q, rates, now: at + 2, id: 'b2' }).account;
  // Away: it falls 65% on day 3, then recovers to 100 by day 6.
  const path = [[2, 90], [3, 35], [4, 70], [6, 100]].map(([d, p]) => [at + d * DAY, p]);
  const priceAt = (sym, t) => path.filter(([tt]) => tt <= t).at(-1)?.[1] ?? 100;
  const r = marginHistory(a, { times: path.map(p => p[0]), priceAt, rateAt: () => 1 });
  assert.ok(r.forced.length >= 1);
  assert.equal(r.forced[0].t, at + 3 * DAY);
  assert.ok(Math.abs(r.forced[0].quote - 35) < 1e-9);
  const s = replay(r.account, at + 7 * DAY);
  assert.equal(s.positions['X.TW'], undefined);
  // The sale at 35 didn't cover everything owed: the rest is still owed, as at a real broker.
  assert.ok(s.loans.TWD.balance > 0 && s.loans.TWD.balance < 5000);
  assert.deepEqual(marginHistory(r.account, { times: path.map(p => p[0]), priceAt, rateAt: () => 1 }).forced, []);
});

test('a fill found in the past must have fitted the cash at that moment', async () => {
  const { fillFromHistory, placeOrder, exchange } = await import('../public/lib/account.mjs');
  const at = Date.parse('2026-09-01T10:00:00+08:00');
  const q = { symbol: '2330.TW', name: 'TSMC', kind: 'stock', market: 'TW', currency: 'TWD', price: 1000, prev: 1000, session: { start: at + 3_600_000, end: at + 5 * 3_600_000 }, marketTime: at };
  let a = newAccount(200_000, at, 'h');
  // A limit order waiting, then the cash sent to US$ on day 2 (live).
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 950, qty: 100 }, { quote: q, rates: { TWD: 1 }, now: at, id: 'o' }).account;
  assert.equal(a.orders[0].status, 'open');
  a = { ...a, orders: a.orders.map(o => ({ ...o, reserve: 0 })) };
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 150_000 }, { rates: { TWD: 1, USD: 32 }, now: at + 2 * DAY, id: 'x' }).account;
  // The price reached 950 on day 1, when the cash was still there: filled,
  // even though today's NT$ alone... is checked too, so it's refused.
  const r = fillFromHistory(a, 'o', { t: at + DAY, price: 950 }, 1, at + 3 * DAY);
  assert.equal(r.order.status, 'rejected');
  const ok = fillFromHistory({ ...a, events: a.events.filter(e => e.type !== 'fx') }, 'o', { t: at + DAY, price: 950 }, 1, at + 3 * DAY);
  assert.equal(ok.fill.t, at + DAY);
});

test('sale proceeds settle T+2 in Taiwan: they buy again at once but can’t be exchanged until then', async () => {
  const { placeOrder, exchange, unsettled } = await import('../public/lib/account.mjs');
  const fri = Date.parse('2026-09-25T10:00:00+08:00');
  const q = { symbol: '0050.TW', name: '0050', kind: 'etf', market: 'TW', currency: 'TWD', price: 100, prev: 100, session: { start: fri - 3_600_000, end: fri + 3_600_000 }, marketTime: fri };
  let a = newAccount(100_000, fri - DAY, 's');
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 100, qty: 900 }, { quote: { ...q, marketTime: fri - DAY + 1, session: { start: fri - DAY, end: fri - DAY + 3_600_000 } }, rates: { TWD: 1 }, now: fri - DAY + 1, id: 'b' }).account;
  const sold = placeOrder(a, { side: 'sell', type: 'limit', limit: 100, qty: 900 }, { quote: q, rates: { TWD: 1 }, now: fri, id: 's' });
  a = sold.account;
  assert.equal(new Date(sold.fill.settle + 8 * 3_600_000).toISOString().slice(0, 10), '2026-09-29');
  assert.ok(unsettled(a, fri + 1).TWD > 89_000);
  const rates = { TWD: 1, USD: 32 };
  assert.equal(exchange(a, { from: 'TWD', to: 'USD', amount: 50_000 }, { rates, now: fri + 1 }).error, 'unsettled');
  // What was never invested can go.
  assert.equal(exchange(a, { from: 'TWD', to: 'USD', amount: 9000 }, { rates, now: fri + 1 }).error, undefined);
  // The proceeds buy again right away.
  assert.equal(placeOrder(a, { side: 'buy', type: 'limit', limit: 100, qty: 800 }, { quote: q, rates: { TWD: 1 }, now: fri + 1, id: 'b2' }).fill.qty, 800);
  // Settled on Tuesday: free to exchange.
  assert.equal(exchange(a, { from: 'TWD', to: 'USD', amount: 50_000 }, { rates, now: Date.parse('2026-09-30T09:00:00+08:00') }).error, undefined);
});

test('market orders cross the spread, limit orders never fill worse than their price', async () => {
  const { placeOrder } = await import('../public/lib/account.mjs');
  const { marketSlip } = await import('../public/lib/markets.mjs');
  assert.equal(marketSlip('TW', 'stock', 2475), 2.5);
  assert.ok(Math.abs(marketSlip('US', 'stock', 300) - 0.03) < 1e-12);
  assert.equal(marketSlip('METAL', 'metal', 4400), 0);
  const at = Date.parse('2026-09-22T10:00:00+08:00');
  const q = { symbol: '2330.TW', name: 'TSMC', kind: 'stock', market: 'TW', currency: 'TWD', price: 2475, prev: 2475, session: { start: at - 3_600_000, end: at + 3_600_000 }, marketTime: at };
  let a = newAccount(10_000_000, at, 'p');
  const buy = placeOrder(a, { side: 'buy', qty: 1000 }, { quote: q, rates: { TWD: 1 }, now: at, id: 'b' });
  assert.equal(buy.fill.price, 2477.5);
  const sell = placeOrder(buy.account, { side: 'sell', qty: 1000 }, { quote: q, rates: { TWD: 1 }, now: at + 1, id: 's' });
  assert.equal(sell.fill.price, 2472.5);
  const lim = placeOrder(a, { side: 'buy', type: 'limit', limit: 2480, qty: 1000 }, { quote: q, rates: { TWD: 1 }, now: at, id: 'l' });
  assert.equal(lim.fill.price, 2475);
});

test('Taiwan odd lots wait for the 09:10 odd-lot session', async () => {
  const { triggerPrice, backfillPrice } = await import('../public/lib/account.mjs');
  const open = Date.parse('2026-09-22T09:01:00+08:00');
  const q = { symbol: '2330.TW', kind: 'stock', market: 'TW', currency: 'TWD', price: 2475, prev: 2475, session: { start: open - 60_000, end: open + 4 * 3_600_000 }, marketTime: open };
  const odd = { side: 'buy', type: 'market', qty: 10, market: 'TW', kind: 'stock', t: open - 60_000 };
  assert.equal(triggerPrice(odd, q, open), null);
  assert.equal(triggerPrice({ ...odd, qty: 1000 }, q, open), 2475);
  assert.equal(triggerPrice(odd, { ...q, marketTime: open + 10 * 60_000 }, open + 10 * 60_000), 2475);
  const bars = [{ t: open, o: 2470, h: 2480, l: 2465, c: 2475 }, { t: open + 9 * 60_000, o: 2490, h: 2495, l: 2485, c: 2490 }];
  assert.deepEqual(backfillPrice(odd, bars), { t: open + 9 * 60_000, price: 2490 });
});

test('NT$ cash earns the demand-deposit rate, paid June 21 and December 21', async () => {
  const { applyCashInterest } = await import('../public/lib/account.mjs');
  const start = Date.parse('2026-01-01T00:00:00+08:00');
  const a = newAccount(1_000_000, start, 'i');
  const r = applyCashInterest(a, Date.parse('2026-12-31T00:00:00+08:00'));
  assert.deepEqual(r.added.map(e => e.id), ['int:2026-06', 'int:2026-12']);
  const june = r.added[0];
  const days = (Date.parse('2026-06-21T00:00:00+08:00') - start) / DAY;
  assert.equal(june.gross, Math.floor((1_000_000 * 0.008 * days) / 365));
  assert.equal(june.withheld, 0);
  assert.equal(applyCashInterest(r.account, Date.parse('2026-12-31T00:00:00+08:00')).added.length, 0);
  const s = replay(r.account, Date.parse('2026-12-31T00:00:00+08:00'));
  assert.equal(s.cash.TWD, 1_000_000 + june.net + r.added[1].net);
  // June's interest earns interest too until December (a few NT$).
  const extra = r.added[0].gross + r.added[1].gross - Math.floor((1_000_000 * 0.008 * 354) / 365);
  assert.ok(extra >= 0 && extra < 30);
});
