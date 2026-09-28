// Prices from Yahoo Finance's public endpoints, fetched through the shared
// Worker (Yahoo sends no CORS headers). Quotes come 20 to a request from
// /v7/finance/spark (with the day's price line), charts, dividends and
// splits from /v8/finance/chart, and symbol search from /v1/finance/search.
import { BASE, METALS, GRAMS_PER_OUNCE, kindOf, marketOf, normalizeCurrency } from './markets.mjs';
import { BONDS, ISSUERS, CURVE_SYMBOLS, bondQuote, bondLine, curveOf } from './bonds.mjs';

export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev';
const YAHOO = 'https://query1.finance.yahoo.com';
const SPARK_BATCH = 20;

// The proxy answers signed-in apps only: the Quadra session (quadra.mjs)
// supplies the token.
let session = null;
export const useSession = s => (session = s);

export function proxied(url, token = session?.token || '') {
  return `${PROXY_URL}/sports-proxy?url=${encodeURIComponent(url)}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
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
        const token = session ? await session.ensureToken().catch(() => session.token) : '';
        const res = await fetch(proxied(url, token), { signal: AbortSignal.timeout(15_000) });
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
  const q = r.indicators?.quote?.[0] || {};
  const bars = [];
  // Closes with dividends added back (Yahoo's adjusted close): what holding
  // it and reinvesting every dividend would have made.
  const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
  const adjusted = [];
  for (let i = 0; i < (r.timestamp || []).length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if ([o, h, l, c].every(Number.isFinite)) bars.push({ t: r.timestamp[i] * 1000, o: o / factor, h: h / factor, l: l / factor, c: c / factor, v: q.volume?.[i] || 0 });
    if (Number.isFinite(adj[i])) adjusted.push([r.timestamp[i] * 1000, adj[i] / factor]);
  }
  const dividends = Object.values(r.events?.dividends || {})
    .map(d => ({ date: d.date * 1000, amount: d.amount / factor }))
    .sort((a, b) => a.date - b.date);
  const splits = Object.values(r.events?.splits || {})
    .filter(s => s.numerator > 0 && s.denominator > 0)
    .map(s => ({ date: s.date * 1000, ratio: s.numerator / s.denominator }))
    .sort((a, b) => a.date - b.date);
  return { quote, points: quote.line, bars, adjusted, dividends, splits };
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
    } else if (BONDS[s]) {
      if (BONDS[s].live) for (const c of CURVE_SYMBOLS) set.add(c);
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
  for (const s of symbols) if (BONDS[s]) {
    const q = liveBondQuote(s, out);
    if (q) out.set(s, q);
  }
  if (failed && failed === batches.length) throw new Error('quotes unavailable');
  return out;
}

// Today's quote for a bond: the live curve (and yesterday's, for the day's
// change) or the reference one, with today's price line from the curve's.
function liveBondQuote(symbol, quotes) {
  const bond = BONDS[symbol];
  const now = Date.now();
  if (!bond.live) {
    const q = bondQuote(bond, curveOf(bond.issuer), null, now);
    return q && { ...q, line: bondLine(bond, [now - 86_400_000, now], () => curveOf(bond.issuer)) };
  }
  const curve = curveOf(bond.issuer, quotes);
  if (!curve) return null;
  const q = bondQuote(bond, curve, curveOf(bond.issuer, quotes, x => x.prev), now);
  const lines = ISSUERS[bond.issuer].live.map(([years, sym]) => [years, quotes.get(sym)?.line || []]);
  const times = lines.find(([y]) => y === 10)?.[1].map(p => p[0]) || [];
  return { ...q, line: bondLine(bond, times, t => curveFromLines(lines, t)) };
}

// The curve at moment `t` from each point's history (its latest value at or
// before `t`).
function curveFromLines(lines, t) {
  const pts = [];
  for (const [years, line] of lines) {
    let v = null;
    for (const [tt, c] of line) {
      if (tt > t) break;
      v = c;
    }
    if (v === null && line.length) v = line[0][1];
    if (Number.isFinite(v)) pts.push([years, v]);
  }
  return pts.length ? pts : null;
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
  if (BONDS[symbol]) {
    const bond = BONDS[symbol];
    const quote = (await fetchQuotes([symbol]).catch(() => new Map())).get(symbol) || null;
    let lines;
    if (bond.live) {
      const charts = await Promise.all(ISSUERS[bond.issuer].live.map(([, sym]) => fetchChart(sym, rangeKey).catch(() => null)));
      lines = ISSUERS[bond.issuer].live.map(([years], i) => [years, charts[i]?.points || []]);
    }
    const ref = lines?.find(([y]) => y === 10)?.[1] || [];
    const span = { '1d': 1, '5d': 5, '1mo': 30, '6mo': 182, ytd: 270, '1y': 365, '5y': 1826, max: 3650 }[rangeKey] || 30;
    const times = ref.length ? ref.map(p => p[0]) : Array.from({ length: 60 }, (_, i) => Date.now() - ((59 - i) / 59) * span * 86_400_000);
    const points = bondLine(bond, times, t => (bond.live ? curveFromLines(lines, t) : curveOf(bond.issuer)));
    return { quote, points, bars: [], dividends: [], splits: [] };
  }
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

// Price bars since `since`, as fine as Yahoo keeps them: 5 minutes for the
// last few days, 30 minutes for a month, an hour for two years, days after.
export async function fetchBars(symbol, since) {
  const age = Date.now() - since;
  const day = 86_400_000;
  const [range, interval] = age < 5 * day ? ['5d', '5m'] : age < 28 * day ? ['1mo', '30m'] : age < 700 * day ? ['2y', '1h'] : ['max', '1d'];
  if (METALS[symbol]) {
    const [future, usd] = await Promise.all([fetchBars(METALS[symbol].future, since), fetchBars(fxSymbol('USD'), since)]);
    let j = 0;
    return future.map(b => {
      while (j + 1 < usd.length && usd[j + 1].t <= b.t) j++;
      const k = (usd[j]?.c ?? 0) / GRAMS_PER_OUNCE;
      return { t: b.t, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k };
    }).filter(b => b.c > 0);
  }
  const json = await getJson(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  return parseChart(json)?.bars || [];
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

// A company's or fund's numbers from Yahoo's quoteSummary (the Worker adds
// the session Yahoo asks for): for a stock its P/E, EPS, market value,
// dividend yield and what it does; for a fund its fees, size, yield and
// biggest holdings. Missing numbers are null.
const raw = x => (x && typeof x === 'object' ? (Number.isFinite(x.raw) ? x.raw : null) : Number.isFinite(x) ? x : null);
export function parseFundamentals(json) {
  const r = json?.quoteSummary?.result?.[0];
  if (!r) return null;
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  const ap = r.assetProfile || {};
  const fp = r.fundProfile || {};
  const th = r.topHoldings || {};
  const ce = r.calendarEvents || {};
  const er = r.earnings || {};
  const currency = sd.currency || fd.financialCurrency || null;
  const { factor } = normalizeCurrency(currency || 'USD');
  const money = x => (raw(x) == null ? null : raw(x) / factor);
  const out = {
    currency: currency ? normalizeCurrency(currency).currency : null,
    marketCap: money(sd.marketCap),
    pe: raw(sd.trailingPE),
    forwardPe: raw(sd.forwardPE),
    eps: money(ks.trailingEps),
    pb: raw(ks.priceToBook),
    dividendYield: raw(sd.dividendYield) ?? raw(sd.yield) ?? raw(sd.trailingAnnualDividendYield),
    beta: raw(sd.beta) ?? raw(ks.beta3Year),
    margin: raw(fd.profitMargins) ?? raw(ks.profitMargins),
    roe: raw(fd.returnOnEquity),
    growth: raw(fd.revenueGrowth),
    revenue: raw(fd.totalRevenue),
    debtToEquity: raw(fd.debtToEquity),
    sector: ap.sector || null,
    industry: ap.industry || null,
    country: ap.country || null,
    employees: raw(ap.fullTimeEmployees),
    website: /^https?:\/\//.test(ap.website || '') ? ap.website : null,
    summary: ap.longBusinessSummary || null,
    // Funds.
    family: fp.family || ks.fundFamily || null,
    category: fp.categoryName || ks.category || null,
    expenseRatio: raw(fp.feesExpensesInvestment?.annualReportExpenseRatio) ?? raw(ks.annualReportExpenseRatio) ?? raw(ks.netExpenseRatio),
    totalAssets: money(sd.totalAssets) ?? money(ks.totalAssets),
    inception: raw(ks.fundInceptionDate) ? raw(ks.fundInceptionDate) * 1000 : null,
    holdings: (th.holdings || []).map(h => ({ symbol: h.symbol || '', name: h.holdingName || h.symbol || '', weight: raw(h.holdingPercent) })).filter(h => h.weight > 0).slice(0, 10),
    // More of a company: margins, cash and debt, dividends, what analysts
    // expect, dates coming up, the last four years and quarters.
    grossMargin: raw(fd.grossMargins),
    operatingMargin: raw(fd.operatingMargins),
    earningsGrowth: raw(fd.earningsGrowth),
    // Company-wide amounts are in its reporting currency, not in pence.
    cash: raw(fd.totalCash),
    debt: raw(fd.totalDebt),
    freeCashflow: raw(fd.freeCashflow),
    dividendRate: money(sd.dividendRate),
    payoutRatio: raw(sd.payoutRatio),
    // Yahoo gives the 5-year average yield in percent (1.67 = 1.67%).
    avgYield5: raw(sd.fiveYearAvgDividendYield) != null ? raw(sd.fiveYearAvgDividendYield) / 100 : null,
    change52: raw(ks['52WeekChange']),
    sp52: raw(ks.SandP52WeekChange),
    target: raw(fd.targetMeanPrice) != null ? { mean: money(fd.targetMeanPrice), high: money(fd.targetHighPrice), low: money(fd.targetLowPrice), analysts: raw(fd.numberOfAnalystOpinions), rating: fd.recommendationKey || null } : null,
    earningsDate: raw(ce.earnings?.earningsDate?.[0]) ? raw(ce.earnings.earningsDate[0]) * 1000 : null,
    exDividendDate: raw(ce.exDividendDate) ? raw(ce.exDividendDate) * 1000 : raw(sd.exDividendDate) ? raw(sd.exDividendDate) * 1000 : null,
    ceo: (ap.companyOfficers || []).find(o => /CEO|Chief Executive/i.test(o.title || ''))?.name?.replace(/\s+/g, ' ').replace(/^(Mr|Ms|Mrs|Dr)\.\s*/, '') || null,
    city: ap.city || null,
    yearly: (er.financialsChart?.yearly || []).map(y => ({ label: String(y.date), revenue: raw(y.revenue), earnings: raw(y.earnings) })).filter(y => y.revenue != null),
    quarterly: (er.financialsChart?.quarterly || []).map(y => ({ label: y.date, revenue: raw(y.revenue), earnings: raw(y.earnings) })).filter(y => y.revenue != null),
    reportCurrency: er.financialCurrency || fd.financialCurrency || null,
    // Funds: past returns and what's inside.
    ytd: raw(ks.ytdReturn),
    return3y: raw(ks.threeYearAverageReturn),
    return5y: raw(ks.fiveYearAverageReturn),
    sectors: (th.sectorWeightings || []).map(x => Object.entries(x)[0]).map(([k, v]) => ({ id: k, weight: raw(v) })).filter(x => x.weight > 0.0005).sort((a, b) => b.weight - a.weight),
    mix: raw(th.stockPosition) != null ? { stock: raw(th.stockPosition), bond: raw(th.bondPosition) || 0, cash: raw(th.cashPosition) || 0, other: raw(th.otherPosition) || 0 } : null
  };
  return out;
}

export async function fetchFundamentals(symbol) {
  const modules = 'assetProfile,summaryDetail,defaultKeyStatistics,financialData,fundProfile,topHoldings,calendarEvents,earnings';
  return parseFundamentals(await getJson(`${YAHOO}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`));
}

// Recent news headlines about a symbol (Yahoo's search; English sources).
export function parseNews(json) {
  return (json?.news || [])
    .filter(n => n.title && /^https:\/\//.test(n.link || ''))
    .map(n => ({ title: n.title, publisher: n.publisher || '', link: n.link, t: (n.providerPublishTime || 0) * 1000 }))
    .sort((a, b) => b.t - a.t);
}
export async function fetchNews(query) {
  const q = String(query || '').trim();
  if (!q || /[^\x20-\x7e]/.test(q)) return [];
  return parseNews(await getJson(`${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=6&listsCount=0`));
}
