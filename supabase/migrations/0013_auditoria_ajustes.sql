-- =============================================================
-- Escala UTI  |  0013  ajustes na auditoria
--
-- Dois problemas vistos na tela:
--   1. dia da semana saia em ingles, porque to_char com TMDay depende do
--      idioma configurado no servidor, que e ingles.
--   2. criar uma versao gerava 168 registros, um por celula copiada. A
--      copia e efeito de UMA acao, que ja e registrada como versao nova.
--      O ruido enterrava as mudancas de verdade.
-- =============================================================

create or replace function public.audita_slot()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid; v_rot public.rotations; v_ator record;
  v_de text; v_para text; v_uti text; v_dia text;
  DIAS text[] := array['domingo','segunda','terca','quarta','quinta','sexta','sabado'];
begin
  -- copia em bloco de uma versao nova: nao registra celula por celula
  if coalesce(current_setting('escala.copiando', true), '') = '1' then
    return coalesce(new, old);
  end if;

  select * into v_rot from public.rotations where id = coalesce(new.rotation_id, old.rotation_id);
  v_org := v_rot.org_id;

  if tg_op = 'UPDATE' and new.member_id is not distinct from old.member_id then
    return new;
  end if;

  v_ator := public.quem_agiu(v_org);
  select full_name into v_de   from public.members where id = old.member_id;
  select full_name into v_para from public.members where id = new.member_id;
  select name into v_uti from public.units where id = coalesce(new.unit_id, old.unit_id);
  -- dia da semana sem depender do idioma do servidor
  v_dia := DIAS[extract(dow from
             v_rot.anchor_date + coalesce(new.day_index, old.day_index))::int + 1];

  insert into public.audit_log
    (org_id, quem, quem_nome, acao, descricao, detalhe, unit_id, shift)
  values (
    v_org, v_ator.id, v_ator.full_name, 'escala_slot',
    format('%s, %s, turno %s: %s no lugar de %s',
           v_uti, v_dia, coalesce(new.shift, old.shift)::text,
           coalesce(v_para, 'vago'), coalesce(v_de, 'vago')),
    jsonb_build_object('versao', v_rot.name, 'vigencia_desde', v_rot.effective_from,
                       'posicao_ciclo', coalesce(new.day_index, old.day_index),
                       'de', v_de, 'para', v_para),
    coalesce(new.unit_id, old.unit_id), coalesce(new.shift, old.shift));
  return coalesce(new, old);
end $$;


-- a criacao da versao marca a copia para o gatilho ficar quieto
create or replace function public.nova_versao_escala(
  p_org uuid, p_inicio date, p_nome text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_atual public.rotations;
  v_nova uuid;
  v_me uuid;
begin
  if not public.is_admin(p_org) then
    raise exception 'Apenas o administrador pode fazer isso.' using errcode = '42501';
  end if;
  v_me := public.current_member(p_org);

  if p_inicio <= current_date then
    raise exception 'A nova versao tem que comecar a partir de amanha, para nao mexer no que ja passou.';
  end if;

  select * into v_atual from public.rotations
   where id = public.escala_vigente(p_org, current_date);
  if v_atual.id is null then
    raise exception 'Nao existe escala fixa vigente para copiar.';
  end if;
  if p_inicio <= v_atual.effective_from then
    raise exception 'A nova versao tem que comecar depois do inicio da versao atual (%).',
      to_char(v_atual.effective_from, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.rotations
              where org_id = p_org and is_published and effective_from >= p_inicio) then
    raise exception 'Ja existe uma versao comecando nessa data ou depois dela.';
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

revoke all on function public.nova_versao_escala(uuid,date,text) from public, anon;
grant execute on function public.nova_versao_escala(uuid,date,text) to authenticated;
