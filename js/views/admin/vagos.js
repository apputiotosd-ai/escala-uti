import { h, mount, toast, confirmBox, modal } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { S, sb, loadVacant, loadInterests, interestKey, niceError } from "../../store.js";
import { avatar, shiftBadge, emptyState, memberPicker } from "../../lib/ui.js";
import { brDow, brDateTime, haQuanto } from "../../lib/dates.js";
import { SHIFT_INFO } from "../../config.js";

/**
 * Plantoes sem ninguem, com a fila de quem se candidatou.
 * A coordenacao ve a ordem de chegada e escolhe.
 */
export async function vagosTab() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const [vagos, interesses] = await Promise.all([
    loadVacant(180), loadInterests(["open"]),
  ]);

  const fila = new Map();
  for (const i of interesses) {                 // ja vem por ordem de chegada
    const k = interestKey(i.unit_id, i.work_date, i.shift);
    if (!fila.has(k)) fila.set(k, []);
    fila.get(k).push(i);
  }

  const comFila = vagos.filter((v) => fila.has(interestKey(v.unit_id, v.work_date, v.shift)));
  const semFila = vagos.filter((v) => !fila.has(interestKey(v.unit_id, v.work_date, v.shift)));

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Com candidatos"),
      h("span", { class: "mono" }, String(comFila.length))),
    comFila.length
      ? comFila.map((v) => cartao(v, fila.get(interestKey(v.unit_id, v.work_date, v.shift)), root))
      : emptyState("Nenhum plantao vago tem candidato no momento.", "bell"),

    h("div", { class: "bar", style: { marginTop: "18px" } },
      h("span", null, "Sem candidato"),
      h("span", { class: "mono" }, String(semFila.length))),
    semFila.length
      ? semFila.map((v) => cartao(v, [], root))
      : emptyState("Todos os turnos tem plantonista.", "check"));
}

const reload = (root) => paint(root).catch((e) => mount(root, h("div", { class: "err" }, niceError(e))));

function cartao(v, candidatos, root) {
  const unit = S.unitById.get(v.unit_id);
  const previa = S.byId.get(v.base_member_id);

  return h("div", { class: "card" },
    h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "8px" } },
        h("span", { class: `tick ${v.shift}`, style: { height: "34px" } }),
        h("div", { class: "grow" },
          h("div", { class: "t-date mono" }, brDow(v.work_date)),
          h("div", { class: "meta" }, `${unit?.name || ""} | ${SHIFT_INFO[v.shift].hours}`)),
        shiftBadge(v.shift)),

      previa && h("div", { class: "meta", style: { marginTop: "6px" } },
        "A escala fixa previa ", h("span", { class: "strong" }, previa.full_name),
        " nesta posicao do ciclo."),

      candidatos.length
        ? h("div", { style: { marginTop: "10px", border: "1px solid var(--rule)" } },
            candidatos.map((it, i) => h("div", {
              class: "arow", style: { padding: "8px 10px", borderBottom: i === candidatos.length - 1 ? "0" : "" },
            },
              h("span", { class: "mono", style: { color: "var(--ink-3)", width: "16px" } }, String(i + 1)),
              avatar(it.member_id),
              h("div", { class: "grow" },
                h("div", { style: { fontSize: "13.5px" } },
                  S.byId.get(it.member_id)?.full_name || "?"),
                h("div", { class: "meta mono" }, brDateTime(it.created_at)),
                h("div", { class: "meta" }, haQuanto(it.created_at)),
                it.note && h("div", { class: "meta" }, it.note)),
              h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                h("button", {
                  class: "btn btn-sm btn-primary",
                  onclick: () => escalar(it, v, unit, root),
                }, "Escalar"),
                h("button", {
                  class: "btn btn-sm btn-danger",
                  onclick: () => recusar(it, root),
                }, "Recusar")))))
        : h("div", { class: "meta", style: { marginTop: "8px" } }, "Ninguem se candidatou."),

      h("div", { style: { marginTop: "10px" } },
        h("button", {
          class: "btn btn-sm",
          onclick: () => escalarDireto(v, unit, root),
        }, icon("plus"), "Escalar alguem de fora da fila"))));
}

async function escalar(it, v, unit, root) {
  const nome = S.byId.get(it.member_id)?.full_name || "o medico";
  if (!await confirmBox("Escalar este medico",
    `${nome} assume ${brDow(v.work_date)}, ${unit?.name}, turno ${v.shift}. ` +
    "Os outros candidatos sao avisados. A escala fixa nao muda.", "Escalar")) return;
  const { error } = await sb.rpc("grant_interest", { p_id: it.id });
  if (error) return toast(niceError(error));
  toast("Escalado.");
  reload(root);
}

async function recusar(it, root) {
  const motivo = h("input", { class: "inp", placeholder: "Motivo (opcional)" });
  modal({
    title: "Recusar candidatura",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: 0 } },
        "O medico recebe o aviso e o plantao continua vago."),
      h("label", { class: "f" }, h("span", null, "Motivo"), motivo)),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-danger",
        onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.rpc("decline_interest", {
            p_id: it.id, p_reason: motivo.value.trim() || null,
          });
          if (error) { e.target.disabled = false; return toast(niceError(error)); }
          close(); toast("Recusado."); reload(root);
        },
      }, "Recusar"),
    ],
  });
}

/** Coordenacao coloca alguem que nao se candidatou. */
function escalarDireto(v, unit, root) {
  let escolhido = null;
  const err = h("div");
  modal({
    title: "Escalar direto",
    body: h("div", null,
      h("p", { class: "meta", style: { marginTop: 0 } },
        `${unit?.name} | ${brDow(v.work_date)} | ${SHIFT_INFO[v.shift].label}`),
      h("p", { style: { fontSize: "13.5px" } },
        "Vale so para esta data. A escala fixa continua como esta."),
      h("label", { class: "f" }, h("span", null, "Plantonista"),
        memberPicker(null, (x) => { escolhido = x; }, { blank: "Escolha o medico" })),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          if (!escolhido) { err.replaceChildren(h("div", { class: "err" }, "Escolha o medico.")); return; }
          e.target.disabled = true;
          const { error } = await sb.rpc("admin_set_shift", {
            p_org: S.org.id, p_unit: v.unit_id, p_date: v.work_date,
            p_shift: v.shift, p_member: escolhido,
            p_note: "Plantao vago preenchido pela coordenacao",
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close(); toast("Escalado."); reload(root);
        },
      }, "Escalar"),
    ],
  });
}
