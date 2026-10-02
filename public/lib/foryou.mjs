// For you: what to look at next, from what the person holds, watches, opens
// and trades, ranked by the shared engine (quadra.mjs's rank: decaying
// affinity across every Quadra app, diversity, a little exploration).
//
// Candidates are the catalog's tradable things. Each carries the keys it's
// about (its symbol, list, kind, market) and a quality from the market
// today and what the portfolio lacks:
//   - diversification: a kind or market the portfolio has nothing in (only
//     Taiwan stocks: a world ETF, bonds) weighs more;
//   - income: dividend ETFs, for someone who holds dividend ETFs;
//   - movement: a big move today is worth a look;
//   - popularity: a small prior for the well-known names.
// Held and watched symbols are left out (they're on the portfolio already).
import { CATEGORIES, catalogInfo } from './catalog.mjs';
import { rank } from './quadra.mjs';

// The well-known names, a prior for new accounts.
export const POPULAR = ['2330.TW', '0050.TW', '0056.TW', '00878.TW', '2317.TW', '2454.TW', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'VOO', 'QQQ', 'VT', 'SCHD', 'BTC-USD', 'ETH-USD', 'XAU', 'TLT', '006208.TW', '00919.TW', 'AMZN', 'GOOGL', 'META', 'TSM'];
const INCOME = new Set(['0056.TW', '00878.TW', '00919.TW', '00929.TW', '00940.TW', '00713.TW', 'SCHD', 'VYM', 'HYG', 'LQD', 'BND']);
// Watch-only lists are no recommendation.
const SKIP = new Set(['index', 'fx']);
// What fills a gap: for each kind the portfolio lacks, one broad way in.
const GAP = { etf: ['VT', '0050.TW', 'VOO'], bond: ['BND', 'TLT', '00679B.TWO'], metal: ['XAU', 'GLD'], crypto: ['BTC-USD'] };

export function candidates() {
  const out = [];
  for (const c of CATEGORIES) {
    if (SKIP.has(c.id)) continue;
    for (const [symbol] of c.items) out.push(symbol);
  }
  return [...new Set(out)];
}

// The symbols worth a quote for the section: the popular ones, and the
// lists the person is into (at most `max`).
export function wantedSymbols({ aff = {}, held = [], watched = [], max = 80 } = {}) {
  const lists = new Map();
  for (const [k, v] of Object.entries(aff)) if (k.startsWith('cat:')) lists.set(k.slice(4), (lists.get(k.slice(4)) || 0) + v);
  for (const s of [...held, ...watched]) {
    const cat = catalogInfo(s)?.category;
    if (cat) lists.set(cat, (lists.get(cat) || 0) + 2);
  }
  const top = [...lists].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const out = new Set(POPULAR);
  for (const gap of Object.values(GAP)) for (const s of gap) out.add(s);
  for (const id of top) for (const [s] of CATEGORIES.find(c => c.id === id)?.items || []) out.add(s);
  return [...out].slice(0, max);
}

