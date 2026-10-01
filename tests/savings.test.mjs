import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, valuate, placeOrder, available, openDeposit, breakDeposit, matureDeposits, lendShares, lendableQty, recallShares, matureLending, recallAll, incomeSummary } from '../public/lib/account.mjs';
import { TD_TERMS, tdInterest, addMonths, incomeTaxes, lendFee, addWeekdays, LEND_CUT } from '../public/lib/savings.mjs';

const T0 = Date.UTC(2026, 8, 21, 2); // Monday 10:00 Taipei
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RATES = { TWD: 1, USD: 32 };
const quote = (symbol, price, over = {}) => ({ symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, pct: 0, session: { start: T0 - HOUR, end: T0 + 4 * HOUR }, marketTime: T0, line: [], ...over });

test('a time deposit: locked, paid in full at maturity, rolled over when asked', () => {
  let a = newAccount(100_000, T0 - DAY, 'acc');
  assert.equal(openDeposit(a, { amount: 5_000, months: 12 }, T0).error, 'tdMin');
  assert.equal(openDeposit(a, { amount: 200_000, months: 12 }, T0).error, 'funds');
  assert.equal(openDeposit(a, { amount: 50_000, months: 2 }, T0).error, 'tdTerm');
  const r = openDeposit(a, { amount: 50_000, months: 12 }, T0, 'x');
  a = r.account;
  assert.equal(replay(a, T0).cash.TWD, 50_000);
  // In net worth, not in cash.
  const v = valuate(replay(a, T0), new Map(), RATES);
  assert.equal(v.savedTWD, 50_000);
  assert.equal(Math.round(v.netWorth), 100_000);
  // Matures a year on: 50,000 × 1.72% = 860, back in cash, dated then.
  const ends = addMonths(T0, 12);
  assert.equal(r.event.ends, ends);
  const m = matureDeposits(a, ends + DAY);
  const end = m.events.find(e => e.type === 'tdend');
  assert.equal(end.t, ends);
  assert.equal(end.interest, 860);
  assert.equal(end.net, 860);
  assert.equal(Math.round(replay(m, ends + DAY).cash.TWD - replay(a, ends + DAY).cash.TWD), 50_860);
  assert.equal(matureDeposits(m, ends + DAY), m);
  // Rolled over: principal again, at the rate posted then; the interest paid out.
  const rr = openDeposit(newAccount(100_000, T0 - DAY, 'b'), { amount: 50_000, months: 1, renew: true }, T0, 'y').account;
  const after = matureDeposits(rr, addMonths(T0, 3) + HOUR);
  assert.equal(after.events.filter(e => e.type === 'tdend').length, 3);
  assert.equal(Object.keys(replay(after, addMonths(T0, 3) + HOUR).tds).length, 1);
});

test('closing a deposit early: nothing under a month, 80% of the term held after', () => {
  const td = { id: 'td:x', t: T0, amount: 100_000, months: 12, rate: 0.0172, ends: addMonths(T0, 12) };
  assert.deepEqual(tdInterest(td, T0 + 20 * DAY), { gross: 0, early: true });
  // Seven months held: the 6-month rate × 80% for the days held.
  const at = addMonths(T0, 7);
  const want = Math.round((100_000 * TD_TERMS.find(x => x.months === 6).rate * 0.8 * (at - T0)) / (365 * DAY));
  assert.equal(tdInterest(td, at).gross, want);
  let a = openDeposit(newAccount(200_000, T0 - DAY, 'acc'), { amount: 100_000, months: 12 }, T0, 'x').account;
  const r = breakDeposit(a, 'td:x', at);
  assert.equal(r.event.early, true);
  assert.equal(replay(r.account, at).cash.TWD, 100_000 + 100_000 + want);
  assert.equal(breakDeposit(r.account, 'td:x', at + DAY).error, 'tdGone');
});

test('interest and fees over NT$20,000 at once: 10% withheld and the health premium', () => {
  assert.deepEqual(incomeTaxes(20_000), { withheld: 0, nhi: 422, net: 19_578 });
  assert.deepEqual(incomeTaxes(30_000), { withheld: 3_000, nhi: 633, net: 26_367 });
  assert.deepEqual(incomeTaxes(5_000), { withheld: 0, nhi: 0, net: 5_000 });
});

