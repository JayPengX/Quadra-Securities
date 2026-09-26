// The time machine: what money put into one thing on a past date would be
// worth today, from monthly prices (with dividends reinvested when the
// adjusted closes are given) and, for a foreign one, the NT$ rate of each
// month. Costs aren't counted; the answer is about the market, not fees.

// The value of `points` ([t, v], oldest first) at moment `t`: the last one
// at or before it (the first one before the series starts).
export function valueAt(points, t) {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (t < points[0][0]) return points[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo][1];
}

// A deposit that earns `rate` a year, compounded monthly: the bank's
// answer to the same deposits.
function bankValue(deposits, rate, now) {
  return deposits.reduce((sum, d) => sum + d.amount * (1 + rate / 12) ** ((now - d.t) / (365.25 / 12 * 86_400_000)), 0);
}

// points: monthly [t, price] in the thing's currency; fx: [t, NT$ per unit]
// or null when it's priced in NT$. amount: NT$ once (mode 'lump') or every
// month (mode 'monthly') from `start`. `now` and `price` (today's, in its
// currency) finish the series. Returns null when there's no price at start.
export function timeMachine({ points, fx = null, amount, start, mode = 'lump', now = Date.now(), price = null, rate = null, bankRate = 0.015 }) {
  if (!points?.length || !(amount > 0)) return null;
  const first = points[0][0];
  const from = Math.max(start, first);
  const twd = t => (fx ? valueAt(fx, t) || rate : 1);
  const series = [];
  const deposits = [];
  let units = 0;
  let putIn = 0;
  for (const [t, p] of points) {
    if (t < from - 20 * 86_400_000) continue;
    const r = twd(t);
    if (!(p > 0) || !(r > 0)) continue;
    if (mode === 'monthly' || !deposits.length) {
      units += amount / (p * r);
      putIn += amount;
      deposits.push({ t, amount });
    }
    series.push([t, units * p * r, putIn]);
  }
  if (!series.length) return null;
  const endPrice = price ?? points.at(-1)[1];
  const endRate = rate ?? twd(now);
  if (now > series.at(-1)[0]) series.push([now, units * endPrice * endRate, putIn]);
  const value = series.at(-1)[1];
  // Worst fall from a high along the way, and the months it took.
  let peak = -Infinity;
  let peakT = series[0][0];
  let maxDrawdown = 0;
  let drawdownFrom = null;
  let drawdownTo = null;
  for (const [t, v, put] of series) {
    // Money added lifts the value without being a gain: compare value per NT$ put in.
    const x = v / put;
    if (x > peak) {
      peak = x;
      peakT = t;
    }
    const dd = x / peak - 1;
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      drawdownFrom = peakT;
      drawdownTo = t;
    }
  }
  const years = (now - series[0][0]) / (365.25 * 86_400_000);
  // Yearly return for a lump sum (CAGR); for monthly buying, the rate a bank
  // would have had to pay on the same deposits to end at the same value.
  let annual = null;
  if (years >= 0.5) {
    if (mode === 'lump') annual = (value / putIn) ** (1 / years) - 1;
    else {
      let lo = -0.99;
      let hi = 2;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (bankValue(deposits, mid, now) > value) hi = mid;
        else lo = mid;
      }
      annual = (lo + hi) / 2;
    }
  }
  // Each calendar year's change (value per NT$ put in, so deposits don't count).
  const byYear = new Map();
  for (const [t, v, put] of series) {
    const y = new Date(t + 8 * 3_600_000).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, { first: v / put, last: v / put });
    byYear.get(y).last = v / put;
  }
  const yearly = [];
  let prev = null;
  for (const [y, { first: f, last }] of byYear) {
    yearly.push([y, last / (prev ?? f) - 1]);
    prev = last;
  }
  const best = yearly.reduce((b, x) => (!b || x[1] > b[1] ? x : b), null);
  const worst = yearly.reduce((b, x) => (!b || x[1] < b[1] ? x : b), null);
  return {
    series,
    start: series[0][0],
    value,
    putIn,
    gain: value - putIn,
    ratio: value / putIn,
    years,
    annual,
    maxDrawdown,
    drawdownFrom,
    drawdownTo,
    yearly,
    best,
    worst,
    bank: bankValue(deposits, bankRate, now),
    bankRate
  };
}

// Average of the last `n` values at each point (none for the first n-1).
export function movingAverage(points, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i][1];
    if (i >= n) sum -= points[i - n][1];
    if (i >= n - 1) out.push([points[i][0], sum / n]);
  }
  return out;
}
