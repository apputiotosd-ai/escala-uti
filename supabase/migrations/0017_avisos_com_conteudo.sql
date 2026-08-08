-- =============================================================
-- Escala UTI  |  0017  avisos que dizem quem, quando e onde
--
-- Os textos diziam "Alguem quer assumir seu plantao" e "Um colega quer
-- trocar um plantao com voce". Na tela bloqueada do celular isso nao
-- ajuda: o medico tem que abrir o app so para descobrir de que plantao
-- se trata. Agora cada aviso carrega quem, a data, a UTI e o turno.
-- =============================================================

/** "05/09, UTI 3B, turno SN" */
create or replace function public.rotulo_plantao(
  p_unit uuid, p_date date, p_shift public.shift_code
) returns text
language sql stable security definer set search_path = public
as $$
  select to_char(p_date, 'DD/MM') || ', ' ||
         coalesce((select name from public.units where id = p_unit), 'UTI') ||
         ', turno ' || p_shift::text
$$;


create or replace function public.claim_giveaway(p_offer uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_o public.offers; v_me uuid; v_auto boolean; v_id uuid; v_nome text;
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
  select full_name into v_nome from public.members where id = v_me;

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
      coalesce(v_nome, 'Um colega') || ' quer assumir seu plantão',
      public.rotulo_plantao(v_o.unit_id, v_o.work_date, v_o.shift) ||
      '. Confirme em Pendente para liberar.', v_id);
  end if;
  return v_id;
end $$;


create or replace function public.propose_swap(
  p_org uuid, p_my_unit uuid, p_my_date date, p_my_shift public.shift_code,
  p_their_unit uuid, p_their_date date, p_their_shift public.shift_code,
  p_note text default null, p_offer uuid default null
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_them uuid; v_hold uuid; v_id uuid; v_nome text;
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

  select full_name into v_nome from public.members where id = v_me;
  perform public.notify_member(p_org, v_them, 'swap_proposed',
    coalesce(v_nome, 'Um colega') || ' propôs uma troca',
    'Você entrega ' || public.rotulo_plantao(p_their_unit, p_their_date, p_their_shift) ||
    ' e fica com ' || public.rotulo_plantao(p_my_unit, p_my_date, p_my_shift) ||
    '. Responda em Pendente.', v_id);
  return v_id;
end $$;


create or replace function public.apply_exchange(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_e public.exchanges; v_hold_a uuid; v_hold_b uuid;
  v_de text; v_para text;
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

  select full_name into v_de   from public.members where id = v_e.from_member_id;
  select full_name into v_para from public.members where id = v_e.to_member_id;

  if v_e.kind = 'giveaway' then
    -- quem cedeu precisa saber QUEM ficou com o plantao
    perform public.notify_member(v_e.org_id, v_e.from_member_id, 'exchange_approved',
      coalesce(v_para, 'Um colega') || ' assumiu seu plantão',
      public.rotulo_plantao(v_e.from_unit_id, v_e.from_date, v_e.from_shift) ||
      ' saiu do seu calendário.', v_e.id);
    perform public.notify_member(v_e.org_id, v_e.to_member_id, 'exchange_approved',
      'Plantão assumido',
      public.rotulo_plantao(v_e.from_unit_id, v_e.from_date, v_e.from_shift) ||
      ' já está no seu calendário.', v_e.id);
  else
    perform public.notify_member(v_e.org_id, v_e.from_member_id, 'exchange_approved',
      'Troca confirmada com ' || coalesce(v_para, 'colega'),
      'Você sai de ' || public.rotulo_plantao(v_e.from_unit_id, v_e.from_date, v_e.from_shift) ||
      ' e fica com ' || public.rotulo_plantao(v_e.to_unit_id, v_e.to_date, v_e.to_shift) || '.', v_e.id);
    perform public.notify_member(v_e.org_id, v_e.to_member_id, 'exchange_approved',
      'Troca confirmada com ' || coalesce(v_de, 'colega'),
      'Você sai de ' || public.rotulo_plantao(v_e.to_unit_id, v_e.to_date, v_e.to_shift) ||
      ' e fica com ' || public.rotulo_plantao(v_e.from_unit_id, v_e.from_date, v_e.from_shift) || '.', v_e.id);
  end if;
end $$;


create or replace function public.respond_exchange(
  p_id uuid, p_accept boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public
as $$
declare v_e public.exchanges; v_me uuid; v_side text; v_other uuid; v_nome text; v_rot text;
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
    select full_name into v_nome from public.members where id = v_me;
    v_rot := public.rotulo_plantao(v_e.from_unit_id, v_e.from_date, v_e.from_shift);
    perform public.notify_member(v_e.org_id, v_other, 'exchange_rejected',
      coalesce(v_nome, 'O colega') || ' recusou',
      v_rot || '. ' || coalesce(p_reason, 'Sem motivo informado.'), v_e.id);
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


-- a coordenacao mexendo no plantao: dizer qual UTI, nao so a data
create or replace function public.admin_set_shift(
  p_org uuid, p_unit uuid, p_date date, p_shift public.shift_code,
  p_member uuid, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_prev uuid; v_me uuid; v_uti text; v_rot text; r record;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me   := public.current_member(p_org);
  v_prev := public.shift_holder(p_org, p_unit, p_date, p_shift);
  v_rot  := public.rotulo_plantao(p_unit, p_date, p_shift);

  if p_member is not null and public.member_busy(p_org, p_member, p_date, p_shift, p_unit) then
    raise exception 'Este médico já tem plantão neste turno em outra UTI.';
  end if;

  perform public.set_shift_holder(p_org, p_unit, p_date, p_shift,
                                  p_member, v_prev, 'admin', null, v_me, p_note);

  if p_member is not null and p_member is distinct from v_prev then
    perform public.notify_member(p_org, p_member, 'admin_assigned',
      'A coordenação escalou você', v_rot || '. Já está no seu calendário.', null);
  end if;
  if v_prev is not null and v_prev is distinct from p_member then
    perform public.notify_member(p_org, v_prev, 'admin_removed',
      'A coordenação tirou seu plantão', v_rot || '. Saiu do seu calendário.', null);
  end if;

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
        v_rot || ' está vago. Manifeste interesse no Mural.', null);
    end loop;
  end if;
end $$;


create or replace function public.grant_interest(p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_i public.shift_interests; v_adm uuid; v_dono uuid; v_outro record; v_rot text;
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
  v_rot := public.rotulo_plantao(v_i.unit_id, v_i.work_date, v_i.shift);

  perform public.set_shift_holder(
    v_i.org_id, v_i.unit_id, v_i.work_date, v_i.shift,
    v_i.member_id, null, 'admin', null, v_adm, 'Plantão vago entregue pela coordenação');

  update public.shift_interests
     set status = 'granted', decided_by = v_adm, decided_at = now() where id = p_id;

  perform public.notify_member(v_i.org_id, v_i.member_id, 'interest_granted',
    'O plantão é seu', v_rot || '. Já está no seu calendário.', null);

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
      'O plantão foi para outro médico', v_rot || '.', null);
  end loop;
end $$;
