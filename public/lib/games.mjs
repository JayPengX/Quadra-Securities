// 小遊戲: stock mini games that earn play money by skill, not luck, like
// Quadra Sportsbook's. Each round is about a minute and pays about
// ECONOMY.gamesPerMinute (NT$15) for ordinary play (more for a good one);
// together they pay at most GAMES.dailyCap a Taiwan day. What they teach is
// real: which ticker is which company, what a Taiwan trade really costs, and
// what an exchange at the bank really costs.
//
//   ticker  代號配對  a company, four tickers: pick its own
//   fee     手續費    a Taiwan trade, four totals: pick the fees and tax it really pays
//   fx      換匯計算  an exchange at the bank's rates: pick what it really costs or returns
//
// Pay goes into the account as a deposit with a fixed id per round
// ('game:<round>', `game: '<name>'`), set to the round's running total, so it
// syncs and merges like everything else and counts as money put in, not return.
import { ECONOMY } from './quadra.mjs';
import { GAME_COMPANIES } from './catalog.mjs';
import { tradeCosts, CURRENCIES } from './markets.mjs';

export const GAMES = {
  dailyCap: ECONOMY.gamesDailyCap.stock,
  roundSeconds: 60,
  list: ['ticker', 'fee', 'fx'],
  // Pay per right answer, the streak bonus (every `every` in a row) and what
  // a wrong answer costs: about NT$15 a minute of ordinary play (tickers take
  // about 2.5 s an answer, fees and exchanges about 8 s).
  pay: {
    ticker: { right: 0.8, every: 5, bonus: 1, wrong: 0.5 },
    fee: { right: 2.4, every: 3, bonus: 2, wrong: 1 },
    fx: { right: 2.4, every: 3, bonus: 2, wrong: 1 }
  }
};

const TPE = 8 * 3_600_000;
const dayOf = t => new Date(t + TPE).toISOString().slice(0, 10);

export function earnedToday(account, now = Date.now()) {
  const day = dayOf(now);
  return (account?.events || []).filter(e => e.game && dayOf(e.t) === day).reduce((sum, e) => sum + e.amount, 0);
}
export const roomToday = (account, now = Date.now()) => Math.max(0, GAMES.dailyCap - earnedToday(account, now));

// A round's pay so far into the account (the round's one deposit, set to its
// running total, as much as today's room allows). Returns { account, paid }.
export function payRound(account, round, game, amount, now = Date.now()) {
  const id = `game:${round}`;
  const current = account.events.find(e => e.id === id);
  const others = { ...account, events: account.events.filter(e => e.id !== id) };
  const paid = Math.max(0, Math.min(Math.round(amount), roomToday(others, now)));
  if (paid === (current?.amount ?? 0)) return { account, paid };
  const event = { id, type: 'deposit', game, t: current?.t ?? now, currency: 'TWD', amount: paid };
  if (!paid) return { account: others, paid };
  return { account: { ...account, events: current ? account.events.map(e => (e.id === id ? event : e)) : [...account.events, event] }, paid };
}

// A round's running score: right() and wrong() return the change.
export function scorer(game) {
  const rule = GAMES.pay[game];
  let sum = 0;
  let run = 0;
  return {
    right() {
      run++;
      const extra = run % rule.every === 0 ? rule.bonus : 0;
      sum += rule.right + extra;
      return rule.right + extra;
    },
    wrong() {
      run = 0;
      const cost = Math.min(sum, rule.wrong);
      sum -= cost;
      return -cost;
    },
    get total() {
      return sum;
    },
    get streak() {
      return run;
    }
  };
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];
function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const bare = symbol => symbol.replace(/\.(TW|TWO|T)$/, '');

// 代號配對: { name: [zh, en], answer, options } (tickers without the suffix).
// Wrong options come from the same market, so the numbers look alike.
export function tickerQuestion(rand = Math.random) {
  const [symbol, zh, en] = pick(GAME_COMPANIES, rand);
  const market = s => (/\.(TW|TWO)$/.test(s) ? 'tw' : /\.T$/.test(s) ? 'jp' : 'us');
  const same = GAME_COMPANIES.filter(c => market(c[0]) === market(symbol) && c[0] !== symbol);
  const wrong = shuffle(same, rand).slice(0, 3).map(c => bare(c[0]));
  return { name: [zh, en], answer: bare(symbol), options: shuffle([bare(symbol), ...wrong], rand) };
}

