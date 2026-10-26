-- =====================================================================
-- Equipe: corrige a criação de dispatcher, troca de função e exclusão.
--
-- 1. A Edge Function admin-criar-usuario grava como service_role. O CHECK de
--    dispatcher_galpoes chama galpoes_validos(), que só tinha EXECUTE para
--    authenticated: criar dispatcher dava "permission denied" (Erro interno).
-- 2. mudar_papel_usuario: admin troca admin <-> dispatcher (e os galpões) de
--    outro usuário, numa transação só.
-- 3. Excluir é feito pela Edge Function admin-gerir-usuario (apaga no Auth);
--    perfil, função, galpões e inscrições de push caem pelo ON DELETE CASCADE,
--    e o histórico fica com o nome (alterado_por vira null).
-- =====================================================================

grant execute on function public.galpoes_validos() to service_role;

create or replace function public.mudar_papel_usuario(p_user uuid, p_papel public.app_role, p_galpoes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_galpoes text[];
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'Você não pode mudar a própria função.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.perfis where user_id = p_user) then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;

  if p_papel = 'dispatcher' then
    select coalesce(array_agg(distinct upper(regexp_replace(g, '\s', '', 'g'))), '{}')
      into v_galpoes
      from unnest(coalesce(p_galpoes, '{}')) g;
    if cardinality(v_galpoes) = 0 then
      raise exception 'Selecione ao menos um galpão.' using errcode = '23514';
    end if;
    if not (v_galpoes <@ public.galpoes_validos()) then
      raise exception 'Galpão inválido.' using errcode = '23514';
    end if;
  end if;

  delete from public.user_roles where user_id = p_user;
  insert into public.user_roles (user_id, role) values (p_user, p_papel);
  delete from public.dispatcher_galpoes where user_id = p_user;
  if p_papel = 'dispatcher' then
    insert into public.dispatcher_galpoes (user_id, galpao) select p_user, unnest(v_galpoes);
  end if;
end;
$$;

revoke all on function public.mudar_papel_usuario(uuid, public.app_role, text[]) from public, anon;
grant execute on function public.mudar_papel_usuario(uuid, public.app_role, text[]) to authenticated;
