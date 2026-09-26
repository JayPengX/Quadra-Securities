import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSONS, MISSIONS, GLOSSARY } from '../public/lib/learn.mjs';
import { newAccount, placeOrder, exchange } from '../public/lib/account.mjs';
import { catalogInfo } from '../public/lib/catalog.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const ctxKeys = [...app.slice(app.indexOf('function lessonContext')).matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);

test('every lesson is complete in both languages, with a valid quiz and real targets', () => {
  assert.equal(new Set(LESSONS.map(l => l.id)).size, LESSONS.length);
  for (const l of LESSONS) {
    assert.ok(l.title.zh && l.title.en, l.id);
    assert.equal(l.body.zh.length, l.body.en.length, l.id);
    assert.ok(l.quiz.answer >= 0 && l.quiz.answer < l.quiz.options.length, l.id);
    for (const o of l.quiz.options) assert.ok(o.zh && o.en, l.id);
    for (const [kind, target] of l.try) {
      if (kind === 'open') assert.ok(catalogInfo(target), `${l.id} opens ${target}`);
      else assert.ok(['markets', 'portfolio', 'fx', 'history', 'guide'].includes(target), l.id);
    }
    // Every {placeholder} is one the page fills in.
    for (const p of [...l.body.zh, ...l.body.en]) for (const [, k] of p.matchAll(/\{(\w+)\}/g)) assert.ok(ctxKeys.includes(k), `${l.id}: {${k}}`);
  }
  assert.ok(GLOSSARY.every(g => g.length === 3));
});

test('missions tick themselves off from the account', () => {
  const T0 = Date.UTC(2026, 8, 21, 2);
  const HOUR = 3_600_000;
  const done = a => MISSIONS.filter(m => m.done(a, T0 + 40 * 86_400_000)).map(m => m.id);
  assert.deepEqual(done(null), []);
  let a = newAccount(1_000_000, T0, 'acc');
  assert.deepEqual(done(a), ['open']);
  const q = (symbol, price, over) => ({ symbol, name: symbol, kind: 'stock', market: 'TW', currency: 'TWD', price, prev: price, session: { start: T0 - HOUR, end: T0 + HOUR }, marketTime: T0, ...over });
  const rates = { TWD: 1, USD: 32 };
  a = placeOrder(a, { side: 'buy', qty: 10 }, { quote: q('2330.TW', 2000), rates, now: T0, id: '1' }).account;
  a = placeOrder(a, { side: 'buy', qty: 10 }, { quote: q('0050.TW', 100, { kind: 'etf' }), rates, now: T0, id: '2' }).account;
  a = exchange(a, { from: 'TWD', to: 'USD', amount: 100_000 }, { rates, now: T0, id: 'x' }).account;
  a = placeOrder(a, { side: 'buy', qty: 1 }, { quote: q('VOO', 500, { kind: 'etf', market: 'US', currency: 'USD' }), rates, now: T0, id: '3' }).account;
  assert.deepEqual(done(a), ['open', 'twStock', 'etf', 'fx', 'foreign', 'patient']);
  a = placeOrder(a, { side: 'buy', type: 'limit', limit: 1, qty: 1 }, { quote: q('2317.TW', 200), rates, now: T0, id: '4' }).account;
  a = placeOrder(a, { side: 'buy', qty: 1 }, { quote: q('BTC-USD', 1000, { kind: 'crypto', market: 'CRYPTO', currency: 'USD' }), rates, now: T0, id: '5' }).account;
  assert.ok(done(a).includes('limit') && done(a).includes('spread'));
});
