import { h, mount, toast, modal, confirmBox } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { S, sb, niceError, loadVersoes } from "../../store.js";
import { emptyState } from "../../lib/ui.js";
import { DOW3, addDays, br, parse, today, iso } from "../../lib/dates.js";
import { SHIFTS, SHIFT_INFO } from "../../config.js";

/**
 * Escala fixa em versoes. O ciclo tem 14 dias e 14 e multiplo de 7, entao
 * cada posicao cai sempre no mesmo dia da semana: a tela mostra "semana A"
 * e "semana B", que e como a coordenacao pensa.
 *
 * Mudar a escala nao reescreve o passado. Cria-se uma versao valendo de uma
 * data em diante; a anterior fica congelada como registro do que valia.
 */
export async function rotationTab() {
  const root = h("div");
  await paint(root);
  return root;
}

let unidadeAtual = null;
let versaoAtual = null;

async function paint(root) {
  const versoes = await loadVersoes();
  if (!versoes.length) return mount(root, emptyState("Nenhuma escala fixa criada ainda."));

  const t = today();
  const vigente = versoes.find((v) => v.is_published && v.effective_from <= t &&
                                      (!v.effective_to || v.effective_to >= t)) || versoes[0];
  if (!versaoAtual || !versoes.some((v) => v.id === versaoAtual)) versaoAtual = vigente.id;
  const rot = versoes.find((v) => v.id === versaoAtual);

  const { data: slots, error } = await sb
    .from("rotation_slots").select("*").eq("rotation_id", rot.id);
  if (error) throw error;

  const porChave = new Map(slots.map((s) => [`${s.unit_id}|${s.day_index}|${s.shift}`, s]));
  if (!unidadeAtual || !S.unitById.has(unidadeAtual)) unidadeAtual = S.units[0]?.id;

  const preenchidos = slots.filter((s) => s.member_id).length;
  const passada = rot.effective_to && rot.effective_to < t;
  const futura = rot.effective_from > t;

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Escala fixa"),
      h("span", { class: "mono" }, `${preenchidos} de ${slots.length} turnos`)),

    // seletor de versao
    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("label", { class: "f", style: { marginBottom: "8px" } },
        h("span", null, "Versão"),
        h("select", {
          class: "inp",
          onchange: (e) => { versaoAtual = e.target.value; paint(root); },
        }, versoes.map((v) => h("option", { value: v.id, selected: v.id === versaoAtual },
          `${rotuloVigencia(v, t)}  |  ${v.name}`)))),

      h("div", { class: "meta", style: { lineHeight: "1.55" } },
        "Ciclo de ", h("span", { class: "strong" }, `${rot.cycle_days} dias`),
        " contado a partir de ", h("span", { class: "strong mono" }, br(rot.anchor_date)), ". ",
        vigente.id === rot.id
          ? "Esta é a versão que vale hoje."
          : passada
            ? "Versão encerrada. Ela é o registro do que valeu naquele período."
            : "Versão futura: passa a valer na data de início."),

      h("div", { class: "card-row", style: { gap: "8px", marginTop: "12px" } },
        h("button", { class: "btn btn-primary btn-sm", onclick: () => novaVersao(root) },
          icon("plus"), "Nova versão"),
        versoes.length > 1 && futura &&
          h("button", { class: "btn btn-sm btn-danger", onclick: () => descartar(rot, root) },
            "Descartar esta")))),

    passada
      ? h("div", { class: "err" },
          "Esta versão já passou. Editar aqui muda o registro histórico e o que ",
          "o relatório do mês mostra para aquele período. Prefira criar uma versão nova.")
      : null,

    h("div", { class: "tabs" },
      S.units.map((u) => h("button", {
        class: "tab", role: "tab", "aria-selected": String(unidadeAtual === u.id),
        onclick: () => { unidadeAtual = u.id; paint(root); },
      }, u.name))),

    tabelaSemana(rot, porChave, 0, "Semana A", root),
    tabelaSemana(rot, porChave, 7, "Semana B", root));
}

function rotuloVigencia(v, t) {
  const de = br(v.effective_from);
  if (!v.effective_to) return v.effective_from <= t ? `vale desde ${de}` : `valera de ${de}`;
  return `${de} a ${br(v.effective_to)}`;
}

