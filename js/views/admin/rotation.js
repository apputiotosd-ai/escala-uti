import { h, mount, toast } from "../../lib/dom.js";
import { icon } from "../../lib/icons.js";
import { S, sb, niceError } from "../../store.js";
import { emptyState } from "../../lib/ui.js";
import { DOW3, addDays, br, parse, today } from "../../lib/dates.js";
import { SHIFTS, SHIFT_INFO } from "../../config.js";

/**
 * Escala fixa. O ciclo tem 14 dias e 14 e multiplo de 7, entao cada posicao
 * do ciclo cai sempre no mesmo dia da semana. Por isso a tela mostra
 * "semana A" e "semana B" em vez de "dia 0 ate dia 13": e assim que a
 * coordenacao pensa a escala.
 */
export async function rotationTab() {
  const root = h("div");
  await paint(root);
  return root;
}

let currentUnit = null;

async function paint(root) {
  const { data: rots, error } = await sb
    .from("rotations").select("*").eq("org_id", S.org.id)
    .order("effective_from", { ascending: false });
  if (error) throw error;

  const rot = rots?.find((r) => r.is_published) || rots?.[0];
  if (!rot) return mount(root, emptyState("Nenhuma escala fixa criada ainda."));

  const { data: slots, error: e2 } = await sb
    .from("rotation_slots").select("*").eq("rotation_id", rot.id);
  if (e2) throw e2;

  const byKey = new Map(slots.map((s) => [`${s.unit_id}|${s.day_index}|${s.shift}`, s]));
  if (!currentUnit || !S.unitById.has(currentUnit)) currentUnit = S.units[0]?.id;

  const filled = slots.filter((s) => s.member_id).length;

  mount(root,
    h("div", { class: "bar" },
      h("span", null, "Escala fixa"),
      h("span", { class: "mono" }, `${filled} de ${slots.length} turnos`)),

    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("div", { class: "meta", style: { lineHeight: "1.55" } },
        "O ciclo repete a cada ", h("span", { class: "strong" }, `${rot.cycle_days} dias`),
        ", contando a partir de ", h("span", { class: "strong mono" }, br(rot.anchor_date)),
        ". Quem voce colocar aqui aparece no calendario em todas as repeticoes, ",
        "do passado e do futuro. Trocas ja combinadas nao sao desfeitas."))),

    h("div", { class: "tabs" },
      S.units.map((u) => h("button", {
        class: "tab", role: "tab", "aria-selected": String(currentUnit === u.id),
        onclick: () => { currentUnit = u.id; paint(root); },
      }, u.name))),

    weekTable(rot, byKey, 0, "Semana A"),
    weekTable(rot, byKey, 7, "Semana B"));
}

function weekTable(rot, byKey, offset, label) {
  const anchor = rot.anchor_date;

  const head = h("thead", null,
    h("tr", null,
      h("th", { style: { textAlign: "left", paddingLeft: "8px" } }, label),
      SHIFTS.map((s) => h("th", null, `${s} ${SHIFT_INFO[s].hours.replace(" as ", "-").replace(/h/g, "")}`))));

  const body = h("tbody");
  for (let i = 0; i < 7; i++) {
    const idx = offset + i;
    const dateAtIdx = addDays(anchor, idx);
    const wd = parse(dateAtIdx).getDay();
    const nextReal = nextOccurrence(anchor, rot.cycle_days, idx);

    body.append(h("tr", null,
      h("td", { class: `turno${[0, 6].includes(wd) ? " sat" : ""}`,
                style: { width: "88px", textAlign: "left", padding: "5px 8px" } },
        h("div", { style: { fontWeight: "700" } }, DOW3[wd]),
        h("div", { style: { fontSize: "9px", color: "var(--ink-3)", fontWeight: "400" } },
          "prox " + br(nextReal).slice(0, 5))),
      SHIFTS.map((s) => {
        const key = `${currentUnit}|${idx}|${s}`;
        const slot = byKey.get(key);
        const td = h("td", { class: slot?.member_id ? "" : "vago" });
        const sel = h("select", {
          onchange: async (e) => {
            const val = e.target.value || null;
            td.className = val ? "" : "vago";
            const { error } = await sb.from("rotation_slots")
              .upsert({ rotation_id: rot.id, unit_id: currentUnit, day_index: idx,
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

  return h("div", { class: "gridwrap" },
    h("table", { class: "escala" }, head, body));
}

/** Proxima data real em que esta posicao do ciclo acontece. */
function nextOccurrence(anchor, cycle, idx) {
  const t = today();
  let d = addDays(anchor, idx);
  while (d < t) d = addDays(d, cycle);
  return d;
}
