import { h, mount, toast, modal, confirmBox } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadRefs, niceError, callAdminUsers } from "../store.js";
import { avatar, emptyState, memberPicker, unitPicker } from "../lib/ui.js";
import { DOW3, br } from "../lib/dates.js";
import { rotationTab } from "./admin/rotation.js";
import { vagosTab } from "./admin/vagos.js";
import { exportTab } from "./admin/export.js";

const TABS = [
  { id: "escala",    label: "Escala fixa", render: rotationTab },
  { id: "vagos",     label: "Vagos",       render: vagosTab },
  { id: "fechar",    label: "Fechamento",  render: exportTab },
  { id: "medicos",   label: "Medicos",     render: membersTab },
  { id: "diaristas", label: "Diaristas",   render: roundsTab },
  { id: "ajustes",   label: "Ajustes",     render: settingsTab },
];

let tab = "escala";

export async function adminView() {
  const root = h("div");
  const body = h("div");

  const nav = h("div", { class: "tabs", style: { top: "0" } },
    h("a", { class: "tab", href: "#/escala", "aria-label": "Voltar" }, icon("left")),
    TABS.map((t) => h("button", {
      class: "tab", role: "tab", "aria-selected": String(tab === t.id),
      onclick: () => { tab = t.id; swap(); },
    }, t.label)));

  async function swap() {
    for (const b of nav.querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b.textContent === TABS.find((t) => t.id === tab).label));
    }
    mount(body, h("div", { class: "load" }, "Carregando"));
    try {
      mount(body, await TABS.find((t) => t.id === tab).render());
    } catch (e) {
      mount(body, h("div", { class: "err" }, niceError(e)));
    }
  }

  mount(root, nav, body);
  await swap();
  return root;
}

/* =========================================================
   MEDICOS
   ========================================================= */
async function membersTab() {
  const root = h("div");
  await paintMembers(root);
  return root;
}

async function paintMembers(root) {
  await loadRefs();
  const withAccess = S.members.filter((m) => m.user_id).length;

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Corpo clinico"),
      h("span", { class: "mono" }, `${withAccess} de ${S.members.length} com acesso`)),

    h("div", { style: { padding: "10px 12px" } },
      h("button", { class: "btn btn-block", onclick: () => editMember(null, root) },
        icon("plus"), "Cadastrar medico")),

    h("div", { class: "adminlist" }, S.members.map((m) => memberRow(m, root))));
}

function memberRow(m, root) {
  return h("div", { class: "arow" },
    avatar(m.id),
    h("div", { class: "grow", style: { minWidth: 0 } },
      h("div", { class: "nm" }, m.full_name,
        m.role === "admin" && h("span", { class: "chip", style: { marginLeft: "6px" } }, "coordenacao"),
        !m.is_active && h("span", { class: "chip no", style: { marginLeft: "6px" } }, "inativo")),
      h("div", { class: "rg" },
        m.registro ? "Registro " + m.registro : "sem registro",
        m.email ? "  |  " + m.email : "")),
    m.user_id
      ? h("span", { class: "chip ok" }, "tem acesso")
      : h("span", { class: "chip" }, "sem acesso"),
    h("button", { class: "btn btn-icon", "aria-label": "Editar",
      onclick: () => editMember(m, root) }, icon("cog")));
}

