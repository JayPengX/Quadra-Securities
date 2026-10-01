// What a Taiwan bank and broker offer on money and shares that sit still,
// with their real terms (account.mjs records them as events in the log).
//
// 定存 (time deposits): NT$ locked for a term at the bank's posted fixed
// rate (Bank of Taiwan's board, 2026), paid in full at maturity. Broken
// early, a bank pays 80% of the rate for the term actually held (the
// longest posted term it covers), and nothing under a month. At maturity the
// principal comes back to cash, or rolls over at the rate posted then
// (自動轉存, principal only; the interest is paid out).
//
// 借券出借 (securities lending): Taiwan stocks and ETFs held whole lots,
// settled and not bought on margin, lent through the broker for a fee on
// their value when lent. The broker keeps LEND_CUT of the fee. Lent shares
// can't be sold; a recall returns them in LEND_RECALL business days, and
// a contract ends by itself after LEND_TERM_DAYS. The fee is paid when the
// shares come back.
//
// Interest and lending fees are income: a payment over NT$20,000 has 10%
// withheld (扣繳) and 2.11% supplementary health premium (二代健保).
import { NHI_RATE, NHI_THRESHOLD } from './markets.mjs';

const DAY = 86_400_000;
const YEAR_MS = 365 * DAY;
const TPE = 8 * 3_600_000;

export const TD_TERMS = [
  { months: 1, rate: 0.0123 },
  { months: 3, rate: 0.0139 },
  { months: 6, rate: 0.0156 },
  { months: 9, rate: 0.0163 },
  { months: 12, rate: 0.0172 }
];
export const TD_MIN = 10_000;
export const TD_EARLY = 0.8;
export const tdRate = months => TD_TERMS.find(x => x.months === months)?.rate ?? null;

// The same day `n` Taiwan months later (the month's last day when it's short).
export function addMonths(t, n) {
  const d = new Date(t + TPE);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - TPE;
}

// Whole months from `from` to `to`.
export function fullMonths(from, to) {
  let n = 0;
  while (addMonths(from, n + 1) <= to) n++;
  return n;
}

// Income tax withheld and the health premium on one payment of interest or
// a lending fee.
export function incomeTaxes(gross) {
  const big = gross > NHI_THRESHOLD;
  const withheld = big ? Math.round(gross * 0.1) : 0;
  const nhi = gross >= NHI_THRESHOLD ? Math.floor(gross * NHI_RATE) : 0;
  return { withheld, nhi, net: gross - withheld - nhi };
}

// A deposit's interest if closed at `at`: in full at or after maturity;
// before it, 80% of the posted rate for the longest term held, for the time
// held; under a month, nothing.
export function tdInterest(td, at) {
  if (at >= td.ends) return { gross: Math.round((td.amount * td.rate * td.months) / 12), early: false };
  const held = fullMonths(td.t, at);
  const term = [...TD_TERMS].reverse().find(x => x.months <= held);
  if (!term) return { gross: 0, early: true };
  return { gross: Math.round((td.amount * term.rate * TD_EARLY * (at - td.t)) / YEAR_MS), early: true };
}

export const LEND_RATE = { stock: 0.012, etf: 0.006 };
export const LEND_CUT = 0.3;
export const LEND_LOT = 1_000;
export const LEND_RECALL = 3;
export const LEND_TERM_DAYS = 180;
export const lendable = (market, kind) => market === 'TW' && Boolean(LEND_RATE[kind]);

// `n` weekdays after `t` (a recall's return day).
export function addWeekdays(t, n) {
  let x = t;
  for (let left = n; left > 0; ) {
    x += DAY;
    const day = new Date(x + TPE).getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return x;
}

// The fee for a lending contract from its start to `until`: gross, the
// broker's cut, the taxes, what's paid.
export function lendFee(lend, until) {
  const gross = Math.max(0, Math.round((lend.qty * lend.price * lend.rate * (until - lend.t)) / YEAR_MS));
  const cut = Math.round(gross * LEND_CUT);
  const taxes = incomeTaxes(gross - cut);
  return { gross, cut, ...taxes };
}
