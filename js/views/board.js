import { h, mount, toast, confirmBox } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadOffers, niceError } from "../store.js";
import { avatar, shiftBadge, emptyState, shiftLine } from "../lib/ui.js";
import { brDow, shortName } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";
import { openProposeSwap } from "./shift-sheet.js";

/** Mural: plantoes cedidos para quem quiser pegar, e plantoes oferecidos para troca. */
export async function boardView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const offers = await loadOffers();
  const ceded = offers.filter((o) => o.kind === "giveaway");
  const swaps = offers.filter((o) => o.kind === "swap");

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Plantoes cedidos"),
      h("span", { class: "mono" }, ceded.length === 1 ? "1 disponivel" : `${ceded.length} disponiveis`)),
    ceded.length
      ? ceded.map((o) => offerCard(o, root))
      : emptyState("Ninguem esta cedendo plantao no momento.", "hand"),

    h("div", { class: "bar", style: { marginTop: "18px" } },
      h("span", null, "Oferecidos para troca"),
      h("span", { class: "mono" }, String(swaps.length))),
    swaps.length
      ? swaps.map((o) => offerCard(o, root))
      : emptyState("Nenhum plantao oferecido para troca.", "swap"));
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
            mine ? "Voce" : (owner?.full_name || "Medico")),
          h("div", { class: "meta" }, o.kind === "giveaway" ? "esta cedendo" : "quer trocar")),
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
                  "O plantao volta a ser seu e some da lista.", "Retirar")) return;
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
                  if (!await confirmBox("Assumir plantao",
                    `Voce quer assumir ${brDow(o.work_date)}, ${unit?.name}, turno ${o.shift}? ` +
                    `${owner?.full_name || "O colega"} ainda precisa confirmar.`, "Quero assumir")) return;
                  const { error } = await sb.rpc("claim_giveaway", { p_offer: o.id, p_note: null });
                  if (error) return toast(niceError(error));
                  toast("Pedido enviado. Aguarde a confirmacao.");
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
