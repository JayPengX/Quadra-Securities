// Syncs the practice brokerage account across devices through the shared Worker's
// /stock-sync route (Firestore behind it). One 8-character passcode is both
// the account's address and its only key; the Worker stores the account
// under the passcode's hash, never the passcode itself. The account travels
// gzip-compressed (see codec.mjs).
import { pack, unpack } from './codec.mjs';

export const SYNC_URL = 'https://orbit-workers-proxy.pengzjay.workers.dev/stock-sync';
export const PASSCODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;

// What people type: lower case, spaces and dashes are fine. (Passcodes never
// use 0, 1, O or I, so they can't be misread.)
export function cleanPasscode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

async function request(method, { passcode, payload } = {}) {
  const url = passcode ? `${SYNC_URL}?passcode=${encodeURIComponent(passcode)}` : SYNC_URL;
  const res = await fetch(url, {
    method,
    headers: payload ? { 'Content-Type': 'application/json' } : {},
    body: payload ? JSON.stringify({ payload }) : undefined,
    signal: AbortSignal.timeout(20_000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.error?.message || `HTTP ${res.status}`);
    error.code = body?.error?.code || `HTTP_${res.status}`;
    throw error;
  }
  return body;
}

// New synced account: returns its passcode.
export async function createSync(account) {
  const { passcode } = await request('POST', { payload: await pack(account) });
  return passcode;
}

// The synced account, or null if no account has this passcode.
export async function readSync(passcode) {
  const body = await request('GET', { passcode });
  if (!body.exists || !body.payload) return null;
  return unpack(body.payload);
}

// The most the Worker keeps for one account (STOCK_SYNC_APP, the same limit as /odds-sync).
export const SYNC_MAX_LENGTH = 1_000_000;

export async function writeSync(passcode, account) {
  const payload = await pack(account);
  if (payload.length > SYNC_MAX_LENGTH) {
    const error = new Error('account too big to sync');
    error.code = 'TOO_BIG';
    throw error;
  }
  await request('PATCH', { passcode, payload });
}
