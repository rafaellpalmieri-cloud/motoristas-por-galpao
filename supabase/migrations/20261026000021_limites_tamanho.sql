-- =====================================================================
-- Endurecimento de segurança
--  1. Limites de tamanho em campos gravados pelo app (evita textos gigantes).
--  2. SSRF: o endereço de notificação push só pode ser de um serviço oficial
--     (Google/Chrome, Mozilla/Firefox, Apple/Safari, Microsoft/Edge). Antes,
--     qualquer URL https era aceita e o servidor faria POST para ela.
-- =====================================================================

create or replace function public.endpoint_push_valido(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_endpoint, '') ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
     and length(p_endpoint) <= 1000;
$$;
grant execute on function public.endpoint_push_valido(text) to authenticated, service_role;

-- Remove o que não for de serviço oficial (hoje não há nenhum assim).
delete from public.push_inscricoes where not public.endpoint_push_valido(endpoint);

alter table public.alertas_lidos
  add constraint alertas_lidos_chave_tamanho check (length(chave) <= 200);
alter table public.push_inscricoes
  add constraint push_endpoint_oficial check (public.endpoint_push_valido(endpoint)),
  add constraint push_p256dh_tamanho check (length(p256dh) <= 200),
  add constraint push_auth_tamanho check (length(auth) <= 100),
  add constraint push_user_agent_tamanho check (user_agent is null or length(user_agent) <= 300);

create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.usuario_ativo(auth.uid()) then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not public.endpoint_push_valido(p_endpoint)
     or coalesce(p_p256dh, '') = '' or length(p_p256dh) > 200
     or coalesce(p_auth, '') = '' or length(p_auth) > 100 then
    raise exception 'Inscrição inválida.' using errcode = '22023';
  end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end;
$$;
