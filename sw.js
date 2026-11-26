// sw.js — keeps the page's own files on the phone, so Mchango opens with no network.
// It fetches nothing but these files, from the address it was served from.
// A new version waits until the treasurer taps "Fungua upya" (see app.js).

const VERSION = '0.1.0';
const FILES = [
  './',
  'index.html',
  'style.css?v=0.1.0',
  'app.js?v=0.1.0',
  'parse.js?v=0.1.0',
  'store.js?v=0.1.0',
  'share.js?v=0.1.0',
  'backup.js?v=0.1.0',
  'manifest.webmanifest?v=0.1.0',
  'icons/icon-192.png?v=0.1.0',
  'icons/icon-512.png?v=0.1.0',
];
// The folder is part of the name: two copies under one address keep apart.
const PREFIX = 'mchango ' + self.registration.scope + ' ';
const CACHE = PREFIX + VERSION;

self.addEventListener('install', (event) => {
  // cache: 'reload' goes past the browser's own cache: old code can never be stored as new.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const kept = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
      return kept ?? fetch(request);
    }),
  );
});
