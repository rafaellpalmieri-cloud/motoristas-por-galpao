-- =====================================================================
-- Índices
-- =====================================================================

create index motoristas_galpao_status_idx on public.motoristas (galpao, status);

-- motoristas(codigo): já coberto pelo índice único da constraint
-- "motoristas_codigo_key" (criado pelo UNIQUE). Um segundo índice seria duplicado.

create index motorista_historico_motorista_data_idx
  on public.motorista_historico (motorista_id, alterado_em desc);

-- Alertas (sino): inativações recentes.
create index motorista_historico_inativacoes_idx
  on public.motorista_historico (alterado_em desc)
  where status_novo = 'inativo';

-- FKs usadas em joins/políticas.
create index dispatcher_galpoes_galpao_idx on public.dispatcher_galpoes (galpao);
create index motoristas_atualizado_por_idx on public.motoristas (atualizado_por);
