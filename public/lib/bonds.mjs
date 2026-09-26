// Government bonds: real coupon bonds with a maturity, priced from a yield
// curve. US Treasuries follow the live Treasury curve (Yahoo's 13-week,
// 2-, 5-, 10- and 30-year yields); Taiwan, Japan, Germany and UK bonds use a
// fixed reference curve (no free live source), so their prices only move as
// time passes. A bond's quote is the price of ONE bond (its face value) with
// accrued interest included (the "dirty" price a buyer pays), so the order
// engine treats it like any other security; coupons and the repayment at
// maturity are credited by the account.

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

// Each issuer: currency, face value of one bond, coupons a year, tax
// withheld from coupons for a Taiwan resident, where it trades (for its
// hours), and its curve: live Yahoo symbols or fixed reference yields (%).
export const ISSUERS = {
  US: {
    zh: '美國公債', en: 'US Treasury', flag: '🇺🇸', currency: 'USD', face: 1000, freq: 2, tax: 0, tz: 'America/New_York', hours: [8, 17],
    live: [[0.25, '^IRX'], [2, '2YY=F'], [5, '^FVX'], [10, '^TNX'], [30, '^TYX']]
  },
  TW: {
    zh: '中央政府公債', en: 'Taiwan government bond', flag: '🇹🇼', currency: 'TWD', face: 100_000, freq: 1, tax: 0.1, tz: 'Asia/Taipei', hours: [9, 13.5],
    reference: [[2, 1.45], [5, 1.55], [10, 1.7], [20, 1.85], [30, 1.95]]
  },
  JP: {
    zh: '日本公債', en: 'Japanese government bond', flag: '🇯🇵', currency: 'JPY', face: 100_000, freq: 2, tax: 0.15315, tz: 'Asia/Tokyo', hours: [9, 15],
    reference: [[2, 1.0], [5, 1.3], [10, 1.9], [20, 2.6], [30, 3.0]]
  },
  DE: {
    zh: '德國公債', en: 'German Bund', flag: '🇩🇪', currency: 'EUR', face: 1000, freq: 1, tax: 0.26375, tz: 'Europe/Berlin', hours: [9, 17.5],
    reference: [[2, 2.1], [5, 2.4], [10, 2.8], [30, 3.2]]
  },
  UK: {
    zh: '英國公債', en: 'UK gilt', flag: '🇬🇧', currency: 'GBP', face: 100, freq: 2, tax: 0, tz: 'Europe/London', hours: [8, 16.5],
    reference: [[2, 4.0], [5, 4.2], [10, 4.7], [30, 5.3]]
  }
};

// [id, issuer, coupon % a year, maturity (YYYY-MM-DD)]. A zero coupon is a
// bill. Coupons near today's yields for new issues, and a few old low-coupon
// ones that trade well below par.
const LIST = [
  ['UST-3M', 'US', 0, '2026-12-24'],
  ['UST-2Y', 'US', 4.5, '2028-09-30'],
  ['UST-5Y', 'US', 4.875, '2031-08-31'],
  ['UST-5Y-OLD', 'US', 1.625, '2031-05-15'],
  ['UST-10Y', 'US', 5.125, '2036-08-15'],
  ['UST-20Y', 'US', 5.375, '2046-08-15'],
  ['UST-20Y-OLD', 'US', 2.25, '2046-08-15'],
  ['UST-30Y', 'US', 5.5, '2056-08-15'],
  ['TWGB-2Y', 'TW', 1.375, '2028-06-15'],
  ['TWGB-5Y', 'TW', 1.5, '2031-03-15'],
  ['TWGB-10Y', 'TW', 1.625, '2036-06-15'],
  ['TWGB-20Y', 'TW', 1.75, '2046-04-15'],
  ['TWGB-30Y', 'TW', 1.875, '2056-02-15'],
  ['JGB-2Y', 'JP', 1.0, '2028-10-01'],
  ['JGB-10Y', 'JP', 1.9, '2036-09-20'],
  ['JGB-30Y', 'JP', 3.0, '2056-09-20'],
  ['BUND-5Y', 'DE', 2.2, '2031-10-10'],
  ['BUND-10Y', 'DE', 2.5, '2036-08-15'],
  ['BUND-30Y', 'DE', 3.2, '2056-08-15'],
  ['GILT-5Y', 'UK', 4.125, '2031-07-22'],
  ['GILT-10Y', 'UK', 4.5, '2036-03-07'],
  ['GILT-30Y', 'UK', 5.25, '2056-01-31']
];

export const BONDS = Object.fromEntries(
  LIST.map(([id, issuer, coupon, maturity]) => [id, { id, issuer, coupon, maturity: Date.parse(`${maturity}T00:00:00Z`), ...ISSUERS[issuer] }])
);
export const isBond = symbol => Boolean(BONDS[symbol]);

export function bondName(bond, locale) {
  const years = Math.max(0, (bond.maturity - Date.now()) / YEAR);
  const term = years < 1 ? (locale === 'zh' ? `${Math.round(years * 12)} 個月` : `${Math.round(years * 12)}-month`) : locale === 'zh' ? `${Math.round(years)} 年` : `${Math.round(years)}-year`;
  const date = new Date(bond.maturity).toISOString().slice(0, 7).replace('-', '/');
  const issuer = locale === 'zh' ? bond.zh : bond.en;
  if (!bond.coupon) return locale === 'zh' ? `${issuer} ${term}國庫券（${date} 到期）` : `${issuer} ${term} bill (${date})`;
  return locale === 'zh' ? `${issuer} ${term} ${bond.coupon}%（${date} 到期）` : `${issuer} ${term} ${bond.coupon}% (${date})`;
}

