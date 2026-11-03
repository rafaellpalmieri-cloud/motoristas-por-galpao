-- =====================================================================
-- Treinamentos (decisão de 03/11/2026)
--  1. O admin passa a ser avisado também de quem compareceu, não só de
--     quem faltou: push e alerta comp:<id> no sino, como falta:<id>.
--  2. Lembrete aos dispatchers do galpão 16 horas antes do treinamento.
--     Só para treinamento marcado com mais de 16 h de antecedência: quem
--     foi marcado em cima da hora já recebeu o aviso de "novo".
--     Se o horário mudar, o lembrete vale de novo para o novo horário.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Presença: "compareceu" também avisa os admins.
-- ---------------------------------------------------------------------
create or replace function public.disparar_notificacao_treinamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_token  text;
  v_evento text;
begin
  if tg_op = 'INSERT' and new.status = 'agendado' and new.inicio > now() then
    v_evento := 'novo';
  elsif tg_op = 'UPDATE' and new.presenca in ('faltou', 'compareceu') and old.presenca is distinct from new.presenca then
    v_evento := new.presenca;
  else
    return new;
  end if;

  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('treinamento_id', new.id, 'evento', v_evento),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token)
  );
  return new;
exception when others then
  raise warning 'aviso de treinamento não enviado (%): %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.disparar_notificacao_treinamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Sino: comp:<id> (admin, "Compareceu" marcado nos últimos 30 dias).
-- ---------------------------------------------------------------------
create or replace function public.marcar_alertas_lidos(p_chaves text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if coalesce(cardinality(p_chaves), 0) = 0 then
    return 0;
  end if;
  if cardinality(p_chaves) > 2000 then
    raise exception 'Muitos alertas de uma vez (máximo 2000).' using errcode = '22023';
  end if;
  insert into public.alertas_lidos (user_id, chave)
  select auth.uid(), c from unnest(p_chaves) c
  where c ~ '^(mov|rota|pedido|trein|falta|comp):[0-9a-f:-]{1,110}$'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.alertas_nao_lidos()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  with lidos as (select l.chave from public.alertas_lidos l where l.user_id = (select auth.uid()))
  select (
    (select count(*) from public.motorista_historico h
      where h.status_novo = 'inativo'
        and h.alterado_em > now() - interval '30 days'
        and (h.alterado_por is null or h.alterado_por <> (select auth.uid()))
        and ('mov:' || h.id) not in (select chave from lidos))
    +
    (select count(*) from public.motoristas m
      where m.status = 'ativo'
        and m.ultima_rota is not null
        and not (m.realizou_rotas = false or coalesce(m.qtd_rotas, 1) = 0)
        and m.ultima_rota <= (now() at time zone 'America/Sao_Paulo')::date - public.dias_corte_sem_rota()
        and ('rota:' || m.id || ':' || m.ultima_rota) not in (select chave from lidos))
    +
    (select count(distinct coalesce(s.grupo::text, s.id::text)) from public.solicitacoes_inativacao s
      where s.solicitado_por = (select auth.uid())
        and s.status in ('aprovada', 'recusada')
        and s.decidido_em > now() - interval '30 days'
        and ('pedido:' || coalesce(s.grupo::text, s.id::text)) not in (select chave from lidos))
    +
    (select count(*) from public.treinamentos t
      where not public.eh_admin()
        and t.status = 'agendado'
        and t.inicio > now()
        and ('trein:' || t.id) not in (select chave from lidos))
    +
    (select count(*) from public.treinamentos t
      where public.eh_admin()
        and t.presenca in ('faltou', 'compareceu')
        and t.presenca_em > now() - interval '30 days'
        and ((case t.presenca when 'faltou' then 'falta:' else 'comp:' end) || t.id) not in (select chave from lidos))
  )::integer;
$$;

-- ---------------------------------------------------------------------
-- 2. Lembrete 16 h antes. lembrete_inicio guarda o horário já lembrado:
-- diferente de inicio = ainda falta lembrar (cobre a remarcação).
-- A reserva já grava, para duas execuções nunca lembrarem o mesmo treinamento.
-- ---------------------------------------------------------------------
alter table public.treinamentos add column lembrete_inicio timestamptz;

create or replace function public.reservar_lembretes_treinamento()
returns table (id bigint, galpao text, nome text, inicio timestamptz)
language sql
security definer
set search_path = ''
as $$
  update public.treinamentos t set lembrete_inicio = t.inicio
  where t.status = 'agendado'
    and t.presenca is null
    and t.inicio > now()
    and t.inicio <= now() + interval '16 hours'
    and t.criado_em <= t.inicio - interval '16 hours'
    and t.lembrete_inicio is distinct from t.inicio
  returning t.id, t.galpao, t.nome, t.inicio;
$$;
revoke all on function public.reservar_lembretes_treinamento() from public, anon, authenticated;
grant execute on function public.reservar_lembretes_treinamento() to service_role;

-- A cada 15 minutos.
select cron.schedule('lembrete-treinamentos', '*/15 * * * *', $$select public.disparar_tarefa('lembrete_treinamentos')$$);
