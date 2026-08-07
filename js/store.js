import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "escala-uti-auth" },
});

export const S = {
  user: null,
  memberships: [],   // uma linha por organizacao da qual participo
  org: null,         // organizacao ativa
  me: null,          // meu registro nesta organizacao
  units: [],
  members: [],
  byId: new Map(),
  unitById: new Map(),
  unread: 0,
};

const ORG_KEY = "escala-uti-org";

export const isAdmin = () => S.me?.role === "admin";
export const memberName = (id) => S.byId.get(id)?.full_name || "";
export const unitName = (id) => S.unitById.get(id)?.name || "";

export function avatarUrl(path) {
  return path ? `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}` : null;
}

/** Erros do Postgres chegam com prefixo tecnico. O medico nao precisa ver isso. */
export function niceError(e) {
  const m = e?.message || String(e || "Nao deu certo.");
  return m
    .replace(/^.*?(?:violates|duplicate key value violates).*unique.*$/i,
             "Ja existe um registro igual a esse.")
    .replace(/^new row violates row-level security.*$/i,
             "Voce nao tem permissao para isso.")
    .replace(/^Failed to fetch$/i, "Sem conexao. Tente de novo.");
}

export async function boot() {
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user || null;
  if (!S.user) return false;
  await loadMemberships();
  return true;
}

export async function loadMemberships() {
  const { data, error } = await sb
    .from("members")
    .select("id, org_id, role, full_name, display_name, registro, email, phone, avatar_path, organizations(*)")
    .eq("user_id", S.user.id)
    .eq("is_active", true);
  if (error) throw error;

  S.memberships = data || [];
  if (!S.memberships.length) { S.org = null; S.me = null; return; }

  const saved = localStorage.getItem(ORG_KEY);
  const pick = S.memberships.find((m) => m.org_id === saved) || S.memberships[0];
  await setOrg(pick.org_id);
}

export async function setOrg(orgId) {
  const ms = S.memberships.find((m) => m.org_id === orgId);
  if (!ms) return;
  localStorage.setItem(ORG_KEY, orgId);
  S.org = ms.organizations;
  S.me = ms;
  await loadRefs();
}

export async function loadRefs() {
  const [u, m] = await Promise.all([
    sb.from("units").select("*").eq("org_id", S.org.id).eq("is_active", true).order("sort_order"),
    sb.from("members").select("id, full_name, display_name, registro, avatar_path, role, is_active, user_id, email")
      .eq("org_id", S.org.id).order("full_name"),
  ]);
  if (u.error) throw u.error;
  if (m.error) throw m.error;

  S.units = u.data || [];
  S.members = m.data || [];
  S.byId = new Map(S.members.map((x) => [x.id, x]));
  S.unitById = new Map(S.units.map((x) => [x.id, x]));

  // refresca meus proprios dados a partir da lista carregada
  const mine = S.byId.get(S.me.id);
  if (mine) S.me = { ...S.me, ...mine };
}

/** A escala resolvida: escala fixa projetada pelo ciclo + trocas ja aplicadas. */
export async function loadSchedule(from, to) {
  const [sch, dr] = await Promise.all([
    sb.rpc("schedule_range", { p_org: S.org.id, p_from: from, p_to: to }),
    sb.rpc("daily_rounds_range", { p_org: S.org.id, p_from: from, p_to: to }),
  ]);
  if (sch.error) throw sch.error;
  if (dr.error) throw dr.error;

  // indice: dia -> unidade -> turno
  const map = new Map();
  for (const r of sch.data || []) {
    if (!map.has(r.work_date)) map.set(r.work_date, new Map());
    const d = map.get(r.work_date);
    if (!d.has(r.unit_id)) d.set(r.unit_id, {});
    d.get(r.unit_id)[r.shift] = r;
  }
  const rounds = new Map();
  for (const r of dr.data || []) {
    const k = `${r.work_date}|${r.unit_id}`;
    if (!rounds.has(k)) rounds.set(k, []);
    rounds.get(k).push(r.member_id);
  }
  return { map, rounds, rows: sch.data || [] };
}

export const cell = (sch, date, unitId, shift) => sch.map.get(date)?.get(unitId)?.[shift] || null;

export async function loadOffers() {
  const { data, error } = await sb
    .from("offers").select("*")
    .eq("org_id", S.org.id).eq("status", "open")
    .gte("work_date", new Date().toISOString().slice(0, 10))
    .order("work_date");
  if (error) throw error;
  return data || [];
}

export async function loadExchanges(statuses = ["pending"]) {
  const { data, error } = await sb
    .from("exchanges").select("*")
    .eq("org_id", S.org.id).in("status", statuses)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}

/** Pedidos que estao esperando MINHA resposta. */
export function awaitingMe(list) {
  return list.filter((e) =>
    (e.to_member_id === S.me.id && !e.to_approved_at) ||
    (e.from_member_id === S.me.id && !e.from_approved_at) ||
    (isAdmin() && S.org.require_admin_approval && !e.admin_approved_at &&
      e.from_approved_at && e.to_approved_at));
}

export async function loadNotifications() {
  const { data, error } = await sb
    .from("notifications").select("*")
    .eq("member_id", S.me.id)
    .order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  return data || [];
}

export async function refreshUnread() {
  const { count } = await sb
    .from("notifications").select("id", { count: "exact", head: true })
    .eq("member_id", S.me.id).is("read_at", null);
  S.unread = count || 0;
  return S.unread;
}

/** Meus plantoes daqui para a frente. */
export async function myShifts(days = 120) {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const { data, error } = await sb.rpc("schedule_range", { p_org: S.org.id, p_from: from, p_to: to });
  if (error) throw error;
  return (data || [])
    .filter((r) => r.member_id === S.me.id)
    .sort((a, b) => a.work_date.localeCompare(b.work_date) ||
                    ["M", "T", "SN"].indexOf(a.shift) - ["M", "T", "SN"].indexOf(b.shift));
}

export async function callAdminUsers(payload) {
  const { data, error } = await sb.functions.invoke("admin-users", {
    body: { org_id: S.org.id, ...payload },
  });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch { /* corpo nao era json */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
