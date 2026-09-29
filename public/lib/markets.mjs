// Currencies, markets, what kind of thing a symbol is, and what trading it
// costs. Everything the account needs to know about a place to trade, in one
// table each, so the guide can show the very numbers the orders use.

// Wallet currencies. `spread`: what a Taiwan bank's online FX desk keeps on
// each exchange, as a share of the amount (the gap between its buy and sell
// rates, halved). `loanRate`: yearly interest on money borrowed in it.
import { isTradingDay } from './holidays.mjs';

export const CURRENCIES = {
  TWD: { symbol: 'NT$', digits: 0, spread: 0, loanRate: 0.065, zh: '新台幣', en: 'Taiwan dollar', flag: '🇹🇼' },
  USD: { symbol: 'US$', digits: 2, spread: 0.002, loanRate: 0.075, zh: '美元', en: 'US dollar', flag: '🇺🇸' },
  JPY: { symbol: '¥', digits: 0, spread: 0.003, loanRate: 0.03, zh: '日圓', en: 'Japanese yen', flag: '🇯🇵' },
  HKD: { symbol: 'HK$', digits: 2, spread: 0.003, loanRate: 0.07, zh: '港幣', en: 'Hong Kong dollar', flag: '🇭🇰' },
  CNY: { symbol: 'CN¥', digits: 2, spread: 0.004, loanRate: 0.05, zh: '人民幣', en: 'Chinese yuan', flag: '🇨🇳' },
  KRW: { symbol: '₩', digits: 0, spread: 0.008, loanRate: 0.06, zh: '韓元', en: 'Korean won', flag: '🇰🇷' },
  EUR: { symbol: '€', digits: 2, spread: 0.003, loanRate: 0.06, zh: '歐元', en: 'Euro', flag: '🇪🇺' },
  GBP: { symbol: '£', digits: 2, spread: 0.0035, loanRate: 0.07, zh: '英鎊', en: 'British pound', flag: '🇬🇧' },
  CHF: { symbol: 'CHF ', digits: 2, spread: 0.0035, loanRate: 0.04, zh: '瑞士法郎', en: 'Swiss franc', flag: '🇨🇭' },
  // Yahoo has no DKK/TWD pair: priced through US$ (USDDKK=X).
  DKK: { cross: true, symbol: 'kr ', digits: 2, spread: 0.005, loanRate: 0.06, zh: '丹麥克朗', en: 'Danish krone', flag: '🇩🇰' },
  CAD: { symbol: 'C$', digits: 2, spread: 0.0035, loanRate: 0.065, zh: '加幣', en: 'Canadian dollar', flag: '🇨🇦' },
  AUD: { symbol: 'A$', digits: 2, spread: 0.0035, loanRate: 0.07, zh: '澳幣', en: 'Australian dollar', flag: '🇦🇺' },
  SGD: { symbol: 'S$', digits: 2, spread: 0.0035, loanRate: 0.055, zh: '新加坡幣', en: 'Singapore dollar', flag: '🇸🇬' },
  INR: { symbol: '₹', digits: 2, spread: 0.01, loanRate: 0.1, zh: '印度盧比', en: 'Indian rupee', flag: '🇮🇳' }
};
export const BASE = 'TWD';
// A currency not in the table (a stock found by search trades in it) still
// works: its rate comes from the same feed, at a wider spread.
const OTHER_CURRENCY = { digits: 2, spread: 0.01, loanRate: 0.1, flag: '🏳️' };

export function currencyInfo(code) {
  return CURRENCIES[code] || { ...OTHER_CURRENCY, symbol: `${code} `, zh: code, en: code };
}

// Weekends and other hours the FX market is shut, banks still exchange, at
// twice their usual spread (they can't hedge until it reopens).
export const CLOSED_FX_MULTIPLIER = 2;

