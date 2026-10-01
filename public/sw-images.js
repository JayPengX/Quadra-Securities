// Pictures from other sites (team, league and company logos, flags, people's
// photos), for every Quadra app's service worker (`importScripts`): kept on
// the device in one cache all the apps share, served from there at once,
// and checked again in the background after a week. Most of these sites
// tell browsers to keep a picture for seconds (ESPN's two), so without this
// every opening downloaded every logo again. A download that fails is tried
// again before the page sees an error. Part of the shared kit: edit it in
// Shared-Proxy/kit, copy it with `node kit/sync.mjs`.
const IMAGE_CACHE = 'quadra-images-v1';
const IMAGE_FRESH_MS = 7 * 86_400_000;
const IMAGE_MAX = 1_500;
const IMAGE_SAVED = 'x-quadra-saved-at';
const IMAGE_RETRY_MS = [300, 1_200];

// The page asked for a picture on another site.
const isImage = (request, url) => request.method === 'GET' && request.destination === 'image' && url.origin !== self.location.origin && url.protocol === 'https:';
// When a picture that can't be read (no CORS: kept as the page got it) was saved.
const savedNote = url => `${self.registration.scope}__image-saved?u=${encodeURIComponent(url)}`;

async function download(url) {
  for (let i = 0; ; i++) {
    try {
      // Readable when the site allows it (ESPN, NBA.com, flags), so the copy
      // carries its time; otherwise as the page would get it.
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' }).catch(() => fetch(url, { mode: 'no-cors', credentials: 'omit' }));
      if (res.type === 'opaque' || res.ok) return res;
      if (res.status < 500) return null;
    } catch {}
    if (i >= IMAGE_RETRY_MS.length) return null;
    await new Promise(done => setTimeout(done, IMAGE_RETRY_MS[i]));
  }
}

async function saveImage(cache, url) {
  const res = await download(url);
  if (!res) return null;
  const now = String(Date.now());
  if (res.type === 'opaque') {
    await cache.put(url, res.clone());
    await cache.put(savedNote(url), new Response(now));
    trimImages(cache);
    return res;
  }
  const copy = new Response(await res.blob(), { headers: { 'content-type': res.headers.get('content-type') || 'image/png', [IMAGE_SAVED]: now } });
  await cache.put(url, copy.clone());
  trimImages(cache);
  return copy;
}

async function imageAge(cache, url, hit) {
  const saved = hit.type === 'opaque' ? await (await cache.match(savedNote(url)))?.text() : hit.headers.get(IMAGE_SAVED);
  return Date.now() - (Number(saved) || 0);
}

// Oldest out first once there are too many.
let trimming = false;
async function trimImages(cache) {
  if (trimming || Math.random() > 0.05) return;
  trimming = true;
  try {
    const keys = (await cache.keys()).filter(k => !k.url.includes('__image-saved'));
    for (const old of keys.slice(0, Math.max(0, keys.length - IMAGE_MAX))) {
      await cache.delete(old);
      await cache.delete(savedNote(old.url));
    }
  } finally {
    trimming = false;
  }
}

async function image(event) {
  const url = event.request.url;
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(url);
  if (hit) {
    if ((await imageAge(cache, url, hit)) > IMAGE_FRESH_MS) event.waitUntil(saveImage(cache, url).catch(() => {}));
    return hit;
  }
  return (await saveImage(cache, url).catch(() => null)) || fetch(event.request);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (isImage(event.request, url)) event.respondWith(image(event));
});
