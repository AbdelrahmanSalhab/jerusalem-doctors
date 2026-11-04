// The installed app's offline page: a page that can't load because there is
// no network shows /offline.html instead of the browser's error. Nothing a
// doctor sees is stored on the phone; every other request goes to the network
// untouched. And an admin's notifications (lib/push.ts): a push shows its
// title and opens its link when tapped. Registered by
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

// A path in this app, else the admin panel: a push carries a link, and a
// link that leaves the site is not one we sent.
const safePath = (url) => (typeof url === "string" && /^\/(?![\/\\])/.test(url) ? url : "/admin");

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable body still has to show something: the browsers
    // that deliver one require a notification for every push.
  }
  event.waitUntil(
    self.registration.showNotification(typeof data.title === "string" && data.title ? data.title : "دليل أطباء القدس", {
      // A newer notification with the same tag replaces the older one.
      tag: typeof data.tag === "string" ? data.tag : undefined,
      // Without it, a second signup replaces the first on the same device with
      // no sound or buzz, and the admin never learns there were two.
      renotify: typeof data.tag === "string",
      icon: "/icon-192.png",
      lang: "ar",
      dir: "rtl",
      data: { url: safePath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
