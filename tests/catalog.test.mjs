// The points catalogue in Securities (Rewards' 積分兌換, the kit's CATALOG):
// a commission voucher, a 定存 bonus, and Plus's new perks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, replay, placeOrder, processOrders, openDeposit, matureDeposits, lendShares, usePlus, useVouchers, feeVoucher, tdVouchers, usedVouchers, depositRate } from '../public/lib/account.mjs';
import { addMonths, lendFee, LEND_CUT } from '../public/lib/savings.mjs';

const T0 = Date.UTC(2026, 9, 5, 2); // Monday 10:00 Taipei
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RATES = { TWD: 1, USD: 32 };
const quote = (symbol, price, over = {}) => ({ symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, pct: 0, session: { start: T0 - HOUR, end: T0 + 4 * HOUR }, marketTime: T0, got: T0 + 1, line: [], ...over });
const token = (id, over = {}) => ({ id, value: 100, rate: 0, cap: 0, t: T0 - DAY, until: T0 + 29 * DAY, ...over });

test('a commission voucher: up to NT$100 off the next fill that pays one, once, the rest lost', () => {
  let a = newAccount(2_000_000, T0 - 2 * DAY, 'acc');
  useVouchers({ fee: [token('vocab:xs:fee:a'), token('vocab:xs:fee:b', { until: T0 + 2 * DAY })] });
  try {
    // The one expiring first goes first.
    assert.equal(feeVoucher(a, T0).id, 'vocab:xs:fee:b');
    const q = quote('2330.TW', 1000);
    a = placeOrder(a, { side: 'buy', type: 'market', qty: 1_000 }, { quote: q, rates: RATES, now: T0, id: 'b1' }).account;
    const r = processOrders(a, new Map([['2330.TW', q]]), RATES, T0 + 2);
    const fill = r.account.events.find(e => e.id === 'fill:b1');
    // About NT$1,425 of commission (0.1425%), less NT$100.
    assert.equal(fill.voucher, 'vocab:xs:fee:b');
    assert.equal(fill.voucherOff, 100);
    assert.ok(fill.commission > 1_300 && fill.commission < 1_400);
    assert.ok(fill.total === fill.gross + fill.commission + fill.tax + fill.fee);
    assert.equal(feeVoucher(r.account, T0 + 3).id, 'vocab:xs:fee:a');
    assert.deepEqual(usedVouchers(r.account).map(x => x[0]), ['vocab:xs:fee:b']);
    // A commission smaller than the voucher: only that much, the rest gone.
    const small = quote('0050.TW', 10);
    let b = placeOrder(r.account, { side: 'buy', type: 'market', qty: 100 }, { quote: small, rates: RATES, now: T0 + 3, id: 'b2' }).account;
    b = processOrders(b, new Map([['0050.TW', small]]), RATES, T0 + 4).account;
    const f2 = b.events.find(e => e.id === 'fill:b2');
    // An odd lot's commission (NT$1 here): all of it off, the rest of the voucher lost.
    assert.equal(f2.commission, 0);
    assert.ok(f2.voucherOff > 0 && f2.voucherOff < 100);
    assert.equal(feeVoucher(b, T0 + 5), null);
  } finally {
    useVouchers(null);
  }
});

test('a 定存 bonus token: +0.5% on one deposit up to NT$100,000, its first term; Plus +0.1%', () => {
  let a = newAccount(500_000, T0 - DAY, 'acc');
  useVouchers({ td: [token('vocab:xs:td:t', { value: 0, rate: 0.005, cap: 100_000 })] });
  try {
    assert.equal(openDeposit(a, { amount: 150_000, months: 12, bonus: 'vocab:xs:td:t' }, T0).error, 'tdBonusCap');
    assert.equal(openDeposit(a, { amount: 50_000, months: 12, bonus: 'nope' }, T0).error, 'tdBonusGone');
    const r = openDeposit(a, { amount: 100_000, months: 12, renew: true, bonus: 'vocab:xs:td:t' }, T0, 'x');
    a = r.account;
    assert.equal(r.event.rate, 0.0222);
    assert.equal(r.event.bonus, 'vocab:xs:td:t');
    assert.equal(tdVouchers(a, T0 + 1).length, 0);
    // Matures: 100,000 × 2.22% = 2,220; rolled over at the posted rate, no bonus.
    const m = matureDeposits(a, addMonths(T0, 12) + DAY);
    assert.equal(m.events.find(e => e.type === 'tdend').interest, 2_220);
    const again = m.events.find(e => e.id === 'td:xr');
    assert.equal(again.rate, 0.0172);
    assert.equal(again.bonus, undefined);
    // A Plus month: +0.1% on a new deposit.
    usePlus({ months: new Set(['2026-10']), tdBonus: 0.001, lendCut: 0.2 });
    assert.equal(depositRate(12, T0), 0.0182);
    assert.equal(depositRate(12, Date.UTC(2026, 10, 5)), 0.0172);
  } finally {
    useVouchers(null);
    usePlus(null);
  }
});

test('Plus: lending contracts made in a member month leave the broker 20%', () => {
  const lend = { qty: 1_000, price: 1_000, rate: 0.012, t: 0 };
  const plain = lendFee(lend, 365 * DAY);
  assert.equal(plain.cut, Math.round(plain.gross * LEND_CUT));
  assert.equal(lendFee({ ...lend, cutRate: 0.2 }, 365 * DAY).cut, Math.round(plain.gross * 0.2));
  let a = newAccount(2_000_000, T0 - 10 * DAY, 'acc');
  const q = quote('2330.TW', 1000, { session: { start: T0 - 10 * DAY - HOUR, end: T0 - 10 * DAY + 4 * HOUR }, marketTime: T0 - 10 * DAY, got: T0 - 10 * DAY + 1 });
  a = placeOrder(a, { side: 'buy', type: 'market', qty: 1_000 }, { quote: q, rates: RATES, now: T0 - 10 * DAY, id: 'b1' }).account;
  a = processOrders(a, new Map([['2330.TW', q]]), RATES, T0 - 10 * DAY + 2).account;
  usePlus({ months: new Set(['2026-10']), tdBonus: 0.001, lendCut: 0.2 });
  try {
    const r = lendShares(a, { symbol: '2330.TW', qty: 1_000, price: 1_000 }, T0, 'l');
    assert.equal(r.event.cutRate, 0.2);
  } finally {
    usePlus(null);
  }
  assert.equal(lendShares(a, { symbol: '2330.TW', qty: 1_000, price: 1_000 }, T0, 'l').event.cutRate, undefined);
});
