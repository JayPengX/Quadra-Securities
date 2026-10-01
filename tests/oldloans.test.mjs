// 融資 buys from before 2026-10-01 10:49 Taipei borrowed the shortfall as a
// plain cash loan: linkOldLoans ties each, once, to the buy it paid for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, linkOldLoans } from '../public/lib/account.mjs';

const T = Date.UTC(2026, 8, 30, 2);
const MIN = 60_000;
const fill = (id, t, symbol, qty, total) => ({ id: `fill:${id}`, type: 'fill', t, orderId: id, symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', side: 'buy', qty, price: total / qty, gross: total, commission: 0, tax: 0, fee: 0, total, twd: 1 });
const order = (id, t, symbol, qty) => ({ id, t, symbol, side: 'buy', currency: 'TWD', qty, status: 'filled', fillId: `fill:${id}`, rev: 1 });

test('old loans: tied to the buy right after them, newest first, no more than still owed; once', () => {
  const a0 = newAccount(50_000, T - 60 * MIN, 'acc');
  const account = {
    ...a0,
    events: [
      ...a0.events,
      // A loan paid off in full: left alone.
      { id: 'borrow:old', type: 'borrow', t: T - 30 * MIN, currency: 'TWD', amount: 5_000, rate: 0.065 },
      { id: 'repay:old', type: 'repay', t: T - 20 * MIN, currency: 'TWD', amount: 5_000 },
      { id: 'borrow:a', type: 'borrow', t: T, currency: 'TWD', amount: 20_000, rate: 0.065 },
      fill('o1', T + 3 * MIN, '2330.TW', 20, 50_000),
      { id: 'borrow:b', type: 'borrow', t: T + 60 * MIN, currency: 'TWD', amount: 10_000, rate: 0.065 },
      // Nothing bought after this one: it stays a plain loan.
      { id: 'borrow:c', type: 'borrow', t: T + 120 * MIN, currency: 'TWD', amount: 1_000, rate: 0.065 },
      fill('o2', T + 61 * MIN, '0050.TW', 100, 9_000)
    ],
    orders: [order('o1', T + MIN, '2330.TW', 20), order('o2', T + 60 * MIN, '0050.TW', 100)]
  };
  const now = T + 200 * MIN;
  const linked = linkOldLoans(account, now);
  assert.deepEqual(linked.events.filter(e => e.type === 'link').map(e => [e.borrow, e.symbol, e.amount]), [['borrow:b', '0050.TW', 9_000], ['borrow:a', '2330.TW', 20_000]]);
  const s = replay(linked, now);
  assert.equal(s.positions['2330.TW'].financed, 20_000);
  assert.equal(s.positions['0050.TW'].financed, 9_000);
  // Cash and the loan itself don't move; it's done once.
  assert.equal(s.cash.TWD, replay(account, now).cash.TWD);
  assert.equal(linkOldLoans(linked, now + MIN), linked);
});
