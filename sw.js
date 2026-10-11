// Service worker: funciona offline e recebe PDFs compartilhados por outros apps (Android).
const VERSION = 'pdfsigner-v1';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'signature.js',
  'manifest.webmanifest',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/pdf-lib.esm.min.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'pdfsigner-share').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Rede primeiro (pega atualizações), cache como reserva offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

async function handleShare(request) {
  const base = new URL('./', self.registration.scope);
  try {
    const form = await request.formData();
    const file = form.get('pdf');
    if (file) {
      const cache = await caches.open('pdfsigner-share');
      await cache.put('shared-file', new Response(file, {
        headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name || 'documento.pdf') },
      }));
    }
  } catch (err) {
    // ignora: abre o app normalmente
  }
  return Response.redirect(new URL('./?shared=1', base).href, 303);
}
