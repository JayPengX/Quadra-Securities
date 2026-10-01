// Builds public/lib/brands.mjs: each catalogue company's official logo (a
// Wikimedia Commons file, from Wikidata's "logo image" by its ticker on its
// exchange), and each fund's by its issuer. Run it when the catalogue
// changes: `node scripts/brand-logos.mjs`. It uses curl (the container's
// proxy) and writes the map; the app never asks Wikidata itself.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CATEGORIES } from '../public/lib/catalog.mjs';

const UA = 'QuadraSecurities/1.0 (https://github.com/jaypengx/quadra-securities)';
const sparql = query => {
  const out = execFileSync('curl', ['-s', '-G', 'https://query.wikidata.org/sparql', '--data-urlencode', `query=${query}`, '-H', 'Accept: application/sparql-results+json', '-A', UA], { maxBuffer: 64 << 20 });
  return JSON.parse(out).results.bindings;
};
const fileOf = url => decodeURIComponent(url.replace(/^.*Special:FilePath\//, ''));
// Of an item's logos, the plain one: not the white or inverted one, the
// English one before the Chinese.
const better = (a, b) => {
  const score = f => (/white|negative|invert|reverse|dark/i.test(f) ? 4 : 0) + (/zh|chinese/i.test(f) ? 1 : 0) + (/icon|symbol/i.test(f) ? 0.5 : 0);
  return score(a) <= score(b) ? a : b;
};

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

const items = CATEGORIES.flatMap(c => c.items.map(([symbol, zh, en, kind]) => ({ symbol, zh, en, kind: kind || (/etf/.test(c.id) || c.id === 'bond' ? 'etf' : c.id === 'fund' ? 'fund' : c.id === 'crypto' ? 'crypto' : 'stock'), cat: c.id })));
const exIds = [...new Set(Object.values(EXCHANGES).flat())];
const rows = sparql(`SELECT ?ticker ?ex ?logo WHERE {
  ?item p:P414 ?st . ?st ps:P414 ?ex ; pq:P249 ?ticker .
  VALUES ?ex { ${exIds.map(q => `wd:${q}`).join(' ')} }
  ?item wdt:P154 ?logo .
}`);
const byTicker = new Map();
for (const r of rows) {
  const key = `${r.ex.value.split('/').pop()}|${r.ticker.value}`;
  const f = fileOf(r.logo.value);
  byTicker.set(key, byTicker.has(key) ? better(byTicker.get(key), f) : f);
}

// Funds and ETFs: their issuer's logo, by the name's first word: a listed
// parent by its symbol, or the issuer by its English name on Wikidata.
const ISSUERS = [
  [/^元大|^Yuanta/, '2885.TW'], [/^富邦/, '2881.TW'], [/^國泰/, '2882.TW'], [/^中信/, '2891.TW'], [/^永豐/, '2890.TW'],
  [/^兆豐/, '2886.TW'], [/^凱基/, '2883.TW'], [/^統一/, '1216.TW'], [/^群益/, '6005.TW'],
  [/^iShares/, 'BLK'], [/^SPDR|Select Sector$/, 'STT'], [/^Invesco/, 'IVZ'], [/^Schwab/, 'SCHW'], [/^JPMorgan/, 'JPM'],
  [/^Vanguard/, 'The Vanguard Group'], [/^ProShares/, 'ProShares'], [/^Global X/, 'Global X'], [/^ARK/, 'ARK Invest'], [/^VanEck/, 'VanEck'], [/^Fidelity|^富達/, 'Fidelity Investments']
];
const issuerLogo = new Map();
const labels = ISSUERS.map(x => x[1]).filter(x => / /.test(x) || /^[A-Z][a-z]/.test(x));
for (const r of sparql(`SELECT ?name ?logo WHERE { VALUES ?name { ${labels.map(n => `"${n}"@en`).join(' ')} } ?item rdfs:label ?name ; wdt:P154 ?logo . }`)) {
  const n = r.name.value;
  const f = fileOf(r.logo.value);
  issuerLogo.set(n, issuerLogo.has(n) ? better(issuerLogo.get(n), f) : f);
}
const listedLogo = symbol => {
  const p = placeOf(symbol);
  for (const ex of p?.ex || []) {
    const f = byTicker.get(`${ex}|${p.ticker}`);
    if (f) return f;
  }
  return null;
};

// Coins: by their English name.
const coinNames = items.filter(i => i.kind === 'crypto').map(i => i.en.replace(/\s*\(.*\)$/, ''));
const coinLogo = new Map();
for (const r of sparql(`SELECT ?name ?logo WHERE { VALUES ?name { ${coinNames.map(n => `"${n}"@en`).join(' ')} } ?item rdfs:label ?name ; wdt:P31/wdt:P279* wd:Q13479982 ; wdt:P154 ?logo . }`)) {
  const n = r.name.value;
  const f = fileOf(r.logo.value);
  coinLogo.set(n, coinLogo.has(n) ? better(coinLogo.get(n), f) : f);
}

// The rest, by name (English, or Chinese as written here), among companies
// only (an industry or a listing on Wikidata), so a word doesn't find a place.
const plain = n => n.replace(/\s*\(.*\)$/, '').replace(/ ADR$/, '');
const named = new Map();
const nameRows = names => {
  const list = [...new Set(names)].filter(Boolean);
  const res = [];
  for (let k = 0; k < list.length; k += 60) {
    res.push(...sparql(`SELECT ?name ?logo WHERE {
      VALUES ?name { ${list.slice(k, k + 60).flatMap(n => [`"${n.replace(/"/g, '')}"@en`, `"${n.replace(/"/g, '')}"@zh-tw`, `"${n.replace(/"/g, '')}"@zh`]).join(' ')} }
      ?item rdfs:label|skos:altLabel ?name ; wdt:P154 ?logo .
      FILTER EXISTS { { ?item wdt:P452 ?ind } UNION { ?item wdt:P414 ?ex } UNION { ?item wdt:P31 wd:Q891723 } }
    }`));
  }
  for (const r of res) {
    const n = r.name.value;
    const f = fileOf(r.logo.value);
    named.set(n, named.has(n) ? better(named.get(n), f) : f);
  }
};

nameRows(items.filter(i => i.kind === 'stock').flatMap(i => [plain(i.en), i.zh]));
const out = {};
const missing = [];
// Compact, current marks for symbols where a default Wikidata match is
// missing or too detailed for a small badge. 2912.TW is President Chain
// Store, the listed operator of 7-Eleven in Taiwan.
const LOGO_OVERRIDES = {
  '2912.TW': '7-Eleven logo 2021.svg',
  RBLX: 'Roblox Logo 2022.svg',
  MCD: "McDonald's Golden Arches.svg"
};
for (const i of items) {
  let f = null;
  if (i.kind === 'crypto') f = coinLogo.get(i.en.replace(/\s*\(.*\)$/, ''));
  else if (i.kind === 'etf' || i.kind === 'fund' || i.kind === 'bond') {
    const hit = ISSUERS.find(([re]) => re.test(i.zh) || re.test(i.en));
    f = hit ? issuerLogo.get(hit[1]) || listedLogo(hit[1]) : null;
  } else f = listedLogo(i.symbol);
  if (!f && (i.kind === 'stock' || !i.kind)) f = named.get(plain(i.en)) || named.get(i.zh);
  f = LOGO_OVERRIDES[i.symbol] || f;
  // A photo (a sign on a building, say) isn't a logo.
  if (f && !/\.(svg|png)$/i.test(f)) f = null;
  if (f) out[i.symbol] = f;
  else if (i.cat !== 'fx' && i.cat !== 'index' && i.cat !== 'metal' && i.cat !== 'govbond') missing.push(i.symbol);
}
const body = Object.entries(out)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
writeFileSync(
  new URL('../public/lib/brands.mjs', import.meta.url),
  `// Made by scripts/brand-logos.mjs (Wikidata's logo of each company, by its
// ticker; a fund's issuer's): a Wikimedia Commons file per symbol. Don't edit
// by hand; run the script again.
export const BRANDS = {
${body}
};
// A logo as a PNG of about this width (Commons renders the SVG).
export const brandLogo = (symbol, width = 96) => (BRANDS[symbol] ? \`https://commons.wikimedia.org/wiki/Special:FilePath/\${encodeURIComponent(BRANDS[symbol])}?width=\${width}\` : null);
`
);
console.log(`${Object.keys(out).length} logos; none for ${missing.length}: ${missing.join(' ')}`);
