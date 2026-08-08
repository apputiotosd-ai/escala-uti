-- =============================================================
-- Escala UTI  |  0006  corrige "Meus plantoes"
--
-- A API corta qualquer resposta em 1000 linhas. A tela pedia a escala
-- inteira de 180 dias (mais de 2000 turnos) e filtrava no navegador,
-- entao o corte engolia plantoes sem avisar ninguem.
--
-- Duas correcoes:
--   1. my_shifts: o filtro passa a ser feito no banco, devolvendo so os
--      turnos da pessoa. Nunca chega perto do limite.
--   2. ordem fixa nas funcoes que devolvem lista, para o app poder
--      paginar com seguranca quando o periodo for grande.
-- =============================================================

-- ordem determinada: sem isso, paginar devolveria linhas repetidas ou faltando
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
  with bounds as (
    select p_from as d0, least(p_to, p_from + 400) as d1
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


-- -------------------------------------------------------------
-- Os plantoes de quem esta pedindo, filtrados no banco
-- -------------------------------------------------------------
create or replace function public.my_shifts(
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
  select s.*
    from public.schedule_range(p_org, p_from, p_to) s
   where s.member_id = public.current_member(p_org)
   order by s.work_date, s.shift
$$;

revoke all on function public.my_shifts(uuid,date,date) from public, anon;
grant execute on function public.my_shifts(uuid,date,date) to authenticated;


-- vagos tambem com ordem fixa
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

revoke all on function public.vacant_shifts(uuid,date,date) from public, anon;
grant execute on function public.vacant_shifts(uuid,date,date) to authenticated;
