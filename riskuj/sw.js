/* Riskuj na webe: mobil si hru uloží, aby sa otvorila aj tam, kde nie je signál.
   Keď je internet, vždy sa načíta najnovšia verzia; bez internetu (alebo keď sieť neodpovedá do 3 s) uložená. */
const CACHE = 'riskuj';
// pri inštalácii sa hneď uloží celá hra (aj keď prvé otvorenie stránky ešte nešlo cez tento skript)
const SUBORY = ['riskuj-mobily.html', 'manifest.webmanifest', 'ikona-192.png', 'ikona-512.png'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SUBORY)).catch(() => {}));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const kluc = url.origin + url.pathname;            // bez ?… a #hra=… – kód hry z odkazu sa nesmie uložiť
  e.respondWith((async () => {
    const ulozena = await caches.match(kluc);
    // uložená stránka sa vráti ako nová odpoveď, aby si prehliadač nechal adresu (aj #hra=…) z aktuálneho odkazu
    const zCache = () => ulozena.blob().then(t => new Response(t, {status: 200, headers: {'Content-Type': ulozena.headers.get('Content-Type') || 'text/html'}}));
    const siet = fetch(req).then(r => {
      if (r.ok) { const kopia = r.clone(); caches.open(CACHE).then(c => c.put(kluc, kopia)); }
      return r;
    });
    if (!ulozena) return siet;
    return Promise.race([siet.catch(zCache), new Promise(res => setTimeout(() => res(zCache()), 3000))]);
  })());
});
