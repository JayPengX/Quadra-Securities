// Numbers, money, prices, dates, in the page's language.
import { currencyInfo } from './markets.mjs';

let locale = 'zh';
const cache = new Map();
export function setFormatLocale(l) {
  locale = l;
  cache.clear();
}
const tag = () => (locale === 'zh' ? 'zh-TW' : 'en-US');
function nf(min, max) {
  const key = `${min}/${max}`;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(tag(), { minimumFractionDigits: min, maximumFractionDigits: max }));
  return cache.get(key);
}

export const num = (n, digits = 0, min = digits) => (Number.isFinite(n) ? nf(min, digits).format(n) : '—');

// NT$1,234 · US$12.50 · −€3.20 · +NT$500 (with sign).
export function money(amount, currency, { sign = false, digits } = {}) {
  if (!Number.isFinite(amount)) return '—';
  const info = currencyInfo(currency);
  const d = digits ?? info.digits;
  const body = `${info.symbol}${nf(d, d).format(Math.abs(amount))}`;
  if (amount < 0 && Math.abs(amount) >= 0.5 * 10 ** -d) return `−${body}`;
  return sign && amount > 0 ? `+${body}` : body;
}

// A price: as many decimals as it needs (0.000012 for a tiny coin).
export function price(p, currency) {
  if (!Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  const max = a >= 1000 ? 2 : a >= 1 ? (currencyInfo(currency).digits === 0 && a >= 100 ? 2 : 3) : a >= 0.01 ? 4 : 8;
  const min = a >= 1 && currencyInfo(currency).digits > 0 ? 2 : 0;
  return nf(Math.min(min, max), max).format(p);
}

export function pct(x, { digits = 2, sign = true } = {}) {
  if (!Number.isFinite(x)) return '—';
  const body = `${nf(digits, digits).format(Math.abs(x) * 100)}%`;
  if (x < 0 && Math.abs(x) * 100 >= 0.5 * 10 ** -digits) return `−${body}`;
  return sign && x > 0 ? `+${body}` : body;
}

export function qty(n) {
  if (!Number.isFinite(n)) return '—';
  return nf(0, Math.abs(n) >= 1000 ? 3 : 8).format(n);
}

// Short forms for chart axes: 1.2萬 / 3.4億 in Chinese, 12K / 3.4M in English.
export function compact(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (locale === 'zh') {
    if (a >= 1e12) return `${s}${nf(0, a >= 1e14 ? 0 : 2).format(a / 1e12)}兆`;
    if (a >= 1e8) return `${s}${nf(0, a >= 1e10 ? 0 : 2).format(a / 1e8)}億`;
    if (a >= 1e4) return `${s}${nf(0, a >= 1e6 ? 0 : 1).format(a / 1e4)}萬`;
    return `${s}${nf(0, a < 10 ? 2 : 0).format(a)}`;
  }
  if (a >= 1e12) return `${s}${nf(0, 2).format(a / 1e12)}T`;
  if (a >= 1e9) return `${s}${nf(0, 1).format(a / 1e9)}B`;
  if (a >= 1e6) return `${s}${nf(0, 1).format(a / 1e6)}M`;
  if (a >= 1e4) return `${s}${nf(0, 0).format(a / 1e3)}K`;
  return `${s}${nf(0, a < 10 ? 2 : 0).format(a)}`;
}

function dtf(options, timeZone = 'Asia/Taipei') {
  const key = `dt:${timeZone}:${JSON.stringify(options)}`;
  if (!cache.has(key)) {
    try {
      cache.set(key, new Intl.DateTimeFormat(tag(), { ...options, timeZone }));
    } catch {
      cache.set(key, new Intl.DateTimeFormat(tag(), options));
    }
  }
  return cache.get(key);
}

export const dateTime = (t, tz) => dtf({ month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }, tz).format(t);
export const date = (t, tz) => dtf({ year: 'numeric', month: 'numeric', day: 'numeric' }, tz).format(t);
export const shortDate = (t, tz) => dtf({ month: 'numeric', day: 'numeric' }, tz).format(t);
export const clock = (t, tz) => dtf({ hour: '2-digit', minute: '2-digit', hour12: false }, tz).format(t);
export const weekdayClock = (t, tz) => dtf({ weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }, tz).format(t);
export const monthYear = (t, tz) => dtf({ year: 'numeric', month: 'short' }, tz).format(t);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
