-- =====================================================================
-- Inativação com aprovação:
--  - Dispatcher NÃO inativa direto: abre uma solicitação (motorista segue ativo).
--  - Admin aprova (depois de enviar para a Coopmetro e inativar no sistema
--    interno) → motorista fica inativo; ou recusa, com resposta.
--  - Admin inativando direto, reativação e planilha continuam imediatos.
-- =====================================================================

create table public.solicitacoes_inativacao (
  id                  bigint generated always as identity primary key,
  motorista_id        uuid not null references public.motoristas (id) on delete cascade,
  galpao              text,
  motivo              text not null,
  observacao          text,
  status              text not null default 'pendente'
                        check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  solicitado_por      uuid references auth.users (id) on delete set null,
  solicitado_por_nome text,
  solicitado_em       timestamptz not null default now(),
  decidido_por        uuid references auth.users (id) on delete set null,
  decidido_por_nome   text,
  decidido_em         timestamptz,
  resposta            text
);

-- No máximo uma solicitação pendente por motorista.
create unique index solicitacoes_uma_pendente_idx
  on public.solicitacoes_inativacao (motorista_id) where status = 'pendente';
create index solicitacoes_status_data_idx
  on public.solicitacoes_inativacao (status, solicitado_em desc);
create index solicitacoes_galpao_idx on public.solicitacoes_inativacao (galpao);

alter table public.solicitacoes_inativacao enable row level security;
revoke all on public.solicitacoes_inativacao from anon, authenticated;
grant select on public.solicitacoes_inativacao to authenticated;
grant select on public.solicitacoes_inativacao to service_role;

-- Leitura pelo galpão (mesma regra dos motoristas); escrita só pelas funções.
create policy solicitacoes_select on public.solicitacoes_inativacao
  for select to authenticated
  using (public.pode_gerir_galpao(galpao));

-- ---------------------------------------------------------------------
-- Fecha pendências quando o motorista é inativado por outro caminho.
-- ---------------------------------------------------------------------
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
  where s.motorista_id = p_motorista_id and s.status = 'pendente';
$$;
revoke all on function public.fechar_solicitacoes_pendentes(uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Validação de motivo (igual à inativação direta).
-- ---------------------------------------------------------------------
create or replace function public.validar_motivo_inativacao(p_motivo text, p_observacao text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_motivo is null then
    raise exception 'Informe o motivo da inativação.' using errcode = '22023';
  end if;
  if p_motivo not in ('Parou de rodar', 'Saiu da operação', 'Documentação', 'Outro') then
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
revoke all on function public.validar_motivo_inativacao(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Inativar/reativar direto: inativar agora é só para admin.
-- ---------------------------------------------------------------------
create or replace function public.alterar_status_motorista(
  p_motorista_id uuid,
  p_novo_status  text,
  p_motivo       text default null,
  p_observacao   text default null
)
returns public.motoristas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_atual  public.motoristas;
  v_novo   public.motoristas;
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

  if p_novo_status = 'inativo' and not public.eh_admin() then
    raise exception 'Dispatcher não inativa direto: use a solicitação de inativação.' using errcode = '42501';
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
  where m.id = p_motorista_id
  returning m.* into v_novo;

  insert into public.motorista_historico
    (motorista_id, galpao, status_anterior, status_novo, motivo, observacao, alterado_por, alterado_por_nome)
  values
    (p_motorista_id, v_atual.galpao, v_atual.status, p_novo_status, v_motivo, v_obs, v_uid, v_nome);

  if p_novo_status = 'inativo' then
    perform public.fechar_solicitacoes_pendentes(p_motorista_id, v_uid, v_nome, 'Inativado diretamente por admin');
  else
    -- Reativou: pendência (se houver) perde o sentido.
    update public.solicitacoes_inativacao s set
      status = 'cancelada', decidido_por = v_uid, decidido_por_nome = v_nome,
      decidido_em = now(), resposta = 'Motorista reativado'
    where s.motorista_id = p_motorista_id and s.status = 'pendente';
  end if;

  return v_novo;
end;
$$;

-- ---------------------------------------------------------------------
-- Dispatcher (ou admin) pede a inativação.
-- ---------------------------------------------------------------------
create or replace function public.solicitar_inativacao(
  p_motorista_id uuid, p_motivo text, p_observacao text default null
)
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
  if v_m.status <> 'ativo' then
    raise exception 'O motorista já está inativo.' using errcode = '22023';
  end if;
  if exists (select 1 from public.solicitacoes_inativacao s where s.motorista_id = v_m.id and s.status = 'pendente') then
    raise exception 'Já existe uma solicitação pendente para este motorista.' using errcode = '22023';
  end if;

  perform public.validar_motivo_inativacao(v_motivo, v_obs);
  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  insert into public.solicitacoes_inativacao
    (motorista_id, galpao, motivo, observacao, solicitado_por, solicitado_por_nome)
  values (v_m.id, v_m.galpao, v_motivo, v_obs, v_uid, v_nome)
  returning * into v_sol;

  return v_sol;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem pediu (ou um admin) cancela enquanto está pendente.
-- ---------------------------------------------------------------------
create or replace function public.cancelar_solicitacao_inativacao(p_solicitacao_id bigint)
returns public.solicitacoes_inativacao
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sol  public.solicitacoes_inativacao;
  v_nome text;
begin
  select * into v_sol from public.solicitacoes_inativacao s where s.id = p_solicitacao_id for update;
  if not found or not public.pode_gerir_galpao(v_sol.galpao)
     or (v_sol.solicitado_por is distinct from v_uid and not public.eh_admin()) then
    raise exception 'Solicitação não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  if v_sol.status <> 'pendente' then
    raise exception 'Esta solicitação já foi %.', v_sol.status using errcode = '22023';
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;
  update public.solicitacoes_inativacao s set
    status = 'cancelada', decidido_por = v_uid, decidido_por_nome = v_nome, decidido_em = now()
  where s.id = p_solicitacao_id
  returning * into v_sol;
  return v_sol;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin aprova (inativa o motorista) ou recusa.
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
    if v_m.status = 'ativo' then
      v_obs := left(concat_ws(' · ', v_sol.observacao,
                              'Solicitado por ' || coalesce(v_sol.solicitado_por_nome, 'usuário removido'),
                              v_resp), 500);
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

revoke all on function public.solicitar_inativacao(uuid, text, text) from public, anon;
revoke all on function public.cancelar_solicitacao_inativacao(bigint) from public, anon;
revoke all on function public.decidir_solicitacao_inativacao(bigint, boolean, text) from public, anon;
grant execute on function public.solicitar_inativacao(uuid, text, text) to authenticated;
grant execute on function public.cancelar_solicitacao_inativacao(bigint) to authenticated;
grant execute on function public.decidir_solicitacao_inativacao(bigint, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Planilha: ao inativar, fecha pendências do motorista.
-- ---------------------------------------------------------------------
create or replace function public.fechar_pendencias_apos_planilha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'planilha' and new.status_novo = 'inativo' then
    perform public.fechar_solicitacoes_pendentes(new.motorista_id, null, 'Planilha', 'Inativado na planilha interna');
  end if;
  return new;
end;
$$;
revoke all on function public.fechar_pendencias_apos_planilha() from public, anon, authenticated;

create trigger motorista_historico_fechar_pendencias
  after insert on public.motorista_historico
  for each row execute function public.fechar_pendencias_apos_planilha();
