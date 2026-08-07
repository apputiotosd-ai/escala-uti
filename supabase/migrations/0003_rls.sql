-- =============================================================
-- Escala UTI  |  0003  permissoes
-- Regra geral: voce so enxerga a organizacao da qual participa.
-- Escrita direta na escala fixa e privilegio do administrador.
-- Trocas e cessoes passam obrigatoriamente pelas funcoes.
-- =============================================================

create or replace function public.my_member_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.id from public.members m
   where m.user_id = auth.uid() and m.is_active
$$;

alter table public.organizations  enable row level security;
alter table public.units          enable row level security;
alter table public.members        enable row level security;
alter table public.rotations      enable row level security;
alter table public.rotation_slots enable row level security;
alter table public.daily_rounds   enable row level security;
alter table public.shift_overrides enable row level security;
alter table public.offers         enable row level security;
alter table public.exchanges      enable row level security;
alter table public.notifications  enable row level security;

-- nada para visitante nao autenticado
revoke all on all tables in schema public from anon;


-- ---------- organizations ----------
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated
  using (public.is_member(id));

drop policy if exists org_update on public.organizations;
create policy org_update on public.organizations
  for update to authenticated
  using (public.is_admin(id))
  with check (public.is_admin(id));


-- ---------- units ----------
drop policy if exists units_select on public.units;
create policy units_select on public.units
  for select to authenticated
  using (public.is_member(org_id));

drop policy if exists units_write on public.units;
create policy units_write on public.units
  for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));


-- ---------- members ----------
-- Todo mundo da equipe ve a lista: e o que faz aparecer nome e foto no calendario.
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_member(org_id));

-- O medico muda os proprios dados pela funcao update_my_profile.
drop policy if exists members_write on public.members;
create policy members_write on public.members
  for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));


-- ---------- rotations ----------
drop policy if exists rotations_select on public.rotations;
create policy rotations_select on public.rotations
  for select to authenticated
  using (public.is_member(org_id));

drop policy if exists rotations_write on public.rotations;
create policy rotations_write on public.rotations
  for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));


-- ---------- rotation_slots ----------
drop policy if exists rotation_slots_select on public.rotation_slots;
create policy rotation_slots_select on public.rotation_slots
  for select to authenticated
  using (exists (
    select 1 from public.rotations r
     where r.id = rotation_id and public.is_member(r.org_id)));

drop policy if exists rotation_slots_write on public.rotation_slots;
create policy rotation_slots_write on public.rotation_slots
  for all to authenticated
  using (exists (
    select 1 from public.rotations r
     where r.id = rotation_id and public.is_admin(r.org_id)))
  with check (exists (
    select 1 from public.rotations r
     where r.id = rotation_id and public.is_admin(r.org_id)));


-- ---------- daily_rounds ----------
drop policy if exists daily_rounds_select on public.daily_rounds;
create policy daily_rounds_select on public.daily_rounds
  for select to authenticated
  using (public.is_member(org_id));

drop policy if exists daily_rounds_write on public.daily_rounds;
create policy daily_rounds_write on public.daily_rounds
  for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));


-- ---------- shift_overrides ----------
-- Leitura livre para a equipe. Escrita direta so do administrador:
-- as trocas escrevem aqui por dentro das funcoes.
drop policy if exists overrides_select on public.shift_overrides;
create policy overrides_select on public.shift_overrides
  for select to authenticated
  using (public.is_member(org_id));

drop policy if exists overrides_write on public.shift_overrides;
create policy overrides_write on public.shift_overrides
  for all to authenticated
  using (public.is_admin(org_id))
  with check (public.is_admin(org_id));


-- ---------- offers ----------
-- O mural e visivel para toda a equipe. Publicar e cancelar so pelas funcoes.
drop policy if exists offers_select on public.offers;
create policy offers_select on public.offers
  for select to authenticated
  using (public.is_member(org_id));


-- ---------- exchanges ----------
-- Tambem visivel para a equipe, para existir a tela de pendentes.
drop policy if exists exchanges_select on public.exchanges;
create policy exchanges_select on public.exchanges
  for select to authenticated
  using (public.is_member(org_id));


-- ---------- notifications ----------
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select to authenticated
  using (member_id in (select public.my_member_ids()));

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated
  using (member_id in (select public.my_member_ids()))
  with check (member_id in (select public.my_member_ids()));


-- =============================================================
-- Execucao das funcoes
-- =============================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.schedule_range(uuid,date,date)',
    'public.daily_rounds_range(uuid,date,date)',
    'public.shift_holder(uuid,uuid,date,public.shift_code)',
    'public.member_busy(uuid,uuid,date,public.shift_code,uuid)',
    'public.shift_starts_at(uuid,date,public.shift_code)',
    'public.current_member(uuid)',
    'public.is_member(uuid)',
    'public.is_admin(uuid)',
    'public.my_orgs()',
    'public.my_member_ids()',
    'public.create_offer(uuid,uuid,date,public.shift_code,public.exchange_kind,text,text)',
    'public.cancel_offer(uuid)',
    'public.claim_giveaway(uuid,text)',
    'public.propose_swap(uuid,uuid,date,public.shift_code,uuid,date,public.shift_code,text,uuid)',
    'public.respond_exchange(uuid,boolean,text)',
    'public.cancel_exchange(uuid)',
    'public.admin_set_shift(uuid,uuid,date,public.shift_code,uuid,text)',
    'public.update_my_profile(uuid,text,text,text)',
    'public.expire_stale()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- funcoes internas: ninguem chama pela API
revoke all on function public.apply_exchange(uuid)        from public, anon, authenticated;
revoke all on function public.maybe_apply_exchange(uuid)  from public, anon, authenticated;
revoke all on function public.set_shift_holder(uuid,uuid,date,public.shift_code,uuid,uuid,text,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.notify_member(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
