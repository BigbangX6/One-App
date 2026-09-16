const CACHE_NAME = 'one-app-core-v1';

// Liste des fichiers vitaux à charger au premier démarrage
const URLS_TO_CACHE = [
    './',
    './index.html',
    './config.js',
    './manifest.json',
    './Launcher.pdf',
    './icon-512.png'
];

// Installation : on prépare le cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
    );
    self.skipWaiting();
});

// Activation : on prend le contrôle immédiat
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Stratégie : Network First, Cache Fallback
self.addEventListener('fetch', (event) => {
    // On ne met pas en cache les requêtes API vers Google Drive
    if (event.request.method !== 'GET' || event.request.url.includes('googleapis.com')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Si on a Internet, on met la nouvelle version en cache silencieusement
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return networkResponse;
            })
            .catch(() => {
                // Si on n'a pas Internet (ou mode avion), on sert la version en cache
                return caches.match(event.request);
            })
    );
});
