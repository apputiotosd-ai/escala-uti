-- =============================================================
-- Escala UTI  |  0008  isolamento entre organizacoes
--
-- As funcoes de leitura da escala eram security definer sem checar
-- se quem chamou pertence a organizacao pedida. Um medico com conta
-- em um hospital conseguia ler a escala de outro passando o id na
-- chamada: datas, turnos e identificadores. Nome, email e telefone
-- nao vazavam, porque a tabela de pessoas tem RLS.
--
-- Correcao: toda funcao que recebe p_org passa a exigir vinculo.
-- =============================================================

/**
 * Quem pode ler os dados desta organizacao.
 * Libera manutencao pelo banco (postgres) e pela chave de servico,
 * usadas pelas funcoes internas e pela edge function. Pela API publica
 * so passa quem e membro.
 */
create or replace function public.pode_ver_org(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select current_user not in ('anon', 'authenticated')
      or public.is_member(p_org)
$$;

revoke all on function public.pode_ver_org(uuid) from public, anon;
grant execute on function public.pode_ver_org(uuid) to authenticated;


-- ---------- escala resolvida ----------
create or replace function public.schedule_range(
  p_org uuid, p_from date, p_to date
) returns table (
  work_date      date,
  unit_id        uuid,
  shift          public.shift_code,
  member_id      uuid,
  base_member_id uuid,
  source         text
)
language sql stable security definer set search_path = public
as $$
  with permitido as (
    -- sem vinculo, nenhuma linha sai daqui
    select 1 as ok where public.pode_ver_org(p_org)
  ),
  bounds as (
    select p_from as d0, least(p_to, p_from + 400) as d1 from permitido
  ),
  days as (
    select g::date as work_date
      from bounds b, generate_series(b.d0, b.d1, interval '1 day') g
  ),
  base as (
    select d.work_date, rs.unit_id, rs.shift, rs.member_id
      from days d
      join public.rotations r
        on r.org_id = p_org
       and r.is_published
       and d.work_date >= r.effective_from
       and (r.effective_to is null or d.work_date <= r.effective_to)
      join public.rotation_slots rs
        on rs.rotation_id = r.id
       and rs.day_index = (((d.work_date - r.anchor_date) % r.cycle_days) + r.cycle_days) % r.cycle_days
  ),
  ovr as (
    select o.work_date, o.unit_id, o.shift, o.member_id, o.reason
      from public.shift_overrides o, bounds b
     where o.org_id = p_org
       and o.work_date between b.d0 and b.d1
  )
  select
    coalesce(b.work_date, o.work_date),
    coalesce(b.unit_id,   o.unit_id),
    coalesce(b.shift,     o.shift),
    case when o.work_date is not null then o.member_id else b.member_id end,
    b.member_id,
    case when o.work_date is null then 'escala' else o.reason end
  from base b
  full outer join ovr o
    on o.work_date = b.work_date
   and o.unit_id   = b.unit_id
   and o.shift     = b.shift
  order by 1, 2, 3
$$;


-- ---------- diaristas ----------
create or replace function public.daily_rounds_range(
  p_org uuid, p_from date, p_to date
) returns table (work_date date, unit_id uuid, member_id uuid)
language sql stable security definer set search_path = public
as $$
  select d.work_date, dr.unit_id, dr.member_id
    from generate_series(p_from, least(p_to, p_from + 400), interval '1 day') g
    cross join lateral (select g::date as work_date) d
    join public.daily_rounds dr
      on dr.org_id = p_org
     and d.work_date >= dr.effective_from
     and (dr.effective_to is null or d.work_date <= dr.effective_to)
     and extract(isodow from d.work_date)::smallint = any (dr.weekdays)
   where public.pode_ver_org(p_org)
   order by 1, 2
$$;


-- ---------- quem esta no plantao ----------
create or replace function public.shift_holder(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code
) returns uuid
language sql stable security definer set search_path = public
as $$
  select s.member_id
    from public.schedule_range(p_org, p_date, p_date) s
   where s.unit_id = p_unit and s.shift = p_shift
   limit 1
$$;


-- ---------- conflito de horario ----------
create or replace function public.member_busy(
  p_org uuid, p_member uuid, p_date date,
  p_shift public.shift_code, p_ignore_unit uuid default null
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.schedule_range(p_org, p_date, p_date) s
     where s.member_id = p_member
       and s.shift = p_shift
       and (p_ignore_unit is null or s.unit_id <> p_ignore_unit)
  )
$$;


-- ---------- horario de inicio do turno ----------
create or replace function public.shift_starts_at(
  p_org uuid, p_date date, p_shift public.shift_code
) returns timestamptz
language sql stable security definer set search_path = public
as $$
  select ((p_date + case p_shift
                      when 'M'  then time '07:00'
                      when 'T'  then time '13:00'
                      else           time '19:00'
                    end)
          at time zone coalesce(
            (select o.timezone from public.organizations o
              where o.id = p_org and public.pode_ver_org(p_org)),
            'America/Fortaleza'))
$$;


-- ---------- turnos vagos ----------
create or replace function public.vacant_shifts(
  p_org uuid, p_from date, p_to date
) returns table (
  work_date      date,
  unit_id        uuid,
  shift          public.shift_code,
  base_member_id uuid,
  interessados   bigint
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
   order by s.work_date, s.shift
$$;


-- -------------------------------------------------------------
-- Faxina de anuncios vencidos: tarefa de manutencao, nao de usuario.
-- Antes qualquer plantonista podia disparar, em todas as organizacoes.
-- -------------------------------------------------------------
revoke all on function public.expire_stale() from public, anon, authenticated;

-- gatilho de updated_at com search_path fixo
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- funcao de apoio do Supabase: visitante nao precisa dela
revoke all on function public.rls_auto_enable() from anon;


-- -------------------------------------------------------------
-- Politicas: separar leitura de escrita.
-- 'for all' fazia a politica de escrita ser avaliada tambem no select,
-- dobrando o trabalho em toda consulta.
-- -------------------------------------------------------------
do $$
declare
  t text;
  tabelas text[] := array['units','members','rotations','daily_rounds','shift_overrides'];
begin
  foreach t in array tabelas loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (public.is_admin(org_id))$f$, t || '_insert', t);
    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (public.is_admin(org_id)) with check (public.is_admin(org_id))$f$, t || '_update', t);
    execute format($f$
      create policy %I on public.%I for delete to authenticated
        using (public.is_admin(org_id))$f$, t || '_delete', t);
  end loop;
