-- =====================================================================
-- Ativação, reativação e inativação: todo mundo fica sabendo.
-- 1. Cadastro novo que chega ativo do CRM passa a ter histórico
--    (status_anterior vazio = ativação). Isso dispara o mesmo aviso das
--    outras mudanças de status (push para os dispatchers do galpão e,
--    pela função notificar-movimentacao, também para os admins).
-- 2. O sino conta ativações e reativações, não só inativações.
-- 3. O relatório mensal não conta cadastro novo como reativação.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Histórico do cadastro novo vindo do CRM. Só com crm_id: importações
--    de CSV feitas pelo admin não viram aviso.
-- ---------------------------------------------------------------------
create or replace function public.historico_cadastro_novo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ativo' and new.crm_id is not null then
    insert into public.motorista_historico
      (motorista_id, galpao, status_anterior, status_novo, motivo, observacao,
       alterado_por, alterado_por_nome, alterado_em, origem)
    values
      (new.id, new.galpao, null, 'ativo', null, 'Cadastro novo no CRM',
       null, 'CRM', now(), 'planilha');
  end if;
  return new;
end;
$$;
revoke all on function public.historico_cadastro_novo() from public, anon, authenticated;

create trigger motoristas_historico_cadastro_novo
  after insert on public.motoristas
  for each row execute function public.historico_cadastro_novo();

-- ---------------------------------------------------------------------
-- 2. Sino: conta qualquer mudança de status (chave mov:<id>).
--    As ativações/reativações dos últimos 30 dias já aconteceram antes
--    desta mudança: entram como lidas, para o sino não encher de uma vez.
-- ---------------------------------------------------------------------
insert into public.alertas_lidos (user_id, chave)
select p.user_id, 'mov:' || h.id
from public.perfis p
join public.motorista_historico h on h.status_novo = 'ativo'
where h.alterado_em > now() - interval '30 days'
on conflict do nothing;

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
      where h.alterado_em > now() - interval '30 days'
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
-- 3. Relatório mensal: reativação é só ativo vindo de inativo; cadastro
--    novo ativo conta à parte (ativacoes).
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
        'reativacoes', count(*) filter (where h.status_novo = 'ativo' and h.status_anterior is not null),
        'ativacoes', count(*) filter (where h.status_novo = 'ativo' and h.status_anterior is null),
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
               count(*) filter (where h.status_novo = 'ativo' and h.status_anterior is not null) as r
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
