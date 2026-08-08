-- =============================================================
-- Escala UTI  |  0010  versoes da escala fixa e auditoria
--
-- A escala fixa passa a ter versoes com data de inicio. Mudar a escala
-- deixa de reescrever o passado: cria-se uma versao nova valendo de uma
-- data em diante, e a anterior fica congelada como registro do que valia.
--
-- Junto, um livro de registro de quem mexeu em que, porque o relatorio
-- do mes e base de pagamento e a pergunta "quem tirou o Fulano do sabado"
-- vai aparecer.
-- =============================================================

-- -------------------------------------------------------------
-- Qual versao vale numa data
-- -------------------------------------------------------------
create or replace function public.escala_vigente(p_org uuid, p_data date default null)
returns uuid
language sql stable security definer set search_path = public
as $$
  select r.id
    from public.rotations r
   where r.org_id = p_org
     and r.is_published
     and coalesce(p_data, current_date) >= r.effective_from
     and (r.effective_to is null or coalesce(p_data, current_date) <= r.effective_to)
     and public.pode_ver_org(p_org)
   order by r.effective_from desc
   limit 1
$$;

revoke all on function public.escala_vigente(uuid,date) from public, anon;
grant execute on function public.escala_vigente(uuid,date) to authenticated;


-- -------------------------------------------------------------
-- Cria uma versao nova a partir de uma data, copiando a atual
-- -------------------------------------------------------------
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

  -- fecha a atual no dia anterior: ela continua sendo a verdade do passado
  update public.rotations
     set effective_to = p_inicio - 1
   where id = v_atual.id;

  insert into public.rotations
    (org_id, name, cycle_days, anchor_date, effective_from, effective_to,
     is_published, notes, created_by)
  values
    (p_org,
     coalesce(nullif(btrim(p_nome), ''), 'Escala a partir de ' || to_char(p_inicio, 'DD/MM/YYYY')),
     v_atual.cycle_days,
     v_atual.anchor_date,        -- mesma ancora: o ciclo nao desalinha
     p_inicio, null, true,
     'Copiada de: ' || v_atual.name, v_me)
  returning id into v_nova;

  -- copia as celulas para a coordenacao editar so o que muda
  insert into public.rotation_slots (rotation_id, unit_id, day_index, shift, member_id)
  select v_nova, unit_id, day_index, shift, member_id
    from public.rotation_slots where rotation_id = v_atual.id;

  return v_nova;
end $$;

revoke all on function public.nova_versao_escala(uuid,date,text) from public, anon;
grant execute on function public.nova_versao_escala(uuid,date,text) to authenticated;


-- =============================================================
-- LIVRO DE REGISTRO
-- =============================================================
create table if not exists public.audit_log (
  id          bigserial primary key,
  org_id      uuid references public.organizations(id) on delete cascade,
  quando      timestamptz not null default now(),
  quem        uuid references public.members(id) on delete set null,
  quem_nome   text,                    -- guardado no momento, sobrevive a exclusao
  acao        text not null,           -- escala_slot, escala_versao, plantao_pontual
  descricao   text not null,           -- frase pronta para a tela
  detalhe     jsonb,                   -- o que mudou, para conferencia
  unit_id     uuid,
  work_date   date,
  shift       public.shift_code
);
create index if not exists audit_org_idx on public.audit_log(org_id, quando desc);
create index if not exists audit_data_idx on public.audit_log(org_id, work_date);

alter table public.audit_log enable row level security;

-- so a coordenacao le o livro
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select to authenticated
  using (public.is_admin(org_id));


/** Quem esta agindo, com o nome congelado. */
create or replace function public.quem_agiu(p_org uuid)
returns record
language plpgsql stable security definer set search_path = public
as $$
declare r record;
begin
  select m.id, m.full_name into r
    from public.members m
   where m.org_id = p_org and m.user_id = auth.uid()
   limit 1;
  if r.id is null then
    select null::uuid as id, 'manutencao pelo sistema'::text as full_name into r;
  end if;
  return r;
end $$;


