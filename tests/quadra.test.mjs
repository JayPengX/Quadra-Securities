import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, applyPool, ownCash, stripPool, moneySources, mergeDistinct, START_AMOUNT } from '../public/lib/account.mjs';
import { poolBalance, othersBalance } from '../public/lib/quadra.mjs';
import { payRound, roomToday, feeQuestion, tickerQuestion, GAMES } from '../public/lib/games.mjs';

const T0 = Date.parse('2026-09-01T00:00:00Z');

test('every new account opens with NT$100,000', () => {
  assert.equal(START_AMOUNT, 100_000);
  assert.equal(replay(newAccount(undefined, T0, 'a'), T0).cash.TWD, 100_000);
});

test('the pool: other apps\' entries arrive once, as money put in or out', () => {
  const a = newAccount(undefined, T0, 'a');
  const wallet = {
    entries: [
      { id: 'odds:start', t: T0 + 1, app: 'odds', kind: 'start', amount: 10_000 },
      { id: 'odds:stake-x', t: T0 + 2, app: 'odds', kind: 'stake', amount: -3_000 },
      { id: 'vocab:r1', t: T0 + 3, app: 'vocab', kind: 'reward', amount: 120 },
      { id: 'stock:ignored', t: T0 + 3, app: 'stock', kind: 'x', amount: 5 }
    ],
    snap: { stock: { cash: 100_000, t: T0 } }
  };
  const { account, added } = applyPool(a, wallet);
  assert.equal(added.length, 3);
  assert.equal(applyPool(account, wallet).added.length, 0);
  const s = replay(account, T0 + 10);
  assert.equal(s.cash.TWD, 107_120);
  assert.equal(s.deposits, 107_120);
  // Its own part is what it shares back: the pool counts it once.
  assert.equal(ownCash(account, s, T0 + 10), 100_000);
  assert.equal(poolBalance(wallet) - 5, 107_120);
  assert.equal(othersBalance(wallet, 'odds'), 100_000 + 120 + 5);
  const src = moneySources(account, T0 + 10);
  assert.equal(src.odds, 7_000);
  assert.equal(src.vocab, 120);
  assert.equal(stripPool(account).events.length, a.events.length);
});

test('two separate accounts folded together keep both', () => {
  const a = newAccount(undefined, T0, 'a');
  const b = { ...newAccount(250_000, T0 - 86_400_000, 'b'), events: [...newAccount(250_000, T0 - 86_400_000, 'b').events, { id: 'x:old', type: 'deposit', pool: true, t: T0, currency: 'TWD', amount: 999 }] };
  const m = mergeDistinct(a, b);
  assert.equal(replay(m, T0 + 1).cash.TWD, 350_000);
  assert.equal(m.id, 'a');
  assert.equal(mergeDistinct(m, b).events.length, m.events.length);
});

test('mini games: pay per round within the daily cap', () => {
  let a = newAccount(undefined, T0, 'a');
  let r = payRound(a, 'r1', 'ticker', 30, T0 + 1000);
  assert.equal(r.paid, 30);
  r = payRound(r.account, 'r1', 'ticker', 45, T0 + 2000);
  assert.equal(r.account.events.filter(e => e.game).length, 1);
  r = payRound(r.account, 'r2', 'fee', 5000, T0 + 3000);
  assert.equal(r.paid, GAMES.dailyCap - 45);
  assert.equal(roomToday(r.account, T0 + 4000), 0);
  const q = feeQuestion(() => 0.3);
  assert.equal(new Set(q.options).size, 4);
  assert.ok(q.options.includes(q.answer));
  const tq = tickerQuestion(() => 0.1);
  assert.ok(tq.options.includes(tq.answer));
});
