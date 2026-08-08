import { h, mount, toast } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { S, loadSchedule, niceError } from "../../store.js";
import { emptyState } from "../../lib/ui.js";
import {
  monthBounds, monthLabel, MONTHS, DOW, DOW3, dow, addDays, br, today,
} from "../../lib/dates.js";
import { SHIFTS, SHIFT_INFO } from "../../config.js";

// horas por turno, usadas no fechamento
const HORAS = { M: 6, T: 6, SN: 12 };
const ORIGEM = {
  escala: "escala fixa", troca: "troca", cessao: "cessão", admin: "ajuste da coordenação",
};

const vista = { y: null, m: null };

export async function exportTab() {
  const agora = new Date();
  if (vista.y === null) { vista.y = agora.getFullYear(); vista.m = agora.getMonth(); }
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const b = monthBounds(vista.y, vista.m);
  const sch = await loadSchedule(b.first, b.last);
  const linhas = montaLinhas(sch, b);
  const resumo = montaResumo(linhas);

  const passo = (n) => {
    let m = vista.m + n, y = vista.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    vista.m = m; vista.y = y;
    paint(root).catch((e) => mount(root, h("div", { class: "err" }, niceError(e))));
  };

  const vagos = linhas.filter((l) => !l.medico).length;

  mount(root,
    h("div", { class: "bar" }, h("span", null, "Fechamento do mês")),

    h("div", { class: "monthbar" },
      h("button", { class: "btn btn-icon", onclick: () => passo(-1), "aria-label": "Mês anterior" }, icon("left")),
      h("span", { class: "label" }, monthLabel(vista.y, vista.m)),
      h("button", { class: "btn btn-icon", onclick: () => passo(1), "aria-label": "Próximo mês" }, icon("right"))),

    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "18px", marginBottom: "12px" } },
        num(linhas.length, "turnos"),
        num(resumo.length, "médicos"),
        num(linhas.reduce((s, l) => s + (l.medico ? HORAS[l.shift] : 0), 0), "horas"),
        vagos ? num(vagos, "vagos") : null),

      h("button", {
        class: "btn btn-block", style: { marginBottom: "8px" },
        onclick: () => baixaCsv(detalhadoCsv(linhas),
          `escala-${vista.y}-${String(vista.m + 1).padStart(2, "0")}-detalhado.csv`),
      }, icon("grid"), "Baixar planilha turno a turno"),

      h("button", {
        class: "btn btn-block", style: { marginBottom: "8px" },
        onclick: () => baixaCsv(resumoCsv(resumo),
          `escala-${vista.y}-${String(vista.m + 1).padStart(2, "0")}-por-médico.csv`),
      }, icon("user"), "Baixar total por médico"),

      h("button", {
        class: "btn btn-primary btn-block",
        onclick: () => window.print(),
      }, icon("board"), "Imprimir ou salvar em PDF"),

      h("p", { class: "meta", style: { marginTop: "10px", lineHeight: "1.55" } },
        "As planilhas abrem no Excel. Elas já vem com as trocas e cessões aplicadas, ",
        "então mostram quem realmente ficou no plantão, não quem estava na escala fixa."))),

    // area que sai na impressao
    relatorio(linhas, resumo, vagos));
}

const num = (n, rot) => h("div", null,
  h("div", { class: "mono", style: { fontSize: "21px", fontWeight: "700", lineHeight: "1.1" } },
    String(Math.round(n))),
  h("div", { class: "meta" }, rot));

/* ---------------- dados ---------------- */
function montaLinhas(sch, b) {
  const out = [];
  let d = b.first;
  while (d <= b.last) {
    for (const u of S.units) {
      for (const s of SHIFTS) {
        const r = sch.map.get(d)?.get(u.id)?.[s];
        if (!r) continue;
        const m = r.member_id ? S.byId.get(r.member_id) : null;
        const base = r.base_member_id ? S.byId.get(r.base_member_id) : null;
        out.push({
          date: d, unit: u.name, shift: s, medico: m, base,
          origem: r.source,
          trocado: !!(r.base_member_id && r.base_member_id !== r.member_id),
        });
      }
    }
    d = addDays(d, 1);
  }
  return out;
}

