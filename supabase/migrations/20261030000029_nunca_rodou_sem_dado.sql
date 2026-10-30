-- =====================================================================
-- "Nunca fez rota" passa a incluir quem não aparece na BASE - POWER BI
-- (realizou_rotas vazio), decisão de 30/10/2026. Antes só contava quem
-- aparecia lá com zero rotas. Mesma regra de nuncaRodou() no app.
-- =====================================================================

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
           count(*) filter (where m.status = 'ativo' and (m.realizou_rotas is not true or m.qtd_rotas = 0)) as nunca_rodou,
           count(*) filter (where m.status = 'ativo' and not (m.realizou_rotas is not true or coalesce(m.qtd_rotas, 1) = 0)
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
