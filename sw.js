// JARVIS DIVE — Service worker : tout le planificateur fonctionne hors ligne.
// Incrémenter VERSION à chaque déploiement pour forcer la mise à jour du cache.
const VERSION = 'jarvis-dive-v0.4.0';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'engine/zhl16c.js',
  'engine/gases.js',
  'engine/oxygen.js',
  'engine/planner.js',
  'engine/errors.js',
  'engine/scenarios.js',
  'assistant/commands.js',
  'assistant/parser.js',
  'assistant/summary.js',
  'i18n.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache d'abord pour les fichiers de l'app ; les appels au LLM (autre origine) ne sont jamais interceptés.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
