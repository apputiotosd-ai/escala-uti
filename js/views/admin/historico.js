import { h, mount } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { S, loadAuditoria, loadMovimentacoes, niceError } from "../../store.js";
import { avatar, shiftBadge, emptyState } from "../../lib/ui.js";
import { br, brDow, brDateTime, haQuanto } from "../../lib/dates.js";
import { SHIFT_INFO } from "../../config.js";

/**
 * Duas perguntas diferentes, duas abas:
 *   Escala fixa  -> quem mexeu no ciclo, quando, de quem para quem
 *   Plantoes     -> trocas, cessoes e vagos entregues, dia a dia
 */
const vista = { aba: "plantoes", medico: "" };

export async function historicoTab() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const corpo = h("div");
  const abas = h("div", { class: "tabs" },
    ["plantoes", "escala"].map((id) => h("button", {
      class: "tab", role: "tab", "aria-selected": String(vista.aba === id),
      onclick: () => { vista.aba = id; paint(root); },
    }, id === "plantoes" ? "Movimentações" : "Escala fixa")));

  mount(root, abas, corpo);
  mount(corpo, h("div", { class: "load" }, "Carregando"));
  try {
    mount(corpo, vista.aba === "plantoes" ? await movimentacoes(root) : await auditoria());
  } catch (e) {
    mount(corpo, h("div", { class: "err" }, niceError(e)));
  }
}

const nome = (id) => S.byId.get(id)?.full_name || "médico removido";
const uti = (id) => S.unitById.get(id)?.name || "";

/* =========================================================
   MOVIMENTACOES DE PLANTAO
   ========================================================= */
async function movimentacoes(root) {
  const { trocas, interesses } = await loadMovimentacoes({ limite: 300 });

  // uma lista unica, ordenada no tempo
  const linhas = [
    ...trocas.map((e) => ({ quando: e.created_at, tipo: e.kind, dados: e, origem: "troca" })),
    ...interesses.map((i) => ({ quando: i.decided_at || i.created_at, tipo: "interesse",
                                dados: i, origem: "interesse" })),
  ].sort((a, b) => String(b.quando).localeCompare(String(a.quando)));

  const filtradas = vista.medico
    ? linhas.filter((l) => envolve(l, vista.medico))
    : linhas;

  const seletor = h("select", {
    class: "inp",
    onchange: (e) => { vista.medico = e.target.value; paint(root); },
  },
    h("option", { value: "" }, "Todos os médicos"),
    S.members.map((m) => h("option", { value: m.id, selected: m.id === vista.medico }, m.full_name)));

  return h("div", null,
    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("label", { class: "f", style: { marginBottom: 0 } },
        h("span", null, "Filtrar por médico"), seletor))),

    h("div", { class: "bar" },
      h("span", null, "Movimentações"),
      h("span", { class: "mono" }, String(filtradas.length))),

    filtradas.length
      ? h("div", { class: "adminlist" }, filtradas.map(cartaoMov))
      : emptyState("Nenhuma movimentação registrada.", "swap"));
}

function envolve(l, memberId) {
  const d = l.dados;
  return d.from_member_id === memberId || d.to_member_id === memberId ||
         d.member_id === memberId || d.decided_by === memberId;
}

const ESTADO = {
  approved:  ["ok",  "feita"],
  pending:   ["wait", "aguardando"],
  rejected:  ["no",  "recusada"],
  cancelled: ["",    "cancelada"],
  expired:   ["",    "venceu"],
  granted:   ["ok",  "entregue"],
  declined:  ["no",  "recusado"],
  withdrawn: ["",    "retirado"],
};

