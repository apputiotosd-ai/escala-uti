import { h, mount, clear } from "./lib/dom.js";
import { icon } from "./lib/icons.js";
import { S, sb, boot, isAdmin, refreshUnread, loadExchanges, awaitingMe, setOrg } from "./store.js";
import { loading, errorBox } from "./lib/ui.js";
import { ajustaTopo } from "./lib/sticky.js";

import { loginView, changePasswordView } from "./views/login.js";
import { scheduleView } from "./views/schedule.js";
import { myShiftsView } from "./views/mine.js";
import { boardView } from "./views/board.js";
import { pendingView } from "./views/pending.js";
import { profileView } from "./views/profile.js";
import { adminView } from "./views/admin.js";

const app = document.getElementById("app");

const ROUTES = {
  "/escala":     { title: "Escala",     view: scheduleView },
  "/meus":       { title: "Meus plantoes", view: myShiftsView },
  "/mural":      { title: "Mural",      view: boardView },
  "/pendencias": { title: "Pendencias", view: pendingView },
  "/perfil":     { title: "Perfil",     view: profileView },
  "/admin":      { title: "Coordenacao", view: adminView, admin: true },
};

const NAV = [
  { path: "/escala",     label: "Escala",  ic: "grid" },
  { path: "/meus",       label: "Meus",    ic: "clock" },
  { path: "/mural",      label: "Mural",   ic: "board" },
  { path: "/pendencias", label: "Pendente", ic: "swap", badge: true },
  { path: "/perfil",     label: "Perfil",  ic: "user" },
];

export const go = (path) => { location.hash = "#" + path; };

function currentPath() {
  const raw = (location.hash || "#/escala").slice(1);
  return raw.startsWith("/") ? raw : "/escala";
}

let pendingCount = 0;

function topBar() {
  const many = S.memberships.length > 1;
  return h("header", { class: "top" },
    h("div", { class: "top-in wrap" },
      h("img", { class: "top-mark", src: "./assets/mark.png", alt: "", "aria-hidden": "true" }),
      h("div", { class: "grow", style: { minWidth: 0 } },
        h("div", { class: "sub" }, "Escala de plantao"),
        many
          ? h("select", {
              class: "inp",
              style: { padding: "2px 4px", border: "0", background: "transparent",
                       fontSize: "14px", fontWeight: "650", width: "auto" },
              onchange: async (e) => { await setOrg(e.target.value); render(); },
            }, S.memberships.map((m) =>
                h("option", { value: m.org_id, selected: m.org_id === S.org.id },
                  m.organizations.short_name || m.organizations.name)))
          : h("h1", null, S.org.short_name || S.org.name)),
      h("div", { class: "top-actions" },
        isAdmin() && h("a", {
          class: "btn btn-icon", href: "#/admin", "aria-label": "Coordenacao",
          title: "Coordenacao",
        }, icon("cog")))));
}

function navBar(path) {
  return h("nav", { class: "nav", "aria-label": "Secoes" },
    NAV.map((n) =>
      h("a", { href: "#" + n.path, class: path === n.path ? "on" : "" },
        icon(n.ic),
        n.badge && pendingCount > 0 && h("span", { class: "dot" }),
        h("span", null, n.label))));
}

async function refreshPendingBadge() {
  try {
    const list = await loadExchanges(["pending"]);
    pendingCount = awaitingMe(list).length;
    await refreshUnread();
  } catch { /* contador e enfeite, nao derruba a tela */ }
}

let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const path = currentPath();

  if (!S.user) return mount(app, loginView(onAuthed));
  if (S.user.user_metadata?.must_change_password) {
    return mount(app, changePasswordView(async () => {
      const { data } = await sb.auth.getUser();
      S.user = data.user;
      render();
    }));
  }
  if (!S.org) {
    return mount(app, h("div", { class: "login" },
      h("div", { class: "login-box" },
        h("h2", null, "Conta sem escala"),
        h("p", { class: "sub" },
          "Seu acesso existe, mas ainda nao esta ligado a nenhuma escala. Fale com a coordenacao."),
        h("button", { class: "btn btn-block", onclick: signOut }, "Sair"))));
  }

  const route = ROUTES[path] || ROUTES["/escala"];
  if (route.admin && !isAdmin()) return go("/escala");

  const body = h("main", { class: "wrap" }, loading());
  mount(app, topBar(), body, navBar(path));

  try {
    const node = await route.view();
    if (token !== renderToken) return;      // o usuario ja navegou para outra tela
    mount(body, node);
  } catch (e) {
    if (token !== renderToken) return;
    mount(body, errorBox(e?.message || "Nao consegui carregar esta tela."));
  }
  ajustaTopo();

  refreshPendingBadge().then(() => {
    if (token !== renderToken) return;
    const dot = document.querySelector('.nav a[href="#/pendencias"]');
    if (!dot) return;
    dot.querySelector(".dot")?.remove();
    if (pendingCount > 0) dot.insertBefore(h("span", { class: "dot" }), dot.children[1]);
  });
}

export async function signOut() {
  await sb.auth.signOut();
  S.user = null; S.org = null; S.me = null; S.memberships = [];
  location.hash = "#/escala";
  render();
}

async function onAuthed() {
  const ok = await boot();
  if (!ok) return render();
  render();
}

window.addEventListener("hashchange", render);

sb.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") { S.user = null; render(); }
});

(async function start() {
  try {
    await boot();
  } catch (e) {
    mount(app, errorBox("Nao consegui falar com o servidor. " + (e?.message || "")));
    return;
  }
  render();
  registerServiceWorker();
})();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {});
}
