import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, placeOrder, valuate, callDeadline, callState, callNeed, payDown, lastTwClose } from '../public/lib/account.mjs';
import { MARGIN_RESTORE } from '../public/lib/markets.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const tpe = (d, hm) => Date.parse(`${d}T${hm}:00+08:00`);
const RATES = { TWD: 1, USD: 32 };
const T0 = tpe('2026-09-21', '10:00'); // Monday
function quote(symbol, price, at = T0) {
  return { symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, pct: 0, session: { start: at - HOUR, end: at + 3 * HOUR }, marketTime: at, line: [] };
}

test('a call is due at the close of the second business day after the close it was judged on', () => {
  assert.equal(lastTwClose(tpe('2026-09-22', '15:00')), tpe('2026-09-22', '13:30'));
  assert.equal(callDeadline(tpe('2026-09-22', '15:00')), tpe('2026-09-24', '13:30'));
  // Mid-Autumn (Fri 25th) and the 28th are holidays.
  assert.equal(callDeadline(tpe('2026-09-23', '20:00')), tpe('2026-09-29', '13:30'));
  // A Saturday judges Thursday's close.
  assert.equal(callDeadline(tpe('2026-09-26', '11:00')), tpe('2026-09-30', '13:30'));
  // Before the open, the previous close.
  assert.equal(callDeadline(tpe('2026-09-22', '08:00')), tpe('2026-09-23', '13:30'));
});

function marginAccount() {
  let a = newAccount(100_000, T0, 'acc');
  a = { ...a, events: [...a.events, { id: 'credit:test', type: 'credit', t: T0, limit: 5_000_000 }] };
  const v = valuate(replay(a, T0), new Map(), RATES);
  const r = placeOrder(a, { side: 'buy', qty: 2000, margin: true }, { quote: quote('2330.TW', 100), rates: RATES, valuation: v, now: T0, id: 'b' });
  assert.ok(r.fill, r.error);
  return r.account;
}
const val = (a, price, at) => valuate(replay(a, at), new Map([['2330.TW', quote('2330.TW', price, at)]]), RATES);

test('under 130% in the session calls nothing; after the close it calls, and 166% cancels it', () => {
  const a = marginAccount();
  const v0 = val(a, 100, T0);
  assert.ok(v0.debtTWD > 100_000);
  // Find a price under 130%.
  let price = 100;
  while (val(a, price, T0).ratio >= 1.3) price -= 1;
  const low = val(a, price, T0);
  assert.equal(callState(null, low, T0).event, 'intraday');
  const after = tpe('2026-09-21', '14:00');
  const c = callState(null, low, after);
  assert.equal(c.event, 'issued');
  assert.equal(c.call.due, tpe('2026-09-23', '13:30'));
  assert.equal(c.call.need, callNeed(low));
  assert.equal(c.sell, false);
  // Back between 130% and 166%: still called, nothing sold even past the deadline.
  const mid = val(a, price + 8, after);
  assert.ok(mid.ratio >= 1.3 && mid.ratio < MARGIN_RESTORE);
  const late = callState(c.call, mid, c.call.due + HOUR);
  assert.ok(late.call && !late.sell);
  // Under 130% past the deadline: sold.
  assert.equal(callState(c.call, low, c.call.due + HOUR).sell, true);
  assert.equal(callState(c.call, low, c.call.due - HOUR).sell, false);
  // Paying the call's amount brings it to 166% and cancels it.
  const paid = payDown({ ...a, events: [...a.events, { id: 'deposit:x', type: 'deposit', t: after - 1, currency: 'TWD', amount: 200_000 }] }, callNeed(low), { rates: RATES, now: after });
  const vp = valuate(replay(paid.account, after), new Map([['2330.TW', quote('2330.TW', price, after)]]), RATES);
  assert.ok(Math.abs(paid.paid - callNeed(low)) < 1);
  assert.ok(vp.ratio >= MARGIN_RESTORE - 0.001, String(vp.ratio));
  assert.equal(callState(c.call, vp, after).event, 'met');
  // The payment went against the holding's 融資.
  const s = replay(paid.account, after);
  assert.ok(s.positions['2330.TW'].financed < replay(a, after).positions['2330.TW'].financed);
});

test('paying down stops at the cash there is', () => {
  const a = marginAccount();
  const cash = replay(a, T0).cash.TWD;
  const r = payDown(a, 10_000_000, { rates: RATES, now: T0 + DAY });
  assert.ok(Math.abs(r.paid - Math.max(0, cash)) < 2);
});
