import { h, modal, toast, confirmBox } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, isAdmin, niceError, myShifts } from "../store.js";
import { avatar, avatarAmpliavel, linhaWhats, shiftBadge, memberPicker } from "../lib/ui.js";
import { br, brDow, shortName, brDateTime, haQuanto } from "../lib/dates.js";
import { SHIFT_INFO } from "../config.js";

/** Painel de um plantao: quem esta, quem estava, e o que da para fazer. */
export function openShiftSheet({ date, unit, shift, row, onChanged }) {
  const m = row && S.byId.get(row.member_id);
  const was = row?.base_member_id && row.base_member_id !== row.member_id
    ? S.byId.get(row.base_member_id) : null;
  const mine = row?.member_id === S.me.id;
  const past = new Date(`${date}T23:59:59`) < new Date();

  const fila = h("div");        // interessados, preenchido quando o turno esta vago

  const body = h("div", null,
    h("div", { class: "card-row", style: { gap: "10px", marginBottom: "12px" } },
      h("span", { class: `tick ${shift}`, style: { height: "40px" } }),
      h("div", { class: "grow" },
        h("div", { class: "t-date mono", style: { fontSize: "15px" } }, brDow(date)),
        h("div", { class: "meta" },
          `${unit.name} | ${SHIFT_INFO[shift].label} ${SHIFT_INFO[shift].hours}`)),
      shiftBadge(shift)),

    m
      ? h("div", { class: "card-row", style: { gap: "10px", padding: "10px 0", borderTop: "1px solid var(--rule)" } },
          avatarAmpliavel(row.member_id, "lg"),
          h("div", { class: "grow", style: { minWidth: 0 } },
            h("div", { class: "strong" }, m.full_name),
            m.registro && h("div", { class: "meta mono" }, "Registro " + m.registro),
            linhaWhats(m.phone),
            was && h("div", { class: "meta" },
              h("span", { style: { textDecoration: "line-through" } }, was.full_name),
              " passou o plantao")))
      : h("div", { class: "err", style: { margin: "10px 0" } }, "Este turno esta sem plantonista."),

    fila,
    past && h("p", { class: "meta" }, "Plantao ja realizado."));

  if (!m && !past) carregaFila(fila, unit, date, shift, onChanged);

  modal({
    title: unit.name + " " + br(date),
    body,
    actions: (close) => {
      const acts = [];
      if (!past && !row?.member_id) {
        acts.push(h("button", {
          class: "btn btn-primary", onclick: () => { close(); manifestar({ date, unit, shift, onChanged }); },
        }, icon("hand"), "Tenho interesse"));
      }
      if (!past && mine) {
        acts.push(h("button", {
          class: "btn", onclick: () => { close(); openOffer({ date, unit, shift, kind: "giveaway", onChanged }); },
        }, icon("hand"), "Ceder"));
        acts.push(h("button", {
          class: "btn", onclick: () => { close(); openOffer({ date, unit, shift, kind: "swap", onChanged }); },
        }, icon("swap"), "Trocar"));
      }
      if (!past && !mine && row?.member_id) {
        acts.push(h("button", {
          class: "btn btn-primary", onclick: () => { close(); openProposeSwap({ date, unit, shift, onChanged }); },
        }, icon("swap"), "Propor troca"));
      }
      if (isAdmin() && !past) {
        acts.push(h("button", {
          class: "btn", onclick: () => { close(); openAdminSet({ date, unit, shift, row, onChanged }); },
        }, icon("cog"), "Ajustar"));
      }
      if (!acts.length) acts.push(h("button", { class: "btn btn-block", onclick: close }, "Fechar"));
      return acts;
    },
  });
}

