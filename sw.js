const CACHE = 'huawen-lab-v2-vocabulary';
const ASSETS = [
  './',
  './index.html',
  './icon.svg',
  './manifest.webmanifest',
  './data/vocabulary.json',
  './data/content.js',
  './data/activities.js',
  './styles/base.css',
  './styles/layout.css',
  './styles/components.css',
  './styles/activities.css',
  './styles/responsive.css',
  './js/app.js',
  './js/navigation.js',
  './js/activity-context.js',
  './js/utils.js',
  './js/state.js',
  './js/storage.js',
  './js/mastery.js',
  './js/speech-service.js',
  './js/essay-sentence-service.js',
  './js/writing-checks.js',
  './js/views.js',
  './js/session.js',
  './js/vocabulary-schema.js',
  './js/vocabulary-service.js',
  './js/vocabulary-store.js',
  './js/vocabulary-file.js',
  './js/vocabulary-worker.js',
  './components/vocabulary-library.js',
  './styles/vocabulary.css',
  './vendor/xlsx.mjs',
  './templates/vocabulary-template.csv',
  './components/modal.js',
  './components/drag.js',
  './components/garden.js',
  './activities/recognition.js',
  './activities/matching.js',
  './activities/cloze.js',
  './activities/memory.js',
  './activities/ordering.js',
  './activities/sentenceBuilder.js',
  './activities/sentenceExpansion.js',
  './activities/sentenceDoctor.js',
  './activities/semantic.js',
  './activities/connectors.js',
  './activities/writing.js',
  './activities/treasure.js',
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('huawen-lab-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(event.request);
        if (hit) return hit;
        if (event.request.mode === 'navigate')
          return (await caches.match('./index.html')) || Response.error();
        return Response.error();
      }),
  );
});
