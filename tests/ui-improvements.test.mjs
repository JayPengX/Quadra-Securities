import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRANDS } from '../public/lib/brands.mjs';
import { makeT } from '../public/lib/i18n.mjs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const logoScript = readFileSync(new URL('../scripts/brand-logos.mjs', import.meta.url), 'utf8');
const t = makeT('zh');

test('movers and closed-trade badges use neutral official logos instead of blue TV tiles', () => {
  assert.match(app, /symbolBadge\(q\.symbol, q, \{ neutral: true \}\)/);
  assert.match(app, /symbolBadge\(c\.symbol, undefined, \{ neutral: true \}\)/);
  assert.match(css, /\.sym-badge\.logo-neutral\s*\{\s*background:\s*#fff;\s*color:\s*#334155;/);
});

test('company badge logos are current, compact marks with generator overrides', () => {
  assert.equal(BRANDS['2912.TW'], '7-Eleven logo 2021.svg');
  assert.equal(BRANDS.RBLX, 'Roblox Logo 2022.svg');
  assert.equal(BRANDS.MCD, "McDonald's Golden Arches.svg");
  assert.match(logoScript, /const LOGO_OVERRIDES = \{/);
});

test('closed-trade summary describes profitable-trade share without overstating it as a win rate', () => {
  assert.equal(t('winRate'), '獲利交易占比');
  assert.equal(t('noClosed'), '賣出之後，這裡會顯示獲利交易占比。');
});

test('editing a monthly plan does not focus its amount field or open the mobile keyboard', () => {
  const editCase = app.match(/case 'plan-edit': \{([\s\S]*?)\n    case 'plan-row-save':/);
  assert.ok(editCase);
  assert.doesNotMatch(editCase[1], /\.focus\s*\(/);
});

test('financial amount inputs stay readable and scroll with the caret on narrow phones', () => {
  assert.match(css, /\.fx-input,\s*\.fx-result\s*\{[^}]*font-size:\s*clamp\(16px,\s*5vw,\s*1\.6rem\)/);
  assert.match(css, /\.fx-input\s*\{[^}]*overflow-x:\s*auto;[^}]*text-overflow:\s*clip;/);
});
