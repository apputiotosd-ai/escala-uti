-- =============================================================
-- Escala UTI  |  0005  interesse em plantao vago
-- Turno sem plantonista fica aberto. Quem quiser manifesta interesse,
-- e a coordenacao decide quem assume, vendo a ordem de chegada.
-- =============================================================

do $$ begin
  create type public.interest_status as enum ('open','granted','declined','withdrawn','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.shift_interests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  unit_id     uuid not null references public.units(id) on delete cascade,
  work_date   date not null,
  shift       public.shift_code not null,
  member_id   uuid not null references public.members(id) on delete cascade,
  note        text,
  status      public.interest_status not null default 'open',
  decided_by  uuid references public.members(id) on delete set null,
  decided_at  timestamptz,
  decided_reason text,
  created_at  timestamptz not null default now(),
  -- uma manifestacao por pessoa por plantao
  unique (org_id, unit_id, work_date, shift, member_id)
);
create index if not exists interests_lookup_idx
  on public.shift_interests(org_id, status, work_date);
create index if not exists interests_member_idx
  on public.shift_interests(member_id, status);


-- -------------------------------------------------------------
-- Turnos sem plantonista no periodo, ja com a contagem de interessados
-- -------------------------------------------------------------
create or replace function public.vacant_shifts(
  p_org uuid, p_from date, p_to date
) returns table (
  work_date     date,
  unit_id       uuid,
  shift         public.shift_code,
  base_member_id uuid,
  interessados  bigint
)
language sql stable security definer set search_path = public
as $$
  select s.work_date, s.unit_id, s.shift, s.base_member_id,
         (select count(*) from public.shift_interests i
           where i.org_id = p_org and i.unit_id = s.unit_id
             and i.work_date = s.work_date and i.shift = s.shift
             and i.status = 'open')
    from public.schedule_range(p_org, p_from, p_to) s
   where s.member_id is null
$$;

revoke all on function public.vacant_shifts(uuid,date,date) from public, anon;
grant execute on function public.vacant_shifts(uuid,date,date) to authenticated;


-- -------------------------------------------------------------
-- Manifestar interesse
-- -------------------------------------------------------------
create or replace function public.express_interest(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_dono uuid; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then
    raise exception 'Voce nao faz parte desta escala.' using errcode = '42501';
  end if;

  v_dono := public.shift_holder(p_org, p_unit, p_date, p_shift);
  if v_dono is not null then
    raise exception 'Este plantao ja tem plantonista.';
  end if;

  if public.shift_starts_at(p_org, p_date, p_shift) < now() then
    raise exception 'Este plantao ja passou.';
  end if;

  if public.member_busy(p_org, v_me, p_date, p_shift, null) then
    raise exception 'Voce ja tem plantao neste mesmo turno.';
  end if;

  insert into public.shift_interests (org_id, unit_id, work_date, shift, member_id, note)
  values (p_org, p_unit, p_date, p_shift, v_me, p_note)
  on conflict (org_id, unit_id, work_date, shift, member_id) do update
     set status = 'open', note = excluded.note, created_at = now(),
         decided_by = null, decided_at = null, decided_reason = null
  returning id into v_id;

  return v_id;
end $$;


create or replace function public.withdraw_interest(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestacao nao encontrada.'; end if;
  if v_i.member_id <> public.current_member(v_i.org_id) then
    raise exception 'Esta manifestacao nao e sua.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestacao ja foi resolvida.'; end if;

  update public.shift_interests set status = 'withdrawn' where id = p_id;
end $$;


-- -------------------------------------------------------------
-- A coordenacao escolhe quem assume
-- -------------------------------------------------------------
create or replace function public.grant_interest(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests; v_adm uuid; v_dono uuid; v_outro record;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestacao nao encontrada.'; end if;
  if not public.is_admin(v_i.org_id) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestacao ja foi resolvida.'; end if;

  v_dono := public.shift_holder(v_i.org_id, v_i.unit_id, v_i.work_date, v_i.shift);
  if v_dono is not null then
    raise exception 'Este plantao deixou de estar vago.';
  end if;
  if public.member_busy(v_i.org_id, v_i.member_id, v_i.work_date, v_i.shift, v_i.unit_id) then
    raise exception 'Este medico ja tem plantao neste turno em outra UTI.';
  end if;

  v_adm := public.current_member(v_i.org_id);

  perform public.set_shift_holder(
    v_i.org_id, v_i.unit_id, v_i.work_date, v_i.shift,
    v_i.member_id, null, 'admin', null, v_adm,
    'Plantao vago entregue pela coordenacao');

  update public.shift_interests
     set status = 'granted', decided_by = v_adm, decided_at = now()
   where id = p_id;

  perform public.notify_member(v_i.org_id, v_i.member_id, 'interest_granted',
    'O plantao e seu', to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text ||
    ' ja aparece no seu calendario.', null);

  -- os demais interessados naquele mesmo plantao ficam sabendo
  for v_outro in
    update public.shift_interests
       set status = 'declined', decided_by = v_adm, decided_at = now(),
           decided_reason = 'O plantao foi para outro medico.'
     where org_id = v_i.org_id and unit_id = v_i.unit_id
       and work_date = v_i.work_date and shift = v_i.shift
       and status = 'open' and id <> p_id
    returning member_id
  loop
    perform public.notify_member(v_i.org_id, v_outro.member_id, 'interest_declined',
      'O plantao foi para outro medico',
      to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text, null);
  end loop;
end $$;


create or replace function public.decline_interest(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests; v_adm uuid;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestacao nao encontrada.'; end if;
  if not public.is_admin(v_i.org_id) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestacao ja foi resolvida.'; end if;

  v_adm := public.current_member(v_i.org_id);
  update public.shift_interests
     set status = 'declined', decided_by = v_adm, decided_at = now(), decided_reason = p_reason
   where id = p_id;

  perform public.notify_member(v_i.org_id, v_i.member_id, 'interest_declined',
    'Manifestacao recusada',
    coalesce(p_reason, to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text), null);
end $$;


-- -------------------------------------------------------------
-- Permissoes
-- -------------------------------------------------------------
alter table public.shift_interests enable row level security;

drop policy if exists interests_select on public.shift_interests;
create policy interests_select on public.shift_interests
  for select to authenticated
  using (public.is_member(org_id));

do $$
declare f text;
begin
  foreach f in array array[
    'public.express_interest(uuid,uuid,date,public.shift_code,text)',
    'public.withdraw_interest(uuid)',
    'public.grant_interest(uuid)',
    'public.decline_interest(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
