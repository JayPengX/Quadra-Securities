// Adds ?v=<version> to every local script, stylesheet and module import in
// public/, so a deploy never mixes new files with ones a browser cached from
// the last deploy (GitHub Pages caches for 10 minutes; one stale module can
// stop the whole page from starting). Also stamps the version into
// index.html and writes public/version.json: the page compares the two and
// reloads itself when a newer deploy is out. Run by the deploy workflow only.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const version = process.argv[2];
if (!version) throw new Error('usage: node scripts/stamp-version.mjs <version>');
const root = new URL('../public/', import.meta.url).pathname;

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(html|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

// './x.js', './lib/x.mjs', './styles.css' inside import/from/src/href/new URL.
const LOCAL = /((?:from|import\(|src=|href=|new URL\()\s*['"])(\.\/[^'"?]+\.(?:m?js|css))(['"])/g;
for (const path of await files(root)) {
  const text = await readFile(path, 'utf8');
  const stamped = text.replace(LOCAL, (_, before, file, after) => `${before}${file}?v=${version}${after}`);
  if (stamped !== text) await writeFile(path, stamped);
}

// The page's own version, and the latest one, fetched past every cache.
const index = join(root, 'index.html');
await writeFile(index, (await readFile(index, 'utf8')).replace('content="dev"', `content="${version}"`));
await writeFile(join(root, 'version.json'), JSON.stringify({ version }) + '\n');