/* ---------- plantao vago: fila de interessados ---------- */
async function carregaFila(alvo, unit, date, shift, onChanged) {
  const { data, error } = await sb
    .from("shift_interests")
    .select("id, member_id, note, created_at")
    .eq("org_id", S.org.id).eq("unit_id", unit.id)
    .eq("work_date", date).eq("shift", shift).eq("status", "open")
    .order("created_at");                 // ordem de chegada
  if (error || !data?.length) return;

  alvo.replaceChildren(
    h("div", { class: "bar", style: { margin: "10px 0 0" } },
      h("span", null, "Manifestaram interesse"),
      h("span", { class: "mono" }, String(data.length))),
    h("div", { style: { border: "1px solid var(--rule)", borderTop: "0" } },
      data.map((it, i) => h("div", { class: "arow", style: { padding: "8px 10px" } },
        h("span", { class: "mono", style: { color: "var(--ink-3)", width: "16px" } }, String(i + 1)),
        avatar(it.member_id),
        h("div", { class: "grow" },
          h("div", { style: { fontSize: "13.5px" } },
            S.byId.get(it.member_id)?.full_name || "?",
            it.member_id === S.me.id && h("span", { class: "chip", style: { marginLeft: "6px" } }, "voce")),
          h("div", { class: "meta mono" }, brDateTime(it.created_at), "  ", haQuanto(it.created_at)),
          it.note && h("div", { class: "meta" }, it.note)),
        isAdmin() && h("button", {
          class: "btn btn-sm btn-primary",
          onclick: async (e) => {
            if (!await confirmBox("Escalar este medico",
              `${S.byId.get(it.member_id)?.full_name} assume ${brDow(date)}, ${unit.name}, turno ${shift}. ` +
              "Os outros interessados sao avisados.", "Escalar")) return;
            e.target.disabled = true;
            const { error } = await sb.rpc("grant_interest", { p_id: it.id });
            if (error) { e.target.disabled = false; return toast(niceError(error)); }
            document.querySelector(".mask")?.remove();
            toast("Escalado.");
            onChanged?.();
          },
        }, "Escalar")))));
}

function manifestar({ date, unit, shift, onChanged }) {
  const note = h("textarea", { class: "inp", rows: 2, placeholder: "Recado para a coordenacao" });
  const err = h("div");
  modal({
    title: "Manifestar interesse",
    body: h("div", null,
      h("p", { class: "meta", style: { marginTop: 0 } },
        `${unit.name} | ${brDow(date)} | ${SHIFT_INFO[shift].label} ${SHIFT_INFO[shift].hours}`),
      h("p", { style: { fontSize: "13.5px" } },
        "Este turno esta sem plantonista. Voce entra na fila e a coordenacao decide quem assume. ",
        "A data e a hora da sua manifestacao ficam registradas."),
      h("label", { class: "f" }, h("span", null, "Observacao"), note),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.rpc("express_interest", {
            p_org: S.org.id, p_unit: unit.id, p_date: date,
            p_shift: shift, p_note: note.value.trim() || null,
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close();
          toast("Interesse registrado. A coordenacao vai avaliar.");
          onChanged?.();
        },
      }, "Confirmar interesse"),
    ],
  });
}

/* ---------- anunciar no mural: ceder ou pedir troca ---------- */
function openOffer({ date, unit, shift, kind, onChanged }) {
  const note = h("textarea", { class: "inp", rows: 2,
    placeholder: kind === "giveaway" ? "Algum recado para quem for pegar" : "Algum recado" });
  const wanted = h("input", { class: "inp", placeholder: "Ex: aceito qualquer sabado de setembro" });
  const err = h("div");

  modal({
    title: kind === "giveaway" ? "Ceder plantao" : "Oferecer para troca",
    body: h("div", null,
      h("p", { class: "meta", style: { marginTop: "0" } },
        `${unit.name} | ${brDow(date)} | ${SHIFT_INFO[shift].label} ${SHIFT_INFO[shift].hours}`),
      h("p", { style: { fontSize: "13.5px" } },
        kind === "giveaway"
          ? "O plantao vai para o mural. Quando alguem pegar, voce confirma e a mudanca entra no calendario."
          : "O plantao vai para o mural marcado como troca. Quem tiver interesse propoe uma data e voce decide."),
      kind === "swap" && h("label", { class: "f" }, h("span", null, "O que voce aceita em troca"), wanted),
      h("label", { class: "f" }, h("span", null, "Observacao"), note),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.rpc("create_offer", {
            p_org: S.org.id, p_unit: unit.id, p_date: date, p_shift: shift,
            p_kind: kind, p_note: note.value.trim() || null,
            p_wanted_note: kind === "swap" ? (wanted.value.trim() || null) : null,
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close();
          toast("Publicado no mural.");
          onChanged?.();
        },
      }, "Publicar"),
    ],
  });
}

