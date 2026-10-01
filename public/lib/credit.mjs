// Taiwan credit trading (信用交易), as Taiwan's brokers run it: the credit
// account and its limit, 融資 and 融券 with their six-month term (展延 to
// extend it), and day trading (現股當沖). Pure functions over the account
// log; account.mjs applies them to orders and fills.
//
// The credit account gates margin and borrowed shorts in every market (as
// a Taiwan broker's 複委託 would); the limit, the terms and 融券's deposit
// are Taiwan's own. Margin elsewhere is lent and called by account.mjs's
// rules (the US's Reg T and the like). A currency pair sold borrows nothing.
import { addMonths } from './savings.mjs';
import { localDayOf } from './markets.mjs';
import { isTradingDay } from './holidays.mjs';

const DAY = 86_400_000;
const YEAR = 365 * DAY;

// The credit account's limit (融資額度, the same again for 融券), by tier.
export const CREDIT_TIERS = [500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000];
// To open one: the brokerage account open three months, ten trades in the
// last year, and that year's turnover at least half the limit asked for
// (台灣證券交易所 信用交易帳戶開立條件). Above the first tier, the broker also
// asks for proof of means (財力證明): here, net worth of 30% of the limit.
export const CREDIT_MIN_MONTHS = 3;
export const CREDIT_MIN_TRADES = 10;
export const CREDIT_TURNOVER = 0.5;
export const CREDIT_PROOF = 0.3;
// 融資 and 融券 each run six months from the trade; 展延 adds six more,
// asked for in the last month before it's due, while the account isn't
// under a margin call. Past due, the broker closes it (sells, or buys back).
export const TERM_MONTHS = 6;
export const EXTEND_WINDOW = 30 * DAY;
// 融券: the seller puts up 90% of the sale (保證金成數), and the broker keeps
// the sale money too, both as collateral; the 融券手續費 is 0.08% of the sale.
export const SHORT_DEPOSIT = 0.9;
export const SHORT_HANDLING = 0.0008;
// Day trading (現股當沖): buying then selling the same day needs the account
// open three months with ten trades in the last year; selling first and
// buying back the same day, a year open with ten trades. A day-trade short
// not bought back by the close is bought back for the account.
export const DAY_TRADE_BUY_FIRST_MONTHS = 3;
export const DAY_TRADE_SELL_FIRST_MONTHS = 12;

const fills = account => (account?.events || []).filter(e => e.type === 'fill' && !e.forced);

// The last year's trading: { trades, turnoverTWD }.
export function yearOfTrading(account, now = Date.now()) {
  const list = fills(account).filter(e => e.t <= now && e.t > now - YEAR);
  return { trades: list.length, turnoverTWD: Math.round(list.reduce((sum, e) => sum + e.gross * (e.twd || 1), 0)) };
}

const monthsOpen = (account, months, now) => Boolean(account?.created) && addMonths(account.created, months) <= now;

// The credit account: { open, limit, since }. Every account opens one the
// same way (openCredit), once it meets the rules.
export function creditAccount(account, now = Date.now()) {
  const opened = (account?.events || []).filter(e => e.type === 'credit' && e.t <= now).sort((a, b) => a.t - b.t);
  const last = opened.at(-1);
  return last ? { open: true, limit: last.limit, since: opened[0].t } : { open: false, limit: 0, since: null };
}

// Whether `limit` can be had now, and why not: { ok, needs: [{ key, have, want }] }.
export function creditCheck(account, limit, netWorthTWD, now = Date.now()) {
  const { trades, turnoverTWD } = yearOfTrading(account, now);
  const needs = [];
  if (!monthsOpen(account, CREDIT_MIN_MONTHS, now)) needs.push({ key: 'age', have: account?.created ? Math.floor((now - account.created) / (30 * DAY)) : 0, want: CREDIT_MIN_MONTHS, from: addMonths(account?.created || now, CREDIT_MIN_MONTHS) });
  if (trades < CREDIT_MIN_TRADES) needs.push({ key: 'trades', have: trades, want: CREDIT_MIN_TRADES });
  if (turnoverTWD < limit * CREDIT_TURNOVER) needs.push({ key: 'turnover', have: turnoverTWD, want: limit * CREDIT_TURNOVER });
  if (limit > CREDIT_TIERS[0] && netWorthTWD < limit * CREDIT_PROOF) needs.push({ key: 'means', have: Math.round(netWorthTWD), want: limit * CREDIT_PROOF });
  return { ok: needs.length === 0 && CREDIT_TIERS.includes(limit), needs };
}
// The highest tier that can be had now (0: none).
export function bestTier(account, netWorthTWD, now = Date.now()) {
  return [...CREDIT_TIERS].reverse().find(x => creditCheck(account, x, netWorthTWD, now).ok) || 0;
}

// Opens the credit account (or raises its limit). Returns { account, event } or { error, needs }.
export function openCredit(account, limit, netWorthTWD, now = Date.now()) {
  const check = creditCheck(account, limit, netWorthTWD, now);
  if (!check.ok) return { error: 'credit', needs: check.needs };
  const event = { id: `credit:${now}`, type: 'credit', t: now, limit };
  return { account: { ...account, events: [...account.events, event] }, event };
}

