-- =====================================================================
-- Painel de atenção, relatório mensal, último acesso e tarefas agendadas
-- (lembrete semanal aos dispatchers e aviso de pedido parado).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6. Último acesso dos usuários
-- ---------------------------------------------------------------------
alter table public.perfis add column ultimo_acesso timestamptz;

create or replace function public.registrar_acesso()
returns void
language sql
security definer
set search_path = ''
as $$
  -- No máximo uma gravação a cada 10 minutos por usuário.
  update public.perfis set ultimo_acesso = now()
  where user_id = auth.uid()
    and (ultimo_acesso is null or ultimo_acesso < now() - interval '10 minutes');
$$;
revoke all on function public.registrar_acesso() from public, anon;
grant execute on function public.registrar_acesso() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Painel de atenção (respeita a RLS: cada um vê os seus galpões)
-- ---------------------------------------------------------------------
create or replace function public.painel_atencao()
returns table (
  galpao             text,
  ativos             bigint,
  inativos           bigint,
  nunca_rodou        bigint,
  parados_30         bigint,
  pedidos_pendentes  bigint,
  pedidos_atrasados  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  m as (
    select m.galpao,
           count(*) filter (where m.status = 'ativo') as ativos,
           count(*) filter (where m.status = 'inativo') as inativos,
           count(*) filter (where m.status = 'ativo' and (m.realizou_rotas = false or m.qtd_rotas = 0)) as nunca_rodou,
           count(*) filter (where m.status = 'ativo' and not (m.realizou_rotas = false or coalesce(m.qtd_rotas, 1) = 0)
                              and m.ultima_rota <= (select d from hoje) - 30) as parados_30
    from public.motoristas m
    group by m.galpao
  ),
  s as (
    select s.galpao,
           count(distinct coalesce(s.grupo::text, s.id::text)) as pendentes,
           count(distinct coalesce(s.grupo::text, s.id::text)) filter (where s.solicitado_em < now() - interval '24 hours') as atrasados
    from public.solicitacoes_inativacao s
    where s.status = 'pendente'
    group by s.galpao
  )
  select coalesce(m.galpao, s.galpao), coalesce(m.ativos, 0), coalesce(m.inativos, 0),
         coalesce(m.nunca_rodou, 0), coalesce(m.parados_30, 0),
         coalesce(s.pendentes, 0), coalesce(s.atrasados, 0)
  from m full join s on coalesce(s.galpao, '') = coalesce(m.galpao, '')
  order by 1 nulls last;
$$;
revoke all on function public.painel_atencao() from public, anon;
grant execute on function public.painel_atencao() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Relatório mensal (só admin)
-- ---------------------------------------------------------------------
create or replace function public.relatorio_mensal(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini timestamptz;
  v_fim timestamptz;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores veem o relatório.' using errcode = '42501';
  end if;
  v_ini := (date_trunc('month', coalesce(p_mes, current_date))::date)::timestamp at time zone 'America/Sao_Paulo';
  v_fim := ((date_trunc('month', coalesce(p_mes, current_date)) + interval '1 month')::date)::timestamp at time zone 'America/Sao_Paulo';

  return jsonb_build_object(
    'inicio', v_ini,
    'fim', v_fim,
    'totais', (
      select jsonb_build_object(
        'inativacoes', count(*) filter (where h.status_novo = 'inativo'),
        'reativacoes', count(*) filter (where h.status_novo = 'ativo'),
        'inativacoes_planilha', count(*) filter (where h.status_novo = 'inativo' and h.origem = 'planilha'),
        'inativacoes_app', count(*) filter (where h.status_novo = 'inativo' and h.origem = 'app')
      )
      from public.motorista_historico h
      where h.alterado_em >= v_ini and h.alterado_em < v_fim
    ),
    'por_motivo', coalesce((
      select jsonb_agg(jsonb_build_object('motivo', x.motivo, 'quantidade', x.n) order by x.n desc)
      from (
        select coalesce(h.motivo, '(sem motivo)') as motivo, count(*) as n
        from public.motorista_historico h
        where h.status_novo = 'inativo' and h.alterado_em >= v_ini and h.alterado_em < v_fim
        group by 1
      ) x
    ), '[]'::jsonb),
    'por_galpao', coalesce((
      select jsonb_agg(jsonb_build_object('galpao', x.galpao, 'inativacoes', x.i, 'reativacoes', x.r) order by x.galpao nulls last)
      from (
        select h.galpao,
               count(*) filter (where h.status_novo = 'inativo') as i,
               count(*) filter (where h.status_novo = 'ativo') as r
        from public.motorista_historico h
        where h.alterado_em >= v_ini and h.alterado_em < v_fim
        group by h.galpao
      ) x
    ), '[]'::jsonb),
    'por_dispatcher', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', x.nome, 'pedidos', x.pedidos, 'aprovados', x.aprovados,
               'recusados', x.recusados, 'cancelados', x.cancelados, 'pendentes', x.pendentes
             ) order by x.pedidos desc)
      from (
        select coalesce(s.solicitado_por_nome, '(removido)') as nome,
               count(distinct coalesce(s.grupo::text, s.id::text)) as pedidos,
               count(distinct coalesce(s.grupo::text, s.id::text)) filter (where s.status = 'aprovada') as aprovados,
               count(distinct coalesce(s.grupo::text, s.id::text)) filter (where s.status = 'recusada') as recusados,
               count(distinct coalesce(s.grupo::text, s.id::text)) filter (where s.status = 'cancelada') as cancelados,
               count(distinct coalesce(s.grupo::text, s.id::text)) filter (where s.status = 'pendente') as pendentes
        from public.solicitacoes_inativacao s
        where s.solicitado_em >= v_ini and s.solicitado_em < v_fim
        group by 1
      ) x
    ), '[]'::jsonb),
    'tempo_medio_aprovacao_horas', (
      select round((extract(epoch from avg(s.decidido_em - s.solicitado_em)) / 3600)::numeric, 1)
      from public.solicitacoes_inativacao s
      where s.status in ('aprovada', 'recusada') and s.solicitado_em >= v_ini and s.solicitado_em < v_fim
    )
  );
end;
$$;
revoke all on function public.relatorio_mensal(date) from public, anon;
grant execute on function public.relatorio_mensal(date) to authenticated;

-- ---------------------------------------------------------------------
-- 3 e 4. Tarefas agendadas (pg_cron → pg_net → Edge Function de avisos)
-- ---------------------------------------------------------------------
alter table public.solicitacoes_inativacao add column lembrete_em timestamptz;
grant update (lembrete_em) on public.solicitacoes_inativacao to service_role;

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.disparar_tarefa(p_tarefa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_token text;
begin
  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('tarefa', p_tarefa),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token)
  );
end;
$$;
revoke all on function public.disparar_tarefa(text) from public, anon, authenticated;

-- Segunda-feira 08:00 (Brasília = 11:00 UTC): lembrete semanal aos dispatchers.
select cron.schedule('lembrete-semanal-dispatchers', '0 11 * * 1', $$select public.disparar_tarefa('lembrete_semanal')$$);
-- De hora em hora: pedidos pendentes há mais de 24 h avisam os admins.
select cron.schedule('aviso-pedidos-parados', '15 * * * *', $$select public.disparar_tarefa('pedidos_parados')$$);
