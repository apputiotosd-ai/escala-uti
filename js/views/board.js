import { h, mount, toast, confirmBox } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadOffers, loadVacant, loadInterests, interestKey, niceError } from "../store.js";
import { avatar, shiftBadge, emptyState, shiftLine } from "../lib/ui.js";
import { brDow, shortName } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";
import { openProposeSwap, openShiftSheet } from "./shift-sheet.js";

/** Mural: plantoes vagos, plantoes cedidos e plantoes oferecidos para troca. */
export async function boardView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const [offers, vagos, interesses] = await Promise.all([
    loadOffers(), loadVacant(), loadInterests(["open"]),
  ]);
  const ceded = offers.filter((o) => o.kind === "giveaway");
  const swaps = offers.filter((o) => o.kind === "swap");
  const meus = new Set(interesses.filter((i) => i.member_id === S.me.id)
    .map((i) => interestKey(i.unit_id, i.work_date, i.shift)));

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Plantões vagos"),
      h("span", { class: "mono" }, String(vagos.length))),
    vagos.length
      ? vagos.map((v) => vacantCard(v, meus, root))
      : emptyState("Nenhum turno sem plantonista.", "check"),

    h("div", { class: "bar", style: { marginTop: "18px" } },
      h("span", null, "Plantões cedidos"),
      h("span", { class: "mono" }, ceded.length === 1 ? "1 disponível" : `${ceded.length} disponíveis`)),
    ceded.length
      ? ceded.map((o) => offerCard(o, root))
      : emptyState("Ninguém está cedendo plantão no momento.", "hand"),

    h("div", { class: "bar", style: { marginTop: "18px" } },
      h("span", null, "Oferecidos para troca"),
      h("span", { class: "mono" }, String(swaps.length))),
    swaps.length
      ? swaps.map((o) => offerCard(o, root))
      : emptyState("Nenhum plantão oferecido para troca.", "swap"));
}

/** Turno sem ninguem: qualquer plantonista pode se candidatar. */
function vacantCard(v, meus, root) {
  const unit = S.unitById.get(v.unit_id);
  const jaPedi = meus.has(interestKey(v.unit_id, v.work_date, v.shift));

  return h("div", { class: "card" },
    h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "8px" } },
        h("span", { class: `tick ${v.shift}`, style: { height: "34px" } }),
        h("div", { class: "grow" },
          h("div", { class: "t-date mono" }, brDow(v.work_date)),
          h("div", { class: "meta" }, `${unit?.name || ""} | ${SHIFT_INFO[v.shift].hours}`)),
        shiftBadge(v.shift)),

      h("div", { class: "card-row", style: { gap: "8px", marginTop: "10px" } },
        Number(v.interessados) > 0
          ? h("span", { class: "chip wait" },
              Number(v.interessados) === 1 ? "1 interessado" : `${v.interessados} interessados`)
          : h("span", { class: "meta" }, "ninguém se candidatou ainda"),
        h("span", { class: "grow" }),
        jaPedi
          ? h("span", { class: "chip ok" }, "você se candidatou")
          : h("button", {
              class: "btn btn-sm btn-primary",
              onclick: () => openShiftSheet({
                date: v.work_date, unit, shift: v.shift,
                row: { member_id: null, base_member_id: v.base_member_id },
                onChanged: () => reload(root),
              }),
            }, icon("hand"), "Tenho interesse"))));
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

function offerCard(o, root) {
  const owner = S.byId.get(o.owner_id);
  const mine = o.owner_id === S.me.id;
  const unit = S.unitById.get(o.unit_id);

  return h("div", { class: "card" },
    h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "9px", marginBottom: "9px" } },
        avatar(o.owner_id),
        h("div", { class: "grow" },
          h("div", { class: "strong", style: { fontSize: "13.5px" } },
            mine ? "Você" : (owner?.full_name || "Médico")),
          h("div", { class: "meta" }, o.kind === "giveaway" ? "está cedendo" : "quer trocar")),
        mine && h("span", { class: "chip" }, "seu")),

      h("div", { class: "card-row", style: { gap: "8px", padding: "8px 0",
                 borderTop: "1px solid var(--rule-2)", borderBottom: "1px solid var(--rule-2)" } },
        h("span", { class: `tick ${o.shift}`, style: { height: "32px" } }),
        h("div", { class: "grow" },
          h("div", { class: "t-date mono" }, brDow(o.work_date)),
          h("div", { class: "meta" }, `${unit?.name || ""} | ${SHIFT_INFO[o.shift].hours}`)),
        shiftBadge(o.shift)),

      o.wanted_note && h("div", { class: "meta", style: { marginTop: "8px" } },
        h("span", { class: "strong" }, "Aceita em troca: "), o.wanted_note),
      o.note && h("div", { class: "meta", style: { marginTop: "5px" } }, o.note),

      h("div", { class: "card-row", style: { gap: "8px", marginTop: "11px" } },
        mine
          ? h("button", {
              class: "btn btn-sm btn-danger",
              onclick: async () => {
                if (!await confirmBox("Retirar do mural",
                  "O plantão volta a ser seu e some da lista.", "Retirar")) return;
                const { error } = await sb.rpc("cancel_offer", { p_offer: o.id });
                if (error) return toast(niceError(error));
                toast("Retirado do mural.");
                reload(root);
              },
            }, icon("x"), "Retirar do mural")
          : o.kind === "giveaway"
            ? h("button", {
                class: "btn btn-sm btn-primary",
                onclick: async () => {
                  if (!await confirmBox("Assumir plantão",
                    `Você quer assumir ${brDow(o.work_date)}, ${unit?.name}, turno ${o.shift}? ` +
                    `${owner?.full_name || "O colega"} ainda precisa confirmar.`, "Quero assumir")) return;
                  const { error } = await sb.rpc("claim_giveaway", { p_offer: o.id, p_note: null });
                  if (error) return toast(niceError(error));
                  toast("Pedido enviado. Aguarde a confirmação.");
                  reload(root);
                },
              }, icon("hand"), "Assumir")
            : h("button", {
                class: "btn btn-sm btn-primary",
                onclick: () => openProposeSwap({
                  date: o.work_date, unit, shift: o.shift, offerId: o.id,
                  onChanged: () => reload(root),
                }),
              }, icon("swap"), "Propor troca"))));
}
