// Service worker de One App : permet d'ouvrir One App sans réseau.
// Les données (apps, documents) ne passent pas par ici : elles sont gardées
// dans IndexedDB par index.html (voir ARCHITECTURE.md, « Local d'abord »).
const CACHE_NAME = 'one-app-v2';

// Fichiers indispensables, mis en cache dès l'installation
const CORE_FILES = [
    './',
    './index.html',
    './config.js',
    './manifest.json',
    './icon-512.png'
];

// Au-delà de ce délai, on sert la version en cache (réseau très lent)
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES))
    );
    self.skipWaiting();
});

// Activation : suppression des anciens caches (dont celui du premier essai PWA)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Seules les lectures de One App elle-même sont gérées. Google (Drive,
    // connexion, Picker) et les autres sites passent directement par le réseau.
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
    } else {
        event.respondWith(staleWhileRevalidate(request));
    }
});

// Page : réseau d'abord (toujours la dernière version), cache si hors-ligne ou trop lent.
// Le cache est indexé sans les paramètres (?file=...) : une seule copie de la page.
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const fromNetwork = fetch(request).then((response) => {
        if (response.ok) cache.put(request.url.split('?')[0], response.clone());
        return response;
    });
    fromNetwork.catch(() => {}); // échec réseau géré ci-dessous

    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
        const response = await Promise.race([fromNetwork, timeout]);
        if (response) return response;
    } catch (e) {
        // Hors-ligne : on passe au cache
    }

    const cached = await cache.match(request, { ignoreSearch: true }) || await cache.match('./index.html');
    if (cached) return cached;
    return fromNetwork; // rien en cache : on attend le réseau malgré tout
}

// Autres fichiers : réponse immédiate depuis le cache, mise à jour en arrière-plan
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const fromNetwork = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => cached);
    return cached || fromNetwork;
}