test('lending shares: whole settled lots only, locked while lent, the fee paid on return less the broker’s cut', () => {
  let a = newAccount(3_000_000, T0 - DAY, 'acc');
  const q = quote('2330.TW', 1_000);
  a = placeOrder(a, { side: 'buy', type: 'market', qty: 2_500 }, { quote: q, rates: RATES, now: T0, id: 'b1' }).account;
  // Not settled yet (T+2).
  assert.equal(lendableQty(a, '2330.TW', T0 + HOUR), 0);
  const later = T0 + 4 * DAY;
  assert.equal(lendableQty(a, '2330.TW', later), 2_000);
  assert.equal(lendShares(a, { symbol: '2330.TW', qty: 1_500, price: 1_000 }, later).error, 'lendLot');
  assert.equal(lendShares(a, { symbol: '2330.TW', qty: 3_000, price: 1_000 }, later).error, 'lendQty');
  const r = lendShares(a, { symbol: '2330.TW', qty: 2_000, price: 1_000 }, later, 'l1');
  a = r.account;
  assert.equal(r.event.rate, 0.012);
  // Only the 500 not lent can be sold.
  assert.equal(available(a, replay(a, later + HOUR)).qty['2330.TW'], 500);
  const v = valuate(replay(a, later + HOUR), new Map([['2330.TW', q]]), RATES);
  assert.equal(v.positions[0].lent, 2_000);
  // Recalled after 30 days: back in 3 business days, the fee paid then.
  const at = later + 30 * DAY;
  const rc = recallShares(a, 'lend:l1', at);
  assert.equal(rc.back, addWeekdays(at, 3));
  a = rc.account;
  assert.equal(available(a, replay(a, at + HOUR)).qty['2330.TW'], 500);
  const fee = lendFee({ qty: 2_000, price: 1_000, rate: 0.012, t: later }, rc.back);
  assert.equal(fee.cut, Math.round(fee.gross * LEND_CUT));
  const cashBefore = replay(a, at + HOUR).cash.TWD;
  assert.equal(Math.round(replay(a, rc.back + HOUR).cash.TWD - cashBefore), fee.net);
  assert.equal(available(a, replay(a, rc.back + HOUR)).qty['2330.TW'], 2_500);
  assert.equal(incomeSummary(a, rc.back + HOUR).lending, fee.net);
});

test('lending ends by itself after 180 days; a default or call recalls everything', () => {
  let a = newAccount(2_000_000, T0 - DAY, 'acc');
  const q = quote('0050.TW', 100, { kind: 'etf' });
  a = placeOrder(a, { side: 'buy', type: 'market', qty: 3_000 }, { quote: q, rates: RATES, now: T0, id: 'b1' }).account;
  a = lendShares(a, { symbol: '0050.TW', qty: 3_000, price: 100 }, T0 + 4 * DAY, 'l1').account;
  const end = T0 + 184 * DAY;
  const m = matureLending(a, end + DAY);
  assert.equal(m.events.find(e => e.type === 'lendpay').t, end);
  assert.equal(Object.keys(replay(m, end + DAY).lent).length, 0);
  const all = recallAll(a, T0 + 10 * DAY);
  assert.ok(replay(all, T0 + 10 * DAY).lent['lend:l1'].back > T0 + 10 * DAY);
  assert.equal(recallAll(all, T0 + 11 * DAY), all);
});

test('shares bought on margin can’t be lent', () => {
  let a = newAccount(2_000_000, T0 - DAY, 'acc');
  const q = quote('2330.TW', 1_000);
  const v = valuate(replay(a, T0), new Map(), RATES);
  a = placeOrder(a, { side: 'buy', type: 'market', qty: 1_000, margin: true }, { quote: q, rates: RATES, valuation: v, now: T0, id: 'm1' }).account;
  assert.equal(lendableQty(a, '2330.TW', T0 + 5 * DAY), 0);
  assert.equal(lendShares(a, { symbol: '2330.TW', qty: 1_000, price: 1_000 }, T0 + 5 * DAY).error, 'lendFinanced');
});
