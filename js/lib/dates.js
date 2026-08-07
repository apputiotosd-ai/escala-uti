// Datas sempre como texto AAAA-MM-DD para nao pegar fuso pelo caminho.

export const DOW  = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
export const DOW3 = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];
export const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
                       "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const today = () => iso(new Date());

export const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const dow = (s) => parse(s).getDay();
export const isWeekend = (s) => [0, 6].includes(dow(s));

/** dd/mm */
export const brShort = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}`; };
/** dd/mm/aaaa */
export const br = (s) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
/** sab, 15/08 */
export const brDow = (s) => `${DOW[dow(s)]}, ${brShort(s)}`;

export const monthLabel = (y, m) => `${MONTHS[m]} de ${y}`;

/** "07/08/2026 as 19:32" a partir de um instante do banco */
export function brDateTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} as ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "ha 2 horas", para dar noçao de ordem de chegada sem contar no relogio */
export function haQuanto(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "agora ha pouco";
  const min = Math.round(s / 60);
  if (min < 60) return `ha ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `ha ${hr} h`;
  const dias = Math.round(hr / 24);
  return dias === 1 ? "ha 1 dia" : `ha ${dias} dias`;
}

/** primeiro e ultimo dia do mes, e as bordas da grade comecando no domingo */
export function monthBounds(y, m) {
  const first = new Date(y, m, 1);
  const last  = new Date(y, m + 1, 0);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));
  return { first: iso(first), last: iso(last), gridStart: iso(gridStart), gridEnd: iso(gridEnd) };
}

/** Qual turno esta acontecendo agora. A noite atravessa a meia-noite. */
export function currentShift(now = new Date()) {
  const hh = now.getHours() + now.getMinutes() / 60;
  if (hh >= 7 && hh < 13) return { shift: "M",  date: iso(now) };
  if (hh >= 13 && hh < 19) return { shift: "T", date: iso(now) };
  // depois das 19h e a noite de hoje; antes das 7h ainda e a noite de ontem
  return { shift: "SN", date: hh >= 19 ? iso(now) : addDays(iso(now), -1) };
}

/** "Adan Vidal" -> "Adan V." para caber na celula */
export function shortName(full, display) {
  if (display) return display;
  const parts = String(full || "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const small = ["de", "da", "do", "das", "dos", "e"];
  const surname = small.includes(last.toLowerCase()) ? parts[parts.length - 2] || "" : last;
  return `${parts[0]} ${surname.charAt(0)}.`;
}

export function initials(full) {
  const parts = String(full || "?").trim().split(/\s+/).filter((p) => p.length > 2);
  if (!parts.length) return String(full || "?").slice(0, 2).toUpperCase();
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