function montaResumo(linhas) {
  const por = new Map();
  for (const l of linhas) {
    if (!l.medico) continue;
    const k = l.medico.id;
    if (!por.has(k)) {
      por.set(k, { nome: l.medico.full_name, registro: l.medico.registro || "",
                   M: 0, T: 0, SN: 0, horas: 0 });
    }
    const r = por.get(k);
    r[l.shift] += 1;
    r.horas += HORAS[l.shift];
  }
  return [...por.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ---------------- planilhas ---------------- */
// ponto e virgula e BOM: e assim que o Excel em portugues abre certo
const csv = (linhas) => "﻿" + linhas.map((l) =>
  l.map((c) => {
    const s = String(c ?? "");
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(";")).join("\r\n");

function detalhadoCsv(linhas) {
  const out = [["Data", "Dia", "UTI", "Turno", "Horário", "Horas",
                "Médico", "Registro", "Origem", "Escala fixa previa"]];
  for (const l of linhas) {
    out.push([
      br(l.date), DOW3[dow(l.date)], l.unit, l.shift, SHIFT_INFO[l.shift].hours,
      l.medico ? HORAS[l.shift] : 0,
      l.medico ? l.medico.full_name : "VAGO",
      l.medico ? (l.medico.registro || "") : "",
      ORIGEM[l.origem] || l.origem,
      l.trocado && l.base ? l.base.full_name : "",
    ]);
  }
  return csv(out);
}

function resumoCsv(resumo) {
  const out = [["Médico", "Registro", "Manhas", "Tardes", "Noites", "Plantões", "Horas"]];
  for (const r of resumo) {
    out.push([r.nome, r.registro, r.M, r.T, r.SN, r.M + r.T + r.SN, r.horas]);
  }
  out.push([]);
  out.push(["TOTAL", "", ...["M", "T", "SN"].map((k) => resumo.reduce((s, r) => s + r[k], 0)),
            resumo.reduce((s, r) => s + r.M + r.T + r.SN, 0),
            resumo.reduce((s, r) => s + r.horas, 0)]);
  return csv(out);
}

function baixaCsv(texto, nome) {
  const blob = new Blob([texto], { type: "text/csv;charset=utf-8" });
  const a = h("a", { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Planilha baixada.");
}

/* ---------------- versao para impressao ---------------- */
function relatorio(linhas, resumo, vagos) {
  const porDia = new Map();
  for (const l of linhas) {
    if (!porDia.has(l.date)) porDia.set(l.date, []);
    porDia.get(l.date).push(l);
  }

  const tabela = h("table", { class: "rel" },
    h("thead", null, h("tr", null,
      h("th", null, "Dia"),
      S.units.map((u) => SHIFTS.map((s) =>
        h("th", null, u.name.replace("UTI ", "") + " " + s))))),
    h("tbody", null, [...porDia.keys()].map((d) =>
      h("tr", { class: [0, 6].includes(dow(d)) ? "fds" : "" },
        h("td", { class: "dia" },
          h("span", { class: "mono strong" }, d.slice(8)),
          " ", h("span", { class: "meta" }, DOW[dow(d)])),
        S.units.map((u) => SHIFTS.map((s) => {
          const l = linhas.find((x) => x.date === d && x.unit === u.name && x.shift === s);
          if (!l) return h("td", null, "");
          if (!l.medico) return h("td", { class: "vago" }, "vago");
          return h("td", { class: l.trocado ? "trocado" : "" },
            curto(l.medico.full_name));
        }))))));

  return h("section", { class: "print-área" },
    h("header", { class: "rel-cab" },
      h("img", { src: "./assets/logo.png", alt: "", class: "rel-logo" }),
      h("div", null,
        h("h2", null, "Escala de plantão ", MONTHS[vista.m], " de ", vista.y),
        h("div", { class: "meta" }, S.org.name, " | UTI Adulto"),
        h("div", { class: "meta" }, "Emitido em ", br(today()),
          vagos ? ` | ${vagos} turno${vagos > 1 ? "s" : ""} sem plantonista` : ""))),
    h("div", { class: "rel-wrap" }, tabela),
    h("h3", { class: "rel-h3" }, "Total por médico"),
    h("table", { class: "rel" },
      h("thead", null, h("tr", null,
        h("th", { style: { textAlign: "left" } }, "Médico"),
        h("th", null, "Registro"), h("th", null, "M"), h("th", null, "T"),
        h("th", null, "SN"), h("th", null, "Plantões"), h("th", null, "Horas"))),
      h("tbody", null,
        resumo.map((r) => h("tr", null,
          h("td", { style: { textAlign: "left" } }, r.nome),
          h("td", { class: "mono" }, r.registro),
          h("td", { class: "mono" }, String(r.M)),
          h("td", { class: "mono" }, String(r.T)),
          h("td", { class: "mono" }, String(r.SN)),
          h("td", { class: "mono" }, String(r.M + r.T + r.SN)),
          h("td", { class: "mono strong" }, String(r.horas)))),
        h("tr", { class: "tot" },
          h("td", { style: { textAlign: "left" } }, "TOTAL"),
          h("td", null, ""),
          ["M", "T", "SN"].map((k) =>
            h("td", { class: "mono" }, String(resumo.reduce((s, r) => s + r[k], 0)))),
          h("td", { class: "mono" }, String(resumo.reduce((s, r) => s + r.M + r.T + r.SN, 0))),
          h("td", { class: "mono strong" }, String(resumo.reduce((s, r) => s + r.horas, 0)))))),
    h("p", { class: "rel-nota" },
      "Nome em italico indica plantão que mudou de dono por troca, cessão ou ajuste da coordenação. ",
      "M das 07h as 13h, T das 13h as 19h, SN das 19h as 07h."));
}

function curto(nome) {
  const p = String(nome).trim().split(/\s+/);
  if (p.length === 1) return p[0];
  const peq = ["de", "da", "do", "das", "dos", "e"];
  const ult = peq.includes(p[p.length - 1].toLowerCase()) ? p[p.length - 2] : p[p.length - 1];
  return `${p[0]} ${(ult || "").charAt(0)}.`;
}
