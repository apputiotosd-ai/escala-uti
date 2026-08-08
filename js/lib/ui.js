// Pecas visuais reaproveitadas pelas telas.
import { h } from "./dom.js";
import { icon } from "./icons.js";
import { S, avatarUrl } from "../store.js";
import { initials, shortName, br, brDow } from "./dates.js";
import { SHIFT_INFO } from "../config.js";

/** Foto de rosto. Sem foto, mostra as iniciais. A minha aparece colorida. */
export function avatar(memberId, size = "") {
  const m = S.byId.get(memberId);
  const mine = memberId && memberId === S.me?.id ? " me" : "";
  const url = avatarUrl(m?.avatar_path);
  if (url) {
    return h("img", {
      class: `ava${size ? " " + size : ""}${mine}`,
      src: url, alt: m?.full_name || "", loading: "lazy",
      onerror: (e) => { e.target.replaceWith(placeholder(m, size, mine)); },
    });
  }
  return placeholder(m, size, mine);
}

function placeholder(m, size, mine) {
  return h("span", {
    class: `ava ava-ph${size ? " " + size : ""}${mine}`,
    "aria-hidden": "true",
  }, initials(m?.full_name));
}

/**
 * Amplia a foto por cima da tela, sem mexer no layout de baixo.
 * Fecha tocando em qualquer lugar ou com Esc.
 */
export function ampliaFoto(memberId) {
  const m = S.byId.get(memberId);
  const url = avatarUrl(m?.avatar_path);
  if (!url) return;                     // sem foto nao tem o que ampliar

  const fechar = () => { caixa.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (e) => { if (e.key === "Escape") fechar(); };

  const caixa = h("div", {
    class: "fotozoom", role: "dialog", "aria-label": `Foto de ${m.full_name}`,
    onclick: fechar,
  },
    h("img", { src: url, alt: m.full_name || "" }),
    h("div", { class: "fotozoom-nome" }, m.full_name || ""));

  document.addEventListener("keydown", tecla);
  document.body.append(caixa);
}

/** Foto que amplia ao toque. Igual a normal, so ganha o gesto. */
export function avatarAmpliavel(memberId, size = "") {
  const m = S.byId.get(memberId);
  const el = avatar(memberId, size);
  if (!m?.avatar_path) return el;

  el.classList.add("ava-zoom");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("title", "Toque para ampliar");
  el.addEventListener("click", (e) => { e.stopPropagation(); ampliaFoto(memberId); });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ampliaFoto(memberId); }
  });
  return el;
}

/**
 * Telefone brasileiro para link do WhatsApp.
 * Celular com DDD tem 11 digitos, 10 se for fixo antigo. Com o pais, 12 ou 13.
 * Devolve null quando o numero nao tem cara de telefone.
 */
export function whatsUrl(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length >= 12 && d.startsWith("55")) return `https://wa.me/${d}`;
  if (d.length === 10 || d.length === 11) return `https://wa.me/55${d}`;
  return `https://wa.me/${d}`;
}

/** (85) 98931-2299 */
export function telFormatado(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(phone || "");
}

/** Numero com o atalho para abrir a conversa no WhatsApp. */
export function linhaWhats(phone) {
  const url = whatsUrl(phone);
  if (!url) return null;
  return h("a", {
    class: "whats", href: url, target: "_blank", rel: "noopener",
    onclick: (e) => e.stopPropagation(),
  }, icon("whats"), h("span", { class: "mono" }, telFormatado(phone)));
}

export const shiftBadge = (s) => h("span", { class: `shift ${s}` }, s);

export const shiftHours = (s) => SHIFT_INFO[s]?.hours || "";

/** Nome do plantonista. Se houve troca, o nome antigo fica riscado em cima. */
export function personLabel(row) {
  const m = S.byId.get(row?.member_id);
  if (!m) return h("span", { class: "srow-vago" }, "sem plantonista");

  const changed = row.base_member_id && row.base_member_id !== row.member_id;
  const name = shortName(m.full_name, m.display_name);
  if (!changed) return h("span", { class: "srow-n" }, name);

  const was = S.byId.get(row.base_member_id);
  return h("span", { class: "swapped grow" },
    was && h("span", { class: "was" }, shortName(was.full_name, was.display_name)),
    h("span", { class: "srow-n" }, name));
}

export const dateChip = (d, shift) =>
  h("span", { class: "card-row", style: { gap: "6px" } },
    h("span", { class: "t-date mono" }, br(d)),
    shiftBadge(shift),
    h("span", { class: "meta mono" }, shiftHours(shift)));

export const emptyState = (msg, ic = "empty") =>
  h("div", { class: "empty" }, icon(ic), h("div", null, msg));

export const loading = (msg = "Carregando") => h("div", { class: "load" }, msg);

export const errorBox = (msg) => h("div", { class: "err" }, msg);

export function unitPicker(value, onChange, { allowAll = false } = {}) {
  const sel = h("select", { class: "inp", onchange: (e) => onChange(e.target.value) });
  if (allowAll) sel.append(h("option", { value: "" }, "Todas as UTIs"));
  for (const u of S.units) {
    sel.append(h("option", { value: u.id, selected: u.id === value }, u.name));
  }
  return sel;
}

export function memberPicker(value, onChange, { blank = "Vago" } = {}) {
  const sel = h("select", { class: "inp", onchange: (e) => onChange(e.target.value || null) });
  sel.append(h("option", { value: "" }, blank));
  for (const m of S.members.filter((x) => x.is_active)) {
    sel.append(h("option", { value: m.id, selected: m.id === value }, m.full_name));
  }
  return sel;
}

/** Resumo de um plantao, usado no mural e nas pendencias. */
export function shiftLine(unitId, date, shift) {
  return h("div", { class: "card-row", style: { gap: "7px" } },
    h("span", { class: `tick ${shift}`, style: { height: "17px" } }),
    h("span", { class: "t-date mono" }, brDow(date)),
    shiftBadge(shift),
    h("span", { class: "meta mono" }, S.unitById.get(unitId)?.name || ""));
}
