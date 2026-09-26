// Friend leagues through the shared Worker's /stock-league route: friends
// share one 8-character league code and compare their play-money returns.
// Each person posts one row (nickname, return, net worth, what they put in,
// top holdings); only the browser holding the row's secret can change it.
export const LEAGUE_URL = 'https://orbit-workers-proxy.pengzjay.workers.dev/stock-league';
export const LEAGUE_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

async function request(method, { code, query = {}, body } = {}) {
  const params = new URLSearchParams({ ...(code ? { code } : {}), ...query });
  const res = await fetch(`${LEAGUE_URL}${params.size ? `?${params}` : ''}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `HTTP ${res.status}`);
    error.code = data?.error?.code || `HTTP_${res.status}`;
    throw error;
  }
  return data;
}

export const createLeague = name => request('POST', { body: { name } });
export const readLeague = code => request('GET', { code });
export const postRow = (code, me, row) => request('PATCH', { code, body: { id: me.id, secret: me.secret, ...row } });
export const leaveLeague = (code, me) => request('DELETE', { code, query: { member: me.id, secret: me.secret } });

// The row this account shows its friends: return on what was put in (so a
// NT$100,000 account and a NT$10,000,000 one compare fairly).
export function leagueRow(nick, valuation, account) {
  const top = [...valuation.positions]
    .filter(p => !p.short)
    .sort((a, b) => b.valueTWD - a.valueTWD)
    .slice(0, 5)
    .map(p => ({ s: p.symbol, n: p.name || p.symbol, w: Math.round(p.weight * 1000) / 1000 }));
  return {
    nick,
    pct: valuation.totalReturnPct,
    nw: Math.round(valuation.netWorth),
    dep: Math.round(valuation.deposits),
    since: account.created,
    trades: account.events.filter(e => e.type === 'fill').length,
    top
  };
}

// Members best first; ties by who got there first.
export function ranked(members) {
  return [...members].filter(m => Number.isFinite(m.pct)).sort((a, b) => b.pct - a.pct || a.since - b.since);
}
