// JARVIS DIVE — Service worker : tout le planificateur fonctionne hors ligne.
// Incrémenter VERSION à chaque déploiement pour forcer la mise à jour du cache.
const VERSION = 'jarvis-dive-v1.0.3';
const LIB_CACHE = 'jarvis-dive-libs'; // bibliothèques externes versionnées (WebLLM) : conservées entre les mises à jour
const LIB_HOSTS = ['esm.run', 'cdn.jsdelivr.net'];
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
  'assistant/intents.js',
  'assistant/facts.js',
  'assistant/llm.js',
  'assistant/conversation.js',
  'assistant/llm-engine.js',
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
      // Ne supprime que les anciennes versions de l'app : jamais les modèles WebLLM ni les bibliothèques.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jarvis-dive-v') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Fichiers de l'app : réseau d'abord (version à jour dès qu'il y a du réseau), copie locale sinon (hors ligne).
// Chaque réponse réseau met la copie locale à jour. Les autres sites (poids des modèles…) ne sont pas interceptés.
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Bibliothèque WebLLM (URL versionnée, donc immuable) : copie locale d'abord, pour le hors ligne.
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const response = await fetch(event.request);
      if (response && response.ok) cache.put(event.request, response.clone());
      return response;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await Promise.race([
        fetch(event.request, { cache: 'no-cache' }), // revalide auprès de GitHub Pages
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
      ]);
      if (response && response.ok) cache.put(event.request, response.clone());
      return response;
    } catch {
      const hit = await cache.match(event.request, { ignoreSearch: true });
      if (hit) return hit;
      return new Response('Hors ligne et pas de copie locale.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
