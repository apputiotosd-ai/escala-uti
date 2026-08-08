-- =============================================================
-- Escala UTI  |  0009  conserta a checagem de vinculo
--
-- A versao anterior usava current_user para saber se a chamada vinha da
-- API ou da manutencao. Dentro de uma funcao security definer,
-- current_user e o DONO da funcao (postgres), nunca quem chamou, entao a
-- checagem passava sempre e o vazamento continuava.
--
-- O que distingue de verdade: chamada pela API traz o JWT em
-- request.jwt.claims; conexao direta ao banco, para manutencao, nao traz.
-- =============================================================

create or replace function public.pode_ver_org(p_org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- manutencao pelo banco, sem JWT nenhum
    nullif(current_setting('request.jwt.claims', true), '') is null
    -- chave de servico, usada pelas edge functions
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         '') = 'service_role'
    -- pela API, so quem e membro
    or public.is_member(p_org)
$$;

revoke all on function public.pode_ver_org(uuid) from public, anon;
grant execute on function public.pode_ver_org(uuid) to authenticated;
