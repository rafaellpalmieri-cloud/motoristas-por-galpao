-- =====================================================================
-- Notificações push do site (celular e computador), no lugar do WhatsApp.
--  - Cada aparelho que ativa as notificações vira uma linha em push_inscricoes.
--  - Pedidos de inativação (novo / aprovado / recusado) também disparam a
--    Edge Function notificar-movimentacao, pelo mesmo caminho (pg_net + Vault).
-- =====================================================================

create table public.push_inscricoes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  criado_em  timestamptz not null default now()
);
create index push_inscricoes_user_idx on public.push_inscricoes (user_id);

alter table public.push_inscricoes enable row level security;
revoke all on public.push_inscricoes from anon, authenticated;
grant select on public.push_inscricoes to authenticated;
grant select, delete on public.push_inscricoes to service_role;

create policy push_inscricoes_select on public.push_inscricoes
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Registrar/remover passam por funções: o mesmo navegador pode ter sido
-- usado por outra pessoa antes (o aparelho passa a ser de quem entrou agora).
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
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Inscrição inválida.' using errcode = '22023';
  end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
end;
$$;

create or replace function public.remover_push(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_inscricoes where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.registrar_push(text, text, text, text) from public, anon;
revoke all on function public.remover_push(text) from public, anon;
grant execute on function public.registrar_push(text, text, text, text) to authenticated;
grant execute on function public.remover_push(text) to authenticated;

-- A função de avisos lê pedidos e perfis como service_role.
grant select on public.solicitacoes_inativacao to service_role;

-- Controle anti-duplicidade dos avisos de pedido (um por situação).
create table public.solicitacoes_notificadas (
  solicitacao_id bigint not null references public.solicitacoes_inativacao (id) on delete cascade,
  status         text not null,
  enviado_em     timestamptz not null default now(),
  resultado      jsonb,
  primary key (solicitacao_id, status)
);
alter table public.solicitacoes_notificadas enable row level security;
revoke all on public.solicitacoes_notificadas from anon, authenticated;
grant select, insert, update on public.solicitacoes_notificadas to service_role;

-- ---------------------------------------------------------------------
-- Gatilho: novo pedido ou pedido decidido → chama a Edge Function.
-- ---------------------------------------------------------------------
create or replace function public.disparar_notificacao_solicitacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_token text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('pendente', 'aprovada', 'recusada') then
    return new;
  end if;

  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('solicitacao_id', new.id, 'status', new.status),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token)
  );
  return new;
exception when others then
  raise warning 'aviso de pedido % não enviado: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.disparar_notificacao_solicitacao() from public, anon, authenticated;

create trigger solicitacoes_notificar
  after insert or update of status on public.solicitacoes_inativacao
  for each row execute function public.disparar_notificacao_solicitacao();
