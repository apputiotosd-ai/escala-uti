import { h, mount } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, loadSchedule, cell, isAdmin } from "../store.js";
import { avatar, personLabel, shiftBadge } from "../lib/ui.js";
import {
  today, addDays, dow, DOW, monthBounds, monthLabel,
  currentShift, shortName, isWeekend,
} from "../lib/dates.js";
import { SHIFTS, SHIFT_INFO } from "../config.js";
import { openShiftSheet } from "./shift-sheet.js";

// lembra onde o usuario estava ao voltar para a tela
const view = { y: null, m: null, unit: "", scrolled: false };

export async function scheduleView() {
  const now = new Date();
  if (view.y === null) { view.y = now.getFullYear(); view.m = now.getMonth(); }

  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const b = monthBounds(view.y, view.m);
  // carrega a grade inteira do mes, inclusive as bordas que completam as semanas
  const sch = await loadSchedule(b.gridStart, b.gridEnd);

  const body = h("div");
  mount(root,
    nowStrip(sch),
    tabs(root),
    monthNav(root),
    body);

  const single = view.unit && S.unitById.get(view.unit);
  mount(body,
    dayList(sch, b, single ? [S.unitById.get(view.unit)] : S.units, root),
    single ? monthGrid(sch, b, S.unitById.get(view.unit), root) : null);

  // com "Todas" nao existe grade de mes: a lista serve nas duas larguras
  body.querySelector(".daylist").style.display = single ? "" : "block";

  // a lista do mes e longa. Na primeira abertura do mes corrente,
  // leva a tela direto para hoje em vez de deixar o medico rolando.
  const now = new Date();
  if (!view.scrolled && view.y === now.getFullYear() && view.m === now.getMonth()) {
    view.scrolled = true;
    requestAnimationFrame(() => {
      root.querySelector(".day.is-today")?.scrollIntoView({ block: "center" });
    });
  }
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

/* ---------------- quem esta de plantao agora ---------------- */
function nowStrip(sch) {
  const { shift, date } = currentShift();
  return h("section", { class: "now" },
    h("div", { class: "bar" },
      h("span", null, "Agora"),
      h("span", { class: "mono", style: { letterSpacing: ".06em" } },
        `${SHIFT_INFO[shift].label} ${SHIFT_INFO[shift].hours}`)),
    h("div", { class: "now-grid" },
      S.units.map((u) => {
        const row = cell(sch, date, u.id, shift);
        const m = row && S.byId.get(row.member_id);
        return h("div", { class: "now-cell" },
          h("span", { class: "now-u" }, u.name),
          m
            ? h("span", { class: "now-p" }, avatar(row.member_id),
                h("span", { class: "now-n" }, shortName(m.full_name, m.display_name)))
            : h("span", { class: "now-empty" }, "sem plantonista"));
      })));
}

/* ---------------- abas ---------------- */
function tabs(root) {
  const mk = (id, label) =>
    h("button", {
      class: "tab", role: "tab", "aria-selected": String(view.unit === id),
      onclick: () => { view.unit = id; reload(root); },
    }, label);
  return h("div", { class: "tabs", role: "tablist", style: { top: "0" } },
    mk("", "Todas"),
    S.units.map((u) => mk(u.id, u.name)));
}

/* ---------------- navegacao de mes ---------------- */
function monthNav(root) {
  const step = (n) => {
    let m = view.m + n, y = view.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    view.m = m; view.y = y;
    reload(root);
  };
  const now = new Date();
  const isNow = view.y === now.getFullYear() && view.m === now.getMonth();
  return h("div", { class: "monthbar" },
    h("button", { class: "btn btn-icon", onclick: () => step(-1), "aria-label": "Mes anterior" }, icon("left")),
    h("span", { class: "label" }, monthLabel(view.y, view.m)),
    h("button", { class: "btn btn-icon", onclick: () => step(1), "aria-label": "Proximo mes" }, icon("right")),
    h("button", {
      class: "btn btn-sm", style: { marginLeft: "8px", visibility: isNow ? "hidden" : "" },
      onclick: () => {
        view.y = now.getFullYear(); view.m = now.getMonth(); view.scrolled = false;
        reload(root);
      },
    }, "Hoje"));
}

/* ---------------- lista de dias ---------------- */
function dayList(sch, b, units, root) {
  const list = h("div", { class: "daylist" });
  const t = today();
  let d = b.first;
  let any = false;

  while (d <= b.last) {
    const rows = [];
    for (const u of units) {
      for (const s of SHIFTS) {
        const row = cell(sch, d, u.id, s);
        if (!row && units.length > 1) continue;   // em "Todas", nao polui com turno inexistente
        rows.push(shiftRow(d, u, s, row, root));
        if (row?.member_id) any = true;
      }
      const dia = sch.rounds.get(`${d}|${u.id}`);
      if (dia?.length) rows.push(roundsRow(u, dia));
    }
    if (rows.length) {
      list.append(h("div", {
        class: `day${d === t ? " is-today" : ""}${isWeekend(d) ? " is-weekend" : ""}`,
      },
        h("div", { class: "day-d" },
          h("div", { class: "day-num" }, String(Number(d.slice(8)))),
          h("div", { class: "day-dow" }, DOW[dow(d)])),
        h("div", { class: "day-rows" }, rows)));
    }
    d = addDays(d, 1);
  }

  // Mes inteiro sem ninguem escalado: mostrar 372 linhas vazias nao ajuda.
  if (!any) {
    list.replaceChildren(h("div", { class: "empty" },
      icon("empty"),
      h("div", null, "A escala fixa ainda nao foi preenchida."),
      isAdmin()
        ? h("a", { class: "btn btn-primary", href: "#/admin",
                   style: { marginTop: "14px" } }, "Preencher a escala fixa")
        : h("div", { style: { marginTop: "6px" } }, "A coordenacao ainda esta montando.")));
  }
  return list;
}

function shiftRow(date, unit, shift, row, root) {
  const mine = row?.member_id && row.member_id === S.me.id;
  return h("button", {
    class: `srow${mine ? " mine" : ""}`,
    style: { width: "100%", background: mine ? undefined : "none", border: "0", textAlign: "left" },
    onclick: () => openShiftSheet({ date, unit, shift, row, onChanged: () => reload(root) }),
  },
    h("span", { class: `tick ${shift}` }),
    h("span", { class: "srow-u" }, unit.name.replace("UTI ", "")),
    shiftBadge(shift),
    row?.member_id ? avatar(row.member_id) : null,
    personLabel(row),
    h("span", { class: "srow-h mono" }, SHIFT_INFO[shift].hours));
}

function roundsRow(unit, memberIds) {
  return h("div", { class: "srow", style: { minHeight: "32px", opacity: ".78" } },
    h("span", { class: "tick", style: { background: "var(--ink-3)" } }),
    h("span", { class: "srow-u" }, unit.name.replace("UTI ", "")),
    h("span", { class: "shift", style: { color: "var(--ink-3)" } }, "DIA"),
    memberIds.map((id) => avatar(id)),
    h("span", { class: "srow-n" },
      memberIds.map((id) => {
        const m = S.byId.get(id);
        return shortName(m?.full_name, m?.display_name);
      }).join(", ")),
    h("span", { class: "srow-h mono" }, "diarista"));
}

/* ---------------- grade do mes ---------------- */
function monthGrid(sch, b, unit, root) {
  const head = h("div", { class: "mg-head" }, DOW.map((d) => h("div", null, d)));
  const body = h("div", { class: "mg-body" });
  const t = today();

  let d = b.gridStart;
  while (d <= b.gridEnd) {
    const out = d < b.first || d > b.last;
    const cellEl = h("div", { class: `mg-cell${out ? " out" : ""}${d === t ? " today" : ""}` },
      h("div", { class: "mg-num" }, String(Number(d.slice(8)))));

    if (!out) {
      for (const s of SHIFTS) {
        const row = cell(sch, d, unit.id, s);
        const m = row && S.byId.get(row.member_id);
        const mine = row?.member_id === S.me.id;
        const date = d;
        cellEl.append(h("button", {
          class: `mg-s${mine ? " mine" : ""}`,
          style: { border: "0", background: "none", padding: "0", width: "100%", textAlign: "left" },
          onclick: () => openShiftSheet({ date, unit, shift: s, row, onChanged: () => reload(root) }),
          title: `${SHIFT_INFO[s].label} ${SHIFT_INFO[s].hours}`,
        },
          shiftBadge(s),
          m ? avatar(row.member_id) : null,
          h("span", { class: "nm" }, m ? shortName(m.full_name, m.display_name) : "vago")));
      }
    }
    body.append(cellEl);
    d = addDays(d, 1);
  }
  return h("div", { class: "monthgrid" }, head, body);
}
