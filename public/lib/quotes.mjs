// Prices from Yahoo Finance's public endpoints, fetched through the shared
// Worker (Yahoo sends no CORS headers). Quotes come 20 to a request from
// /v7/finance/spark (with the day's price line), charts, dividends and
// splits from /v8/finance/chart, and symbol search from /v1/finance/search.
import { BASE, METALS, GRAMS_PER_OUNCE, kindOf, marketOf, normalizeCurrency } from './markets.mjs';

export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev';
const YAHOO = 'https://query1.finance.yahoo.com';
const SPARK_BATCH = 20;

export function proxied(url) {
  return `${PROXY_URL}/sports-proxy?url=${encodeURIComponent(url)}`;
}

// At most this many requests at once, and one retry for a failed one.
const MAX_CONCURRENT = 4;
let running = 0;
const waiting = [];
async function slot(task) {
  if (running >= MAX_CONCURRENT) await new Promise(resolve => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function getJson(url) {
  return slot(async () => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(proxied(url), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  });
}

// The FX symbol for a currency's price in NT$ (USDTWD=X: NT$ per US$).
export const fxSymbol = currency => `${currency}${BASE}=X`;

// One quote from a spark or chart response: meta plus the price line.
export function quoteFromMeta(meta, timestamps = [], closes = [], hint = {}) {
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) return null;
  const { currency, factor } = normalizeCurrency(meta.currency);
  const symbol = meta.symbol;
  const kind = kindOf(meta.instrumentType, symbol, hint.kind);
  const price = meta.regularMarketPrice / factor;
  const prev = (meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice) / factor;
  const line = [];
  for (let i = 0; i < closes.length; i++) if (Number.isFinite(closes[i])) line.push([timestamps[i] * 1000, closes[i] / factor]);
  const period = meta.currentTradingPeriod?.regular;
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol,
    shortName: meta.shortName || meta.longName || symbol,
    kind,
    market: marketOf(symbol, kind),
    currency,
    price,
    prev,
    change: price - prev,
    pct: prev ? price / prev - 1 : 0,
    dayHigh: Number.isFinite(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh / factor : null,
    dayLow: Number.isFinite(meta.regularMarketDayLow) ? meta.regularMarketDayLow / factor : null,
    high52: Number.isFinite(meta.fiftyTwoWeekHigh) ? meta.fiftyTwoWeekHigh / factor : null,
    low52: Number.isFinite(meta.fiftyTwoWeekLow) ? meta.fiftyTwoWeekLow / factor : null,
    volume: meta.regularMarketVolume ?? null,
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    tz: meta.exchangeTimezoneName || 'UTC',
    marketTime: (meta.regularMarketTime || 0) * 1000,
    session: period ? { start: period.start * 1000, end: period.end * 1000 } : null,
    line
  };
}

export function parseSpark(json) {
  const out = new Map();
  for (const item of json?.spark?.result || []) {
    const r = item.response?.[0];
    const q = r && quoteFromMeta(r.meta, r.timestamp || [], r.indicators?.quote?.[0]?.close || []);
    if (q) out.set(item.symbol, { ...q, symbol: item.symbol });
  }
  return out;
}

export function parseChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r) return null;
  const quote = quoteFromMeta(r.meta, r.timestamp || [], r.indicators?.quote?.[0]?.close || []);
  if (!quote) return null;
  const { factor } = normalizeCurrency(r.meta.currency);
  const dividends = Object.values(r.events?.dividends || {})
    .map(d => ({ date: d.date * 1000, amount: d.amount / factor }))
    .sort((a, b) => a.date - b.date);
  const splits = Object.values(r.events?.splits || {})
    .filter(s => s.numerator > 0 && s.denominator > 0)
    .map(s => ({ date: s.date * 1000, ratio: s.numerator / s.denominator }))
    .sort((a, b) => a.date - b.date);
  return { quote, points: quote.line, dividends, splits };
}

// A passbook metal: the future's US$ per troy ounce, in NT$ per gram.
export function metalQuote(symbol, future, usd) {
  if (!future || !usd) return null;
  const k = usd.price / GRAMS_PER_OUNCE;
  const kPrev = usd.prev / GRAMS_PER_OUNCE;
  const info = METALS[symbol];
  const price = future.price * k;
  const prev = future.prev * kPrev;
  return {
    ...future,
    symbol,
    name: info.en,
    shortName: info.en,
    kind: 'metal',
    market: 'METAL',
    currency: BASE,
    price,
    prev,
    change: price - prev,
    pct: prev ? price / prev - 1 : 0,
    dayHigh: future.dayHigh && future.dayHigh * k,
    dayLow: future.dayLow && future.dayLow * k,
    high52: future.high52 && future.high52 * k,
    low52: future.low52 && future.low52 * k,
    exchange: 'COMEX × USD/TWD',
    line: future.line.map(([t, c]) => [t, c * k])
  };
}

