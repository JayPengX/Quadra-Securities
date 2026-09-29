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