-- -------------------------------------------------------------
-- Gatilho: mudanca numa celula da escala fixa
-- -------------------------------------------------------------
create or replace function public.audita_slot()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid; v_rot public.rotations; v_ator record;
  v_de text; v_para text; v_uti text; v_dia text;
begin
  select * into v_rot from public.rotations where id = coalesce(new.rotation_id, old.rotation_id);
  v_org := v_rot.org_id;

  if tg_op = 'UPDATE' and new.member_id is not distinct from old.member_id then
    return new;                       -- nada relevante mudou
  end if;

  v_ator := public.quem_agiu(v_org);
  select full_name into v_de   from public.members where id = old.member_id;
  select full_name into v_para from public.members where id = new.member_id;
  select name into v_uti from public.units where id = coalesce(new.unit_id, old.unit_id);
  v_dia := to_char(v_rot.anchor_date + coalesce(new.day_index, old.day_index), 'TMDay');

  insert into public.audit_log
    (org_id, quem, quem_nome, acao, descricao, detalhe, unit_id, shift)
  values (
    v_org, v_ator.id, v_ator.full_name, 'escala_slot',
    format('%s, %s, turno %s: %s no lugar de %s',
           v_uti, btrim(v_dia), coalesce(new.shift, old.shift)::text,
           coalesce(v_para, 'vago'), coalesce(v_de, 'vago')),
    jsonb_build_object('versao', v_rot.name, 'vigencia_desde', v_rot.effective_from,
                       'posicao_ciclo', coalesce(new.day_index, old.day_index),
                       'de', v_de, 'para', v_para),
    coalesce(new.unit_id, old.unit_id), coalesce(new.shift, old.shift));
  return coalesce(new, old);
end $$;

drop trigger if exists slot_audita on public.rotation_slots;
create trigger slot_audita after insert or update on public.rotation_slots
  for each row execute function public.audita_slot();


-- -------------------------------------------------------------
-- Gatilho: versao da escala criada ou com vigencia alterada
-- -------------------------------------------------------------
create or replace function public.audita_versao()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ator record; v_txt text;
begin
  v_ator := public.quem_agiu(new.org_id);
  if tg_op = 'INSERT' then
    v_txt := format('Nova versao da escala fixa "%s", valendo de %s',
                    new.name, to_char(new.effective_from, 'DD/MM/YYYY'));
  elsif old.effective_to is distinct from new.effective_to then
    v_txt := format('Versao "%s" passou a valer ate %s',
                    new.name, coalesce(to_char(new.effective_to, 'DD/MM/YYYY'), 'sem prazo'));
  else
    return new;
  end if;

  insert into public.audit_log (org_id, quem, quem_nome, acao, descricao, detalhe)
  values (new.org_id, v_ator.id, v_ator.full_name, 'escala_versao', v_txt,
          jsonb_build_object('versao', new.name, 'de', new.effective_from, 'ate', new.effective_to));
  return new;
end $$;

drop trigger if exists versao_audita on public.rotations;
create trigger versao_audita after insert or update on public.rotations
  for each row execute function public.audita_versao();


-- -------------------------------------------------------------
-- Gatilho: alteracao pontual de um plantao
-- -------------------------------------------------------------
create or replace function public.audita_override()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_ator record; v_de text; v_para text; v_uti text;
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

  insert into public.audit_log
    (org_id, quem, quem_nome, acao, descricao, detalhe, unit_id, work_date, shift)
  values (
    new.org_id, v_ator.id, v_ator.full_name, 'plantao_pontual',
    format('%s, %s, turno %s: %s no lugar de %s (%s)',
           v_uti, to_char(new.work_date,'DD/MM/YYYY'), new.shift::text,
           coalesce(v_para,'vago'), coalesce(v_de,'vago'), new.reason),
    jsonb_build_object('motivo', new.reason, 'de', v_de, 'para', v_para,
                       'observacao', new.note),
    new.unit_id, new.work_date, new.shift);
  return new;
end $$;

drop trigger if exists override_audita on public.shift_overrides;
create trigger override_audita after insert or update or delete on public.shift_overrides
  for each row execute function public.audita_override();
