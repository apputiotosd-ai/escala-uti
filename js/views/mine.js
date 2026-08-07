import { h, mount } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, myShifts, loadOffers } from "../store.js";
import { shiftBadge, emptyState, shiftHours } from "../lib/ui.js";
import { brDow, br, DOW3, dow, addDays } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";
import { openShiftSheet } from "./shift-sheet.js";

export async function myShiftsView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const [rows, offers] = await Promise.all([myShifts(180), loadOffers()]);
  const mineOffered = new Set(
    offers.filter((o) => o.owner_id === S.me.id)
      .map((o) => `${o.unit_id}|${o.work_date}|${o.shift}`));

  const total = rows.length;
  const nights = rows.filter((r) => r.shift === "SN").length;

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Meus plantoes"),
      h("span", { class: "mono" }, `${total} nos proximos 6 meses`)),

    total === 0
      ? emptyState("Voce nao tem plantao marcado daqui para a frente.", "clock")
      : h("div", null,
          h("div", { class: "card" },
            h("div", { class: "card-b card-row", style: { gap: "18px" } },
              stat(total, "plantoes"),
              stat(nights, "noites"),
              stat(rows.filter((r) => [0, 6].includes(dow(r.work_date))).length, "fins de semana"))),
          h("div", { class: "daylist" }, rows.map((r) => rowEl(r, mineOffered, root)))));
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

const stat = (n, label) => h("div", null,
  h("div", { class: "mono", style: { fontSize: "22px", fontWeight: "700", lineHeight: "1.1" } }, String(n)),
  h("div", { class: "meta" }, label));

function rowEl(r, offered, root) {
  const unit = S.unitById.get(r.unit_id);
  const isOffered = offered.has(`${r.unit_id}|${r.work_date}|${r.shift}`);
  const gained = r.base_member_id && r.base_member_id !== r.member_id;

  return h("button", {
    class: "day", style: { width: "100%", border: "0", borderBottom: "1px solid var(--rule-2)",
                           background: "none", textAlign: "left", padding: "0" },
    onclick: () => openShiftSheet({
      date: r.work_date, unit, shift: r.shift, row: r, onChanged: () => reload(root),
    }),
  },
    h("div", { class: "day-d" },
      h("div", { class: "day-num" }, String(Number(r.work_date.slice(8)))),
      h("div", { class: "day-dow" }, r.work_date.slice(5, 7) + "/" + r.work_date.slice(2, 4))),
    h("div", { class: "day-rows" },
      h("div", { class: "srow", style: { minHeight: "48px" } },
        h("span", { class: `tick ${r.shift}` }),
        shiftBadge(r.shift),
        h("div", { class: "grow", style: { minWidth: 0 } },
          h("div", { class: "srow-n" }, `${unit?.name || ""} | ${DOW3[dow(r.work_date)]}`),
          h("div", { class: "meta mono" }, SHIFT_INFO[r.shift].hours,
            r.shift === "SN" ? ` (vira ${br(addDays(r.work_date, 1))})` : "")),
        isOffered ? h("span", { class: "chip wait" }, "no mural")
          : gained ? h("span", { class: "chip ok" }, "assumido") : null)));
}
