-- =====================================================================
-- 1. Alertas lidos um a um: abrir a aba ou tocar no alerta não marca como
--    lido; só o botão "Marcar como lido" (ou "Marcar todos"). Chaves:
--      mov:<historico_id>                 inativação (app ou planilha)
--      rota:<motorista_id>:<ultima_rota>  ativo sem rota há 20+ dias (cortar)
--      pedido:<grupo ou id>               pedido do próprio usuário aprovado/recusado
-- 2. Motivo obrigatório também na reativação (pedido e reativação direta).
-- =====================================================================

create table public.alertas_lidos (
  user_id uuid not null references auth.users (id) on delete cascade,
  chave   text not null check (length(chave) <= 120),
  lido_em timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.alertas_lidos enable row level security;
revoke all on public.alertas_lidos from anon, authenticated;
grant select on public.alertas_lidos to authenticated;

create policy alertas_lidos_select on public.alertas_lidos
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Quem já tinha visto os alertas de inativação não recebe tudo de novo como não lido.
insert into public.alertas_lidos (user_id, chave)
select p.user_id, 'mov:' || h.id
from public.perfis p
join public.motorista_historico h on h.status_novo = 'inativo' and h.alterado_em <= p.alertas_vistos_em
where h.alterado_em > now() - interval '30 days'
on conflict do nothing;

-- Pedidos decididos antes desta mudança já foram avisados por push.
insert into public.alertas_lidos (user_id, chave)
select distinct s.solicitado_por, 'pedido:' || coalesce(s.grupo::text, s.id::text)
from public.solicitacoes_inativacao s
where s.solicitado_por is not null and s.status in ('aprovada', 'recusada')
on conflict do nothing;

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
  where c ~ '^(mov|rota|pedido):[0-9a-f:-]{1,110}$'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.marcar_alertas_lidos(text[]) from public, anon;
grant execute on function public.marcar_alertas_lidos(text[]) to authenticated;

-- Dias sem rota a partir dos quais o motorista aparece nos alertas para cortar.
create or replace function public.dias_corte_sem_rota()
returns integer
language sql
immutable
set search_path = ''
as $$ select 20 $$;
grant execute on function public.dias_corte_sem_rota() to authenticated;

-- Contagem do sino. Respeita a RLS: cada um conta só os seus galpões.
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
  )::integer;
