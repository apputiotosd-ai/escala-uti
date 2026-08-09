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
const view = { y: null, m: null, unit: "" };

export async function scheduleView() {
  const now = new Date();
  if (view.y === null) { view.y = now.getFullYear(); view.m = now.getMonth(); }

  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root, rolar = true) {
  const posicao = scrollY;
  const b = monthBounds(view.y, view.m);
  // carrega a grade inteira do mes, inclusive as bordas que completam as semanas
  const sch = await loadSchedule(b.gridStart, b.gridEnd);

  const body = h("div");
  const faixa = nowStrip(sch);
  mount(root,
    faixa,
    tabs(root),
    monthNav(root),
    body);

  // A faixa fica na tela o tempo todo, entao nao pode envelhecer:
  // as 07h, 13h e 19h ela troca de turno sozinha.
  vigiaTurno(root, sch);

  const single = view.unit && S.unitById.get(view.unit);
  mount(body,
    dayList(sch, b, single ? [S.unitById.get(view.unit)] : S.units, root),
    single ? monthGrid(sch, b, S.unitById.get(view.unit), root) : null);

  // com "Todas" não existe grade de mes: a lista serve nas duas larguras
  body.querySelector(".daylist").style.display = single ? "" : "block";

  if (rolar) mostraHoje(root);
  else depoisDoLayout(() => scrollTo(0, posicao));
}

/**
 * Deixa o dia de hoje logo abaixo da faixa fixa.
 * Vale a cada repintura, e não só na primeira: trocar de UTI redesenha a
 * lista inteira, e sem isto a rolagem ficava onde estava, apontando para
 * um dia qualquer do conteúdo novo. Quem confere escala precisa cair
 * sempre no mesmo lugar.
 */
function mostraHoje(root) {
  const agora = new Date();
  const noMes = view.y === agora.getFullYear() && view.m === agora.getMonth();

  const rolar = () => {
    if (!root.isConnected) return;
    // Lista e grade do mês convivem no documento: o CSS esconde uma das
    // duas conforme a largura. Rolar até a escondida não move nada, então
    // vale a que está de fato na tela.
    // O deslocamento da faixa fixa vem do CSS, em scroll-margin-top.
    const alvo = (noMes
      ? [".day.is-today", ".mg-cell.today"]
      : [".daylist", ".monthgrid"])        // outro mês não tem hoje: começa no dia 1
      .map((sel) => root.querySelector(sel))
      .find((el) => el && el.getClientRects().length);
    alvo?.scrollIntoView({ block: "start", behavior: "auto" });
  };

  rolar();
  // Na primeira pintura a tela ainda não está no documento, e a altura da
  // faixa fixa só é medida depois de encaixada. A segunda passada acerta
  // as duas coisas.
  depoisDoLayout(rolar);
}

/**
 * Depois de a pintura entrar no documento e as alturas fixas serem medidas.
 * Não usa requestAnimationFrame de propósito: quando a tela está em segundo
 * plano o navegador nunca chama o quadro, e a rolagem ficaria por fazer.
 */
const depoisDoLayout = (fn) => setTimeout(fn, 0);

const reload = (root, rolar = true) =>
  paint(root, rolar).catch((e) => mount(root, h("div", { class: "err" }, e.message)));

/** Troca a faixa "Agora" quando o turno vira, sem recarregar a escala toda. */
let relogio;
function vigiaTurno(root, sch) {
  clearInterval(relogio);
  let atual = JSON.stringify(currentShift());
  relogio = setInterval(() => {
    if (!root.isConnected) { clearInterval(relogio); return; }
    const agora = JSON.stringify(currentShift());
    if (agora === atual) return;
    atual = agora;
    const velha = root.querySelector(".now");
    if (velha) velha.replaceWith(nowStrip(sch));
  }, 30000);
}

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
  return h("div", { class: "tabs", role: "tablist" },
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
    h("button", { class: "btn btn-icon", onclick: () => step(-1), "aria-label": "Mês anterior" }, icon("left")),
    h("span", { class: "label" }, monthLabel(view.y, view.m)),
    h("button", { class: "btn btn-icon", onclick: () => step(1), "aria-label": "Próximo mês" }, icon("right")),
    h("button", {
      class: "btn btn-sm", style: { marginLeft: "8px", visibility: isNow ? "hidden" : "" },
      onclick: () => {
        view.y = now.getFullYear(); view.m = now.getMonth();
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
      h("div", null, "A escala fixa ainda não foi preenchida."),
      isAdmin()
        ? h("a", { class: "btn btn-primary", href: "#/admin",
                   style: { marginTop: "14px" } }, "Preencher a escala fixa")
        : h("div", { style: { marginTop: "6px" } }, "A coordenação ainda está montando.")));
  }
  return list;
}

function shiftRow(date, unit, shift, row, root) {
  const mine = row?.member_id && row.member_id === S.me.id;
  return h("button", {
    class: `srow${mine ? " mine" : ""}`,
    style: { width: "100%", background: mine ? undefined : "none", border: "0", textAlign: "left" },
    // mexer num plantão não tira o médico do lugar onde ele estava lendo
    onclick: () => openShiftSheet({ date, unit, shift, row, onChanged: () => reload(root, false) }),
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
          onclick: () => openShiftSheet({ date, unit, shift: s, row, onChanged: () => reload(root, false) }),
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