// Months from `t` (UTC date arithmetic, day clamped to the month's end).
function addMonths(t, months) {
  const d = new Date(t);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.getTime();
}

// Every coupon date, counted back from maturity (oldest first), down to `from`.
export function couponDates(bond, from) {
  const step = 12 / bond.freq;
  const dates = [];
  for (let k = 0; k < 1000; k++) {
    const d = addMonths(bond.maturity, -step * k);
    if (d <= from) {
      dates.push(d);
      break;
    }
    dates.push(d);
  }
  return dates.reverse();
}

// Price per 100 of face at yield `y` (% a year) on day `t`: clean, accrued
// and dirty. Standard compounding at the coupon frequency, the first period
// cut short by how much of it has passed.
export function priceAt(bond, y, t) {
  if (t >= bond.maturity) return { clean: 100, accrued: 0, dirty: 100 };
  const dates = couponDates(bond, t);
  const prev = dates[0];
  const next = dates[1];
  const periodCoupon = bond.coupon / bond.freq;
  const accrued = (periodCoupon * (t - prev)) / (next - prev);
  const w = (next - t) / (next - prev);
  const r = y / 100 / bond.freq;
  const n = dates.length - 1;
  let dirty = 0;
  for (let k = 0; k < n; k++) dirty += periodCoupon / (1 + r) ** (k + w);
  dirty += 100 / (1 + r) ** (n - 1 + w);
  return { clean: dirty - accrued, accrued, dirty };
}

// Yield of a maturity on a curve [[years, %]]: straight lines between
// points, flat beyond the ends.
export function curveYield(points, years) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (!pts.length) return null;
  if (years <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (years - x0)) / (x1 - x0);
    }
  }
  return pts.at(-1)[1];
}

// The symbols whose quotes the live curves need.
export const CURVE_SYMBOLS = [...new Set(Object.values(ISSUERS).flatMap(i => (i.live || []).map(([, s]) => s)))];

// Today's curve for an issuer, from quotes (a Map) or its reference.
export function curveOf(issuer, quotes, pick = q => q.price) {
  const info = ISSUERS[issuer];
  if (!info.live) return info.reference;
  const pts = info.live.map(([years, s]) => [years, quotes?.get(s) ? pick(quotes.get(s)) : null]).filter(p => Number.isFinite(p[1]));
  return pts.length ? pts : null;
}

// Weekday business hours in the issuer's time zone (bonds trade over the
// counter): today's session, or the next one.
export function bondSession(bond, now) {
  const parts = tz => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' });
    return Object.fromEntries(f.formatToParts(now).map(p => [p.type, p.value]));
  };
  const p = parts(bond.tz);
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  const offset = local - Math.floor(now / 60_000) * 60_000;
  const midnight = Date.UTC(+p.year, +p.month - 1, +p.day) - offset;
  const [open, close] = bond.hours;
  let start = midnight + open * 3_600_000;
  let end = midnight + close * 3_600_000;
  const weekend = d => {
    const w = new Date(d + offset).getUTCDay();
    return w === 0 || w === 6;
  };
  if (now >= end || weekend(start)) {
    do {
      start += DAY;
      end += DAY;
    } while (weekend(start));
  }
  return { start, end };
}

// A quote for one bond: price = dirty value of one bond in its currency.
// `curve` is today's [[years, %]] and `prevCurve` yesterday's (for the day's
// change); `lines` the history of yields for the price line (optional).
export function bondQuote(bond, curve, prevCurve, now = Date.now(), line = []) {
  if (!curve) return null;
  const years = (bond.maturity - now) / YEAR;
  const y = curveYield(curve, years);
  const yPrev = curveYield(prevCurve || curve, years + 1 / 365);
  const p = priceAt(bond, y, now);
  const pPrev = priceAt(bond, yPrev, now - DAY);
  const k = bond.face / 100;
  const session = bondSession(bond, now);
  return {
    symbol: bond.id,
    name: bond.en,
    shortName: bond.en,
    kind: 'govbond',
    market: 'BOND',
    currency: bond.currency,
    price: p.dirty * k,
    prev: pPrev.dirty * k,
    change: (p.dirty - pPrev.dirty) * k,
    pct: p.dirty / pPrev.dirty - 1,
    dayHigh: null,
    dayLow: null,
    high52: null,
    low52: null,
    volume: null,
    exchange: bond.live ? 'OTC · US Treasury curve' : 'OTC · reference curve',
    tz: bond.tz,
    marketTime: now,
    session,
    line,
    bond: { yield: y, clean: p.clean, accrued: p.accrued, years, live: Boolean(bond.live) }
  };
}

// Price line from yield history: `curveAt(t)` gives the curve on a day.
export function bondLine(bond, times, curveAt) {
  const k = bond.face / 100;
  const out = [];
  for (const t of times) {
    const curve = curveAt(t);
    if (!curve || t >= bond.maturity) continue;
    out.push([t, priceAt(bond, curveYield(curve, (bond.maturity - t) / YEAR), t).dirty * k]);
  }
  return out;
}