// The symbols to ask Yahoo for: passbooks need their future and US$.
function upstreamSymbols(symbols) {
  const set = new Set();
  for (const s of symbols) {
    if (METALS[s]) {
      set.add(METALS[s].future);
      set.add(fxSymbol('USD'));
    } else if (s !== BASE) set.add(s);
  }
  return [...set];
}

// Latest quotes for these symbols (with today's price line), as a Map.
// Symbols Yahoo doesn't know are simply missing.
export async function fetchQuotes(symbols, { range = '1d', interval = '5m' } = {}) {
  const wanted = upstreamSymbols(symbols).sort();
  const batches = [];
  for (let i = 0; i < wanted.length; i += SPARK_BATCH) batches.push(wanted.slice(i, i + SPARK_BATCH));
  const results = await Promise.allSettled(
    batches.map(batch =>
      getJson(`${YAHOO}/v7/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=${range}&interval=${interval}`)
    )
  );
  const out = new Map();
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') for (const [k, v] of parseSpark(r.value)) out.set(k, v);
    else failed++;
  }
  for (const s of symbols) if (METALS[s]) {
    const q = metalQuote(s, out.get(METALS[s].future), out.get(fxSymbol('USD')));
    if (q) out.set(s, q);
  }
  if (failed && failed === batches.length) throw new Error('quotes unavailable');
  return out;
}

// Chart ranges: [range, interval].
export const RANGES = {
  '1d': ['1d', '5m'],
  '5d': ['5d', '30m'],
  '1mo': ['1mo', '1d'],
  '6mo': ['6mo', '1d'],
  ytd: ['ytd', '1d'],
  '1y': ['1y', '1d'],
  '5y': ['5y', '1wk'],
  max: ['max', '1mo']
};

export async function fetchChart(symbol, rangeKey = '1mo', { events = false } = {}) {
  const [range, interval] = RANGES[rangeKey] || RANGES['1mo'];
  if (METALS[symbol]) {
    const [future, usd] = await Promise.all([fetchChart(METALS[symbol].future, rangeKey), fetchChart(fxSymbol('USD'), rangeKey)]);
    if (!future || !usd) return null;
    // Each point at the US$ rate of its day (the nearest earlier FX point).
    let j = 0;
    const points = future.points.map(([t, c]) => {
      while (j + 1 < usd.points.length && usd.points[j + 1][0] <= t) j++;
      return [t, (c * (usd.points[j]?.[1] ?? usd.quote.price)) / GRAMS_PER_OUNCE];
    });
    const quote = metalQuote(symbol, future.quote, usd.quote);
    return { quote, points, dividends: [], splits: [] };
  }
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}${events ? '&events=div%2Csplit' : ''}`;
  return parseChart(await getJson(url));
}

// Dividends and splits since `since` (ms): the account credits them.
export async function fetchCorporateActions(symbol, since) {
  const years = (Date.now() - since) / (365.25 * 86_400_000);
  const range = years < 0.9 ? '1y' : years < 4.5 ? '5y' : 'max';
  const [r, interval] = [range, range === 'max' ? '1mo' : range === '5y' ? '1wk' : '1d'];
  const json = await getJson(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${interval}&events=div%2Csplit`);
  const chart = parseChart(json);
  return chart ? { dividends: chart.dividends, splits: chart.splits } : { dividends: [], splits: [] };
}

// Search Yahoo by symbol or English name. Options and the like are dropped.
const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'CRYPTOCURRENCY', 'INDEX', 'FUTURE', 'CURRENCY']);
export function parseSearch(json) {
  return (json?.quotes || [])
    .filter(q => q.symbol && SEARCH_TYPES.has(q.quoteType))
    .map(q => {
      const kind = kindOf(q.quoteType, q.symbol);
      return {
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        kind,
        market: marketOf(q.symbol, kind),
        exchange: q.exchDisp || q.exchange || ''
      };
    });
}

export async function searchSymbols(query) {
  const q = String(query || '').trim();
  // Yahoo's search takes Latin letters and digits only (Chinese is refused).
  if (!q || /[^\x20-\x7e]/.test(q)) return [];
  return parseSearch(await getJson(`${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`));
}
