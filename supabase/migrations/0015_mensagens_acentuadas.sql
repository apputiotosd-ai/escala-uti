-- =============================================================
-- Escala UTI  |  0015  acentos nas mensagens do banco
--
-- As mensagens de bloqueio e os textos dos avisos aparecem para o medico
-- na tela, entao precisam do portugues escrito direito. Nenhuma regra de
-- negocio muda aqui: e so o texto.
-- =============================================================

-- ---------- mensagens de bloqueio ----------
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
  return v_id;
end $$;


create or replace function public.cancel_offer(p_offer uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_o public.offers;
begin
  select * into v_o from public.offers where id = p_offer for update;
  if not found then raise exception 'Anúncio não encontrado.'; end if;
  if v_o.owner_id <> public.current_member(v_o.org_id)
     and not public.is_admin(v_o.org_id) then
    raise exception 'Este anúncio não é seu.' using errcode = '42501';
  end if;
  if v_o.status <> 'open' then raise exception 'Este anúncio já foi encerrado.'; end if;
  update public.offers set status = 'cancelled', closed_at = now() where id = p_offer;
end $$;


create or replace function public.claim_giveaway(p_offer uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_o public.offers; v_me uuid; v_auto boolean; v_id uuid;
begin
  select * into v_o from public.offers where id = p_offer for update;
  if not found then raise exception 'Anúncio não encontrado.'; end if;
  if v_o.status <> 'open' then raise exception 'Este plantão já foi pego.'; end if;
  if v_o.kind <> 'giveaway' then raise exception 'Este anúncio é de troca, não de cessão.'; end if;

  v_me := public.current_member(v_o.org_id);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;
  if v_me = v_o.owner_id then raise exception 'Este plantão já é seu.'; end if;
  if public.member_busy(v_o.org_id, v_me, v_o.work_date, v_o.shift, v_o.unit_id) then
    raise exception 'Você já tem plantão neste mesmo turno.';
  end if;

  select o.giveaway_auto_accept into v_auto from public.organizations o where o.id = v_o.org_id;

  insert into public.exchanges(
      org_id, kind, offer_id, from_member_id, from_unit_id, from_date, from_shift,
      to_member_id, note, created_by, to_approved_at, from_approved_at)
  values (
      v_o.org_id, 'giveaway', v_o.id, v_o.owner_id, v_o.unit_id, v_o.work_date, v_o.shift,
      v_me, p_note, v_me, now(),
      case when coalesce(v_auto, false) then now() else null end)
  returning id into v_id;

  update public.offers set status = 'taken', closed_at = now() where id = v_o.id;

  if coalesce(v_auto, false) then
    perform public.maybe_apply_exchange(v_id);
  else
    perform public.notify_member(v_o.org_id, v_o.owner_id, 'giveaway_claimed',
      'Alguém quer assumir seu plantão',
      'Confirme para liberar a troca no calendário.', v_id);
  end if;
  return v_id;
end $$;


create or replace function public.propose_swap(
  p_org uuid, p_my_unit uuid, p_my_date date, p_my_shift public.shift_code,
  p_their_unit uuid, p_their_date date, p_their_shift public.shift_code,
  p_note text default null, p_offer uuid default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_them uuid; v_hold uuid; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;

  v_hold := public.shift_holder(p_org, p_my_unit, p_my_date, p_my_shift);
  if v_hold is distinct from v_me then
    raise exception 'O plantão que você quer oferecer não está no seu nome.' using errcode = '42501';
  end if;

  v_them := public.shift_holder(p_org, p_their_unit, p_their_date, p_their_shift);
  if v_them is null then raise exception 'O plantão pedido não tem ninguém escalado.'; end if;
  if v_them = v_me then raise exception 'Os dois plantões são seus.'; end if;

  if public.shift_starts_at(p_org, p_my_date, p_my_shift) < now()
     or public.shift_starts_at(p_org, p_their_date, p_their_shift) < now() then
    raise exception 'Não dá para trocar plantão que já passou.';
  end if;

  if exists (
    select 1 from public.exchanges e
     where e.org_id = p_org and e.status = 'pending'
       and ( (e.from_unit_id = p_my_unit    and e.from_date = p_my_date    and e.from_shift = p_my_shift)
          or (e.to_unit_id   = p_my_unit    and e.to_date   = p_my_date    and e.to_shift   = p_my_shift)
          or (e.from_unit_id = p_their_unit and e.from_date = p_their_date and e.from_shift = p_their_shift)
          or (e.to_unit_id   = p_their_unit and e.to_date   = p_their_date and e.to_shift   = p_their_shift) )
  ) then
    raise exception 'Um destes plantões já tem pedido aguardando resposta.';
  end if;

  insert into public.exchanges(
      org_id, kind, offer_id, from_member_id, from_unit_id, from_date, from_shift,
      to_member_id, to_unit_id, to_date, to_shift, note, created_by, from_approved_at)
  values (
      p_org, 'swap', p_offer, v_me, p_my_unit, p_my_date, p_my_shift,
      v_them, p_their_unit, p_their_date, p_their_shift, p_note, v_me, now())
  returning id into v_id;

  perform public.notify_member(p_org, v_them, 'swap_proposed',
    'Proposta de troca de plantão',
    'Um colega quer trocar um plantão com você.', v_id);
  return v_id;
end $$;


create or replace function public.respond_exchange(
  p_id uuid, p_accept boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_e public.exchanges; v_me uuid; v_side text; v_other uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_e.status <> 'pending' then raise exception 'Este pedido já foi resolvido.'; end if;

  v_me := public.current_member(v_e.org_id);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;

  if    v_e.to_member_id   = v_me and v_e.to_approved_at   is null then v_side := 'to';
  elsif v_e.from_member_id = v_me and v_e.from_approved_at is null then v_side := 'from';
  elsif public.is_admin(v_e.org_id) and v_e.admin_approved_at is null then v_side := 'admin';
  else raise exception 'Você não tem resposta pendente neste pedido.' using errcode = '42501';
  end if;

  if not p_accept then
    update public.exchanges
       set status = 'rejected', decided_by = v_me, decided_reason = p_reason, applied_at = null
     where id = p_id;
    if v_e.offer_id is not null then
      update public.offers set status = 'open', closed_at = null
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
returns void language plpgsql security definer set search_path = public
as $$
declare v_e public.exchanges; v_me uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_e.status <> 'pending' then raise exception 'Este pedido já foi resolvido.'; end if;
  v_me := public.current_member(v_e.org_id);
  if v_e.created_by <> v_me and not public.is_admin(v_e.org_id) then
    raise exception 'Este pedido não é seu.' using errcode = '42501';
  end if;
  update public.exchanges set status = 'cancelled', decided_by = v_me where id = p_id;
  if v_e.offer_id is not null then
    update public.offers set status = 'open', closed_at = null
     where id = v_e.offer_id and status = 'taken';
  end if;
end $$;


-- ---------- avisos ----------
create or replace function public.apply_exchange(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_e public.exchanges; v_hold_a uuid; v_hold_b uuid;
begin
  select * into v_e from public.exchanges where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_e.status <> 'pending' then return; end if;

  v_hold_a := public.shift_holder(v_e.org_id, v_e.from_unit_id, v_e.from_date, v_e.from_shift);
  if v_hold_a is distinct from v_e.from_member_id then
    update public.exchanges set status = 'expired',
      decided_reason = 'O plantão mudou de dono antes da confirmação.' where id = p_id;
    return;
  end if;

  if v_e.kind = 'swap' then
    v_hold_b := public.shift_holder(v_e.org_id, v_e.to_unit_id, v_e.to_date, v_e.to_shift);
    if v_hold_b is distinct from v_e.to_member_id then
      update public.exchanges set status = 'expired',
        decided_reason = 'O plantão mudou de dono antes da confirmação.' where id = p_id;
      return;
    end if;
  end if;

  if public.member_busy(v_e.org_id, v_e.to_member_id, v_e.from_date, v_e.from_shift, v_e.from_unit_id) then
    raise exception 'Conflito de horário: o médico que vai assumir já tem plantão neste turno.';
  end if;
  if v_e.kind = 'swap'
     and public.member_busy(v_e.org_id, v_e.from_member_id, v_e.to_date, v_e.to_shift, v_e.to_unit_id) then
    raise exception 'Conflito de horário: você já tem plantão no turno oferecido em troca.';
  end if;

  perform public.set_shift_holder(
    v_e.org_id, v_e.from_unit_id, v_e.from_date, v_e.from_shift,
    v_e.to_member_id, v_e.from_member_id,
    case v_e.kind when 'swap' then 'troca' else 'cessao' end,
    v_e.id, v_e.created_by, v_e.note);

  if v_e.kind = 'swap' then
    perform public.set_shift_holder(
      v_e.org_id, v_e.to_unit_id, v_e.to_date, v_e.to_shift,
      v_e.from_member_id, v_e.to_member_id, 'troca', v_e.id, v_e.created_by, v_e.note);
  end if;

  update public.exchanges set status = 'approved', applied_at = now() where id = p_id;
  if v_e.offer_id is not null then
    update public.offers set status = 'taken', closed_at = now() where id = v_e.offer_id;
  end if;

  perform public.notify_member(v_e.org_id, v_e.from_member_id, 'exchange_approved',
    'Combinado confirmado', 'A alteração já aparece no calendário.', v_e.id);
  perform public.notify_member(v_e.org_id, v_e.to_member_id, 'exchange_approved',
    'Combinado confirmado', 'A alteração já aparece no calendário.', v_e.id);
end $$;


create or replace function public.express_interest(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code, p_note text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_dono uuid; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;
  v_dono := public.shift_holder(p_org, p_unit, p_date, p_shift);
  if v_dono is not null then raise exception 'Este plantão já tem plantonista.'; end if;
  if public.shift_starts_at(p_org, p_date, p_shift) < now() then
    raise exception 'Este plantão já passou.';
  end if;
  if public.member_busy(p_org, v_me, p_date, p_shift, null) then
    raise exception 'Você já tem plantão neste mesmo turno.';
  end if;

  insert into public.shift_interests (org_id, unit_id, work_date, shift, member_id, note)
  values (p_org, p_unit, p_date, p_shift, v_me, p_note)
  on conflict (org_id, unit_id, work_date, shift, member_id) do update
     set status = 'open', note = excluded.note, created_at = now(),
         decided_by = null, decided_at = null, decided_reason = null
  returning id into v_id;
  return v_id;
end $$;


create or replace function public.grant_interest(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests; v_adm uuid; v_dono uuid; v_outro record;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestação não encontrada.'; end if;
  if not public.is_admin(v_i.org_id) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestação já foi resolvida.'; end if;

  v_dono := public.shift_holder(v_i.org_id, v_i.unit_id, v_i.work_date, v_i.shift);
  if v_dono is not null then raise exception 'Este plantão deixou de estar vago.'; end if;
  if public.member_busy(v_i.org_id, v_i.member_id, v_i.work_date, v_i.shift, v_i.unit_id) then
    raise exception 'Este médico já tem plantão neste turno em outra UTI.';
  end if;

  v_adm := public.current_member(v_i.org_id);
  perform public.set_shift_holder(
    v_i.org_id, v_i.unit_id, v_i.work_date, v_i.shift,
    v_i.member_id, null, 'admin', null, v_adm,
    'Plantão vago entregue pela coordenação');

  update public.shift_interests
     set status = 'granted', decided_by = v_adm, decided_at = now() where id = p_id;

  perform public.notify_member(v_i.org_id, v_i.member_id, 'interest_granted',
    'O plantão é seu', to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text ||
    ' já aparece no seu calendário.', null);

  for v_outro in
    update public.shift_interests
       set status = 'declined', decided_by = v_adm, decided_at = now(),
           decided_reason = 'O plantão foi para outro médico.'
     where org_id = v_i.org_id and unit_id = v_i.unit_id
       and work_date = v_i.work_date and shift = v_i.shift
       and status = 'open' and id <> p_id
    returning member_id
  loop
    perform public.notify_member(v_i.org_id, v_outro.member_id, 'interest_declined',
      'O plantão foi para outro médico',
      to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text, null);
  end loop;
end $$;


create or replace function public.decline_interest(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests; v_adm uuid;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestação não encontrada.'; end if;
  if not public.is_admin(v_i.org_id) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestação já foi resolvida.'; end if;
  v_adm := public.current_member(v_i.org_id);
  update public.shift_interests
     set status = 'declined', decided_by = v_adm, decided_at = now(), decided_reason = p_reason
   where id = p_id;
  perform public.notify_member(v_i.org_id, v_i.member_id, 'interest_declined',
    'Manifestação recusada',
    coalesce(p_reason, to_char(v_i.work_date,'DD/MM/YYYY') || ' turno ' || v_i.shift::text), null);
end $$;


create or replace function public.withdraw_interest(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests;
begin
  select * into v_i from public.shift_interests where id = p_id for update;
  if not found then raise exception 'Manifestação não encontrada.'; end if;
  if v_i.member_id <> public.current_member(v_i.org_id) then
    raise exception 'Esta manifestação não é sua.' using errcode = '42501';
  end if;
  if v_i.status <> 'open' then raise exception 'Esta manifestação já foi resolvida.'; end if;
  update public.shift_interests set status = 'withdrawn' where id = p_id;
end $$;


create or replace function public.admin_set_shift(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_member uuid, p_note text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_prev uuid; v_me uuid;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me := public.current_member(p_org);
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
end $$;


create or replace function public.update_my_profile(
  p_org uuid, p_display_name text default null,
  p_phone text default null, p_avatar_path text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_me uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;
  update public.members
     set display_name = case when p_display_name is null then display_name
                             when btrim(p_display_name) = '' then null
                             else btrim(p_display_name) end,
         phone = case when p_phone is null then phone
                      when btrim(p_phone) = '' then null
                      else btrim(p_phone) end,
         avatar_path = case when p_avatar_path is null then avatar_path
                            when btrim(p_avatar_path) = '' then null
                            else p_avatar_path end
   where id = v_me;
end $$;


create or replace function public.registrar_push(
  p_org uuid, p_endpoint text, p_p256dh text, p_auth text, p_aparelho text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then raise exception 'Você não faz parte desta escala.' using errcode = '42501'; end if;
  insert into public.push_subscriptions (org_id, member_id, endpoint, p256dh, auth, aparelho)
  values (p_org, v_me, p_endpoint, p_p256dh, p_auth, p_aparelho)
  on conflict (endpoint) do update
     set member_id = v_me, org_id = p_org, p256dh = excluded.p256dh, auth = excluded.auth,
         aparelho = coalesce(excluded.aparelho, public.push_subscriptions.aparelho), falhas = 0
  returning id into v_id;
  return v_id;
end $$;


create or replace function public.nova_versao_escala(
  p_org uuid, p_inicio date, p_nome text default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_atual public.rotations; v_nova uuid; v_me uuid;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me := public.current_member(p_org);

  if p_inicio <= current_date then
    raise exception 'A nova versão tem que começar a partir de amanhã, para não mexer no que já passou.';
  end if;

  select * into v_atual from public.rotations where id = public.escala_vigente(p_org, current_date);
  if v_atual.id is null then raise exception 'Não existe escala fixa vigente para copiar.'; end if;
  if p_inicio <= v_atual.effective_from then
    raise exception 'A nova versão tem que começar depois do início da versão atual (%).',
      to_char(v_atual.effective_from, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.rotations
              where org_id = p_org and is_published and effective_from >= p_inicio) then
    raise exception 'Já existe uma versão começando nessa data ou depois dela.';
  end if;

  update public.rotations set effective_to = p_inicio - 1 where id = v_atual.id;

  insert into public.rotations
    (org_id, name, cycle_days, anchor_date, effective_from, effective_to,
     is_published, notes, created_by)
  values
    (p_org,
     coalesce(nullif(btrim(p_nome), ''), 'Escala a partir de ' || to_char(p_inicio, 'DD/MM/YYYY')),
     v_atual.cycle_days, v_atual.anchor_date, p_inicio, null, true,
     'Copiada de: ' || v_atual.name, v_me)
  returning id into v_nova;

  perform set_config('escala.copiando', '1', true);
  insert into public.rotation_slots (rotation_id, unit_id, day_index, shift, member_id)
  select v_nova, unit_id, day_index, shift, member_id
    from public.rotation_slots where rotation_id = v_atual.id;
  perform set_config('escala.copiando', '', true);

  return v_nova;
end $$;


-- ---------- auditoria em portugues correto ----------
create or replace function public.quem_agiu(p_org uuid)
returns record language plpgsql stable security definer set search_path = public
as $$
declare r record;
begin
  select m.id, m.full_name into r
    from public.members m where m.org_id = p_org and m.user_id = auth.uid() limit 1;
  if r.id is null then
    select null::uuid as id, 'manutenção pelo sistema'::text as full_name into r;
  end if;
  return r;
end $$;


create or replace function public.audita_override()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_ator record; v_de text; v_para text; v_uti text; v_motivo text;
begin
  v_ator := public.quem_agiu(coalesce(new.org_id, old.org_id));
  select full_name into v_para from public.members where id = new.member_id;
  select full_name into v_de   from public.members
   where id = coalesce(new.origin_member_id, old.member_id);
  select name into v_uti from public.units where id = coalesce(new.unit_id, old.unit_id);

  if tg_op = 'DELETE' then
    insert into public.audit_log
      (org_id, quem, quem_nome, acao, descricao, unit_id, work_date, shift)
    values (old.org_id, v_ator.id, v_ator.full_name, 'plantao_pontual',
            format('%s, %s, turno %s: voltou para a escala fixa', v_uti,
                   to_char(old.work_date,'DD/MM/YYYY'), old.shift::text),
            old.unit_id, old.work_date, old.shift);
    return old;
  end if;

  v_motivo := case new.reason when 'troca' then 'troca'
                              when 'cessao' then 'cessão'
                              else 'ajuste da coordenação' end;

  insert into public.audit_log
    (org_id, quem, quem_nome, acao, descricao, detalhe, unit_id, work_date, shift)
  values (
    new.org_id, v_ator.id, v_ator.full_name, 'plantao_pontual',
    format('%s, %s, turno %s: %s no lugar de %s (%s)',
           v_uti, to_char(new.work_date,'DD/MM/YYYY'), new.shift::text,
           coalesce(v_para,'vago'), coalesce(v_de,'vago'), v_motivo),
    jsonb_build_object('motivo', v_motivo, 'de', v_de, 'para', v_para,
                       'observacao', new.note),
    new.unit_id, new.work_date, new.shift);
  return new;
end $$;


create or replace function public.audita_versao()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_ator record; v_txt text;
begin
  v_ator := public.quem_agiu(new.org_id);
  if tg_op = 'INSERT' then
    v_txt := format('Nova versão da escala fixa "%s", valendo de %s',
                    new.name, to_char(new.effective_from, 'DD/MM/YYYY'));
  elsif old.effective_to is distinct from new.effective_to then
    v_txt := format('Versão "%s" passou a valer até %s',
                    new.name, coalesce(to_char(new.effective_to, 'DD/MM/YYYY'), 'sem prazo'));
  else
    return new;
  end if;
  insert into public.audit_log (org_id, quem, quem_nome, acao, descricao, detalhe)
  values (new.org_id, v_ator.id, v_ator.full_name, 'escala_versao', v_txt,
          jsonb_build_object('versao', new.name, 'de', new.effective_from, 'ate', new.effective_to));
  return new;
end $$;
