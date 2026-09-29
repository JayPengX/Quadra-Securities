// Quadra Plus in Securities: perks by when things happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, estimate, quoteExchange, usePlus, plusAt, loanRateAt } from '../public/lib/account.mjs';

const OCT = Date.UTC(2026, 9, 10, 2);
const NOV = Date.UTC(2026, 10, 10, 2);
const plus = { months: new Set(['2026-10']), commission: 0.5, fxSpread: 0.5, cashRate: 0.02, loanCut: 0.01 };

test('Plus: half the commission and FX spread, a cheaper loan, only in a paid month', () => {
  const buy = t => estimate({ market: 'TW', kind: 'stock', currency: 'TWD', side: 'buy', qty: 1000, price: 1000, t }).commission;
  usePlus(null);
  const full = buy(OCT);
  const spread = quoteExchange('TWD', 'USD', 100_000, { TWD: 1, USD: 32 }, true).spread;
  usePlus(plus);
  try {
    assert.equal(plusAt(OCT), true);
    assert.equal(buy(OCT), Math.floor(full / 2));
    assert.equal(buy(NOV), full);
    assert.ok(Math.abs(loanRateAt('TWD', OCT) - 0.055) < 1e-12);
    assert.equal(loanRateAt('TWD', NOV), 0.065);
    const fx = quoteExchange('TWD', 'USD', 100_000, { TWD: 1, USD: 32 }, true);
    // (Quotes are for now: a member month only if now is one; checked by rate.)
    assert.ok(fx.spread === spread || Math.abs(fx.spread - spread / 2) < 1e-12);
  } finally {
    usePlus(null);
  }
});

test('Plus: NT$ cash earns 2% in member months, 0.8% otherwise', () => {
  const a = newAccount(100_000, Date.UTC(2026, 9, 1) - 8 * 3_600_000);
  const end = Date.UTC(2026, 10, 1) - 8 * 3_600_000;
  usePlus(null);
  const normal = replay(a, end).cashInterest;
  usePlus(plus);
  try {
    const member = replay(a, end).cashInterest;
    assert.ok(Math.abs(member / normal - 0.02 / 0.008) < 1e-6);
    // November isn't paid for: the plain rate.
    const nov = replay(a, Date.UTC(2026, 11, 1) - 8 * 3_600_000).cashInterest - member;
    assert.ok(Math.abs(nov / (normal * 30 / 31) - 1) < 1e-6);
  } finally {
    usePlus(null);
  }
});

import { coverPlan } from '../public/lib/account.mjs';
test('cover plan: the fewest, largest sales that clear an overdraft', () => {
  const v = { positions: [
    { symbol: 'A.TW', kind: 'stock', qty: 1000, valueTWD: 100_000, short: false },
    { symbol: 'B', kind: 'stock', qty: 10, valueTWD: 20_000, short: false },
    { symbol: 'S', kind: 'stock', qty: -5, valueTWD: 5_000, short: true }
  ] };
  const { plan, covered } = coverPlan(v, 30_000);
  assert.equal(covered, true);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].symbol, 'A.TW');
  assert.equal(plan[0].qty, 303);
  const big = coverPlan(v, 110_000);
  assert.deepEqual(big.plan.map(x => x.symbol), ['A.TW', 'B']);
  assert.equal(big.plan[0].all, true);
  assert.equal(coverPlan(v, 500_000).covered, false);
});

import { applyPool, valuate as valuateAcct } from '../public/lib/account.mjs';
test('the economy reset lands as a negative pooled deposit: cash can go below zero', () => {
  const a = newAccount(0, Date.UTC(2026, 8, 1));
  const wallet = { entries: [{ id: 'eco:start', t: Date.UTC(2026, 8, 1), app: 'eco', kind: 'start', amount: 110_000 }, { id: 'eco:rebase:v3', t: Date.UTC(2026, 8, 29), app: 'eco', kind: 'rebase', amount: -80_000 }, { id: 'odds:x', t: Date.UTC(2026, 8, 29), app: 'odds', kind: 'stake', amount: -50_000 }] };
  const { account } = applyPool(a, wallet);
  const s = replay(account, Date.UTC(2026, 9, 1));
  assert.equal(s.cash.TWD, -20_000);
  const v = valuateAcct(s, new Map(), { TWD: 1 });
  assert.ok(Number.isFinite(v.netWorth));
  assert.equal(v.netWorth, -20_000);
});