function tabelaSemana(rot, porChave, offset, rotulo, root) {
  const ancora = rot.anchor_date;

  const cabeca = h("thead", null,
    h("tr", null,
      h("th", { style: { textAlign: "left", paddingLeft: "8px" } }, rotulo),
      SHIFTS.map((s) => h("th", null,
        `${s} ${SHIFT_INFO[s].hours.replace(" as ", "-").replace(/h/g, "")}`))));

  const corpo = h("tbody");
  for (let i = 0; i < 7; i++) {
    const idx = offset + i;
    const wd = parse(addDays(ancora, idx)).getDay();
    const prox = proximaVez(ancora, rot.cycle_days, idx, rot.effective_from);

    corpo.append(h("tr", null,
      h("td", { class: `turno${[0, 6].includes(wd) ? " sat" : ""}`,
                style: { width: "88px", textAlign: "left", padding: "5px 8px" } },
        h("div", { style: { fontWeight: "700" } }, DOW3[wd]),
        h("div", { style: { fontSize: "9px", color: "var(--ink-3)", fontWeight: "400" } },
          "prox " + br(prox).slice(0, 5))),
      SHIFTS.map((s) => {
        const chave = `${unidadeAtual}|${idx}|${s}`;
        const slot = porChave.get(chave);
        const td = h("td", { class: slot?.member_id ? "" : "vago" });
        const sel = h("select", {
          onchange: async (e) => {
            const val = e.target.value || null;
            td.className = val ? "" : "vago";
            const { error } = await sb.from("rotation_slots")
              .upsert({ rotation_id: rot.id, unit_id: unidadeAtual, day_index: idx,
                        shift: s, member_id: val },
                      { onConflict: "rotation_id,unit_id,day_index,shift" });
            if (error) { toast(niceError(error)); return; }
            if (slot) slot.member_id = val;
          },
        },
          h("option", { value: "" }, "vago"),
          S.members.filter((m) => m.is_active).map((m) =>
            h("option", { value: m.id, selected: slot?.member_id === m.id }, m.full_name)));
        td.append(sel);
        return td;
      })));
  }

  return h("div", { class: "gridwrap" }, h("table", { class: "escala" }, cabeca, corpo));
}

/** Proxima data em que esta posicao do ciclo acontece dentro da vigencia. */
function proximaVez(ancora, ciclo, idx, desde) {
  const base = today() > desde ? today() : desde;
  let d = addDays(ancora, idx);
  while (d < base) d = addDays(d, ciclo);
  return d;
}

/* ---------------- nova versao ---------------- */
function novaVersao(root) {
  const amanha = addDays(today(), 1);
  const data = h("input", { class: "inp", type: "date", value: addDays(today(), 14), min: amanha });
  const nome = h("input", { class: "inp", placeholder: "Ex: Escala de setembro" });
  const err = h("div");

  modal({
    title: "Nova versão da escala fixa",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: 0, lineHeight: "1.55" } },
        "A versão de hoje e copiada inteira e passa a valer só até o dia anterior a data ",
        "escolhida. Nada do que já passou muda, e o relatório dos meses anteriores ",
        "continua mostrando quem realmente estava escalado."),
      h("label", { class: "f" }, h("span", null, "Vale a partir de"), data),
      h("label", { class: "f" }, h("span", null, "Nome (opcional)"), nome),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          if (!data.value) {
            err.replaceChildren(h("div", { class: "err" }, "Escolha a data de início.")); return;
          }
          e.target.disabled = true;
          const { data: novo, error } = await sb.rpc("nova_versao_escala", {
            p_org: S.org.id, p_inicio: data.value, p_nome: nome.value.trim() || null,
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          versaoAtual = novo;
          close();
          toast("Versão criada. Agora edite o que muda nela.");
          paint(root);
        },
      }, "Criar versão"),
    ],
  });
}

async function descartar(rot, root) {
  if (!await confirmBox("Descartar versão futura",
    `A versão "${rot.name}" e tudo que foi editado nela serao apagados, e a versão ` +
    "anterior volta a valer sem prazo. Nada do passado muda.", "Descartar")) return;

  const versoes = await loadVersoes();
  const anterior = versoes.filter((v) => v.effective_from < rot.effective_from)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];

  const { error } = await sb.from("rotations").delete().eq("id", rot.id);
  if (error) return toast(niceError(error));
  if (anterior) {
    await sb.from("rotations").update({ effective_to: null }).eq("id", anterior.id);
  }
  versaoAtual = anterior?.id || null;
  toast("Versão descartada.");
  paint(root);
}