// 手續費: a Taiwan trade (a stock or an ETF, a buy or a sell, whole lots or an
// odd lot) and four totals of commission plus tax; one is right. The wrong
// ones are the mistakes people really make: forgetting the minimum, the
// stock tax rate on an ETF, tax on a buy, or no tax on a sale.
export function feeQuestion(rand = Math.random) {
  const kind = rand() < 0.7 ? 'stock' : 'etf';
  const side = rand() < 0.5 ? 'buy' : 'sell';
  const lots = rand() < 0.25;
  const qty = lots ? 1000 * (1 + Math.floor(rand() * 3)) : [10, 50, 100, 200, 500][Math.floor(rand() * 5)];
  const price = kind === 'etf' ? Math.round((20 + rand() * 180) * 20) / 20 : Math.round((20 + rand() * 1500) * 2) / 2;
  const gross = Math.round(price * qty);
  const right = tradeCosts({ market: 'TW', side, kind, gross, currency: 'TWD' }).total;
  const commission = Math.floor(gross * 0.001425);
  const candidates = [
    Math.max(20, commission) + (side === 'sell' ? Math.floor(gross * (kind === 'etf' ? 0.003 : 0.001)) : Math.floor(gross * 0.003)),
    commission + (side === 'sell' ? Math.floor(gross * (kind === 'etf' ? 0.001 : 0.003)) : 0),
    Math.max(20, commission) + (side === 'sell' ? 0 : Math.floor(gross * (kind === 'etf' ? 0.001 : 0.003))),
    Math.max(20, commission) * 2 + (side === 'sell' ? Math.floor(gross * (kind === 'etf' ? 0.001 : 0.003)) : 0),
    Math.round(right * 1.5)
  ];
  const wrong = [...new Set(candidates.filter(x => x !== right && x > 0))];
  while (wrong.length < 3) wrong.push(right + 10 * (wrong.length + 1));
  return { kind, side, qty, price, gross, answer: right, options: shuffle([right, ...shuffle(wrong, rand).slice(0, 3)], rand) };
}

// 換匯計算: buying foreign currency at the bank (it sells at its higher
// price) or selling it back (it buys at its lower one), and four NT$ totals.
// The wrong ones are the real mistakes: the mid rate from the news, the
// bank's price for the other direction, and paying the spread twice.
// `mids`: today's mid rates (NT$ per unit) when the app has them.
const SAMPLE_MIDS = { USD: 31.7, JPY: 0.215, EUR: 36.6, HKD: 4.07, GBP: 42.4, AUD: 20.9, CNY: 4.43, SGD: 24.4 };
const FX_AMOUNTS = { USD: [100, 300, 500, 1000, 2500], JPY: [10000, 30000, 50000, 100000], EUR: [100, 200, 500, 1000], HKD: [500, 1000, 3000], GBP: [100, 300, 800], AUD: [200, 500, 1500], CNY: [500, 1000, 3000], SGD: [200, 500, 1000] };
export function fxQuestion(rand = Math.random, mids = {}) {
  const currency = pick(Object.keys(SAMPLE_MIDS), rand);
  const mid = mids[currency] > 0 ? mids[currency] : SAMPLE_MIDS[currency] * (0.98 + rand() * 0.04);
  const spread = CURRENCIES[currency]?.spread ?? 0.003;
  const digits = mid < 1 ? 4 : 3;
  const round = x => Math.round(x * 10 ** digits) / 10 ** digits;
  const sell = round(mid * (1 + spread));
  const buy = round(mid * (1 - spread));
  const side = rand() < 0.6 ? 'buy' : 'sell';
  const amount = pick(FX_AMOUNTS[currency], rand);
  const at = rate => Math.round(amount * rate);
  const answer = side === 'buy' ? at(sell) : at(buy);
  const candidates = side === 'buy' ? [at(round(mid)), at(buy), at(round(sell * (1 + spread)))] : [at(round(mid)), at(sell), at(round(buy * (1 - spread)))];
  const wrong = [...new Set(candidates.filter(x => x !== answer && x > 0))];
  while (wrong.length < 3) wrong.push(answer + 10 * (wrong.length + 1));
  return { currency, side, amount, sell, buy, mid: round(mid), answer, options: shuffle([answer, ...wrong.slice(0, 3)], rand) };
}
