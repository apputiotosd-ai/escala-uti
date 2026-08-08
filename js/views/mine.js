import { h, mount } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, myShifts, loadOffers } from "../store.js";
import { shiftBadge, emptyState } from "../lib/ui.js";
import { br, DOW, DOW3, dow, addDays, monthLabel, isWeekend } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";
import { openShiftSheet } from "./shift-sheet.js";

const HORAS = { M: 6, T: 6, SN: 12 };

export async function myShiftsView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const [rows, offers] = await Promise.all([myShifts(180), loadOffers()]);
  const noMural = new Set(
    offers.filter((o) => o.owner_id === S.me.id)
      .map((o) => `${o.unit_id}|${o.work_date}|${o.shift}`));

  const total = rows.length;
  const noites = rows.filter((r) => r.shift === "SN").length;
  const fds = rows.filter((r) => isWeekend(r.work_date)).length;
  const horas = rows.reduce((s, r) => s + HORAS[r.shift], 0);

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Meus plantoes"),
      h("span", { class: "mono" }, "proximos 6 meses")),

    total === 0
      ? emptyState("Voce nao tem plantao marcado daqui para a frente.", "clock")
      : h("div", null,
          h("div", { class: "card" },
            h("div", { class: "card-b card-row", style: { gap: "16px" } },
              stat(total, total === 1 ? "plantao" : "plantoes"),
              stat(noites, noites === 1 ? "noite" : "noites"),
              stat(fds, "fim de semana", "fins de semana"),
              stat(horas, "hora", "horas"))),
          listaPorMes(rows, noMural, root)));
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

const stat = (n, sing, plur) => h("div", null,
  h("div", { class: "mono", style: { fontSize: "21px", fontWeight: "700", lineHeight: "1.1" } }, String(n)),
  h("div", { class: "meta" }, n === 1 ? sing : (plur || sing)));

/** Agrupa por mes: seis meses de plantao numa lista corrida nao se le. */
function listaPorMes(rows, noMural, root) {
  const box = h("div", { class: "mine-list" });
  let mesAtual = null;

  for (const r of rows) {
    const [y, m] = r.work_date.split("-").map(Number);
    const chave = `${y}-${m}`;
    if (chave !== mesAtual) {
      mesAtual = chave;
      const doMes = rows.filter((x) => x.work_date.startsWith(`${y}-${String(m).padStart(2, "0")}`));
      box.append(h("div", { class: "bar", style: { marginTop: "14px" } },
        h("span", null, monthLabel(y, m - 1)),
        h("span", { class: "mono" },
          doMes.length === 1 ? "1 plantao" : `${doMes.length} plantoes`)));
    }
    box.append(linha(r, noMural, root));
  }
  return box;
}

function linha(r, noMural, root) {
  const unit = S.unitById.get(r.unit_id);
  const info = SHIFT_INFO[r.shift];
  const anunciado = noMural.has(`${r.unit_id}|${r.work_date}|${r.shift}`);
  const assumido = r.base_member_id && r.base_member_id !== r.member_id;
  const d = dow(r.work_date);

  return h("button", {
    class: `mine-row${isWeekend(r.work_date) ? " fds" : ""}`,
    onclick: () => openShiftSheet({
      date: r.work_date, unit, shift: r.shift, row: r, onChanged: () => reload(root),
    }),
  },
    h("span", { class: `tick ${r.shift}` }),

    h("span", { class: "mine-dia" },
      h("span", { class: "mine-num mono" }, r.work_date.slice(8)),
      h("span", { class: "mine-dow" }, DOW[d])),

    h("span", { class: "mine-txt" },
      // data por extenso, sem o medico ter que montar na cabeca
      h("span", { class: "mine-data mono" }, `${DOW3[d]}, ${br(r.work_date)}`),
      h("span", { class: "mine-turno" },
        shiftBadge(r.shift),
        h("span", { class: "strong" }, info.label),
        h("span", { class: "mono" }, info.hours),
        h("span", { class: "mine-uti" }, unit?.name || "")),
      r.shift === "SN" &&
        h("span", { class: "meta mono" }, `termina ${br(addDays(r.work_date, 1))} as 07h`)),

    h("span", { class: "mine-tag" },
      anunciado ? h("span", { class: "chip wait" }, "no mural")
        : assumido ? h("span", { class: "chip ok" }, "assumido") : null,
      icon("right", "mine-seta")));
}
