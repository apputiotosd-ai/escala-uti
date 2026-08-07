// Guarda apenas a casca do app: HTML, CSS, JS e icones.
// Escala, trocas e fotos NUNCA sao guardadas aqui: sao dados de pessoas
// e precisam estar sempre atualizados.

const VERSION = "v4";
const CACHE = `escala-uti-${VERSION}`;

const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png",
  "./assets/favicon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // qualquer coisa do Supabase passa direto pela rede
  if (url.hostname.endsWith(".supabase.co")) return;
  // modulos vindos de CDN: rede primeiro, cache como reserva
  const sameOrigin = url.origin === self.location.origin;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: false });

    const network = fetch(req)
      .then((res) => {
        if (res && res.ok && (sameOrigin || url.hostname === "esm.sh")) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => null);

    // casca serve rapido do cache e atualiza por tras
    if (cached) { network; return cached; }

    const fresh = await network;
    if (fresh) return fresh;

    // sem rede e sem cache: devolve a pagina inicial para o app abrir
    if (req.mode === "navigate") {
      return (await cache.match("./index.html")) ||
             new Response("Sem conexao.", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("", { status: 504 });
  })());
});
