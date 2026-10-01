// Builds public/lib/brands.mjs: each catalogue company's official logo (a
// Wikimedia Commons file, from Wikidata's "logo image" by its ticker on its
// exchange), its square icon where Wikidata has one ("small logo or icon"),
// and each fund's issuer's logo. Run it when the catalogue changes:
// `node scripts/brand-logos.mjs`. It uses curl (the container's proxy) and
// writes the map; the app never asks Wikidata itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CATEGORIES } from '../public/lib/catalog.mjs';

const UA = 'QuadraSecurities/1.0 (https://github.com/jaypengx/Quadra-Securities)';
const curl = args => {
  for (let tries = 0; ; tries++) {
    const out = execFileSync('curl', ['-s', '-A', UA, ...args], { maxBuffer: 64 << 20 }).toString();
    if (out.startsWith('{')) return JSON.parse(out);
    // Wikimedia's "too many requests": wait and ask again.
    if (tries === 5) throw new Error(out.slice(0, 200));
    execFileSync('sleep', [String(10 * (tries + 1))]);
  }
};
const sparql = query => curl(['https://query.wikidata.org/sparql', '--data-urlencode', `query=${query}`, '-H', 'Accept: application/sparql-results+json']).results.bindings;
const fileOf = url => decodeURIComponent(url.replace(/^.*Special:FilePath\//, ''));

// An item's logo statements, as Wikidata ranks and dates them: a logo with
// an end date is a past one; a preferred one is the current one; then the
// latest start; then the plain file (not white or inverted, English before
// Chinese).
const LOGO = 'P154';
const ICON = 'P8972';
const statements = `?item ?claim ?st . VALUES ?claim { p:${LOGO} p:${ICON} } ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  { ?st ps:${LOGO} ?file } UNION { ?st ps:${ICON} ?file }
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }`;
const NOW = new Date().toISOString();
const plainScore = f => (/white|negative|invert|reverse|dark/i.test(f) ? 4 : 0) + (/zh|chinese/i.test(f) ? 1 : 0);
const rankOf = r => (/Preferred/.test(r.rank.value) ? 1 : 0);
const startOf = r => r.start?.value || '';
function current(rows) {
  const live = rows.filter(r => !(r.end && r.end.value <= NOW));
  live.sort((a, b) => rankOf(b) - rankOf(a) || (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : 0) || plainScore(fileOf(a.file.value)) - plainScore(fileOf(b.file.value)));
  return live[0] ? fileOf(live[0].file.value) : null;
}
// Rows grouped by a key: its current logo and icon.
function marks(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = new Map();
  for (const [k, list] of groups) {
    const logo = current(list.filter(r => r.claim.value.endsWith(LOGO)));
    const icon = current(list.filter(r => r.claim.value.endsWith(ICON)));
    out.set(k, { logo, icon });
  }
  return out;
}

// Yahoo's suffix: the exchange on Wikidata and the ticker as it's written there.
const EXCHANGES = {
  TW: ['Q548621'],
  TWO: ['Q5598539'],
  T: ['Q217475'],
  HK: ['Q496672'],
  SS: ['Q739514'],
  SZ: ['Q517750'],
  KS: ['Q495372'],
  AS: ['Q478720', 'Q2416590'],
  DE: ['Q151139'],
  MI: ['Q936563'],
  '': ['Q13677', 'Q82059']
};
const placeOf = symbol => {
  const m = symbol.match(/^([A-Z0-9-]+)\.([A-Z]+)$/);
  const suffix = m ? m[2] : '';
  let ticker = m ? m[1] : symbol;
  if (suffix === 'HK') ticker = String(Number(ticker));
  if (!suffix) ticker = ticker.replace('-', '.');
  return EXCHANGES[suffix] ? { ex: EXCHANGES[suffix], ticker } : null;
};

// The brand a listed company trades as, when the brand is what people know
// and Wikidata keeps the logo there (統一超 runs 7-ELEVEN in Taiwan; Roblox
// the company has no logo of its own on Wikidata, Roblox the platform has).
const BRAND_OF = { '2912.TW': '7-Eleven', RBLX: 'Roblox' };

const items = CATEGORIES.flatMap(c => c.items.map(([symbol, zh, en, kind]) => ({ symbol, zh, en, kind: kind || (/etf/.test(c.id) || c.id === 'bond' ? 'etf' : c.id === 'fund' ? 'fund' : c.id === 'crypto' ? 'crypto' : 'stock'), cat: c.id })));
const exIds = [...new Set(Object.values(EXCHANGES).flat())];
const byTicker = marks(
  sparql(`SELECT ?ticker ?ex ?claim ?file ?rank ?start ?end WHERE {
  ?item p:P414 ?listing . ?listing ps:P414 ?ex ; pq:P249 ?ticker .
  VALUES ?ex { ${exIds.map(q => `wd:${q}`).join(' ')} }
  ${statements}
}`),
  r => `${r.ex.value.split('/').pop()}|${r.ticker.value}`
);
const listed = symbol => {
  const p = placeOf(symbol);
  for (const ex of p?.ex || []) {
    const m = byTicker.get(`${ex}|${p.ticker}`);
    if (m?.logo || m?.icon) return m;
  }
  return null;
};
// Items by an English (or Chinese, as written here) name. `where` narrows
// the items: companies only, say, so a word doesn't find a place.
const byName = (names, where = '') => {
  const list = [...new Set(names)].filter(Boolean);
  const rows = [];
  for (let k = 0; k < list.length; k += 60) {
    const values = list.slice(k, k + 60).flatMap(n => [`"${n.replace(/"/g, '')}"@en`, `"${n.replace(/"/g, '')}"@zh-tw`, `"${n.replace(/"/g, '')}"@zh`]);
    rows.push(...sparql(`SELECT ?name ?claim ?file ?rank ?start ?end WHERE { VALUES ?name { ${values.join(' ')} } ?item rdfs:label|skos:altLabel ?name . ${where} ${statements} }`));
  }
  return marks(rows, r => r.name.value);
};

// Funds and ETFs: their issuer's logo, by the name's first word: a listed
// parent by its symbol, or the issuer by its English name on Wikidata.
const ISSUERS = [
  [/^元大|^Yuanta/, '2885.TW'], [/^富邦/, '2881.TW'], [/^國泰/, '2882.TW'], [/^中信/, '2891.TW'], [/^永豐/, '2890.TW'],
  [/^兆豐/, '2886.TW'], [/^凱基/, '2883.TW'], [/^統一/, '1216.TW'], [/^群益/, '6005.TW'],
  [/^iShares/, 'BLK'], [/^SPDR|Select Sector$/, 'STT'], [/^Invesco/, 'IVZ'], [/^Schwab/, 'SCHW'], [/^JPMorgan/, 'JPM'],
  [/^Vanguard/, 'The Vanguard Group'], [/^ProShares/, 'ProShares'], [/^Global X/, 'Global X'], [/^ARK/, 'ARK Invest'], [/^VanEck/, 'VanEck'], [/^Fidelity|^富達/, 'Fidelity Investments']
];
const issuers = byName(ISSUERS.map(x => x[1]).filter(x => / /.test(x) || /^[A-Z][a-z]/.test(x)));
const coins = byName(
  items.filter(i => i.kind === 'crypto').map(i => i.en.replace(/\s*\(.*\)$/, '')),
  '?item wdt:P31/wdt:P279* wd:Q13479982 .'
);
const plain = n => n.replace(/\s*\(.*\)$/, '').replace(/ ADR$/, '');
const companies = byName(
  items.filter(i => i.kind === 'stock').flatMap(i => [plain(i.en), i.zh]),
  'FILTER EXISTS { { ?item wdt:P452 ?ind } UNION { ?item wdt:P414 ?ex } UNION { ?item wdt:P31 wd:Q891723 } }'
);
const brands = byName(Object.values(BRAND_OF));

// What `a` lacks, from `b`.
const fill = (a, b) => ({ logo: a?.logo || b?.logo || null, icon: a?.icon || b?.icon || null });
const found = new Map();
const missing = [];
for (const i of items) {
  let m = null;
  if (i.kind === 'crypto') m = coins.get(i.en.replace(/\s*\(.*\)$/, ''));
  else if (i.kind === 'etf' || i.kind === 'fund' || i.kind === 'bond') {
    // A fund shows its issuer's logo, never the issuer's app icon.
    const hit = ISSUERS.find(([re]) => re.test(i.zh) || re.test(i.en));
    const issuer = hit && (issuers.get(hit[1])?.logo ? issuers.get(hit[1]) : listed(hit[1]));
    m = issuer?.logo ? { logo: issuer.logo } : null;
  } else m = BRAND_OF[i.symbol] ? brands.get(BRAND_OF[i.symbol]) : listed(i.symbol);
  if (!m?.logo && (i.kind === 'stock' || !i.kind)) m = fill(fill(m, companies.get(plain(i.en))), companies.get(i.zh));
  // A photo (a sign on a building, say) isn't a logo.
  for (const k of ['logo', 'icon']) if (m?.[k] && !/\.(svg|png)$/i.test(m[k])) delete m[k];
  if (m?.logo || m?.icon) found.set(i.symbol, m);
  else if (i.cat !== 'fx' && i.cat !== 'index' && i.cat !== 'metal' && i.cat !== 'govbond') missing.push(i.symbol);
}

// Each file as the app loads it: an SVG as it is (sharp at any size; one
// over 100 kB, or a PNG wider than 250 pixels, as a 250-pixel thumbnail, a
// size Wikimedia keeps rendered). Paths are under Wikimedia's commons/
// folder (a file's folder is the MD5 of its name): thumb/… on its thumbnail
// host, the rest on its upload host.
const peek = (url, args) => {
  const tmp = join(tmpdir(), 'brand-logo-peek');
  for (let tries = 0; ; tries++) {
    const status = execFileSync('curl', ['-s', '-A', UA, ...args, '-o', tmp, '-w', '%{http_code}', url]).toString();
    if (/^20/.test(status)) return readFileSync(tmp);
    if (tries === 5) throw new Error(`${status} ${url}`);
    execFileSync('sleep', [String(5 * (tries + 1))]);
  }
};
const files = [...new Set([...found.values()].flatMap(m => [m.logo, m.icon]).filter(Boolean))];
const path = new Map();
for (const file of files) {
  const name = file.replace(/ /g, '_');
  const md5 = createHash('md5').update(name).digest('hex');
  const dir = `${md5[0]}/${md5.slice(0, 2)}/${name}`;
  const url = `https://upload.wikimedia.org/wikipedia/commons/${dir.split('/').map(encodeURIComponent).join('/')}`;
  // An SVG's size, or a PNG's first bytes (its width is from the 17th).
  const svg = /\.svg$/i.test(name);
  const head = peek(url, svg ? ['-I'] : ['-r', '0-23']);
  const small = svg ? Number(head.toString().match(/content-length: *(\d+)/i)?.[1]) <= 100_000 : head.readUInt32BE(16) <= 250;
  path.set(file, small ? dir : `thumb/${dir}/250px-${name}${/\.svg$/i.test(name) ? '.png' : ''}`);
}
const logos = {};
const icons = {};
for (const [symbol, m] of found) {
  if (m.logo && path.has(m.logo)) logos[symbol] = path.get(m.logo);
  if (m.icon && path.has(m.icon)) icons[symbol] = path.get(m.icon);
}
const list = map =>
  Object.entries(map)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
writeFileSync(
  new URL('../public/lib/brands.mjs', import.meta.url),
  `// Made by scripts/brand-logos.mjs (Wikidata's current logo of each company,
// by its ticker; a fund's issuer's): Wikimedia Commons files. Don't edit by
// hand; run the script again.
export const BRANDS = {
${list(logos)}
};
// The company's own square icon (Wikidata's "small logo or icon").
export const ICONS = {
${list(icons)}
};
const commons = path => \`https://\${path.startsWith('thumb/') ? 'thumb' : 'upload'}.wikimedia.org/wikipedia/commons/\${path.split('/').map(encodeURIComponent).join('/')}\`;
export const brandLogo = symbol => (BRANDS[symbol] ? commons(BRANDS[symbol]) : null);
export const brandIcon = symbol => (ICONS[symbol] ? commons(ICONS[symbol]) : null);
`
);
console.log(`${Object.keys(logos).length} logos, ${Object.keys(icons).length} icons; none for ${missing.length}: ${missing.join(' ')}`);
