// The installed app's offline page, and nothing else: a page that can't
// load because there is no network shows /offline.html instead of the
// browser's error. Nothing a doctor sees is stored on the phone; every
// other request goes to the network untouched. Registered by
// components/install/InstallProvider.tsx.

const CACHE = "offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE, { cache: "reload" }))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The page request starts while this worker wakes, so it adds no wait.
      await self.registration.navigationPreload?.enable();
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return (await caches.match(OFFLINE)) || Response.error();
      }
    })(),
  );
});
