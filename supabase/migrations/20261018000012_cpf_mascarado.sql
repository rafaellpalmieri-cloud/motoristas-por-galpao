-- =====================================================================
-- CPF mascarado para dispatcher (decisão de 18/10/2026).
--  - Coluna gerada cpf_mascarado: ***.456.789-**
--  - authenticated perde o SELECT da coluna cpf (privilégio por coluna):
--    o dispatcher nem recebe o número completo, só o mascarado.
--  - Admin vê o CPF completo pelas funções cpf_completo / cpfs_completos
--    (e pela exportação, que já é só para admin).
-- ATENÇÃO: colunas novas em motoristas precisam entrar no GRANT abaixo.
-- =====================================================================

alter table public.motoristas
  add column cpf_mascarado text generated always as (
    case when cpf is null then null
         else '***.' || substr(cpf, 4, 3) || '.' || substr(cpf, 7, 3) || '-**' end
  ) stored;

revoke select on public.motoristas from authenticated;
grant select (
  id, codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde,
  motivo_inativacao, atualizado_em, atualizado_por, realizou_rotas, qtd_rotas,
  ultima_rota, cpf_mascarado
) on public.motoristas to authenticated;

-- ---------------------------------------------------------------------
-- CPF completo: só admin.
-- ---------------------------------------------------------------------
create or replace function public.cpf_completo(p_motorista_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores veem o CPF completo.' using errcode = '42501';
  end if;
  return (select m.cpf from public.motoristas m where m.id = p_motorista_id);
end;
$$;

create or replace function public.cpfs_completos()
returns table (id uuid, cpf text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores veem o CPF completo.' using errcode = '42501';
  end if;
  return query select m.id, m.cpf from public.motoristas m where m.cpf is not null;
end;
$$;

revoke all on function public.cpf_completo(uuid) from public, anon;
revoke all on function public.cpfs_completos() from public, anon;
grant execute on function public.cpf_completo(uuid) to authenticated;
grant execute on function public.cpfs_completos() to authenticated;

-- ---------------------------------------------------------------------
-- alterar_status_motorista devolvia a linha inteira (com o CPF completo).
-- Passa a não devolver nada; o app relê os dados pela consulta normal.
-- ---------------------------------------------------------------------
drop function public.alterar_status_motorista(uuid, text, text, text);

create function public.alterar_status_motorista(
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
  where m.id = p_motorista_id;

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

  return;
end;
$$;

revoke all on function public.alterar_status_motorista(uuid, text, text, text) from public, anon;
grant execute on function public.alterar_status_motorista(uuid, text, text, text) to authenticated;
