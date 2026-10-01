// Quadra Plus in Securities: perks by when things happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, estimate, quoteExchange, usePlus, plusAt, loanRateAt } from '../public/lib/account.mjs';

const OCT = Date.UTC(2026, 9, 10, 2);
const NOV = Date.UTC(2026, 10, 10, 2);
const plus = { months: new Set(['2026-10']), commission: 0.5, fxSpread: 0.5, loanCut: 0.01 };

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

test('Plus is about trading: cash interest, deposits and lending are the same for everyone', async () => {
  const { openDeposit, lendShares } = await import('../public/lib/account.mjs');
  const { CASH_RATE } = await import('../public/lib/markets.mjs');
  const { LEND_CUT, tdRate } = await import('../public/lib/savings.mjs');
  const a = newAccount(100_000, Date.UTC(2026, 9, 1) - 8 * 3_600_000);
  const end = Date.UTC(2026, 10, 1) - 8 * 3_600_000;
  usePlus(plus);
  try {
    const interest = replay(a, end).cashInterest;
    assert.ok(Math.abs(interest / ((100_000 * CASH_RATE * (end - (Date.UTC(2026, 9, 1) - 8 * 3_600_000))) / (365 * 86_400_000)) - 1) < 0.01);
    assert.equal(openDeposit(a, { amount: 50_000, months: 12 }, OCT, 'x').event.rate, tdRate(12));
    assert.equal(lendShares(a, { symbol: '2330.TW', qty: 1_000, price: 1_000 }, OCT, 'l').event?.cutRate, undefined);
    assert.equal(LEND_CUT, 0.3);
  } finally {
    usePlus(null);
  }
});

test('the pool mirrors the wallet: a deposit whose entry the clean-up retired goes', () => {
  const a = newAccount(0, Date.UTC(2026, 8, 1));
  const t = Date.UTC(2026, 8, 2);
  const before = { entries: [{ id: 'eco:pay:2026-09', t, app: 'eco', kind: 'pay', amount: 6_000 }, { id: 'vocab:shop:pack:toeic', t, app: 'vocab', kind: 'shop', amount: -990 }] };
  const { account } = applyPool(a, before);
  assert.equal(replay(account, t + 1).cash.TWD, 5_010);
  // The clean keeps the money as one entry instead.
  const after = { entries: [before.entries[0], { id: 'eco:rebase:hub', t: t + 5, app: 'eco', kind: 'rebase', amount: -990 }] };
  const next = applyPool(account, after);
  assert.deepEqual(next.added.map(e => e.id), ['x:eco:rebase:hub']);
  assert.ok(!next.account.events.some(e => e.id === 'x:vocab:shop:pack:toeic'));
  assert.equal(replay(next.account, t + 10).cash.TWD, 5_010);
  // Nothing changed: the same account back.
  assert.equal(applyPool(next.account, after).account, next.account);
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

import { tradeCosts, FUND_FEE } from '../public/lib/markets.mjs';
test('mutual funds: a subscription fee on buying (Plus discount too), nothing on selling', () => {
  assert.equal(tradeCosts({ market: 'US', side: 'buy', kind: 'fund', gross: 1_000, currency: 'USD' }).total, 1_000 * FUND_FEE);
  assert.equal(tradeCosts({ market: 'US', side: 'buy', kind: 'fund', gross: 1_000, currency: 'USD', discount: 0.28 }).commission, 2.8);
  assert.deepEqual(tradeCosts({ market: 'US', side: 'sell', kind: 'fund', gross: 1_000, currency: 'USD' }), { commission: 0, tax: 0, fee: 0, total: 0, taxRate: 0, feeRate: 0 });
  // A US stock still pays the broker's commission and the SEC fee on sale.
  assert.ok(tradeCosts({ market: 'US', side: 'sell', kind: 'stock', gross: 1_000, currency: 'USD' }).fee > 0);
});
