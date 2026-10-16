-- =====================================================================
-- Funções de permissão (security definer, search_path vazio)
-- =====================================================================

create or replace function public.has_role(p_user uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user and r.role = p_role
  );
$$;

create or replace function public.usuario_ativo(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.ativo from public.perfis p where p.user_id = p_user), false);
$$;

-- Admin com perfil ativo (usuário logado).
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and public.usuario_ativo(auth.uid())
     and public.has_role(auth.uid(), 'admin');
$$;

-- Admin ativo: sempre true. Dispatcher ativo: só galpões vinculados.
-- Galpão nulo: só admin.
create or replace function public.pode_gerir_galpao(p_galpao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when not public.usuario_ativo(auth.uid()) then false
    when public.has_role(auth.uid(), 'admin') then true
    when p_galpao is null then false
    else public.has_role(auth.uid(), 'dispatcher')
         and exists (
           select 1 from public.dispatcher_galpoes dg
           where dg.user_id = auth.uid() and dg.galpao = p_galpao
         )
  end;
$$;