/* ---------- propor troca com o plantao de outro medico ---------- */
export function openProposeSwap({ date, unit, shift, onChanged, offerId = null }) {
  const err = h("div");
  const sel = h("select", { class: "inp" }, h("option", { value: "" }, "Carregando seus plantoes"));
  const note = h("textarea", { class: "inp", rows: 2, placeholder: "Observacao" });

  myShifts(180).then((rows) => {
    const options = rows.filter((r) => !(r.work_date === date && r.shift === shift && r.unit_id === unit.id));
    sel.replaceChildren();
    if (!options.length) {
      sel.append(h("option", { value: "" }, "Voce nao tem plantao para oferecer"));
      return;
    }
    sel.append(h("option", { value: "" }, "Escolha um plantao seu"));
    for (const r of options) {
      sel.append(h("option", { value: `${r.unit_id}|${r.work_date}|${r.shift}` },
        `${brDow(r.work_date)} | ${S.unitById.get(r.unit_id)?.name} | ${r.shift}`));
    }
  }).catch(() => sel.replaceChildren(h("option", { value: "" }, "Nao consegui carregar")));

  modal({
    title: "Propor troca",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: "0" } },
        "Voce assume o plantao abaixo e entrega um plantao seu no lugar. A troca so vale depois que o outro medico confirmar."),
      h("div", { class: "card", style: { margin: "0 0 12px" } },
        h("div", { class: "card-b card-row", style: { gap: "8px" } },
          h("span", { class: `tick ${shift}`, style: { height: "30px" } }),
          h("div", { class: "grow" },
            h("div", { class: "t-date mono" }, brDow(date)),
            h("div", { class: "meta" }, `${unit.name} | ${SHIFT_INFO[shift].hours}`)),
          shiftBadge(shift))),
      h("label", { class: "f" }, h("span", null, "Plantao que voce entrega"), sel),
      h("label", { class: "f" }, h("span", null, "Observacao"), note),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          if (!sel.value) { err.replaceChildren(h("div", { class: "err" }, "Escolha qual plantao voce entrega.")); return; }
          const [mu, md, ms] = sel.value.split("|");
          e.target.disabled = true;
          const { error } = await sb.rpc("propose_swap", {
            p_org: S.org.id,
            p_my_unit: mu, p_my_date: md, p_my_shift: ms,
            p_their_unit: unit.id, p_their_date: date, p_their_shift: shift,
            p_note: note.value.trim() || null, p_offer: offerId,
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close();
          toast("Proposta enviada. Agora e esperar a confirmacao.");
          onChanged?.();
        },
      }, "Enviar proposta"),
    ],
  });
}

/* ---------- ajuste da coordenacao ---------- */
function openAdminSet({ date, unit, shift, row, onChanged }) {
  let chosen = row?.member_id || null;
  const err = h("div");
  const note = h("input", { class: "inp", placeholder: "Motivo do ajuste" });

  modal({
    title: "Ajustar plantonista",
    body: h("div", null,
      h("p", { class: "meta", style: { marginTop: "0" } },
        `${unit.name} | ${brDow(date)} | ${SHIFT_INFO[shift].label}`),
      h("p", { style: { fontSize: "13.5px" } },
        "Isso muda so este dia. A escala fixa continua como esta."),
      h("label", { class: "f" }, h("span", null, "Plantonista"),
        memberPicker(chosen, (v) => { chosen = v; }, { blank: "Deixar sem plantonista" })),
      h("label", { class: "f" }, h("span", null, "Motivo"), note),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.rpc("admin_set_shift", {
            p_org: S.org.id, p_unit: unit.id, p_date: date, p_shift: shift,
            p_member: chosen, p_note: note.value.trim() || null,
          });
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close();
          toast("Ajuste salvo.");
          onChanged?.();
        },
      }, "Salvar"),
    ],
  });
}
