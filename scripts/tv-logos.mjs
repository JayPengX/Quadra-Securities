// Builds public/lib/tvlogos.mjs: each catalogue symbol's icon on
// TradingView's logo CDN (the round icons trading apps show: companies,
// fund issuers, coins, metals and crops, indices, a currency pair's two
// flags, a bond's country). Run it when the catalogue changes:
// `node scripts/tv-logos.mjs`. It uses curl (the container's proxy) and
// writes the map; the app only loads the images.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CATEGORIES } from '../public/lib/catalog.mjs';

const search = (text, extra = '') => {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(text)}&hl=0&lang=en&domain=production${extra}`;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const out = execFileSync('curl', ['-s', '-m', '20', url, '-H', 'Origin: https://www.tradingview.com'], { maxBuffer: 8 << 20 });
      return JSON.parse(out).symbols || [];
    } catch {}
  }
  return [];
};
const plain = s => String(s || '').replace(/<\/?em>/g, '');
const idOf = x => (x?.logo?.style === 'pair' ? `${x.logo.logoid}|${x.logo.logoid2}` : x?.logo?.logoid || x?.logoid || null);

// Yahoo's suffix → TradingView's exchange.
const EXCHANGES = { TW: 'TWSE', TWO: 'TPEX', T: 'TSE', HK: 'HKEX', SS: 'SSE', SZ: 'SZSE', KS: 'KRX', AS: 'EURONEXT', PA: 'EURONEXT', DE: 'XETR', MI: 'MIL', MC: 'BME', SW: 'SIX', CO: 'OMXCOP', L: 'LSE', TO: 'TSX', AX: 'ASX', SI: 'SGX', NS: 'NSE' };
// Indices and yields as TradingView names them.
const INDICES = {
  '^TWII': 'indices/taiex', '^GSPC': 'indices/s-and-p-500', '^IXIC': 'indices/nasdaq-composite', '^DJI': 'indices/dow-30', '^SOX': 'indices/phlx-semiconductor',
  '^RUT': 'indices/russell-2000', '^VIX': 'indices/volatility-s-and-p-500', '^N225': 'indices/nikkei-225', '^HSI': 'indices/hang-seng', '000001.SS': 'indices/sse-composite',
  '^KS11': 'indices/kospi-composite', '^GDAXI': 'indices/dax', '^FTSE': 'indices/uk-100', '^FCHI': 'indices/cac-40', '^STOXX50E': 'indices/euro-stoxx-50',
  '^BSESN': 'indices/sensex', '^AXJO': 'indices/s-and-p-asx-200', '^IRX': 'country/US', '^FVX': 'country/US', '^TNX': 'country/US', '^TYX': 'country/US'
};
const INDEX_SEARCH = { '^TWII': 'TAIEX', '^GSPC': 'SPX', '^IXIC': 'IXIC', '^DJI': 'DJI', '^SOX': 'SOX', '^RUT': 'RUT', '^VIX': 'VIX', '^N225': 'NI225', '^HSI': 'HSI', '000001.SS': '000001', '^KS11': 'KOSPI', '^GDAXI': 'DAX', '^FTSE': 'UKX', '^FCHI': 'PX1', '^STOXX50E': 'SX5E', '^BSESN': 'SENSEX', '^AXJO': 'XJO' };
const BOND_COUNTRY = { UST: 'US', TWGB: 'TW', JGB: 'JP', BUND: 'DE', GILT: 'GB' };
const METALS = { XAU: 'metal/gold', XAG: 'metal/silver' };

function lookup(symbol, cat) {
  if (METALS[symbol]) return METALS[symbol];
  if (cat === 'govbond') return `country/${BOND_COUNTRY[symbol.split('-')[0]]}`;
  if (cat === 'index' || /^\^/.test(symbol)) {
    const hit = search(INDEX_SEARCH[symbol] || symbol.slice(1), '&search_type=index').find(x => idOf(x)?.startsWith('indices/'));
    return idOf(hit) || INDICES[symbol] || null;
  }
  if (/-USD$/.test(symbol)) return idOf(search(symbol.replace('-', ''), '&search_type=crypto').find(x => idOf(x)?.startsWith('crypto/')));
  if (/=X$/.test(symbol)) return idOf(search(symbol.slice(0, 6), '&search_type=forex')[0]);
  if (/=F$/.test(symbol)) return idOf(search(`${symbol.slice(0, -2)}1!`, '&search_type=futures').find(idOf));
  const m = symbol.match(/^(.+)\.([A-Z]+)$/);
  if (m && EXCHANGES[m[2]]) {
    let ticker = m[1];
    if (m[2] === 'HK') ticker = String(Number(ticker));
    if (m[2] === 'CO' || m[2] === 'L' || m[2] === 'SW') ticker = ticker.replace('-', '_');
    const list = search(ticker, `&exchange=${EXCHANGES[m[2]]}`);
    return idOf(list.find(x => plain(x.symbol) === ticker.replace('.', '_')) || list.find(x => plain(x.symbol) === ticker) || null);
  }
  const ticker = symbol.replace('-', '.');
  const list = search(ticker);
  const exact = list.filter(x => plain(x.symbol) === ticker && idOf(x));
  return idOf(exact.find(x => x.country === 'US' && x.is_primary_listing) || exact.find(x => x.country === 'US') || exact[0]);
}

const out = {};
const missing = [];
for (const c of CATEGORIES) {
  for (const [symbol] of c.items) {
    const id = lookup(symbol, c.id);
    if (id) out[symbol] = id;
    else missing.push(symbol);
  }
}
const body = Object.entries(out)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
writeFileSync(
  new URL('../public/lib/tvlogos.mjs', import.meta.url),
  `// Made by scripts/tv-logos.mjs: each symbol's icon on TradingView's logo
// CDN (a company's, a fund's issuer's, a coin's, a metal's or crop's, an
// index's; "a|b" is a currency pair's two flags). Don't edit by hand; run
// the script again.
export const TV_LOGOS = {
${body}
};
// TradingView's Taiwan and Hong Kong flags are blank tiles: flagcdn's instead.
const OWN_FLAGS = { 'country/TW': 'https://flagcdn.com/tw.svg', 'country/HK': 'https://flagcdn.com/hk.svg' };
const tvUrl = id => OWN_FLAGS[id] || \`https://s3-symbol-logo.tradingview.com/\${id}.svg\`;
// The symbol's icon URLs: one, or two for a pair (base first).
export const tvLogos = symbol => (TV_LOGOS[symbol] ? TV_LOGOS[symbol].split('|').map(tvUrl) : null);
`
);
console.log(`${Object.keys(out).length} logos; none for ${missing.length}: ${missing.join(' ')}`);
