import { h, mount, toast, modal, confirmBox } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadExchanges, awaitingMe, isAdmin, niceError } from "../store.js";
import { avatar, shiftBadge, emptyState } from "../lib/ui.js";
import { brDow } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";

/** Trocas e cessoes aguardando resposta. */
export async function pendingView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const [pending, done] = await Promise.all([
    loadExchanges(["pending"]),
    loadExchanges(["approved", "rejected", "cancelled", "expired"]),
  ]);

  const mine = awaitingMe(pending);
  const mineIds = new Set(mine.map((e) => e.id));
  const involved = pending.filter((e) =>
    !mineIds.has(e.id) && (e.from_member_id === S.me.id || e.to_member_id === S.me.id));
  const others = pending.filter((e) =>
    !mineIds.has(e.id) && e.from_member_id !== S.me.id && e.to_member_id !== S.me.id);

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Esperando voce"),
      h("span", { class: "mono" }, String(mine.length))),
    mine.length
      ? mine.map((e) => card(e, root, true))
      : emptyState("Nada esperando sua resposta.", "check"),

    involved.length ? [
      h("div", { class: "bar", style: { marginTop: "18px" } },
        h("span", null, "Enviados, aguardando o outro lado"),
        h("span", { class: "mono" }, String(involved.length))),
      involved.map((e) => card(e, root, false)),
    ] : null,

    others.length ? [
      h("div", { class: "bar", style: { marginTop: "18px" } },
        h("span", null, "Em andamento na equipe"),
        h("span", { class: "mono" }, String(others.length))),
      others.map((e) => card(e, root, false)),
    ] : null,

    done.length ? [
      h("div", { class: "bar", style: { marginTop: "18px" } }, h("span", null, "Historico")),
      done.slice(0, 25).map((e) => historyRow(e)),
    ] : null);
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

const leg = (unitId, date, shift, label) =>
  h("div", { class: "card-row", style: { gap: "8px", padding: "7px 0" } },
    h("span", { class: `tick ${shift}`, style: { height: "30px" } }),
    h("div", { class: "grow" },
      h("div", { class: "meta", style: { fontSize: "10px", letterSpacing: ".08em",
                 textTransform: "uppercase" } }, label),
      h("div", { class: "t-date mono" }, brDow(date)),
      h("div", { class: "meta" },
        `${S.unitById.get(unitId)?.name || ""} | ${SHIFT_INFO[shift].hours}`)),
    shiftBadge(shift));

function card(e, root, actionable) {
  const from = S.byId.get(e.from_member_id);
  const to = S.byId.get(e.to_member_id);
  const iAmFrom = e.from_member_id === S.me.id;
  const other = iAmFrom ? to : from;
  const isSwap = e.kind === "swap";

  // de quem ainda falta resposta
  const waiting = [];
  if (!e.from_approved_at) waiting.push(from?.full_name || "quem entrega");
  if (!e.to_approved_at) waiting.push(to?.full_name || "quem recebe");
  if (S.org.require_admin_approval && !e.admin_approved_at) waiting.push("coordenacao");

  return h("div", { class: "card" },
    h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "9px", marginBottom: "4px" } },
        avatar(e.from_member_id),
        icon("swap", "meta"),
        avatar(e.to_member_id),
        h("div", { class: "grow", style: { marginLeft: "3px" } },
          h("div", { class: "strong", style: { fontSize: "13.5px" } },
            isSwap ? "Troca de plantao" : "Cessao de plantao"),
          h("div", { class: "meta" },
            `${from?.full_name || "?"} e ${to?.full_name || "?"}`)),
        h("span", { class: "chip wait" }, "aguardando")),

      leg(e.from_unit_id, e.from_date, e.from_shift,
          isSwap ? `${from?.full_name || ""} entrega` : `${from?.full_name || ""} cede`),
      isSwap && e.to_unit_id &&
        leg(e.to_unit_id, e.to_date, e.to_shift, `${to?.full_name || ""} entrega`),

      e.note && h("div", { class: "meta", style: { marginTop: "6px" } }, e.note),

      h("div", { class: "meta", style: { marginTop: "8px" } },
        "Falta confirmar: " + waiting.join(", ")),

      actionable
        ? h("div", { class: "card-row", style: { gap: "8px", marginTop: "11px" } },
            h("button", {
              class: "btn btn-sm btn-primary grow", style: { justifyContent: "center" },
              onclick: () => respond(e, true, root),
            }, icon("check"), "Confirmar"),
            h("button", {
              class: "btn btn-sm btn-danger", onclick: () => respond(e, false, root),
            }, icon("x"), "Recusar"))
        : (e.created_by === S.me.id || isAdmin())
          ? h("div", { style: { marginTop: "10px" } },
              h("button", {
                class: "btn btn-sm btn-danger",
                onclick: async () => {
                  if (!await confirmBox("Cancelar pedido", "O pedido some e nada muda no calendario.", "Cancelar pedido")) return;
                  const { error } = await sb.rpc("cancel_exchange", { p_id: e.id });
                  if (error) return toast(niceError(error));
                  toast("Pedido cancelado.");
                  reload(root);
                },
              }, "Cancelar pedido"))
          : null));
}

async function respond(e, accept, root) {
  if (accept) {
    const isSwap = e.kind === "swap";
    const ok = await confirmBox(
      isSwap ? "Confirmar troca" : "Confirmar cessao",
      isSwap
        ? "Assim que voce confirmar, os dois plantoes trocam de dono no calendario."
        : "Assim que voce confirmar, o plantao passa para o outro medico no calendario.",
      "Confirmar");
    if (!ok) return;
    const { error } = await sb.rpc("respond_exchange", { p_id: e.id, p_accept: true, p_reason: null });
    if (error) return toast(niceError(error));
    toast("Confirmado. O calendario ja mudou.");
    reload(root);
    return;
  }

  const reason = h("textarea", { class: "inp", rows: 2, placeholder: "Motivo (opcional)" });
  modal({
    title: "Recusar pedido",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: 0 } },
        "O outro medico recebe o aviso e nada muda no calendario."),
      h("label", { class: "f" }, h("span", null, "Motivo"), reason)),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-danger",
        onclick: async (ev) => {
          ev.target.disabled = true;
          const { error } = await sb.rpc("respond_exchange", {
            p_id: e.id, p_accept: false, p_reason: reason.value.trim() || null,
          });
          if (error) { ev.target.disabled = false; return toast(niceError(error)); }
          close();
          toast("Recusado.");
          reload(root);
        },
      }, "Recusar"),
    ],
  });
}

function historyRow(e) {
  const from = S.byId.get(e.from_member_id);
  const to = S.byId.get(e.to_member_id);
  const label = { approved: "Feito", rejected: "Recusado", cancelled: "Cancelado", expired: "Venceu" }[e.status];
  const cls = { approved: "ok", rejected: "no", cancelled: "", expired: "" }[e.status];
  return h("div", { class: "arow" },
    h("span", { class: `chip ${cls}` }, label),
    h("div", { class: "grow" },
      h("div", { style: { fontSize: "13px" } },
        `${from?.full_name || "?"} ${e.kind === "swap" ? "trocou com" : "cedeu para"} ${to?.full_name || "?"}`),
      h("div", { class: "meta mono" },
        brDow(e.from_date) + " " + e.from_shift +
        (e.to_date ? "  |  " + brDow(e.to_date) + " " + e.to_shift : ""))));
}
