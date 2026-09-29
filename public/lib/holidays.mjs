// Exchange holidays: days a market that would normally trade is shut, so a
// closed market's next opening time is right (Yahoo only knows the next
// session a day ahead). Two kinds:
//   - rule-based calendars (fixed dates, Easter, "the third Monday"...) for
//     the US, UK, Europe, Switzerland, Denmark, Canada, Australia and Japan,
//     good for any year;
//   - listed dates for the markets that follow the lunar calendar or a
//     yearly government announcement (Taiwan, Hong Kong, China, Korea,
//     Singapore), from each exchange's published calendar for 2026 and
//     2027. Past those years they fall back to weekdays only.
// Dates are the exchange's local calendar days, 'YYYY-MM-DD'.

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const shift = (y, m, d, days) => {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};
const key = ([y, m, d]) => ymd(y, m, d);

// The nth weekday (0 = Sunday) of a month; n = -1 for the last.
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = dow(y, m, 1);
    return [y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7];
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = dow(y, m, lastDay);
  return [y, m, lastDay - ((last - weekday + 7) % 7)];
}

// Easter Sunday (Gregorian, anonymous algorithm).
export function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [y, month, day];
}
const fromEaster = (y, days) => shift(...easter(y), days);

// A fixed date moved off the weekend: Saturday to Friday, Sunday to Monday (US).
function observedUS(y, m, d) {
  const w = dow(y, m, d);
  return w === 6 ? shift(y, m, d, -1) : w === 0 ? shift(y, m, d, 1) : [y, m, d];
}
// Weekend to the next weekday(s) (UK, Canada, Australia): `taken` holds days
// already used by an earlier substitute (Christmas and Boxing Day).
function observedNext(y, m, d, taken = new Set()) {
  let day = [y, m, d];
  while ([0, 6].includes(dow(...day)) || taken.has(key(day))) day = shift(...day, 1);
  return day;
}

const RULES = {
  US: y => {
    const out = [observedUS(y, 1, 1), nthWeekday(y, 1, 1, 3), nthWeekday(y, 2, 1, 3), fromEaster(y, -2), nthWeekday(y, 5, 1, -1), observedUS(y, 6, 19), observedUS(y, 7, 4), nthWeekday(y, 9, 1, 1), nthWeekday(y, 11, 4, 4), observedUS(y, 12, 25)];
    // New Year's Day on a Saturday isn't made up on the Friday before.
    return out.filter(([yy]) => yy === y);
  },
  UK: y => {
    const taken = new Set();
    const xmas = observedNext(y, 12, 25);
    taken.add(key(xmas));
    const boxing = observedNext(y, 12, 26, taken);
    return [observedNext(y, 1, 1), fromEaster(y, -2), fromEaster(y, 1), nthWeekday(y, 5, 1, 1), nthWeekday(y, 5, 1, -1), nthWeekday(y, 8, 1, -1), xmas, boxing];
  },
  // Euronext (Paris, Amsterdam), and Madrid.
  EU: y => [[y, 1, 1], fromEaster(y, -2), fromEaster(y, 1), [y, 5, 1], [y, 12, 25], [y, 12, 26]],
  DE: y => [[y, 1, 1], fromEaster(y, -2), fromEaster(y, 1), [y, 5, 1], [y, 12, 24], [y, 12, 25], [y, 12, 26], [y, 12, 31]],
  IT: y => [[y, 1, 1], fromEaster(y, -2), fromEaster(y, 1), [y, 5, 1], [y, 8, 15], [y, 12, 24], [y, 12, 25], [y, 12, 26], [y, 12, 31]],
  CH: y => [[y, 1, 1], [y, 1, 2], fromEaster(y, -2), fromEaster(y, 1), [y, 5, 1], fromEaster(y, 39), fromEaster(y, 50), [y, 8, 1], [y, 12, 24], [y, 12, 25], [y, 12, 26], [y, 12, 31]],
  DK: y => [[y, 1, 1], fromEaster(y, -3), fromEaster(y, -2), fromEaster(y, 1), fromEaster(y, 39), fromEaster(y, 40), fromEaster(y, 50), [y, 6, 5], [y, 12, 24], [y, 12, 25], [y, 12, 26], [y, 12, 31]],
  CA: y => {
    const taken = new Set();
    const xmas = observedNext(y, 12, 25);
    taken.add(key(xmas));
    // Victoria Day: the Monday before May 25.
    const victoria = shift(y, 5, 25, -((dow(y, 5, 25) + 6) % 7 || 7));
    return [observedNext(y, 1, 1), nthWeekday(y, 2, 1, 3), fromEaster(y, -2), victoria, observedNext(y, 7, 1), nthWeekday(y, 8, 1, 1), nthWeekday(y, 9, 1, 1), nthWeekday(y, 10, 1, 2), xmas, observedNext(y, 12, 26, taken)];
  },
  AU: y => {
    const taken = new Set();
    const xmas = observedNext(y, 12, 25);
    taken.add(key(xmas));
    return [observedNext(y, 1, 1), observedNext(y, 1, 26), fromEaster(y, -2), fromEaster(y, 1), [y, 4, 25], nthWeekday(y, 6, 1, 2), xmas, observedNext(y, 12, 26, taken)];
  },
  JP: y => {
    const equinox = { 2025: [20, 23], 2026: [20, 23], 2027: [21, 23], 2028: [20, 22], 2029: [20, 23], 2030: [20, 23] }[y] || [20, 23];
    const national = [[y, 1, 1], nthWeekday(y, 1, 1, 2), [y, 2, 11], [y, 2, 23], [y, 3, equinox[0]], [y, 4, 29], [y, 5, 3], [y, 5, 4], [y, 5, 5], nthWeekday(y, 7, 1, 3), [y, 8, 11], nthWeekday(y, 9, 1, 3), [y, 9, equinox[1]], nthWeekday(y, 10, 1, 2), [y, 11, 3], [y, 11, 23]];
    const days = new Set(national.map(key));
    // A holiday on a Sunday moves to the next day that isn't one.
    for (const day of national) if (dow(...day) === 0) {
      let next = shift(...day, 1);
      while (days.has(key(next))) next = shift(...next, 1);
      days.add(key(next));
    }
    // A day between two holidays is one too (the September "silver week").
    for (const day of national) {
      const next = shift(...day, 2);
      const mid = shift(...day, 1);
      if (days.has(key(next)) && !days.has(key(mid)) && dow(...mid) !== 0) days.add(key(mid));
    }
    // The exchange also shuts Jan 2-3 and Dec 31.
    for (const d of [ymd(y, 1, 2), ymd(y, 1, 3), ymd(y, 12, 31)]) days.add(d);
    return [...days].map(d => d.split('-').map(Number));
  }
};