function editMember(m, root) {
  const isNew = !m;
  const name = h("input", { class: "inp", value: m?.full_name || "", required: true });
  const reg = h("input", { class: "inp", value: m?.registro || "" });
  const disp = h("input", { class: "inp", value: m?.display_name || "", maxlength: 24 });
  const role = h("select", { class: "inp" },
    h("option", { value: "doctor", selected: m?.role !== "admin" }, "Plantonista"),
    h("option", { value: "admin", selected: m?.role === "admin" }, "Coordenacao"));
  const active = h("input", { type: "checkbox", checked: m ? m.is_active : true });
  const err = h("div");

  modal({
    title: isNew ? "Cadastrar medico" : m.full_name,
    body: h("div", null,
      h("label", { class: "f" }, h("span", null, "Nome completo"), name),
      h("label", { class: "f" }, h("span", null, "Registro profissional"), reg),
      h("label", { class: "f" }, h("span", null, "Nome curto no calendario"), disp),
      h("label", { class: "f" }, h("span", null, "Papel"), role),
      !isNew && h("label", { class: "card-row", style: { gap: "8px", marginBottom: "12px" } },
        active, h("span", { style: { fontSize: "14px" } }, "Ativo na escala")),

      !isNew && h("div", { style: { borderTop: "1px solid var(--rule)", paddingTop: "12px" } },
        h("div", { class: "meta", style: { marginBottom: "8px" } }, "Acesso ao sistema"),
        m.user_id
          ? h("div", { class: "card-row", style: { gap: "8px" } },
              h("button", { class: "btn btn-sm", onclick: () => resetPass(m) }, icon("key"), "Nova senha"),
              h("button", { class: "btn btn-sm btn-danger", onclick: () => revoke(m, root) }, "Tirar acesso"))
          : h("button", { class: "btn btn-sm", onclick: () => grant(m, root) },
              icon("key"), "Criar acesso")),
      err),

    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          if (!name.value.trim()) { err.replaceChildren(h("div", { class: "err" }, "Informe o nome.")); return; }
          e.target.disabled = true;
          const payload = {
            full_name: name.value.trim(),
            registro: reg.value.trim() || null,
            display_name: disp.value.trim() || null,
            role: role.value,
          };
          const q = isNew
            ? sb.from("members").insert({ org_id: S.org.id, ...payload })
            : sb.from("members").update({ ...payload, is_active: active.checked }).eq("id", m.id);
          const { error } = await q;
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close();
          toast("Salvo.");
          paintMembers(root);
        },
      }, "Salvar"),
    ],
  });
}

function grant(m, root) {
  const email = h("input", { class: "inp", type: "email", inputmode: "email",
                             placeholder: "email@exemplo.com", value: m.email || "" });
  const err = h("div");
  modal({
    title: "Criar acesso",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: 0 } },
        m.full_name, " vai entrar com este email e uma senha provisoria. ",
        "Na primeira entrada o sistema pede para ele criar a senha dele."),
      h("label", { class: "f" }, h("span", null, "Email"), email),
      err),
    actions: (close) => [
      h("button", { class: "btn", onclick: close }, "Voltar"),
      h("button", {
        class: "btn btn-primary",
        onclick: async (e) => {
          const v = email.value.trim().toLowerCase();
          if (!v) { err.replaceChildren(h("div", { class: "err" }, "Informe o email.")); return; }
          e.target.disabled = true; e.target.textContent = "Criando";
          try {
            const r = await callAdminUsers({ action: "create", member_id: m.id, email: v });
            close();
            showPassword(m.full_name, v, r.password);
            paintMembers(root);
          } catch (ex) {
            e.target.disabled = false; e.target.textContent = "Criar acesso";
            err.replaceChildren(h("div", { class: "err" }, niceError(ex)));
          }
        },
      }, "Criar acesso"),
    ],
  });
}

async function resetPass(m) {
  if (!await confirmBox("Gerar nova senha",
    "A senha atual para de funcionar na hora. O medico entra com a nova e escolhe outra.", "Gerar")) return;
  try {
    const r = await callAdminUsers({ action: "reset_password", member_id: m.id });
    showPassword(m.full_name, m.email, r.password);
  } catch (e) { toast(niceError(e)); }
}

async function revoke(m, root) {
  if (!await confirmBox("Tirar acesso",
    "A conta de login e apagada. O nome continua na escala e o historico de plantoes fica.", "Tirar acesso")) return;
  try {
    await callAdminUsers({ action: "revoke", member_id: m.id });
    toast("Acesso removido.");
    paintMembers(root);
  } catch (e) { toast(niceError(e)); }
}

