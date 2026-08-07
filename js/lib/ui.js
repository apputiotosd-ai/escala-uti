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
