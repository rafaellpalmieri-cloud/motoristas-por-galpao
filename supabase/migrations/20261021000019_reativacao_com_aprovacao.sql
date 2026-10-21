-- =====================================================================
-- Reativação com aprovação (igual à inativação):
--  - Dispatcher NÃO reativa direto: abre um pedido (motorista segue inativo).
--  - Admin aprova → motorista volta a ficar ativo; ou recusa, com resposta.
--  - Admin reativando direto continua imediato (e fecha o pedido pendente).
-- Os pedidos dos dois tipos ficam na mesma tabela, com a coluna "tipo".
-- =====================================================================

alter table public.solicitacoes_inativacao
  add column tipo text not null default 'inativacao' check (tipo in ('inativacao', 'reativacao'));

-- Inativado por outro caminho (admin direto ou planilha): só pedidos de inativação.
create or replace function public.fechar_solicitacoes_pendentes(
  p_motorista_id uuid, p_decidido_por uuid, p_nome text, p_resposta text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.solicitacoes_inativacao s set
    status = 'aprovada', decidido_por = p_decidido_por, decidido_por_nome = p_nome,
    decidido_em = now(), resposta = p_resposta
  where s.motorista_id = p_motorista_id and s.status = 'pendente' and s.tipo = 'inativacao';
$$;
revoke all on function public.fechar_solicitacoes_pendentes(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Inativar/reativar direto: agora as duas coisas são só para admin.
-- ---------------------------------------------------------------------
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
    v_motivo := null;
    if v_obs is not null and length(v_obs) > 500 then
      raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
    end if;
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  update public.motoristas m set
    status            = p_novo_status,
    inativo_desde     = case when p_novo_status = 'inativo'
                             then (now() at time zone 'America/Sao_Paulo')::date end,
    motivo_inativacao = v_motivo,
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
    -- Reativou: o pedido de reativação foi atendido; um de inativação perde o sentido.
    update public.solicitacoes_inativacao s set
      status = case when s.tipo = 'reativacao' then 'aprovada' else 'cancelada' end,
      decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now(),
      resposta = case when s.tipo = 'reativacao' then 'Reativado diretamente por admin' else 'Motorista reativado' end
    where s.motorista_id = p_motorista_id and s.status = 'pendente';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Dispatcher (ou admin) pede a reativação.
-- ---------------------------------------------------------------------
create or replace function public.solicitar_reativacao(p_motorista_id uuid, p_observacao text default null)
returns public.solicitacoes_inativacao
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_m    public.motoristas;
  v_obs  text := nullif(btrim(p_observacao), '');
  v_nome text;
  v_sol  public.solicitacoes_inativacao;
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
  if v_obs is not null and length(v_obs) > 500 then
    raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  insert into public.solicitacoes_inativacao
    (motorista_id, galpao, tipo, motivo, observacao, solicitado_por, solicitado_por_nome)
  values (v_m.id, v_m.galpao, 'reativacao', 'Reativação', v_obs, v_uid, v_nome)
  returning * into v_sol;

  return v_sol;
end;
$$;

-- Uma ou mais placas num pedido agrupado (como na inativação).
create or replace function public.solicitar_reativacao_lote(p_motorista_ids uuid[], p_observacao text default null)
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
    v_sol := public.solicitar_reativacao(v_id, p_observacao);
    update public.solicitacoes_inativacao s set grupo = v_grupo where s.id = v_sol.id;
  end loop;
  return v_grupo;
end;
$$;

revoke all on function public.solicitar_reativacao(uuid, text) from public, anon;
revoke all on function public.solicitar_reativacao_lote(uuid[], text) from public, anon;
grant execute on function public.solicitar_reativacao(uuid, text) to authenticated;
grant execute on function public.solicitar_reativacao_lote(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- Admin aprova ou recusa (inativação ou reativação).
-- ---------------------------------------------------------------------
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
        (v_m.id, v_m.galpao, 'inativo', 'ativo', null, v_obs, v_uid, v_nome);
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
