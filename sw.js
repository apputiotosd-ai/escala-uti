// Guarda apenas a casca do app: HTML, CSS, JS e icones.
// Escala, trocas e fotos NUNCA sao guardadas aqui: sao dados de pessoas
// e precisam estar sempre atualizados.

const VERSION = "v17";
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

// -------------------------------------------------------------
// Notificacao push
// -------------------------------------------------------------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Escala UTI" }; }

  e.waitUntil(self.registration.showNotification(d.title || "Escala UTI", {
    body: d.body || "",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    // mesma tag substitui o aviso anterior do mesmo tipo, em vez de empilhar
    tag: d.tag || "escala",
    renotify: true,
    data: { url: d.url || "./" },
    // vibra: no bolso do jaleco a tela nao e vista
    vibrate: [90, 50, 90],
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = e.notification.data?.url || "./";
  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of abas) {
      if (c.url.includes("/escala-uti")) {
        await c.focus();
        // leva a aba que ja esta aberta para a tela do aviso
        if ("navigate" in c) { try { await c.navigate(alvo); } catch { /* ignora */ } }
        return;
      }
    }
    await self.clients.openWindow(alvo);
  })());
});

// Codigo (HTML, CSS, JS) busca a rede primeiro. Assim uma correcao chega
// na primeira vez que o medico abre o app, e nao na segunda.
// Imagens e icones vem do cache primeiro, porque nao mudam.
const isCode = (url) =>
  /\.(?:html|css|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // qualquer coisa do Supabase passa direto pela rede, sem guardar nada
  if (url.hostname.endsWith(".supabase.co")) return;

  const sameOrigin = url.origin === self.location.origin;
  const guardavel = sameOrigin || url.hostname === "esm.sh";

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // 'reload' pula o cache do proprio navegador. Sem isso o GitHub Pages
    // manda max-age=600 e o medico ficaria ate 10 minutos com a versao velha.
    const buscar = (recarregar = false) =>
      fetch(recarregar ? new Request(req, { cache: "reload" }) : req)
        .then((res) => {
          if (res && res.ok && guardavel) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

    if (req.mode === "navigate" || (sameOrigin && isCode(url))) {
      const fresh = await buscar(true);
      if (fresh) return fresh;
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === "navigate") {
        return (await cache.match("./index.html")) ||
               new Response("Sem conexão.", { status: 503,
                 headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return new Response("", { status: 504 });
    }

    // resto: cache primeiro, rede por tras
    const cached = await cache.match(req);
    if (cached) { buscar(); return cached; }
    return (await buscar()) || new Response("", { status: 504 });
  })());
});