$$;
revoke all on function public.alertas_nao_lidos() from public, anon;
grant execute on function public.alertas_nao_lidos() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Motivo da reativação
-- ---------------------------------------------------------------------
create or replace function public.validar_motivo_reativacao(p_motivo text, p_observacao text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_motivo is null then
    raise exception 'Informe o motivo da reativação.' using errcode = '22023';
  end if;
  if p_motivo not in ('Voltou a rodar', 'Documentação regularizada', 'Outro') then
    raise exception 'Motivo inválido.' using errcode = '22023';
  end if;
  if p_motivo = 'Outro' and p_observacao is null then
    raise exception 'Descreva a observação quando o motivo for Outro.' using errcode = '22023';
  end if;
  if p_observacao is not null and length(p_observacao) > 500 then
    raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.validar_motivo_reativacao(text, text) from public, anon, authenticated;

-- A versão anterior não tinha motivo.
drop function public.solicitar_reativacao_lote(uuid[], text);
drop function public.solicitar_reativacao(uuid, text);

create function public.solicitar_reativacao(p_motorista_id uuid, p_motivo text, p_observacao text default null)
returns public.solicitacoes_inativacao
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_m      public.motoristas;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_obs    text := nullif(btrim(p_observacao), '');
  v_nome   text;
  v_sol    public.solicitacoes_inativacao;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_m from public.motoristas m where m.id = p_motorista_id for update;
  if not found or not public.pode_gerir_galpao(v_m.galpao) then
    raise exception 'Motorista não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_m.status <> 'inativo' then
    raise exception 'O motorista já está ativo.' using errcode = '22023';
  end if;
  if exists (select 1 from public.solicitacoes_inativacao s where s.motorista_id = v_m.id and s.status = 'pendente') then
    raise exception 'Já existe uma solicitação pendente para este motorista.' using errcode = '22023';
  end if;
  perform public.validar_motivo_reativacao(v_motivo, v_obs);

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  insert into public.solicitacoes_inativacao
    (motorista_id, galpao, tipo, motivo, observacao, solicitado_por, solicitado_por_nome)
  values (v_m.id, v_m.galpao, 'reativacao', v_motivo, v_obs, v_uid, v_nome)
  returning * into v_sol;

  return v_sol;
end;
$$;

create function public.solicitar_reativacao_lote(p_motorista_ids uuid[], p_motivo text, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_id    uuid;
  v_sol   public.solicitacoes_inativacao;
begin
  if coalesce(cardinality(p_motorista_ids), 0) = 0 then
    raise exception 'Escolha ao menos uma placa.' using errcode = '22023';
  end if;
  if cardinality(p_motorista_ids) > 20 then
    raise exception 'Máximo de 20 placas por pedido.' using errcode = '22023';
  end if;
  foreach v_id in array p_motorista_ids loop
    v_sol := public.solicitar_reativacao(v_id, p_motivo, p_observacao);
    update public.solicitacoes_inativacao s set grupo = v_grupo where s.id = v_sol.id;
  end loop;
  return v_grupo;
end;
$$;

revoke all on function public.solicitar_reativacao(uuid, text, text) from public, anon;
revoke all on function public.solicitar_reativacao_lote(uuid[], text, text) from public, anon;
grant execute on function public.solicitar_reativacao(uuid, text, text) to authenticated;
grant execute on function public.solicitar_reativacao_lote(uuid[], text, text) to authenticated;

-- Reativação direta (admin) também com motivo, gravado no histórico.
create or replace function public.alterar_status_motorista(
  p_motorista_id uuid,
  p_novo_status  text,
  p_motivo       text default null,
  p_observacao   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_atual  public.motoristas;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_obs    text := nullif(btrim(p_observacao), '');
  v_nome   text;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_novo_status is null or p_novo_status not in ('ativo', 'inativo') then
    raise exception 'Status inválido. Use ativo ou inativo.' using errcode = '22023';
  end if;

  select * into v_atual from public.motoristas m where m.id = p_motorista_id for update;

  if not found or not public.pode_gerir_galpao(v_atual.galpao) then
    raise exception 'Motorista não encontrado ou sem permissão.' using errcode = '42501';
  end if;

  if not public.eh_admin() then
    if p_novo_status = 'inativo' then
      raise exception 'Dispatcher não inativa direto: use a solicitação de inativação.' using errcode = '42501';
    end if;
    raise exception 'Dispatcher não reativa direto: use a solicitação de reativação.' using errcode = '42501';
  end if;

  if v_atual.status = p_novo_status then
    raise exception 'O motorista já está %.', p_novo_status using errcode = '22023';
  end if;

  if p_novo_status = 'inativo' then
    perform public.validar_motivo_inativacao(v_motivo, v_obs);
  else
    perform public.validar_motivo_reativacao(v_motivo, v_obs);
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  update public.motoristas m set
    status            = p_novo_status,
    inativo_desde     = case when p_novo_status = 'inativo'
                             then (now() at time zone 'America/Sao_Paulo')::date end,
    motivo_inativacao = case when p_novo_status = 'inativo' then v_motivo end,
    atualizado_em     = now(),
    atualizado_por    = v_uid
  where m.id = p_motorista_id;

  insert into public.motorista_historico
    (motorista_id, galpao, status_anterior, status_novo, motivo, observacao, alterado_por, alterado_por_nome)
  values
    (p_motorista_id, v_atual.galpao, v_atual.status, p_novo_status, v_motivo, v_obs, v_uid, v_nome);

  if p_novo_status = 'inativo' then
    perform public.fechar_solicitacoes_pendentes(p_motorista_id, v_uid, v_nome, 'Inativado diretamente por admin');
  else
    update public.solicitacoes_inativacao s set
      status = case when s.tipo = 'reativacao' then 'aprovada' else 'cancelada' end,
      decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now(),
      resposta = case when s.tipo = 'reativacao' then 'Reativado diretamente por admin' else 'Motorista reativado' end
    where s.motorista_id = p_motorista_id and s.status = 'pendente';
  end if;
end;
$$;

-- Aprovar a reativação grava o motivo do pedido no histórico.
create or replace function public.decidir_solicitacao_inativacao(
  p_solicitacao_id bigint, p_aprovar boolean, p_resposta text default null
)
returns public.solicitacoes_inativacao
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sol  public.solicitacoes_inativacao;
  v_m    public.motoristas;
  v_nome text;
  v_resp text := nullif(btrim(p_resposta), '');
  v_obs  text;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores aprovam ou recusam solicitações.' using errcode = '42501';
  end if;
  if p_aprovar is null then
    raise exception 'Informe se aprova ou recusa.' using errcode = '22023';
  end if;

  select * into v_sol from public.solicitacoes_inativacao s where s.id = p_solicitacao_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.' using errcode = '22023';
  end if;
  if v_sol.status <> 'pendente' then
    raise exception 'Esta solicitação já foi %.', v_sol.status using errcode = '22023';
  end if;
  if not p_aprovar and v_resp is null then
    raise exception 'Informe o motivo da recusa.' using errcode = '22023';
  end if;
  if v_resp is not null and length(v_resp) > 500 then
    raise exception 'Resposta muito longa (máximo 500 caracteres).' using errcode = '22023';
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  if p_aprovar then
    select * into v_m from public.motoristas m where m.id = v_sol.motorista_id for update;
    v_obs := left(concat_ws(' · ', v_sol.observacao,
                            'Solicitado por ' || coalesce(v_sol.solicitado_por_nome, 'usuário removido'),
                            v_resp), 500);
    if v_sol.tipo = 'inativacao' and v_m.status = 'ativo' then
      update public.motoristas m set
        status            = 'inativo',
        inativo_desde     = (now() at time zone 'America/Sao_Paulo')::date,
        motivo_inativacao = v_sol.motivo,
        atualizado_em     = now(),
        atualizado_por    = v_uid
      where m.id = v_m.id;

      insert into public.motorista_historico
        (motorista_id, galpao, status_anterior, status_novo, motivo, observacao, alterado_por, alterado_por_nome)
      values
        (v_m.id, v_m.galpao, 'ativo', 'inativo', v_sol.motivo, v_obs, v_uid, v_nome);
    elsif v_sol.tipo = 'reativacao' and v_m.status = 'inativo' then
      update public.motoristas m set
        status            = 'ativo',
        inativo_desde     = null,
        motivo_inativacao = null,
        atualizado_em     = now(),
        atualizado_por    = v_uid
      where m.id = v_m.id;

      insert into public.motorista_historico
        (motorista_id, galpao, status_anterior, status_novo, motivo, observacao, alterado_por, alterado_por_nome)
      values
        (v_m.id, v_m.galpao, 'inativo', 'ativo', nullif(v_sol.motivo, 'Reativação'), v_obs, v_uid, v_nome);
    end if;
  end if;

  update public.solicitacoes_inativacao s set
    status = case when p_aprovar then 'aprovada' else 'recusada' end,
    decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now(), resposta = v_resp
  where s.id = p_solicitacao_id
  returning * into v_sol;
  return v_sol;
end;
$$;
