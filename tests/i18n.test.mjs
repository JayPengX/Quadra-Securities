import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS } from '../public/lib/i18n.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const zh = new Set(KEYS.zh);
const en = new Set(KEYS.en);

test('Chinese and English have the same keys', () => {
  assert.deepEqual([...zh].filter(k => !en.has(k)), []);
  assert.deepEqual([...en].filter(k => !zh.has(k)), []);
});

test('every key the page asks for exists', () => {
  const used = new Set([...app.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map(m => m[1]));
  // Keys picked by a condition inside t(...).
  for (const m of app.matchAll(/\bt\(([^()]*\?[^()]*)\)/g)) for (const k of m[1].matchAll(/'([a-z][A-Za-z0-9_]*)'/g)) used.add(k[1]);
  for (const m of html.matchAll(/data-t="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const k of ['alertHitAbove', 'alertHitBelow', 'alertWhenAbove', 'alertWhenBelow', 'alertAddAbove', 'alertAddBelow', 'tmResult', 'tmResultDca', 'tmAnnual', 'tmAnnualDca']) used.add(k);
  const families = {
    kind_: ['stock', 'etf', 'bond', 'fund', 'crypto', 'metal', 'index', 'future', 'fx', 'cash', 'govbond'],
    range_: ['1d', '5d', '1mo', '6mo', 'ytd', '1y', '5y', 'max'],
    otype_: ['market', 'limit', 'stop'],
    status_: ['open', 'filled', 'cancelled', 'rejected'],
    alloc_: ['kind', 'currency', 'market'],
    hview_: ['activity', 'orders', 'stats'],
    af_: ['all', 'trades', 'fx', 'income', 'loans', 'cash'],
    cost_: ['commission', 'tax', 'fee', 'fx', 'interest', 'withheld', 'nhi', 'borrow'],
    margin_: ['ok', 'call', 'liquidate'],
    tab_: ['markets', 'portfolio', 'fx', 'history', 'guide'],
    err_: ['funds', 'shares', 'qty', 'qtyStep', 'limit', 'stop', 'noQuote', 'notTradable', 'noRate', 'side', 'fx', 'tooSmall', 'amount', 'capacity', 'margin', 'noLoan', 'shortMargin', 'noValuation', 'planAmount', 'planDay', 'alertPrice']
  };
  for (const [prefix, list] of Object.entries(families)) for (const k of list) used.add(prefix + k);
  for (const m of app.matchAll(/para\)|\['(g_[a-z]+\d)'/g)) if (m[1]) used.add(m[1]);
  for (const m of app.matchAll(/'(g_[a-z]+\d?)'/g)) used.add(m[1]);
  const missing = [...used].filter(k => !zh.has(k));
  assert.deepEqual(missing, []);
});
