-- =============================================================
-- Escala UTI  |  0002  resolucao da escala e motor de trocas
-- =============================================================

-- -------------------------------------------------------------
-- Quem sou eu nesta organizacao
-- security definer para nao entrar em recursao nas policies
-- -------------------------------------------------------------
create or replace function public.current_member(p_org uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.id
    from public.members m
   where m.org_id = p_org
     and m.user_id = auth.uid()
     and m.is_active
   limit 1
$$;

create or replace function public.is_member(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members m
     where m.org_id = p_org and m.user_id = auth.uid() and m.is_active
  )
$$;

create or replace function public.is_admin(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.members m
     where m.org_id = p_org and m.user_id = auth.uid()
       and m.is_active and m.role = 'admin'
  )
$$;

-- organizacoes das quais eu participo
create or replace function public.my_orgs()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.org_id from public.members m
   where m.user_id = auth.uid() and m.is_active
$$;


-- -------------------------------------------------------------
-- Horarios do turno
-- M 07:00-13:00 | T 13:00-19:00 | SN 19:00-07:00 do dia seguinte
-- -------------------------------------------------------------
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
            (select o.timezone from public.organizations o where o.id = p_org),
            'America/Fortaleza'))
$$;


-- -------------------------------------------------------------
-- A escala resolvida para um intervalo de datas.
-- Projeta a escala fixa pelo ciclo e aplica as alteracoes por cima.
-- base_member_id = quem a escala fixa previa
-- member_id      = quem realmente esta de plantao hoje
-- -------------------------------------------------------------
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
       -- modulo sempre positivo, mesmo para datas antes da ancora
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
$$;

revoke all on function public.schedule_range(uuid,date,date) from public;
grant execute on function public.schedule_range(uuid,date,date) to authenticated;


-- -------------------------------------------------------------
-- Diaristas do intervalo
-- -------------------------------------------------------------
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
$$;

revoke all on function public.daily_rounds_range(uuid,date,date) from public;
grant execute on function public.daily_rounds_range(uuid,date,date) to authenticated;


-- -------------------------------------------------------------
-- Quem esta neste plantao agora
-- -------------------------------------------------------------
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

-- O medico ja tem outro plantao neste mesmo turno, em outra UTI?
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