// Day trading allowed, and which way.
export const dayTradeBuyFirst = (account, now = Date.now()) => monthsOpen(account, DAY_TRADE_BUY_FIRST_MONTHS, now) && yearOfTrading(account, now).trades >= CREDIT_MIN_TRADES;
export const dayTradeSellFirst = (account, now = Date.now()) => monthsOpen(account, DAY_TRADE_SELL_FIRST_MONTHS, now) && yearOfTrading(account, now).trades >= CREDIT_MIN_TRADES;

// What the credit account has out now, in NT$ at cost: 融資 lent and 融券 sold.
export function creditUsed(valuation) {
  let loan = 0;
  let short = 0;
  for (const p of valuation?.positions || []) {
    if (p.market !== 'TW') continue;
    if (!p.short && p.financed > 0) loan += p.financed;
    if (p.short && p.credit) short += Math.abs(p.costTWD);
  }
  return { loan, short };
}

// Each 融資 or 融券 position's term: [{ symbol, side: 'loan'|'short', since, due, canExtend }].
export function terms(valuation, now = Date.now()) {
  const out = [];
  for (const p of valuation?.positions || []) {
    if (p.market !== 'TW') continue;
    if (!p.short && p.financed > 0 && p.loanDue) out.push({ symbol: p.symbol, side: 'loan', since: p.loanSince, due: p.loanDue, canExtend: now >= p.loanDue - EXTEND_WINDOW && now < p.loanDue });
    if (p.short && p.credit && p.shortDue) out.push({ symbol: p.symbol, side: 'short', since: p.first, due: p.shortDue, canExtend: now >= p.shortDue - EXTEND_WINDOW && now < p.shortDue });
  }
  return out.sort((a, b) => a.due - b.due);
}

// 展延: six more months on a position due within the month. Returns { account, event } or { error }.
export function extendTerm(account, valuation, symbol, now = Date.now()) {
  const term = terms(valuation, now).find(x => x.symbol === symbol);
  if (!term) return { error: 'noTerm' };
  if (account.call) return { error: 'margin' };
  if (!term.canExtend) return { error: now >= term.due ? 'termPast' : 'termEarly', from: term.due - EXTEND_WINDOW };
  const event = { id: `extend:${symbol}:${now}`, type: 'extend', t: now, symbol };
  return { account: { ...account, events: [...account.events, event] }, event };
}

// The term's end from its start, and after each 展延.
export const termDue = (since, extensions = 0) => addMonths(since, TERM_MONTHS * (1 + extensions));

// Positions past their term, or day-trade shorts left after their day's
// close: the orders that close them (forced, at market). Without a credit
// account, every 融資 and every borrowed short goes (reason 'noCredit'):
// margin and short selling are the credit account's.
export function closeOutPlan(account, valuation, now = Date.now()) {
  if (account.orders.some(o => o.status === 'open' && o.forced)) return [];
  const plan = [];
  if (!creditAccount(account, now).open) {
    for (const p of valuation.positions) {
      if (!p.short && p.financed > 0 && p.qty > 0) plan.push({ symbol: p.symbol, side: 'sell', type: 'market', qty: p.qty, forced: true, reason: 'noCredit' });
      else if (p.short && !p.dayShort && p.kind !== 'fx') plan.push({ symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true, reason: 'noCredit' });
    }
  }
  const closing = new Set(plan.map(x => x.symbol));
  for (const t of terms(valuation, now)) {
    if (now < t.due || closing.has(t.symbol)) continue;
    const p = valuation.positions.find(x => x.symbol === t.symbol);
    if (!p) continue;
    plan.push(t.side === 'loan' ? { symbol: p.symbol, side: 'sell', type: 'market', qty: p.qty, forced: true, reason: 'due' } : { symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true, reason: 'due' });
  }
  for (const p of valuation.positions) {
    if (!p.short || !p.dayShort || p.market !== 'TW') continue;
    if (!pastClose(p.first, now)) continue;
    plan.push({ symbol: p.symbol, side: 'buy', type: 'market', qty: -p.qty, forced: true, reason: 'dayTrade' });
  }
  return plan;
}

// Whether Taiwan's close (13:30) of the day `t` traded on has passed by `now`.
export function pastClose(t, now) {
  const day = localDayOf(t, 'TW');
  return now >= Date.parse(`${day}T13:30:00+08:00`) || (now - t > DAY && isTradingDay('TW', localDayOf(now, 'TW')));
}

// Taiwan's after-hours sessions (盤後): 盤後定價 for whole lots (14:00-14:30,
// at the close) and 盤後零股 for odd lots (13:40-14:30, one auction at
// 14:30). An order placed after the 13:30 close and before 14:30 on a
// trading day goes to them: it matches once, at 14:30, at the close (a buy
// whose limit is at or above it, a sell at or below; a market order at the
// close), and what doesn't match ends there.
export function afterHours(t) {
  const day = localDayOf(t, 'TW');
  if (!isTradingDay('TW', day)) return null;
  const from = Date.parse(`${day}T13:30:00+08:00`);
  const match = Date.parse(`${day}T14:30:00+08:00`);
  return t >= from && t < match ? { from, match } : null;
}