function showPassword(name, email, password) {
  if (!password) return toast("Conta ja existente foi vinculada.");
  modal({
    title: "Senha provisoria",
    body: h("div", null,
      h("p", { style: { fontSize: "13.5px", marginTop: 0 } },
        "Passe estes dados para ", h("span", { class: "strong" }, name),
        ". Esta senha aparece uma vez so."),
      h("div", { class: "meta", style: { marginBottom: "4px" } }, email),
      h("div", { class: "pw" }, password),
      h("button", {
        class: "btn btn-block", style: { marginTop: "10px" },
        onclick: () => {
          navigator.clipboard?.writeText(`Escala UTI\nEmail: ${email}\nSenha provisoria: ${password}`)
            .then(() => toast("Copiado."), () => toast("Copie manualmente."));
        },
      }, "Copiar email e senha")),
    actions: (close) => [h("button", { class: "btn btn-primary btn-block", onclick: close }, "Pronto")],
  });
}

/* =========================================================
   DIARISTAS
   ========================================================= */
async function roundsTab() {
  const root = h("div");
  await paintRounds(root);
  return root;
}

async function paintRounds(root) {
  const { data, error } = await sb.from("daily_rounds").select("*")
    .eq("org_id", S.org.id).order("unit_id");
  if (error) throw error;

  mount(root,
    h("div", { class: "bar" }, h("span", null, "Diaristas"), h("span", { class: "mono" }, String(data.length))),
    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("div", { class: "meta", style: { lineHeight: "1.55" } },
        "O diarista acompanha uma UTI nos dias combinados. Ele aparece no calendario ",
        "numa faixa separada e nao ocupa os turnos de manha, tarde ou noite."))),
    h("div", { style: { padding: "10px 12px" } },
      h("button", { class: "btn btn-block", onclick: () => editRound(null, root) },
        icon("plus"), "Adicionar diarista")),
    data.length
      ? h("div", { class: "adminlist" }, data.map((d) => h("div", { class: "arow" },
          avatar(d.member_id),
          h("div", { class: "grow" },
            h("div", { class: "nm" }, S.byId.get(d.member_id)?.full_name || "?"),
            h("div", { class: "rg" },
              (S.unitById.get(d.unit_id)?.name || "") + "  |  " +
              d.weekdays.map((w) => DOW3[w % 7]).join(", "))),
          h("button", { class: "btn btn-icon", "aria-label": "Editar",
            onclick: () => editRound(d, root) }, icon("cog")))))
      : emptyState("Nenhum diarista cadastrado."));
}

function editRound(d, root) {
  let unitId = d?.unit_id || S.units[0]?.id;
  let memberId = d?.member_id || null;
  const days = new Set(d?.weekdays || [1, 2, 3, 4, 5]);
  const err = h("div");

  const dayBtns = h("div", { class: "card-row", style: { flexWrap: "wrap", gap: "6px" } },
    [1, 2, 3, 4, 5, 6, 7].map((w) => {
      const b = h("button", {
        class: "btn btn-sm", "aria-pressed": String(days.has(w)),
        style: days.has(w) ? { background: "var(--ink)", color: "var(--paper)" } : {},
        onclick: () => {
          days.has(w) ? days.delete(w) : days.add(w);
          b.setAttribute("aria-pressed", String(days.has(w)));
          Object.assign(b.style, days.has(w)
            ? { background: "var(--ink)", color: "var(--paper)" }
            : { background: "", color: "" });
        },
      }, DOW3[w % 7].slice(0, 3));
      return b;
    }));

  modal({
    title: d ? "Diarista" : "Adicionar diarista",
    body: h("div", null,
      h("label", { class: "f" }, h("span", null, "Medico"),
        memberPicker(memberId, (v) => { memberId = v; }, { blank: "Escolha" })),
      h("label", { class: "f" }, h("span", null, "UTI"),
        unitPicker(unitId, (v) => { unitId = v; })),
      h("label", { class: "f" }, h("span", null, "Dias da semana"), dayBtns),
      err),
    actions: (close) => [
      d && h("button", {
        class: "btn btn-danger",
        onclick: async () => {
          if (!await confirmBox("Remover diarista", "Ele some do calendario a partir de agora.", "Remover")) return;
          const { error } = await sb.from("daily_rounds").delete().eq("id", d.id);
          if (error) return toast(niceError(error));
          close(); toast("Removido."); paintRounds(root);
        },
      }, "Remover"),
      h("button", {
        class: "btn btn-primary grow", style: { justifyContent: "center" },
        onclick: async (e) => {
          if (!memberId) { err.replaceChildren(h("div", { class: "err" }, "Escolha o medico.")); return; }
          if (!days.size) { err.replaceChildren(h("div", { class: "err" }, "Escolha ao menos um dia.")); return; }
          e.target.disabled = true;
          const payload = { org_id: S.org.id, unit_id: unitId, member_id: memberId,
                            weekdays: [...days].sort() };
          const { error } = d
            ? await sb.from("daily_rounds").update(payload).eq("id", d.id)
            : await sb.from("daily_rounds").insert(payload);
          e.target.disabled = false;
          if (error) { err.replaceChildren(h("div", { class: "err" }, niceError(error))); return; }
          close(); toast("Salvo."); paintRounds(root);
        },
      }, "Salvar"),
    ],
  });
}