function cartaoMov(l) {
  const d = l.dados;
  const [cls, rot] = ESTADO[d.status] || ["", d.status];

  if (l.origem === "interesse") {
    return h("div", { class: "hrow" },
      h("span", { class: `chip ${cls}` }, rot),
      h("div", { class: "grow", style: { minWidth: 0 } },
        h("div", { class: "hrow-t" },
          "Interesse em plantão vago: ", h("span", { class: "strong" }, nome(d.member_id))),
        h("div", { class: "meta mono" },
          `${uti(d.unit_id)} | ${brDow(d.work_date)} | ${d.shift} ${SHIFT_INFO[d.shift].hours}`),
        h("div", { class: "meta" },
          "manifestou ", brDateTime(d.created_at),
          d.decided_at ? ` | decidido ${brDateTime(d.decided_at)}` : "",
          d.decided_by ? ` por ${nome(d.decided_by)}` : ""),
        d.decided_reason && h("div", { class: "meta" }, d.decided_reason)));
  }

  const troca = d.kind === "swap";
  return h("div", { class: "hrow" },
    h("span", { class: `chip ${cls}` }, rot),
    h("div", { class: "grow", style: { minWidth: 0 } },
      h("div", { class: "hrow-t" },
        troca ? "Troca entre " : "Cessão de ",
        h("span", { class: "strong" }, nome(d.from_member_id)),
        troca ? " e " : " para ",
        h("span", { class: "strong" }, nome(d.to_member_id))),
      h("div", { class: "meta mono" },
        `${uti(d.from_unit_id)} | ${brDow(d.from_date)} | ${d.from_shift}`,
        troca && d.to_date
          ? `  <->  ${uti(d.to_unit_id)} | ${brDow(d.to_date)} | ${d.to_shift}`
          : ""),
      h("div", { class: "meta" },
        "pedido ", brDateTime(d.created_at),
        d.applied_at ? ` | aplicado ${brDateTime(d.applied_at)}` : "",
        d.decided_by && d.status === "rejected" ? ` | recusado por ${nome(d.decided_by)}` : ""),
      d.note && h("div", { class: "meta" }, d.note),
      d.decided_reason && h("div", { class: "meta" }, "Motivo: ", d.decided_reason)));
}

/* =========================================================
   LIVRO DA ESCALA FIXA
   ========================================================= */
const ACOES = {
  escala_slot:      ["Célula do ciclo", "grid"],
  escala_versao:    ["Versão da escala", "board"],
  plantao_pontual:  ["Plantão de um dia", "clock"],
};

async function auditoria() {
  const linhas = await loadAuditoria({ limite: 300 });

  return h("div", null,
    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("div", { class: "meta", style: { lineHeight: "1.55" } },
        "Registro de quem mexeu na escala. Serve para conferir o relatório do mês: ",
        "toda mudanca de celula do ciclo, criação de versão e ajuste de um dia ",
        "aparece aqui com autor e horário. Somente a coordenação ve."))),

    h("div", { class: "bar" },
      h("span", null, "Livro de registro"),
      h("span", { class: "mono" }, String(linhas.length))),

    linhas.length
      ? h("div", { class: "adminlist" }, linhas.map(cartaoAudit))
      : emptyState("Nada registrado ainda.", "empty"));
}

function cartaoAudit(a) {
  const [rotulo, ic] = ACOES[a.acao] || [a.acao, "empty"];
  const sistema = a.quem === null;

  return h("div", { class: "hrow" },
    h("span", { class: "hrow-ic" }, icon(ic)),
    h("div", { class: "grow", style: { minWidth: 0 } },
      h("div", { class: "hrow-t" }, a.descricao),
      h("div", { class: "meta" },
        h("span", { class: sistema ? "" : "strong" }, a.quem_nome || "desconhecido"),
        " | ", h("span", { class: "mono" }, brDateTime(a.quando)),
        " | ", haQuanto(a.quando)),
      a.detalhe?.versao && h("div", { class: "meta mono" },
        "versão: ", a.detalhe.versao,
        a.detalhe.vigencia_desde ? ` (desde ${br(a.detalhe.vigencia_desde)})` : ""),
      a.detalhe?.observacao && h("div", { class: "meta" }, a.detalhe.observacao)),
    h("span", { class: "chip" }, rotulo));
}
