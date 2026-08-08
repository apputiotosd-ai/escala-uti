-- =============================================================
-- Escala UTI  |  0016  publicar no mural avisa a equipe
--
-- Faltava o essencial: create_offer gravava a oferta e nao avisava
-- ninguem. O plantao ficava no mural esperando alguem abrir o app por
-- conta propria, o que anula o motivo de existir o aviso.
--
-- Quem recebe: só quem poderia realmente pegar o plantao. Nao adianta
-- avisar quem ja esta escalado naquele mesmo turno, e nao se avisa o
-- proprio dono. Cada um pode desligar o aviso de mural sem perder os
-- avisos que sao dirigidos a ele.
-- =============================================================

alter table public.members
  add column if not exists avisa_mural boolean not null default true;

comment on column public.members.avisa_mural is
  'Recebe aviso quando alguem publica plantao no mural. Avisos dirigidos a pessoa nao dependem disto.';


/**
 * Avisa a equipe sobre uma oferta recem publicada.
 * Roda dentro de create_offer, entao herda a transacao: se a oferta
 * falhar, ninguem e avisado.
 */
create or replace function public.avisa_mural(p_offer uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_o      public.offers;
  v_dono   text;
  v_uti    text;
  v_titulo text;
  v_corpo  text;
  v_kind   text;
  r        record;
  n        integer := 0;
begin
  select * into v_o from public.offers where id = p_offer;
  if not found or v_o.status <> 'open' then return 0; end if;

  select full_name into v_dono from public.members where id = v_o.owner_id;
  select name into v_uti from public.units where id = v_o.unit_id;

  if v_o.kind = 'giveaway' then
    v_kind   := 'offer_giveaway';
    v_titulo := 'Plantão disponível para pegar';
    v_corpo  := format('%s está cedendo %s, %s, turno %s.',
                       coalesce(v_dono, 'Um colega'),
                       to_char(v_o.work_date, 'DD/MM'), v_uti, v_o.shift::text);
  else
    v_kind   := 'offer_swap';
    v_titulo := 'Plantão oferecido para troca';
    v_corpo  := format('%s quer trocar %s, %s, turno %s.%s',
                       coalesce(v_dono, 'Um colega'),
                       to_char(v_o.work_date, 'DD/MM'), v_uti, v_o.shift::text,
                       case when v_o.wanted_note is null then ''
                            else ' Aceita: ' || v_o.wanted_note end);
  end if;

  for r in
    select m.id
      from public.members m
     where m.org_id = v_o.org_id
       and m.is_active
       and m.avisa_mural
       and m.user_id is not null          -- sem conta nao ha para onde mandar
       and m.id <> v_o.owner_id
       -- quem ja tem plantao neste turno nao pode pegar: nao se avisa
       and not public.member_busy(v_o.org_id, m.id, v_o.work_date, v_o.shift, null)
  loop
    perform public.notify_member(v_o.org_id, r.id, v_kind, v_titulo, v_corpo, null);
    n := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.avisa_mural(uuid) from public, anon, authenticated;


/** Cada um liga ou desliga o aviso de mural para si. */
create or replace function public.definir_aviso_mural(p_org uuid, p_ligado boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_me uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then
    raise exception 'Você não faz parte desta escala.' using errcode = '42501';
  end if;
  update public.members set avisa_mural = coalesce(p_ligado, true) where id = v_me;
end $$;

revoke all on function public.definir_aviso_mural(uuid,boolean) from public, anon;
grant execute on function public.definir_aviso_mural(uuid,boolean) to authenticated;


-- create_offer passa a avisar depois de gravar
create or replace function public.create_offer(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_kind public.exchange_kind,
  p_note text default null, p_wanted_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_holder uuid; v_notice smallint; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then
    raise exception 'Você não faz parte desta escala.' using errcode = '42501';
  end if;

  v_holder := public.shift_holder(p_org, p_unit, p_date, p_shift);
  if v_holder is null or v_holder <> v_me then
    raise exception 'Este plantão não está no seu nome.' using errcode = '42501';
  end if;

  select o.min_notice_hours into v_notice from public.organizations o where o.id = p_org;
  if public.shift_starts_at(p_org, p_date, p_shift)
       < now() + make_interval(hours => coalesce(v_notice, 0)) then
    raise exception 'Passou do prazo para mexer neste plantão.';
  end if;

  if exists (
    select 1 from public.exchanges e
     where e.org_id = p_org and e.status = 'pending'
       and ( (e.from_unit_id = p_unit and e.from_date = p_date and e.from_shift = p_shift)
          or (e.to_unit_id   = p_unit and e.to_date   = p_date and e.to_shift   = p_shift) )
  ) then
    raise exception 'Já existe um pedido aguardando resposta para este plantão.';
  end if;

  insert into public.offers(org_id, kind, owner_id, unit_id, work_date, shift, note, wanted_note)
  values (p_org, p_kind, v_me, p_unit, p_date, p_shift, p_note, p_wanted_note)
  returning id into v_id;

  perform public.avisa_mural(v_id);
  return v_id;
end $$;


/**
 * Plantao que fica sem ninguem tambem interessa a equipe: e onde a
 * coordenacao mais precisa de voluntario.
 */
create or replace function public.admin_set_shift(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_member uuid, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_prev uuid; v_me uuid; v_uti text; r record; n integer := 0;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me   := public.current_member(p_org);
  v_prev := public.shift_holder(p_org, p_unit, p_date, p_shift);

  if p_member is not null and public.member_busy(p_org, p_member, p_date, p_shift, p_unit) then
    raise exception 'Este médico já tem plantão neste turno em outra UTI.';
  end if;

  perform public.set_shift_holder(p_org, p_unit, p_date, p_shift,
                                  p_member, v_prev, 'admin', null, v_me, p_note);

  if p_member is not null and p_member is distinct from v_prev then
    perform public.notify_member(p_org, p_member, 'admin_assigned',
      'A coordenação escalou você',
      to_char(p_date, 'DD/MM/YYYY') || ' turno ' || p_shift::text, null);
  end if;
  if v_prev is not null and v_prev is distinct from p_member then
    perform public.notify_member(p_org, v_prev, 'admin_removed',
      'A coordenação mudou seu plantão',
      to_char(p_date, 'DD/MM/YYYY') || ' turno ' || p_shift::text, null);
  end if;

  -- turno ficou descoberto: chama voluntario
  if p_member is null and p_date >= current_date then
    select name into v_uti from public.units where id = p_unit;
    for r in
      select m.id from public.members m
       where m.org_id = p_org and m.is_active and m.avisa_mural
         and m.user_id is not null
         and not public.member_busy(p_org, m.id, p_date, p_shift, null)
    loop
      perform public.notify_member(p_org, r.id, 'offer_vago',
        'Plantão sem plantonista',
        format('%s, %s, turno %s está vago. Manifeste interesse no Mural.',
               v_uti, to_char(p_date, 'DD/MM'), p_shift::text), null);
      n := n + 1;
    end loop;
  end if;
end $$;
