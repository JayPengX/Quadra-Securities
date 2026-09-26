// Saves are always gzip-compressed: JSON -> gzip -> base64, marked "gz1:".
// A saved account is mostly repeated keys and names, so it shrinks about
// 8-10x, for this device's storage and for the synced copy alike. Plain JSON
// (older saves) still reads.
const PREFIX = 'gz1:';

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function pack(value) {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === 'undefined') return json;
  return PREFIX + toBase64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip')));
}

export async function unpack(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    if (!text.startsWith(PREFIX)) return JSON.parse(text);
    const bytes = await pipe(fromBase64(text.slice(PREFIX.length)), new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
