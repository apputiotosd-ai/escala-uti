-- =============================================================
-- Escala UTI  |  0007  perfil: permitir apagar um campo
--
-- A versao anterior usava coalesce, entao mandar vazio mantinha o valor
-- antigo e nao havia como limpar o telefone ou o nome curto.
-- Agora:
--   null         = nao mexe neste campo
--   texto vazio  = apaga o campo
-- =============================================================

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
  if v_me is null then
    raise exception 'Voce nao faz parte desta escala.' using errcode = '42501';
  end if;

  update public.members
     set display_name = case
           when p_display_name is null then display_name
           when btrim(p_display_name) = '' then null
           else btrim(p_display_name) end,
         phone = case
           when p_phone is null then phone
           when btrim(p_phone) = '' then null
           else btrim(p_phone) end,
         avatar_path = case
           when p_avatar_path is null then avatar_path
           when btrim(p_avatar_path) = '' then null
           else p_avatar_path end
   where id = v_me;
end $$;

revoke all on function public.update_my_profile(uuid,text,text,text) from public, anon;
grant execute on function public.update_my_profile(uuid,text,text,text) to authenticated;
