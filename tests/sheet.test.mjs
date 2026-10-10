import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test("a stock's sheet is the kit's sheet: it swipes down like every other app's", async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="detail" class="sheet q-sheet">/);
});
