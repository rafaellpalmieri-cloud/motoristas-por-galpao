-- =====================================================================
-- Avisos de movimentação (inativar/reativar):
--  - WhatsApp (Z-API) para os dispatchers do galpão;
--  - registro na aba "MOVIMENTAÇÕES APP" da planilha (só mudanças feitas no app).
--
-- Cada inserção no histórico dispara (via pg_net) a Edge Function
-- notificar-movimentacao, que faz os envios. URL e token ficam no Vault
-- (nomes: notificar_url, notificar_token) — nunca neste arquivo.
-- Sem esses dois segredos, o gatilho não faz nada.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- Controle para nunca avisar duas vezes a mesma movimentação.
create table public.movimentacoes_notificadas (
  historico_id  bigint primary key references public.motorista_historico (id) on delete cascade,
  recebido_em   timestamptz not null default now(),
  whatsapp      jsonb,
  planilha      jsonb
);
alter table public.movimentacoes_notificadas enable row level security;
revoke all on public.movimentacoes_notificadas from anon, authenticated;
grant select, insert, update on public.movimentacoes_notificadas to service_role;

-- A função de avisos lê perfis, papéis e galpões como service_role.
grant select on public.user_roles, public.dispatcher_galpoes to service_role;

create or replace function public.disparar_notificacao_movimentacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_token text;
begin
  -- Inativações antigas importadas da planilha (data no passado) não geram aviso.
  if new.alterado_em < now() - interval '2 hours' then
    return new;
  end if;

  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('historico_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token)
  );
  return new;
exception when others then
  -- Aviso nunca pode impedir a mudança de status.
  raise warning 'notificação não enviada para histórico %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.disparar_notificacao_movimentacao() from public, anon, authenticated;

create trigger motorista_historico_notificar
  after insert on public.motorista_historico
  for each row execute function public.disparar_notificacao_movimentacao();