/* =========================================================
   AJUSTES
   ========================================================= */
async function settingsTab() {
  const root = h("div");
  const o = S.org;

  const adminOk = h("input", { type: "checkbox", checked: o.require_admin_approval });
  const autoTake = h("input", { type: "checkbox", checked: o.giveaway_auto_accept });

  mount(root,
    h("div", { class: "bar" }, h("span", null, "Como as trocas funcionam")),
    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("label", { class: "card-row", style: { gap: "10px", alignItems: "flex-start" } },
        h("div", { style: { paddingTop: "2px" } }, adminOk),
        h("div", null,
          h("div", { class: "strong" }, "Coordenacao tambem precisa confirmar"),
          h("div", { class: "meta" },
            "Alem dos dois medicos, a troca so entra depois que a coordenacao aprova."))),
      h("hr", { style: { border: "0", borderTop: "1px solid var(--rule-2)", margin: "12px 0" } }),
      h("label", { class: "card-row", style: { gap: "10px", alignItems: "flex-start" } },
        h("div", { style: { paddingTop: "2px" } }, autoTake),
        h("div", null,
          h("div", { class: "strong" }, "Plantao cedido e assumido na hora"),
          h("div", { class: "meta" },
            "Quem pegar um plantao cedido assume direto, sem esperar o dono confirmar de novo."))),
      h("button", {
        class: "btn btn-primary btn-block", style: { marginTop: "14px" },
        onclick: async (e) => {
          e.target.disabled = true;
          const { error } = await sb.from("organizations")
            .update({ require_admin_approval: adminOk.checked,
                      giveaway_auto_accept: autoTake.checked })
            .eq("id", o.id);
          e.target.disabled = false;
          if (error) return toast(niceError(error));
          o.require_admin_approval = adminOk.checked;
          o.giveaway_auto_accept = autoTake.checked;
          toast("Salvo.");
        },
      }, "Salvar"))),

    h("div", { class: "bar", style: { marginTop: "16px" } }, h("span", null, "UTIs")),
    h("div", { class: "adminlist" }, S.units.map((u) =>
      h("div", { class: "arow" },
        h("span", { class: "tick", style: { background: "var(--ink-3)", height: "26px" } }),
        h("div", { class: "grow" }, h("div", { class: "nm" }, u.name))))),

    h("div", { style: { padding: "16px 12px 30px" } },
      h("div", { class: "meta", style: { lineHeight: "1.6" } },
        "Hospital: ", h("span", { class: "strong" }, o.name), h("br"),
        "Fuso: ", h("span", { class: "mono" }, o.timezone), h("br"),
        "Ciclo padrao: ", h("span", { class: "mono" }, o.cycle_days + " dias"))));

  return root;
}
