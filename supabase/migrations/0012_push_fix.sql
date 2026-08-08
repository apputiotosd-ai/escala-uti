-- =============================================================
-- Escala UTI  |  0012  conserta o disparo do push
--
-- O gatilho chamava extensions.net.http_post, mas o pg_net instala suas
-- funcoes no schema 'net'. A chamada falhava e o "exception when others"
-- engolia o erro sem deixar rastro: o aviso aparecia no app e o push
-- simplesmente nunca saia.
--
-- Agora chama o lugar certo e, quando falha, escreve o motivo no proprio
-- aviso. Erro invisivel e pior que erro.
-- =============================================================

create or replace function public.dispara_push()
returns trigger
language plpgsql security definer set search_path = public, interno, net
as $$
declare v_url text; v_seg text;
begin
  select valor into v_url from interno.config where chave = 'push_url';
  select valor into v_seg from interno.config where chave = 'push_secret';
  if v_url is null or v_seg is null then
    return new;                        -- push nao configurado: segue sem barulho
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-escala-secret', v_seg),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  -- o aviso no app nunca falha por causa do push, mas o motivo fica gravado
  update public.notifications
     set push_erro = left('disparo: ' || sqlerrm, 300)
   where id = new.id;
  return new;
end $$;


create or replace function public.push_pendentes()
returns void
language plpgsql security definer set search_path = public, interno, net
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
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('notification_id', r.id),
      headers := jsonb_build_object('Content-Type','application/json','x-escala-secret', v_seg),
      timeout_milliseconds := 5000);
  end loop;
end $$;

revoke all on function public.push_pendentes() from public, anon, authenticated;
