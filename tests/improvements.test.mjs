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
  assert.equal(replay(r.account).deposits, 1_090_000);
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
