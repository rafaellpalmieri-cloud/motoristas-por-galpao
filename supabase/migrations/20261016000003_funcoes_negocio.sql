-- =====================================================================
-- Funções de negócio
-- =====================================================================

-- ---------------------------------------------------------------------
-- Alterar status (inativar / reativar) com lock da linha e histórico
-- na mesma transação.
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

  select * into v_atual
  from public.motoristas m
  where m.id = p_motorista_id
  for update;

  if not found or not public.pode_gerir_galpao(v_atual.galpao) then
    raise exception 'Motorista não encontrado ou sem permissão.' using errcode = '42501';
  end if;

  if v_atual.status = p_novo_status then
    raise exception 'O motorista já está %.', p_novo_status using errcode = '22023';
  end if;

  if p_novo_status = 'inativo' then
    if v_motivo is null then
      raise exception 'Informe o motivo da inativação.' using errcode = '22023';
    end if;
    if v_motivo not in ('Parou de rodar', 'Saiu da operação', 'Documentação', 'Outro') then
      raise exception 'Motivo inválido.' using errcode = '22023';
    end if;
    if v_motivo = 'Outro' and v_obs is null then
      raise exception 'Descreva a observação quando o motivo for Outro.' using errcode = '22023';
    end if;
  else
    v_motivo := null;
  end if;

  if v_obs is not null and length(v_obs) > 500 then
    raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
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

  return v_novo;
end;
$$;

-- ---------------------------------------------------------------------
-- Converte data do CSV: AAAA-MM-DD ou DD/MM/AAAA.
-- ---------------------------------------------------------------------
create or replace function public.converter_data_csv(p_texto text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_texto), '');
begin
  if v is null then
    return null;
  elsif v ~ '^\d{4}-\d{2}-\d{2}$' then
    return to_date(v, 'YYYY-MM-DD');
  elsif v ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
    return to_date(v, 'DD/MM/YYYY');
  end if;
  raise exception 'Data inválida: % (use AAAA-MM-DD ou DD/MM/AAAA)', v using errcode = '22007';
end;
$$;

-- ---------------------------------------------------------------------
-- Importação (só admin). Upsert por código.
-- Em conflito atualiza nome, celular, placa, modal e galpão;
-- NUNCA altera status nem inativo_desde de quem já existe.
-- Cada linha roda num bloco próprio: uma linha ruim não derruba o lote.
-- Entrada: [{ "linha": 2, "codigo": "...", "nome_completo": "...", ... }]
-- Saída:   { "novos": n, "atualizados": n, "erros": [{ "linha", "codigo", "erro" }] }
-- ---------------------------------------------------------------------
create or replace function public.importar_motoristas(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_item        jsonb;
  v_idx         bigint;
  v_linha       text;
  v_codigo      text;
  v_galpao      text;
  v_status      text;
  v_inativo     date;
  v_inserido    boolean;
  v_novos       integer := 0;
  v_atualizados integer := 0;
  v_erros       jsonb := '[]'::jsonb;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem importar motoristas.' using errcode = '42501';
  end if;

  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item, v_idx in
    select t.dado, t.ordem from jsonb_array_elements(p_linhas) with ordinality as t(dado, ordem)
  loop
    v_linha  := coalesce(v_item ->> 'linha', v_idx::text);
    v_codigo := nullif(btrim(v_item ->> 'codigo'), '');
    begin
      if v_codigo is null then
        raise exception 'codigo é obrigatório';
      end if;

      v_galpao := nullif(upper(regexp_replace(coalesce(v_item ->> 'galpao', ''), '\s', '', 'g')), '');
      if v_galpao is not null and not (v_galpao = any (public.galpoes_validos())) then
        raise exception 'galpão inválido: %', v_galpao;
      end if;

      v_status := lower(btrim(coalesce(v_item ->> 'status', '')));
      if v_status not in ('ativo', 'inativo') then
        raise exception 'status inválido: "%" (use ativo ou inativo)', coalesce(v_item ->> 'status', '');
      end if;

      v_inativo := case when v_status = 'inativo'
                        then public.converter_data_csv(v_item ->> 'inativo_desde') end;

      insert into public.motoristas as m
        (codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde, atualizado_em, atualizado_por)
      values (
        v_codigo,
        nullif(btrim(v_item ->> 'nome_completo'), ''),
        nullif(btrim(v_item ->> 'celular'), ''),
        nullif(upper(btrim(v_item ->> 'placa')), ''),
        nullif(btrim(v_item ->> 'modal'), ''),
        v_galpao,
        v_status,
        v_inativo,
        now(),
        v_uid
      )
      on conflict (codigo) do update set
        nome_completo = excluded.nome_completo,
        celular       = excluded.celular,
        placa         = excluded.placa,
        modal         = excluded.modal,
        galpao        = excluded.galpao
      returning (m.xmax = 0) into v_inserido;

      if v_inserido then
        v_novos := v_novos + 1;
      else
        v_atualizados := v_atualizados + 1;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_object('linha', v_linha, 'codigo', v_codigo, 'erro', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'erros', v_erros);
end;
$$;

-- ---------------------------------------------------------------------
-- Exportação (só admin): motoristas + autor da última alteração.
-- ---------------------------------------------------------------------
create or replace function public.exportar_motoristas()
returns table (
  codigo                text,
  nome_completo         text,
  celular               text,
  placa                 text,
  modal                 text,
  galpao                text,
  status                text,
  inativo_desde         date,
  motivo_inativacao     text,
  atualizado_em         timestamptz,
  atualizado_por_nome   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem exportar.' using errcode = '42501';
  end if;

  return query
    select m.codigo, m.nome_completo, m.celular, m.placa, m.modal, m.galpao, m.status,
           m.inativo_desde, m.motivo_inativacao, m.atualizado_em, p.nome
    from public.motoristas m
    left join public.perfis p on p.user_id = m.atualizado_por
    order by m.galpao nulls first, m.nome_completo;
end;
$$;

-- ---------------------------------------------------------------------
-- Resumo por galpão (respeita RLS: security invoker).
-- ---------------------------------------------------------------------
create or replace function public.resumo_por_galpao()
returns table (galpao text, ativos bigint, inativos bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.galpao,
         count(*) filter (where m.status = 'ativo'),
         count(*) filter (where m.status = 'inativo')
  from public.motoristas m
  group by m.galpao
  order by m.galpao nulls last;
$$;

-- ---------------------------------------------------------------------
-- Ações do próprio usuário (sem dar UPDATE em perfis).
-- ---------------------------------------------------------------------
create or replace function public.marcar_senha_trocada()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.perfis set trocar_senha = false where user_id = auth.uid();
$$;

create or replace function public.marcar_alertas_vistos()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.perfis set alertas_vistos_em = now() where user_id = auth.uid();
$$;