-- -------------------------------------------------------------
-- Grava quem fica com o plantao.
-- Se o resultado coincide com a escala fixa, apaga a excecao
-- em vez de guardar um registro redundante.
-- -------------------------------------------------------------
create or replace function public.set_shift_holder(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_member uuid, p_origin uuid, p_reason text,
  p_exchange uuid default null, p_by uuid default null, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_base uuid;
begin
  select s.base_member_id into v_base
    from public.schedule_range(p_org, p_date, p_date) s
   where s.unit_id = p_unit and s.shift = p_shift
   limit 1;

  if v_base is not distinct from p_member then
    delete from public.shift_overrides
     where org_id = p_org and unit_id = p_unit
       and work_date = p_date and shift = p_shift;
  else
    insert into public.shift_overrides
      (org_id, unit_id, work_date, shift, member_id,
       origin_member_id, reason, exchange_id, created_by, note)
    values
      (p_org, p_unit, p_date, p_shift, p_member,
       p_origin, p_reason, p_exchange, p_by, p_note)
    on conflict (org_id, unit_id, work_date, shift) do update
      set member_id        = excluded.member_id,
          origin_member_id = excluded.origin_member_id,
          reason           = excluded.reason,
          exchange_id      = excluded.exchange_id,
          created_by       = excluded.created_by,
          note             = excluded.note,
          created_at       = now();
  end if;
end $$;


-- -------------------------------------------------------------
-- Aviso interno
-- -------------------------------------------------------------
create or replace function public.notify_member(
  p_org uuid, p_member uuid, p_kind text,
  p_title text, p_body text default null, p_exchange uuid default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications(org_id, member_id, kind, title, body, exchange_id)
  values (p_org, p_member, p_kind, p_title, p_body, p_exchange)
$$;


-- =============================================================
-- MURAL
-- =============================================================

-- Anunciar um plantao: kind 'giveaway' = estou cedendo
--                      kind 'swap'     = quero trocar por outra data
create or replace function public.create_offer(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_kind public.exchange_kind,
  p_note text default null, p_wanted_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me     uuid;
  v_holder uuid;
  v_notice smallint;
  v_id     uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then
    raise exception 'Voce nao faz parte desta escala.' using errcode = '42501';
  end if;

  v_holder := public.shift_holder(p_org, p_unit, p_date, p_shift);
  if v_holder is null or v_holder <> v_me then
    raise exception 'Este plantao nao esta no seu nome.' using errcode = '42501';
  end if;

  select o.min_notice_hours into v_notice
    from public.organizations o where o.id = p_org;

  if public.shift_starts_at(p_org, p_date, p_shift)
       < now() + make_interval(hours => coalesce(v_notice, 0)) then
    raise exception 'Passou do prazo para mexer neste plantao.';
  end if;

  if exists (
    select 1 from public.exchanges e
     where e.org_id = p_org and e.status = 'pending'
       and ( (e.from_unit_id = p_unit and e.from_date = p_date and e.from_shift = p_shift)
          or (e.to_unit_id   = p_unit and e.to_date   = p_date and e.to_shift   = p_shift) )
  ) then
    raise exception 'Ja existe um pedido aguardando resposta para este plantao.';
  end if;

  insert into public.offers(org_id, kind, owner_id, unit_id, work_date, shift, note, wanted_note)
  values (p_org, p_kind, v_me, p_unit, p_date, p_shift, p_note, p_wanted_note)
  returning id into v_id;

  return v_id;
end $$;


create or replace function public.cancel_offer(p_offer uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_o public.offers;
begin
  select * into v_o from public.offers where id = p_offer for update;
  if not found then raise exception 'Anuncio nao encontrado.'; end if;

  if v_o.owner_id <> public.current_member(v_o.org_id)
     and not public.is_admin(v_o.org_id) then
    raise exception 'Este anuncio nao e seu.' using errcode = '42501';
  end if;
  if v_o.status <> 'open' then
    raise exception 'Este anuncio ja foi encerrado.';
  end if;

  update public.offers
     set status = 'cancelled', closed_at = now()
   where id = p_offer;
end $$;


-- =============================================================
-- PEDIDOS COM DUPLA APROVACAO
-- =============================================================

-- Aplica a troca. So e chamada quando as aprovacoes necessarias existem.
create or replace function public.apply_exchange(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_e       public.exchanges;
  v_hold_a  uuid;
  v_hold_b  uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido nao encontrado.'; end if;
  if v_e.status <> 'pending' then return; end if;

  -- o mundo pode ter mudado desde que o pedido foi criado
  v_hold_a := public.shift_holder(v_e.org_id, v_e.from_unit_id, v_e.from_date, v_e.from_shift);
  if v_hold_a is distinct from v_e.from_member_id then
    update public.exchanges
       set status = 'expired', decided_reason = 'O plantao mudou de dono antes da confirmacao.'
     where id = p_id;
    return;
  end if;

  if v_e.kind = 'swap' then
    v_hold_b := public.shift_holder(v_e.org_id, v_e.to_unit_id, v_e.to_date, v_e.to_shift);
    if v_hold_b is distinct from v_e.to_member_id then
      update public.exchanges
         set status = 'expired', decided_reason = 'O plantao mudou de dono antes da confirmacao.'
       where id = p_id;
      return;
    end if;
  end if;

  -- ninguem pode ficar com dois plantoes no mesmo turno
  if public.member_busy(v_e.org_id, v_e.to_member_id, v_e.from_date, v_e.from_shift, v_e.from_unit_id) then
    raise exception 'Conflito de horario: o medico que vai assumir ja tem plantao neste turno.';
  end if;
  if v_e.kind = 'swap'
     and public.member_busy(v_e.org_id, v_e.from_member_id, v_e.to_date, v_e.to_shift, v_e.to_unit_id) then
    raise exception 'Conflito de horario: voce ja tem plantao no turno oferecido em troca.';
  end if;

  -- quem entregou passa o plantao para quem recebe
  perform public.set_shift_holder(
    v_e.org_id, v_e.from_unit_id, v_e.from_date, v_e.from_shift,
    v_e.to_member_id, v_e.from_member_id,
    case v_e.kind when 'swap' then 'troca' else 'cessao' end,
    v_e.id, v_e.created_by, v_e.note);

  -- na troca, o caminho de volta
  if v_e.kind = 'swap' then
    perform public.set_shift_holder(
      v_e.org_id, v_e.to_unit_id, v_e.to_date, v_e.to_shift,
      v_e.from_member_id, v_e.to_member_id, 'troca',
      v_e.id, v_e.created_by, v_e.note);
  end if;

  update public.exchanges
     set status = 'approved', applied_at = now()
   where id = p_id;

  if v_e.offer_id is not null then
    update public.offers
       set status = 'taken', closed_at = now()
     where id = v_e.offer_id;
  end if;

  perform public.notify_member(v_e.org_id, v_e.from_member_id, 'exchange_approved',
    'Combinado confirmado', 'A alteracao ja aparece no calendario.', v_e.id);
  perform public.notify_member(v_e.org_id, v_e.to_member_id, 'exchange_approved',
    'Combinado confirmado', 'A alteracao ja aparece no calendario.', v_e.id);
end $$;


-- Se ja tem tudo que precisa, aplica
create or replace function public.maybe_apply_exchange(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_e         public.exchanges;
  v_needs_adm boolean;
begin
  select * into v_e from public.exchanges where id = p_id;
  if v_e.status <> 'pending' then return; end if;

  select o.require_admin_approval into v_needs_adm
    from public.organizations o where o.id = v_e.org_id;

  if v_e.from_approved_at is not null
     and v_e.to_approved_at is not null
     and (not coalesce(v_needs_adm, false) or v_e.admin_approved_at is not null) then
    perform public.apply_exchange(p_id);
  end if;
end $$;


-- Pegar um plantao que alguem esta cedendo
create or replace function public.claim_giveaway(p_offer uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_o    public.offers;
  v_me   uuid;
  v_auto boolean;
  v_id   uuid;
begin
  select * into v_o from public.offers where id = p_offer for update;
  if not found then raise exception 'Anuncio nao encontrado.'; end if;
  if v_o.status <> 'open' then raise exception 'Este plantao ja foi pego.'; end if;
  if v_o.kind <> 'giveaway' then raise exception 'Este anuncio e de troca, nao de cessao.'; end if;

  v_me := public.current_member(v_o.org_id);
  if v_me is null then raise exception 'Voce nao faz parte desta escala.' using errcode = '42501'; end if;
  if v_me = v_o.owner_id then raise exception 'Este plantao ja e seu.'; end if;

  if public.member_busy(v_o.org_id, v_me, v_o.work_date, v_o.shift, v_o.unit_id) then
    raise exception 'Voce ja tem plantao neste mesmo turno.';
  end if;

  select o.giveaway_auto_accept into v_auto
    from public.organizations o where o.id = v_o.org_id;

  insert into public.exchanges(
      org_id, kind, offer_id,
      from_member_id, from_unit_id, from_date, from_shift,
      to_member_id,
      note, created_by,
      to_approved_at,
      from_approved_at)
  values (
      v_o.org_id, 'giveaway', v_o.id,
      v_o.owner_id, v_o.unit_id, v_o.work_date, v_o.shift,
      v_me,
      p_note, v_me,
      now(),
      case when coalesce(v_auto, false) then now() else null end)
  returning id into v_id;

  update public.offers set status = 'taken', closed_at = now() where id = v_o.id;

  if coalesce(v_auto, false) then
    perform public.maybe_apply_exchange(v_id);
  else
    perform public.notify_member(v_o.org_id, v_o.owner_id, 'giveaway_claimed',
      'Alguem quer assumir seu plantao',
      'Confirme para liberar a troca no calendario.', v_id);
  end if;

  return v_id;
end $$;


-- Propor troca: eu entrego um plantao meu e recebo um plantao de outro medico
create or replace function public.propose_swap(
  p_org uuid,
  p_my_unit uuid,   p_my_date date,   p_my_shift public.shift_code,
  p_their_unit uuid, p_their_date date, p_their_shift public.shift_code,
  p_note text default null,
  p_offer uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid;
  v_them  uuid;
  v_hold  uuid;
  v_id    uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Voce nao faz parte desta escala.' using errcode = '42501'; end if;

  v_hold := public.shift_holder(p_org, p_my_unit, p_my_date, p_my_shift);
  if v_hold is distinct from v_me then
    raise exception 'O plantao que voce quer oferecer nao esta no seu nome.' using errcode = '42501';
  end if;

  v_them := public.shift_holder(p_org, p_their_unit, p_their_date, p_their_shift);
  if v_them is null then raise exception 'O plantao pedido nao tem ninguem escalado.'; end if;
  if v_them = v_me then raise exception 'Os dois plantoes sao seus.'; end if;

  if public.shift_starts_at(p_org, p_my_date, p_my_shift) < now()
     or public.shift_starts_at(p_org, p_their_date, p_their_shift) < now() then
    raise exception 'Nao da para trocar plantao que ja passou.';
  end if;

  if exists (
    select 1 from public.exchanges e
     where e.org_id = p_org and e.status = 'pending'
       and ( (e.from_unit_id = p_my_unit    and e.from_date = p_my_date    and e.from_shift = p_my_shift)
          or (e.to_unit_id   = p_my_unit    and e.to_date   = p_my_date    and e.to_shift   = p_my_shift)
          or (e.from_unit_id = p_their_unit and e.from_date = p_their_date and e.from_shift = p_their_shift)
          or (e.to_unit_id   = p_their_unit and e.to_date   = p_their_date and e.to_shift   = p_their_shift) )
  ) then
    raise exception 'Um destes plantoes ja tem pedido aguardando resposta.';
  end if;

  insert into public.exchanges(
      org_id, kind, offer_id,
      from_member_id, from_unit_id, from_date, from_shift,
      to_member_id,   to_unit_id,   to_date,   to_shift,
      note, created_by, from_approved_at)
  values (
      p_org, 'swap', p_offer,
      v_me,   p_my_unit,    p_my_date,    p_my_shift,
      v_them, p_their_unit, p_their_date, p_their_shift,
      p_note, v_me, now())
  returning id into v_id;

  perform public.notify_member(p_org, v_them, 'swap_proposed',
    'Proposta de troca de plantao',
    'Um colega quer trocar um plantao com voce.', v_id);

  return v_id;
end $$;


-- Aceitar ou recusar. Cada lado responde pela sua parte.
create or replace function public.respond_exchange(
  p_id uuid, p_accept boolean, p_reason text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_e     public.exchanges;
  v_me    uuid;
  v_side  text;
  v_other uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido nao encontrado.'; end if;
  if v_e.status <> 'pending' then raise exception 'Este pedido ja foi resolvido.'; end if;

  v_me := public.current_member(v_e.org_id);
  if v_me is null then raise exception 'Voce nao faz parte desta escala.' using errcode = '42501'; end if;

  if    v_e.to_member_id   = v_me and v_e.to_approved_at   is null then v_side := 'to';
  elsif v_e.from_member_id = v_me and v_e.from_approved_at is null then v_side := 'from';
  elsif public.is_admin(v_e.org_id) and v_e.admin_approved_at is null then v_side := 'admin';
  else
    raise exception 'Voce nao tem resposta pendente neste pedido.' using errcode = '42501';
  end if;

  if not p_accept then
    update public.exchanges
       set status = 'rejected', decided_by = v_me,
           decided_reason = p_reason, applied_at = null
     where id = p_id;

    -- o anuncio volta para o mural
    if v_e.offer_id is not null then
      update public.offers
         set status = 'open', closed_at = null
       where id = v_e.offer_id and status = 'taken';
    end if;

    v_other := case when v_me = v_e.from_member_id then v_e.to_member_id else v_e.from_member_id end;
    perform public.notify_member(v_e.org_id, v_other, 'exchange_rejected',
      'Pedido recusado', coalesce(p_reason, 'Sem motivo informado.'), v_e.id);
    return;
  end if;

  if v_side = 'to' then
    update public.exchanges set to_approved_at = now() where id = p_id;
  elsif v_side = 'from' then
    update public.exchanges set from_approved_at = now() where id = p_id;
  else
    update public.exchanges set admin_approved_at = now(), decided_by = v_me where id = p_id;
  end if;

  perform public.maybe_apply_exchange(p_id);
end $$;


create or replace function public.cancel_exchange(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_e public.exchanges; v_me uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido nao encontrado.'; end if;
  if v_e.status <> 'pending' then raise exception 'Este pedido ja foi resolvido.'; end if;

  v_me := public.current_member(v_e.org_id);
  if v_e.created_by <> v_me and not public.is_admin(v_e.org_id) then
    raise exception 'Este pedido nao e seu.' using errcode = '42501';
  end if;

  update public.exchanges set status = 'cancelled', decided_by = v_me where id = p_id;

  if v_e.offer_id is not null then
    update public.offers set status = 'open', closed_at = null
     where id = v_e.offer_id and status = 'taken';
  end if;
end $$;


-- -------------------------------------------------------------
-- Administrador troca alguem na mao
-- -------------------------------------------------------------
create or replace function public.admin_set_shift(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_member uuid, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_prev uuid; v_me uuid;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me   := public.current_member(p_org);
  v_prev := public.shift_holder(p_org, p_unit, p_date, p_shift);

  if p_member is not null
     and public.member_busy(p_org, p_member, p_date, p_shift, p_unit) then
    raise exception 'Este medico ja tem plantao neste turno em outra UTI.';
  end if;

  perform public.set_shift_holder(p_org, p_unit, p_date, p_shift,
                                  p_member, v_prev, 'admin', null, v_me, p_note);

  if p_member is not null and p_member <> coalesce(v_prev, '00000000-0000-0000-0000-000000000000'::uuid) then
    perform public.notify_member(p_org, p_member, 'admin_assigned',
      'A coordenacao escalou voce', to_char(p_date, 'DD/MM/YYYY') || ' turno ' || p_shift::text, null);
  end if;
  if v_prev is not null and v_prev is distinct from p_member then
    perform public.notify_member(p_org, v_prev, 'admin_removed',
      'A coordenacao mudou seu plantao', to_char(p_date, 'DD/MM/YYYY') || ' turno ' || p_shift::text, null);
  end if;
end $$;


-- -------------------------------------------------------------
-- Meus dados de perfil (o medico so mexe no que e dele)
-- -------------------------------------------------------------
create or replace function public.update_my_profile(
  p_org uuid,
  p_display_name text default null,
  p_phone text default null,
  p_avatar_path text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Voce nao faz parte desta escala.' using errcode = '42501'; end if;

  update public.members
     set display_name = coalesce(p_display_name, display_name),
         phone        = coalesce(p_phone, phone),
         avatar_path  = coalesce(p_avatar_path, avatar_path)
   where id = v_me;
end $$;


-- -------------------------------------------------------------
-- Faxina: anuncios e pedidos que perderam a validade
-- -------------------------------------------------------------
create or replace function public.expire_stale()
returns void
language sql security definer set search_path = public
as $$
  with a as (
    update public.offers
       set status = 'expired', closed_at = now()
     where status = 'open' and work_date < current_date
     returning 1
  )
  update public.exchanges
     set status = 'expired',
         decided_reason = 'O plantao passou sem resposta.'
   where status = 'pending'
     and least(from_date, coalesce(to_date, from_date)) < current_date
$$;