// [{ symbol, why: { key, what } }], best first.
export function forYou({ quotes, held = [], watched = [], wallet = null, aff, n = 10, now = Date.now() }) {
  const own = new Set([...held, ...watched]);
  const heldKinds = new Set(held.map(s => quotes.get(s)?.kind || catalogInfo(s)?.kind).filter(Boolean));
  const heldCats = new Set(held.map(s => catalogInfo(s)?.category).filter(Boolean));
  const holdsIncome = held.some(s => INCOME.has(s));
  // A holding's peers: the same list (the biggest holding's name, for the reason).
  const peerOf = new Map();
  for (const s of held) {
    const cat = catalogInfo(s)?.category;
    if (cat && !peerOf.has(cat)) peerOf.set(cat, s);
  }
  const heldMarkets = new Set(held.map(s => quotes.get(s)?.market).filter(Boolean));
  const items = [];
  for (const symbol of candidates()) {
    if (own.has(symbol)) continue;
    const q = quotes.get(symbol);
    if (!q) continue;
    const info = catalogInfo(symbol);
    const kind = q.kind || info?.kind || 'stock';
    let quality = 0.35;
    let reason = null;
    const gapKind = Object.entries(GAP).find(([k, list]) => list.includes(symbol) && held.length && !heldKinds.has(k === 'etf' ? 'etf' : k));
    if (gapKind) {
      quality += 0.35;
      reason = { key: 'whyDiversify', what: gapKind[0] };
    }
    if (holdsIncome && INCOME.has(symbol)) {
      quality += 0.2;
      reason ||= { key: 'whyIncome' };
    }
    const move = Math.abs(q.pct || 0);
    if (move > 0.03) {
      quality += Math.min(0.2, move * 2);
      reason ||= { key: 'whyMover' };
    }
    if (POPULAR.includes(symbol)) quality += 0.12 * (1 - POPULAR.indexOf(symbol) / POPULAR.length);
    if (info?.category && heldCats.has(info.category)) {
      quality += 0.12;
      reason ||= { key: 'whyPeer', what: peerOf.get(info.category) };
    }
    // A pullback in a well-known name: down 3% or more today.
    if (POPULAR.includes(symbol) && (q.pct || 0) <= -0.03) {
      quality += 0.1;
      reason = { key: 'whyDip' };
    }
    // A market the person holds nothing in yet, once they hold something.
    if (held.length && q.market && !heldMarkets.has(q.market) && ['US', 'TW'].includes(q.market)) quality += 0.08;
    items.push({
      id: `stock:${symbol}`,
      symbol,
      keys: [`sym:${symbol}`, info?.category ? `cat:${info.category}` : null, `kind:${kind}`, q.market ? `mkt:${q.market}` : null].filter(Boolean),
      quality: Math.min(1, quality),
      group: `${q.market || ''}:${info?.category || kind}`,
      reason
    });
  }
  // Never one market only: at most 60% from any one.
  const ranked = rank(items, { wallet, n: n * 3, now, diversity: 0.45, ...(aff ? { aff } : {}) });
  const cap = Math.max(2, Math.ceil(n * 0.6));
  const per = new Map();
  const out = [];
  for (const item of ranked) {
    const m = quotes.get(item.symbol)?.market || '';
    if ((per.get(m) || 0) >= cap) continue;
    per.set(m, (per.get(m) || 0) + 1);
    out.push(item);
    if (out.length >= n) break;
  }
  return out.map(item => ({ symbol: item.symbol, why: whyOf(item) }));
}

function whyOf(item) {
  // What the portfolio itself says comes first (a peer, a gap, income, a dip).
  if (['whyPeer', 'whyDiversify', 'whyIncome', 'whyDip'].includes(item.reason?.key)) return item.reason;
  const k = item.why || '';
  if (k.startsWith('cat:')) return { key: 'whySector', what: k.slice(4) };
  if (k.startsWith('mkt:')) return { key: 'whyMarket' };
  if (k.startsWith('sym:')) return { key: 'whyWatched' };
  if (k.startsWith('kind:')) return { key: 'whySector', what: k.slice(5) };
  return item.reason || (POPULAR.includes(item.symbol) ? { key: 'whyPopular' } : { key: 'whyNew' });
}

// 今日漲跌's markets: Taiwan, the US, crypto, and the rest of the world.
export const MOVER_GROUPS = ['tw', 'us', 'crypto', 'world'];
export const moverGroupOf = q => (q.market === 'TW' ? 'tw' : q.market === 'US' ? 'us' : q.market === 'CRYPTO' || q.kind === 'crypto' ? 'crypto' : ['FX', 'BOND', 'METAL'].includes(q.market) ? null : 'world');
// The market worth showing first: the one trading now (Taiwan by day in
// Taipei, the US by night), else the last one that did.
export function moverGroupNow(now = Date.now()) {
  const tpe = new Date(now + 8 * 3_600_000);
  const h = tpe.getUTCHours() + tpe.getUTCMinutes() / 60;
  const day = tpe.getUTCDay();
  if (day === 0 || day === 6) return 'us';
  return h >= 7 && h < 20 ? 'tw' : 'us';
}

// Today's biggest movers among the quotes on hand (tradable ones only), of
// one market group (or all).
export function movers(quotes, { up = true, n = 6, group = null } = {}) {
  const list = candidates()
    .map(s => quotes.get(s))
    .filter(q => q && Number.isFinite(q.pct) && q.kind !== 'fx' && (!group || moverGroupOf(q) === group));
  return list.sort((a, b) => (up ? b.pct - a.pct : a.pct - b.pct)).slice(0, n).filter(q => (up ? q.pct > 0 : q.pct < 0));
}