end $$;

-- overrides usava outro nome de politica
drop policy if exists overrides_write on public.shift_overrides;

-- rotation_slots nao tem org_id: chega nele pela escala
drop policy if exists rotation_slots_write on public.rotation_slots;
create policy rotation_slots_insert on public.rotation_slots
  for insert to authenticated
  with check (exists (select 1 from public.rotations r
                       where r.id = rotation_id and public.is_admin(r.org_id)));
create policy rotation_slots_update on public.rotation_slots
  for update to authenticated
  using (exists (select 1 from public.rotations r
                  where r.id = rotation_id and public.is_admin(r.org_id)))
  with check (exists (select 1 from public.rotations r
                       where r.id = rotation_id and public.is_admin(r.org_id)));
create policy rotation_slots_delete on public.rotation_slots
  for delete to authenticated
  using (exists (select 1 from public.rotations r
                  where r.id = rotation_id and public.is_admin(r.org_id)));


-- -------------------------------------------------------------
-- Indices nas chaves que o app realmente filtra
-- -------------------------------------------------------------
create index if not exists offers_owner_idx        on public.offers(owner_id);
create index if not exists overrides_unit_idx      on public.shift_overrides(unit_id);
create index if not exists interests_unit_idx      on public.shift_interests(unit_id, work_date, shift);
create index if not exists notifications_org_idx   on public.notifications(org_id);
create index if not exists rotation_slots_unit_idx on public.rotation_slots(unit_id);