// Announced calendars (market-closed weekdays).
const LISTED = {
  TW: {
    2026: ['01-01', '02-12', '02-13', '02-16', '02-17', '02-18', '02-19', '02-20', '02-27', '04-03', '04-06', '05-01', '06-19', '09-25', '09-28', '10-09', '10-26', '12-25'],
    2027: ['01-01', '02-03', '02-04', '02-05', '02-08', '02-09', '02-10', '03-01', '04-05', '04-30', '06-09', '09-15', '09-28', '10-11', '10-25', '12-24']
  },
  HK: {
    2026: ['01-01', '02-17', '02-18', '02-19', '04-03', '04-06', '04-07', '05-01', '05-25', '06-19', '07-01', '10-01', '10-19', '12-25'],
    2027: ['01-01', '02-08', '02-09', '03-26', '03-29', '04-05', '05-13', '06-09', '07-01', '09-16', '10-01', '10-08', '12-27']
  },
  CN: {
    2026: ['01-01', '01-02', '02-16', '02-17', '02-18', '02-19', '02-20', '02-23', '04-06', '05-01', '05-04', '05-05', '06-19', '09-25', '10-01', '10-02', '10-05', '10-06', '10-07'],
    2027: ['01-01', '02-05', '02-08', '02-09', '02-10', '02-11', '04-05', '05-03', '05-04', '05-05', '06-09', '09-15', '10-01', '10-04', '10-05', '10-06', '10-07']
  },
  KR: {
    2026: ['01-01', '02-16', '02-17', '02-18', '03-02', '05-01', '05-05', '05-25', '06-03', '08-17', '09-24', '09-25', '10-05', '10-09', '12-25', '12-31'],
    2027: ['01-01', '02-08', '02-09', '03-01', '05-05', '05-13', '06-07', '08-16', '09-14', '09-15', '09-16', '10-04', '10-11', '12-27', '12-31']
  },
  SG: {
    2026: ['01-01', '02-17', '02-18', '04-03', '05-01', '05-27', '06-01', '08-10', '11-09', '12-25'],
    2027: ['01-01', '02-08', '02-09', '03-10', '03-26', '05-17', '05-20', '08-09', '10-28', '12-27']
  }
};

// Which calendar each market (see markets.mjs) keeps.
const CALENDAR = { TW: 'TW', US: 'US', JP: 'JP', HK: 'HK', CN: 'CN', KR: 'KR', UK: 'UK', FR: 'EU', NL: 'EU', ES: 'EU', DE: 'DE', IT: 'IT', CH: 'CH', DK: 'DK', CA: 'CA', AU: 'AU', SG: 'SG', METAL: 'US', FX: null, CRYPTO: null, INTL: null };
export const calendarOf = market => CALENDAR[market] ?? null;

const cache = new Map();
function holidaySet(cal, y) {
  const id = `${cal}:${y}`;
  if (!cache.has(id)) {
    const days = RULES[cal] ? RULES[cal](y).map(key) : (LISTED[cal]?.[y] || []).map(md => `${y}-${md}`);
    cache.set(id, new Set(days));
  }
  return cache.get(id);
}

// Whether `day` ('YYYY-MM-DD', the market's own date) is an exchange holiday.
export function isHoliday(market, day) {
  const cal = calendarOf(market);
  if (!cal) return false;
  return holidaySet(cal, Number(day.slice(0, 4))).has(day);
}

// The market's local date of a moment.
export function localDay(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// A trading day: a weekday that isn't a holiday.
export function isTradingDay(market, day) {
  const [y, m, d] = day.split('-').map(Number);
  const w = dow(y, m, d);
  return w !== 0 && w !== 6 && !isHoliday(market, day);
}

// The market's next holidays from `day` on (weekdays only), up to `n`.
export function upcomingHolidays(market, day, n = 5) {
  const cal = calendarOf(market);
  if (!cal) return [];
  const y = Number(day.slice(0, 4));
  const out = [];
  for (const year of [y, y + 1])
    for (const d of [...holidaySet(cal, year)].sort()) {
      const [yy, mm, dd] = d.split('-').map(Number);
      if (d >= day && ![0, 6].includes(dow(yy, mm, dd))) out.push(d);
    }
  return out.slice(0, n);
}

// Moves a session start (a moment) forward by whole days past weekends and
// holidays in the market's time zone; `after`: it must also be later than this.
export function nextTradingStart(market, start, tz, after = -Infinity) {
  let next = start;
  for (let i = 0; i < 30 && (next <= after || !isTradingDay(market, localDay(next, tz))); i++) next += 86_400_000;
  return next;
}