// Yahoo quotes some markets in a minor unit (London in pence, US grain and
// coffee futures in cents).
const MINOR_UNITS = { GBp: ['GBP', 100], GBX: ['GBP', 100], USX: ['USD', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };
export function normalizeCurrency(code) {
  const minor = MINOR_UNITS[code];
  return minor ? { currency: minor[0], factor: minor[1] } : { currency: code || 'USD', factor: 1 };
}

// Where each symbol trades and what it costs there. `commission`: the
// broker's cut both ways, with its minimum in the market's currency (Taiwan
// brokers' usual 0.1425%, their sub-brokerage 複委託 rates abroad). `buy` and
// `sell`: taxes and exchange fees by kind of security (`all` for every kind).
// `withholding`: tax kept from dividends paid to a Taiwan resident.
// `delay`: minutes Yahoo's prices from this market run behind (Yahoo's own
// exchangeDataDelayedBy): US stocks, forex and crypto are live; Taiwan,
// Tokyo, Seoul and Sydney 20 minutes; most others 15; unknown markets 15.
export const MARKETS = {
  TW: {
    delay: 20, zh: '台股', en: 'Taiwan', flag: '🇹🇼', currency: 'TWD', suffixes: ['.TW', '.TWO'],
    // Odd lots (零股): most brokers' minimum is NT$1, not 20. A stock sold the
    // day it was bought (當沖) pays half the tax, 0.15% (to 2027).
    commission: { rate: 0.001425, min: 20, oddMin: 1 }, floorFees: true,
    sell: { stock: { tax: 0.003, dayTrade: 0.0015 }, etf: { tax: 0.001 }, bond: { tax: 0 } },
    withholding: 0, nhi: true
  },
  US: {
    delay: 0, zh: '美股', en: 'US', flag: '🇺🇸', currency: 'USD', suffixes: [''],
    commission: { rate: 0.001, min: 3 },
    // The SEC's Section 31 fee on sales: US$20.60 per million from 2026-04-04.
    sell: { all: { fee: 0.0000206 } },
    withholding: 0.3
  },
  JP: { delay: 20, zh: '日股', en: 'Japan', flag: '🇯🇵', currency: 'JPY', suffixes: ['.T'], commission: { rate: 0.0025, min: 500 }, withholding: 0.15315 },
  HK: {
    delay: 15, zh: '港股', en: 'Hong Kong', flag: '🇭🇰', currency: 'HKD', suffixes: ['.HK'], commission: { rate: 0.0025, min: 100 },
    buy: { stock: { tax: 0.001, fee: 0.000085 }, all: { fee: 0.000085 } },
    sell: { stock: { tax: 0.001, fee: 0.000085 }, all: { fee: 0.000085 } },
    withholding: 0
  },
  CN: {
    delay: 15, zh: '陸股', en: 'China A-shares', flag: '🇨🇳', currency: 'CNY', suffixes: ['.SS', '.SZ'], commission: { rate: 0.003, min: 50 },
    sell: { stock: { tax: 0.0005 } }, withholding: 0.1
  },
  KR: {
    delay: 20, zh: '韓股', en: 'Korea', flag: '🇰🇷', currency: 'KRW', suffixes: ['.KS', '.KQ'], commission: { rate: 0.003, min: 5000 },
    // Securities transaction tax on sales, 0.20% on KOSPI and KOSDAQ from 2026
    // (the special tax for rural development included).
    sell: { stock: { tax: 0.002 } }, withholding: 0.22
  },
  UK: {
    delay: 15, zh: '英股', en: 'UK', flag: '🇬🇧', currency: 'GBP', suffixes: ['.L'], commission: { rate: 0.0025, min: 5 },
    buy: { stock: { tax: 0.005 } }, withholding: 0
  },
  FR: {
    delay: 15, zh: '法股', en: 'France', flag: '🇫🇷', currency: 'EUR', suffixes: ['.PA'], commission: { rate: 0.0025, min: 5 },
    buy: { stock: { tax: 0.004 } }, withholding: 0.25
  },
  DE: { delay: 15, zh: '德股', en: 'Germany', flag: '🇩🇪', currency: 'EUR', suffixes: ['.DE', '.F'], commission: { rate: 0.0025, min: 5 }, withholding: 0.26375 },
  NL: { delay: 0, zh: '荷股', en: 'Netherlands', flag: '🇳🇱', currency: 'EUR', suffixes: ['.AS'], commission: { rate: 0.0025, min: 5 }, withholding: 0.15 },
  IT: {
    delay: 15, zh: '義股', en: 'Italy', flag: '🇮🇹', currency: 'EUR', suffixes: ['.MI'], commission: { rate: 0.0025, min: 5 },
    buy: { stock: { tax: 0.001 } }, withholding: 0.26
  },
  ES: {
    delay: 15, zh: '西股', en: 'Spain', flag: '🇪🇸', currency: 'EUR', suffixes: ['.MC'], commission: { rate: 0.0025, min: 5 },
    buy: { stock: { tax: 0.002 } }, withholding: 0.19
  },
  // The Swiss transfer stamp duty: 0.15% on Swiss securities, half each side.
  CH: {
    delay: 15, zh: '瑞士股', en: 'Switzerland', flag: '🇨🇭', currency: 'CHF', suffixes: ['.SW'], commission: { rate: 0.0025, min: 5 },
    buy: { all: { tax: 0.00075 } }, sell: { all: { tax: 0.00075 } }, withholding: 0.35
  },
  DK: { delay: 0, zh: '丹麥股', en: 'Denmark', flag: '🇩🇰', currency: 'DKK', suffixes: ['.CO'], commission: { rate: 0.0025, min: 40 }, withholding: 0.27 },
  CA: { delay: 15, zh: '加股', en: 'Canada', flag: '🇨🇦', currency: 'CAD', suffixes: ['.TO', '.V'], commission: { rate: 0.0025, min: 5 }, withholding: 0.25 },
  AU: { delay: 20, zh: '澳股', en: 'Australia', flag: '🇦🇺', currency: 'AUD', suffixes: ['.AX'], commission: { rate: 0.0025, min: 5 }, withholding: 0.3 },
  SG: { delay: 10, zh: '星股', en: 'Singapore', flag: '🇸🇬', currency: 'SGD', suffixes: ['.SI'], commission: { rate: 0.0025, min: 5 }, withholding: 0 },
  IN: {
    delay: 15, zh: '印度股', en: 'India', flag: '🇮🇳', currency: 'INR', suffixes: ['.NS', '.BO'], commission: { rate: 0.003, min: 100 },
    // STT 0.1% both ways on delivery trades; stamp duty 0.015% on buys.
    buy: { all: { tax: 0.00115 } }, sell: { all: { tax: 0.001 } }, withholding: 0.2
  },
  CRYPTO: { delay: 0, zh: '加密貨幣', en: 'Crypto', flag: '🪙', currency: 'USD', suffixes: [], commission: { rate: 0.001, min: 0 }, withholding: 0 },
  // Gold and silver passbooks (黃金存摺): grams priced in NT$, bought at the
  // bank's selling price and sold at its buying price, no commission.
  METAL: { delay: 10, zh: '黃金存摺', en: 'Metal passbook', flag: '🥇', currency: 'TWD', suffixes: [], commission: { rate: 0, min: 0 }, spread: 0.006, withholding: 0 },
  // Government bonds, over the counter through a broker: a small commission
  // and the dealer's bid-ask spread. Coupon tax depends on the issuer
  // (bonds.mjs).
  BOND: { delay: 0, zh: '公債', en: 'Government bonds', flag: '🏛️', currency: null, suffixes: [], commission: { rate: 0.001, min: 0 }, spread: 0.0005, withholding: 0 },
  // Currency pairs (外匯): EUR/USD is bought and sold in US$, a unit per
  // euro. No commission; the dealer's spread each way, like a forex broker.
  FX: { delay: 0, zh: '外匯', en: 'Forex', flag: '💱', currency: null, suffixes: [], commission: { rate: 0, min: 0 }, spread: 0.0002, withholding: 0 },
  // Anywhere else search turns up: a generic sub-brokerage rate.
  INTL: { zh: '其他市場', en: 'Other markets', flag: '🌐', currency: null, suffixes: [], commission: { rate: 0.003, min: 0 }, withholding: 0.2 }
};

const SUFFIX_MARKET = Object.entries(MARKETS).flatMap(([id, m]) => m.suffixes.filter(Boolean).map(s => [s, id]));

// Days from a dividend's ex-date to the day the cash arrives, as each
// market usually pays: Taiwan about four weeks, the US about a week, Japan
// two to three months (after the shareholders' meeting), most of Europe
// within days.
export const DIV_PAY_DAYS = {
  TW: 28, US: 7, JP: 75, HK: 30, CN: 7, KR: 30, UK: 28, FR: 3, DE: 3, NL: 21, IT: 2, ES: 4, CH: 3, DK: 3, CA: 14, AU: 30, SG: 21, IN: 30
};
export const divPayDays = market => DIV_PAY_DAYS[market] ?? 21;

// Each market's own clock, for its days (settlement, lunch breaks, T+1).
export const MARKET_TZ = { TW: 'Asia/Taipei', US: 'America/New_York', JP: 'Asia/Tokyo', HK: 'Asia/Hong_Kong', CN: 'Asia/Shanghai', KR: 'Asia/Seoul', UK: 'Europe/London', FR: 'Europe/Paris', DE: 'Europe/Berlin', NL: 'Europe/Amsterdam', IT: 'Europe/Rome', ES: 'Europe/Madrid', CH: 'Europe/Zurich', DK: 'Europe/Copenhagen', CA: 'America/Toronto', AU: 'Australia/Sydney', SG: 'Asia/Singapore', IN: 'Asia/Kolkata', BOND: 'Asia/Taipei', METAL: 'Asia/Taipei' };
const tzOf = market => MARKET_TZ[market] || 'Asia/Taipei';
// A moment's local date and minutes after midnight in a market.
function localParts(t, market) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tzOf(market), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export const localDayOf = (t, market) => localParts(t, market).day;

// The price steps an exchange accepts, by price band:
// - Taiwan (TWSE/TPEx), ETFs finer;
// - US: a cent (a hundredth of a cent under US$1);
// - Hong Kong: the spread table (after the 2025 reduction);
// - Japan: the finer table of the large caps (TOPIX 500), which every
//   ordinary table's price also sits on;
// - Korea: the 2023 table, ETFs 5 won;
// - China A-shares: 0.01 yuan, funds 0.001.
// Other markets aren't checked.
const bands = (price, table) => table.find(([below]) => price < below)?.[1] ?? table.at(-1)[1];
export function tickSize(market, kind, price) {
  if (market === 'TW') {
    if (kind === 'etf' || kind === 'bond') return price < 50 ? 0.01 : 0.05;
    return price < 10 ? 0.01 : price < 50 ? 0.05 : price < 100 ? 0.1 : price < 500 ? 0.5 : price < 1000 ? 1 : 5;
  }
  if (market === 'US') return price < 1 ? 0.0001 : 0.01;
  if (market === 'HK')
    return bands(price, [[0.25, 0.001], [0.5, 0.005], [20, 0.01], [50, 0.02], [100, 0.05], [200, 0.1], [500, 0.2], [1000, 0.5], [2000, 1], [5000, 2], [Infinity, 5]]);
  if (market === 'JP') return bands(price, [[1000, 0.1], [3000, 0.5], [10000, 1], [30000, 5], [100000, 10], [300000, 50], [1000000, 100], [3000000, 500], [10000000, 1000], [30000000, 5000], [Infinity, 10000]]);
  if (market === 'KR') return kind === 'etf' ? 5 : bands(price, [[2000, 1], [5000, 5], [20000, 10], [50000, 50], [200000, 100], [500000, 500], [Infinity, 1000]]);
  if (market === 'CN') return kind === 'etf' ? 0.001 : 0.01;
  return null;
}
export const onTick = (price, tick) => !tick || Math.abs(price / tick - Math.round(price / tick)) < 1e-6;
export const toTick = (price, tick, dir = 0) => {
  if (!tick) return price;
  const f = dir > 0 ? Math.ceil : dir < 0 ? Math.floor : Math.round;
  return +(f(price / tick - (dir > 0 ? 1e-9 : dir < 0 ? -1e-9 : 0)) * tick).toFixed(6);
};

// Daily price limits: how far from yesterday's close a price may go.
// Taiwan ±10%; mainland China ±10% (±20% on the STAR Market, 688xxx, and
// ChiNext, 300xxx/301xxx); Korea ±30%; Japan a fixed yen amount by price
// band. Orders outside them are refused by the exchange.
const JP_LIMITS = [[100, 30], [200, 50], [500, 80], [700, 100], [1000, 150], [1500, 300], [2000, 400], [3000, 500], [5000, 700], [7000, 1000], [10000, 1500], [15000, 3000], [20000, 4000], [30000, 5000], [50000, 7000], [70000, 10000], [100000, 15000], [150000, 30000], [200000, 40000], [300000, 50000], [500000, 70000], [700000, 100000], [1000000, 150000], [Infinity, 300000]];
export function limitShare(quote) {
  if (!quote || !['stock', 'etf', 'bond'].includes(quote.kind)) return null;
  if (quote.market === 'TW') return 0.1;
  if (quote.market === 'KR') return 0.3;
  if (quote.market === 'CN') return /^(688|300|301)\d{3}\./.test(quote.symbol || '') ? 0.2 : 0.1;
  return null;
}
export function priceLimits(quote) {
  if (!(quote?.prev > 0)) return null;
  const tick = x => tickSize(quote.market, quote.kind, x);
  if (quote.market === 'JP' && quote.kind === 'stock') {
    const w = bands(quote.prev, JP_LIMITS);
    return { up: quote.prev + w, down: Math.max(tick(1), quote.prev - w) };
  }
  const share = limitShare(quote);
  if (!share) return null;
  const up = quote.prev * (1 + share);
  const down = quote.prev * (1 - share);
  return { up: toTick(up, tick(up), -1), down: toTick(down, tick(down), 1) };
}

// Board lots: the smallest amount the exchange trades. Japan trades every
// stock in units of 100; mainland China buys in 100s (an odd remainder can
// only be sold whole); Hong Kong's lot is each stock's own (the listed ones
// here, from HKEX; others unchecked). Taiwan has its odd-lot session, and
// Singapore its unit-share market, so any number goes there.
const HK_LOTS = { '0700.HK': 100, '9988.HK': 100, '3690.HK': 100, '1810.HK': 200, '9618.HK': 50, '1211.HK': 500, '0005.HK': 400, '0941.HK': 500, '1299.HK': 200, '0388.HK': 100, '2318.HK': 500, '2800.HK': 500, '2828.HK': 200, '3033.HK': 200 };
export function lotSize(market, symbol, kind) {
  if (!['stock', 'etf', 'bond'].includes(kind)) return 1;
  if (market === 'JP' && kind === 'stock') return 100;
  if (market === 'CN') return 100;
  if (market === 'HK') return HK_LOTS[symbol] || 1;
  return 1;
}
// Whether `qty` is a tradable amount there: whole lots, or (selling) all
// that's left of an odd remainder.
export function lotProblem(market, symbol, kind, side, qty, held = 0) {
  const lot = lotSize(market, symbol, kind);
  if (lot <= 1 || Math.abs(qty / lot - Math.round(qty / lot)) < 1e-9) return null;
  if (side === 'sell' && Math.abs(qty - held) < 1e-9 && held % lot !== 0) return null;
  return { lot };
}

// Lunch breaks, in the market's own time: no trading in between.
const LUNCH = { JP: [690, 750], HK: [720, 780], CN: [690, 780], SG: [720, 780] };
export function atLunch(market, t) {
  const l = LUNCH[market];
  if (!l) return false;
  const m = localParts(t, market).minutes;
  return m >= l[0] && m < l[1];
}
export const lunchOf = market => LUNCH[market] || null;

// Business days until a trade settles (T+n): Taiwan, Japan, Hong Kong,
// Korea, Europe, Australia and Singapore T+2; the US, Canada, India and
// mainland China T+1 (the UK, the EU and Switzerland move to T+1 on
// 2027-10-11). Crypto, passbook metals and forex here settle at once. Sale
// proceeds can buy again right away (the broker nets them), but can't leave
// the market (be exchanged) until settled.
export const SETTLE_DAYS = { TW: 2, US: 1, CA: 1, IN: 1, CN: 1, JP: 2, HK: 2, KR: 2, UK: 2, FR: 2, DE: 2, NL: 2, IT: 2, ES: 2, CH: 2, DK: 2, AU: 2, SG: 2, BOND: 1, CRYPTO: 0, METAL: 0, FX: 0 };
export const T1_EUROPE = Date.UTC(2027, 9, 11);
const EUROPE_T1 = new Set(['UK', 'FR', 'DE', 'NL', 'IT', 'ES', 'CH', 'DK']);
export const settleDays = (market, t = Date.now()) => (EUROPE_T1.has(market) && t >= T1_EUROPE ? 1 : SETTLE_DAYS[market] ?? 2);
// A day is a settlement day in a market when it trades there (weekends and
// the market's own holidays skipped).
const tradingDay = (market, day) => isTradingDay(market, day);
// The moment a trade at `t` settles: n of the market's business days later,
// at the end of that day in the market's own time.
export function settleDate(market, t) {
  let n = settleDays(market, t);
  if (!n) return t;
  const tz = tzOf(market);
  let [y, m, d] = localParts(t, market).day.split('-').map(Number);
  let day;
  while (n > 0) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    [y, m, d] = [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
    day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const w = next.getUTCDay();
    if (w !== 0 && w !== 6 && tradingDay(market, day)) n--;
  }
  // 23:59:59 local: UTC of that wall time, from the zone's offset then.
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  const off = guess - Date.parse(new Date(guess).toLocaleString('en-US', { timeZone: tz }) + ' UTC');
  return guess + off;
}

// Half the bid-ask spread, which a market order pays on top of the last
// price (buys at the ask, sells at the bid): at least half a tick, and a
// typical share of the price for each market. Limit orders don't pay it
// (they fill at their price or better); metals, bonds and forex already
// trade at the dealer's buy and sell prices (`spread` above).
const HALF_SPREAD = { US: 0.0001, TW: 0, JP: 0.0005, HK: 0.0005, CN: 0.0005, KR: 0.0005, UK: 0.0005, FR: 0.0005, DE: 0.0005, NL: 0.0005, IT: 0.0005, ES: 0.0005, CH: 0.0005, DK: 0.0005, CA: 0.0005, AU: 0.0005, SG: 0.001, IN: 0.0005, CRYPTO: 0.0002, METAL: 0, BOND: 0, FX: 0 };
export function marketSlip(market, kind, price) {
  if (MARKETS[market]?.spread) return 0;
  const tick = tickSize(market, kind, price) || 0;
  return Math.max(tick / 2, price * (HALF_SPREAD[market] ?? 0.001));
}
// What a market order fills at, from the last price.
export const marketFill = (market, kind, side, price) => (side === 'buy' ? price + marketSlip(market, kind, price) : Math.max(0, price - marketSlip(market, kind, price)));

// Taiwan's intraday odd-lot session (盤中零股): from 09:10 to 13:30, matched
// by call auction; an order of fewer than 1,000 shares (or a part that
// isn't whole lots) can't fill before 09:10.
export const ODD_LOT_OPEN = { h: 9, m: 10 };
export function isOddLot(market, kind, qty) {
  return market === 'TW' && (kind === 'stock' || kind === 'etf' || kind === 'bond') && Math.round(qty) % 1000 !== 0;
}
export function oddLotOpen(t) {
  const d = new Date(t + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes() >= ODD_LOT_OPEN.h * 60 + ODD_LOT_OPEN.m;
}

// NT$ cash in the settlement account earns the bank's demand-deposit rate,
// accrued daily and paid twice a year (June 21 and December 21, as Taiwan's
// banks do).
export const CASH_RATE = 0.008;

export const delayOf = market => (MARKETS[market] || MARKETS.INTL).delay ?? 15;

export function marketOf(symbol, kind) {
  if (kind === 'crypto') return 'CRYPTO';
  if (kind === 'govbond') return 'BOND';
  if (kind === 'metal') return 'METAL';
  if (kind === 'fx' || /^[A-Z]{6}=X$/.test(symbol)) return 'FX';
  const dot = symbol.lastIndexOf('.');
  if (dot < 0) return 'US';
  const suffix = symbol.slice(dot);
  return SUFFIX_MARKET.find(([s]) => s === suffix)?.[1] || (/^\.[A-Z]$/.test(suffix) ? 'US' : 'INTL');
}

// Passbook metals: the page's own instruments, priced from the futures.
export const METALS = {
  XAU: { future: 'GC=F', zh: '黃金存摺', en: 'Gold passbook', unitZh: '公克', unitEn: 'g' },
  XAG: { future: 'SI=F', zh: '白銀存摺', en: 'Silver passbook', unitZh: '公克', unitEn: 'g' }
};
export const GRAMS_PER_OUNCE = 31.1034768;

// What kind of thing a symbol is, from Yahoo's type. Taiwan's bond ETFs end
// in B (00679B); the catalog marks others.
export function kindOf(type, symbol, hint) {
  if (hint) return hint;
  if (METALS[symbol]) return 'metal';
  switch (String(type || '').toUpperCase()) {
    case 'ETF':
      return /^\d{4,6}B\.TWO?$/.test(symbol) ? 'bond' : 'etf';
    case 'MUTUALFUND':
      return 'fund';
    case 'CRYPTOCURRENCY':
      return 'crypto';
    case 'INDEX':
      return 'index';
    case 'FUTURE':
      return 'future';
    case 'CURRENCY':
      return 'fx';
    default:
      return 'stock';
  }
}

export const TRADABLE_KINDS = new Set(['stock', 'etf', 'bond', 'fund', 'crypto', 'metal', 'govbond', 'fx']);
// What can be sold short (borrowed and sold): listed shares, crypto and
// currency pairs (selling EUR/USD bets on the euro falling).
export const SHORTABLE_KINDS = new Set(['stock', 'etf', 'bond', 'crypto', 'fx']);
export const isShortable = kind => SHORTABLE_KINDS.has(kind);
// Yearly fee for borrowing what's sold short, on the value it was sold at.
export const SHORT_FEE = 0.03;
// Opening a short needs assets of at least this much of all that's owed
// (loans and shorts) afterwards; the maintenance levels below then apply.
export const SHORT_INITIAL = 1.5;
export const isTradable = kind => TRADABLE_KINDS.has(kind);

// Smallest amount that can be bought: whole shares, whole grams, crypto to
// 8 decimals, fund units to 3.
export function qtyStep(kind) {
  if (kind === 'crypto') return 1e-8;
  if (kind === 'fund') return 1e-3;
  return 1;
}
export function roundQty(qty, kind) {
  const step = qtyStep(kind);
  return step >= 1 ? Math.floor(qty + 1e-9) : Math.floor(qty / step + 1e-6) * step;
}

export function roundCash(amount, currency) {
  const f = 10 ** currencyInfo(currency).digits;
  return Math.round(amount * f) / f;
}

function levy(rules, kind) {
  const own = rules?.[kind] || {};
  const all = rules?.all || {};
  return { tax: own.tax ?? all.tax ?? 0, fee: own.fee ?? all.fee ?? 0 };
}

// What a trade of `gross` (price × quantity, in the market's currency) costs
// on top: commission, taxes, exchange fees. Taiwan's brokers and tax office
// drop the fractions of a dollar; elsewhere it's to the cent.
// `discount`: the share of the commission charged (Quadra Plus: 0.5), the
// minimum included.
// `oddLot`: a Taiwan odd-lot trade (its own, lower minimum); `dayTrade`: a
// Taiwan stock sold the same day it was bought (half the tax).
export function tradeCosts({ market, side, kind, gross, currency, discount = 1, oddLot = false, dayTrade = false }) {
  const m = MARKETS[market] || MARKETS.INTL;
  const round = m.floorFees ? x => Math.floor(x) : x => roundCash(x, currency);
  const min = oddLot && m.commission.oddMin != null ? m.commission.oddMin : m.commission.min;
  const commission = gross > 0 && m.commission.rate > 0 ? round(Math.max(gross * m.commission.rate, min) * discount) : 0;
  const rules = levy(side === 'buy' ? m.buy : m.sell, kind);
  const dayRate = dayTrade ? (side === 'buy' ? m.buy : m.sell)?.[kind]?.dayTrade : null;
  const { fee: feeRate } = rules;
  const taxRate = dayRate ?? rules.tax;
  const tax = round(gross * taxRate);
  const fee = round(gross * feeRate);
  return { commission, tax, fee, total: commission + tax + fee, taxRate, feeRate };
}

// The price a trade actually gets: passbook metals at the bank's own buy and
// sell prices around the market price.
export function dealPrice(market, side, price) {
  const spread = MARKETS[market]?.spread || 0;
  return side === 'buy' ? price * (1 + spread) : price * (1 - spread);
}

// Taiwan's NHI supplementary premium (二代健保補充保費): 2.11% of any single
// Taiwan dividend payment of NT$20,000 or more.
export const NHI_RATE = 0.0211;
export const NHI_THRESHOLD = 20_000;

export function dividendTaxes(market, gross) {
  const m = MARKETS[market] || MARKETS.INTL;
  const withheld = roundCash(gross * (m.withholding || 0), m.currency || 'USD');
  const nhi = m.nhi && gross >= NHI_THRESHOLD ? Math.floor(gross * NHI_RATE) : 0;
  return { withheld, nhi, net: gross - withheld - nhi };
}

// Margin: how much of each kind's value can be borrowed against, and the
// maintenance ratio (assets ÷ debt) where the broker calls and where it sells.
export const COLLATERAL = { stock: 0.6, etf: 0.6, bond: 0.6, fund: 0.5, metal: 0.5, crypto: 0.3, govbond: 0.8, fx: 0.5 };
export const MARGIN_CALL = 1.3;
export const MARGIN_LIQUIDATE = 1.15;

// Open for trading right now? Crypto never closes; everything else follows
// the session Yahoo reports for it (holidays included).
export function isOpen(quote, now = Date.now()) {
  if (!quote) return false;
  if (quote.kind === 'crypto') return true;
  const s = quote.session;
  if (!(s && now >= s.start && now < s.end)) return false;
  if (atLunch(quote.market, now)) return false;
  // Mainland shares are bought from abroad through Stock Connect, which
  // trades only when Hong Kong is open too.
  if (quote.market === 'CN' && !tradingDay('HK', localDayOf(now, 'HK'))) return false;
  return true;
}
