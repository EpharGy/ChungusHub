/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Minimal app-shell service worker: it makes the PWA installable and lets the
 * static assets load offline. API/WS/file requests always go to the network;
 * those are live data and must never be served stale.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `chungushub-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	// Never cache live data. Let it hit the network and fail loud if offline.
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/ws') {
		return;
	}

	// Cache-first for precached build assets; network-first for everything else.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(
			caches.match(request).then((cached) => cached ?? fetch(request))
		);
		return;
	}

	event.respondWith(
		fetch(request).catch(() => caches.match(request).then((cached) => cached ?? caches.match('/')) as Promise<Response>)
	);
});
