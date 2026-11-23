const CACHE = 'guide-v9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/geo.js',
  './js/router.js',
  './js/belief.js',
  './js/lexicon.js',
  './js/landmark.js',
  './js/guidance.js',
  './js/flags.js',
  './js/cue.js',
  './js/flag-mode.js',
  './js/flag-ui.js',
  './js/speech.js',
  './js/location.js',
  './js/storage.js',
  './js/log.js',
  './js/chat.js',
  './js/chat-ui.js',
  './js/route-ui.js',
  './data/routes/jamwon4-le-four.json',
  './data/photos/exit4.svg',
  './data/photos/entrance.svg',
  './data/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isRouteData(url) {
  return url.pathname.includes('/data/routes/') && url.pathname.endsWith('.json');
}

// 경로 JSON은 네트워크 우선: 같은 캐시 버전에서 데이터만 바뀌어도 새로 받는다.
async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  } catch {
    const hit = await caches.match(request);
    return hit || new Response('', { status: 504 });
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  } catch {
    if (request.mode === 'navigate') return caches.match('./index.html');
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(isRouteData(url) ? networkFirst(e.request) : cacheFirst(e.request));
});
