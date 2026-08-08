-- =============================================================
-- Escala UTI  |  0011  notificacoes push
--
-- Todo aviso do sistema ja passa por notify_member, que grava em
-- notifications. Aqui esse mesmo ponto passa a disparar o push, sem
-- precisar mexer em nenhuma das funcoes de troca, cessao ou interesse.
--
-- Caminho: insert em notifications -> gatilho -> pg_net chama a edge
-- function -> ela assina com VAPID e entrega ao aparelho.
-- Se a chamada falhar, uma varredura agendada tenta de novo.
-- =============================================================

create extension if not exists pg_net with schema extensions;

-- -------------------------------------------------------------
-- Aparelhos inscritos
-- -------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  aparelho   text,                     -- so para a pessoa reconhecer o proprio aparelho
  criado_em  timestamptz not null default now(),
  ultimo_ok  timestamptz,
  falhas     smallint not null default 0
);
create index if not exists push_member_idx on public.push_subscriptions(member_id);

alter table public.push_subscriptions enable row level security;

-- cada um cuida so dos proprios aparelhos
drop policy if exists push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions
  for select to authenticated
  using (member_id in (select public.my_member_ids()));

drop policy if exists push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions
  for insert to authenticated
  with check (member_id in (select public.my_member_ids()));

drop policy if exists push_update on public.push_subscriptions;
create policy push_update on public.push_subscriptions
  for update to authenticated
  using (member_id in (select public.my_member_ids()))
  with check (member_id in (select public.my_member_ids()));

drop policy if exists push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions
  for delete to authenticated
  using (member_id in (select public.my_member_ids()));


-- -------------------------------------------------------------
-- Registrar o aparelho, ja resolvendo quem e na organizacao
-- -------------------------------------------------------------
create or replace function public.registrar_push(
  p_org uuid, p_endpoint text, p_p256dh text, p_auth text, p_aparelho text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_me uuid; v_id uuid;
begin
  v_me := public.current_member(p_org);
  if v_me is null then
    raise exception 'Voce nao faz parte desta escala.' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (org_id, member_id, endpoint, p256dh, auth, aparelho)
  values (p_org, v_me, p_endpoint, p_p256dh, p_auth, p_aparelho)
  on conflict (endpoint) do update
     set member_id = v_me, org_id = p_org,
         p256dh = excluded.p256dh, auth = excluded.auth,
         aparelho = coalesce(excluded.aparelho, public.push_subscriptions.aparelho),
         falhas = 0
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remover_push(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint
     and member_id in (select public.my_member_ids())
$$;


-- -------------------------------------------------------------
-- Segredo compartilhado com a edge function.
-- Fica em schema proprio, sem acesso pela API.
-- -------------------------------------------------------------
create schema if not exists interno;
revoke all on schema interno from anon, authenticated;

create table if not exists interno.config (
  chave text primary key,
  valor text not null
);
revoke all on table interno.config from anon, authenticated;


-- -------------------------------------------------------------
-- Marca de envio e disparo
-- -------------------------------------------------------------
alter table public.notifications
  add column if not exists push_em timestamptz,
  add column if not exists push_erro text;

create index if not exists notif_pendente_push_idx
  on public.notifications(created_at)
  where push_em is null;

create or replace function public.dispara_push()
returns trigger
language plpgsql security definer set search_path = public, interno, extensions
as $$
declare v_url text; v_seg text;
begin
  select valor into v_url from interno.config where chave = 'push_url';
  select valor into v_seg from interno.config where chave = 'push_secret';
  if v_url is null or v_seg is null then
    return new;                        -- push nao configurado: segue sem barulho
  end if;

  -- fire and forget: se cair, a varredura agendada refaz
  perform extensions.net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-escala-secret', v_seg),
    timeout_milliseconds := 4000);
  return new;
exception when others then
  return new;                          -- aviso no app nunca falha por causa do push
end $$;

drop trigger if exists notif_push on public.notifications;
create trigger notif_push after insert on public.notifications
  for each row execute function public.dispara_push();


-- -------------------------------------------------------------
-- Varredura: avisos recentes que nao viraram push
-- -------------------------------------------------------------
create or replace function public.push_pendentes()
returns void
language plpgsql security definer set search_path = public, interno, extensions
as $$
declare v_url text; v_seg text; r record;
begin
  select valor into v_url from interno.config where chave = 'push_url';
  select valor into v_seg from interno.config where chave = 'push_secret';
  if v_url is null or v_seg is null then return; end if;

  for r in
    select id from public.notifications
     where push_em is null
       and created_at > now() - interval '2 days'
     order by created_at
     limit 100
  loop
    perform extensions.net.http_post(
      url := v_url,
      body := jsonb_build_object('notification_id', r.id),
      headers := jsonb_build_object('Content-Type','application/json','x-escala-secret', v_seg),
      timeout_milliseconds := 4000);
  end loop;
end $$;

revoke all on function public.push_pendentes() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'escala_push_retry';
exception when others then null; end $$;
select cron.schedule('escala_push_retry', '*/5 * * * *', $$select public.push_pendentes()$$);

do $$
declare f text;
begin
  foreach f in array array[
    'public.registrar_push(uuid,text,text,text,text)',
    'public.remover_push(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
