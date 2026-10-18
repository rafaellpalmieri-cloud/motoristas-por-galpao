-- =====================================================================
-- Placas repetidas e motorista com duas placas.
--  - Extrai todas as placas de um texto ("ABC1D23 / XYZ9K88").
--  - Quando a placa bate com mais de um motorista: desempata pelo celular
--    e depois pelo nome. Se continuar empatado, NÃO escolhe ninguém.
-- Antes, a aba INATIVOS pegava o primeiro motorista ativo da placa, o que
-- podia inativar a pessoa errada.
-- =====================================================================

create or replace function public.placas_do_texto(p_texto text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct t[1]), '{}')
  from regexp_matches(upper(regexp_replace(coalesce(p_texto, ''), '[^A-Za-z0-9/;,|]', '', 'g')),
                      '[A-Z]{3}[0-9][A-Z0-9][0-9]{2}', 'g') as t;
$$;

create or replace function public.normalizar_nome(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(translate(coalesce(p_texto, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g')), '');
$$;

-- Candidatos para uma linha da planilha (ids). 0 = não achou; 1 = achou; >1 = empate.
create or replace function public.candidatos_motorista(p_placa text, p_celular text, p_nome text)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_placas text[] := public.placas_do_texto(p_placa);
  v_cel    text   := nullif(right(regexp_replace(coalesce(p_celular, ''), '\D', '', 'g'), 11), '');
  v_nome   text   := public.normalizar_nome(p_nome);
  v_ids    uuid[];
  v_filtro uuid[];
begin
  if cardinality(v_placas) > 0 then
    select coalesce(array_agg(m.id), '{}') into v_ids
    from public.motoristas m
    where exists (
      select 1 from unnest(v_placas) p
      where upper(regexp_replace(coalesce(m.placa, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || p || '%'
    );
  else
    v_ids := '{}';
  end if;

  if cardinality(v_ids) = 0 and v_cel is not null then
    select coalesce(array_agg(m.id), '{}') into v_ids
    from public.motoristas m
    where right(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g'), 11) = v_cel;
  elsif cardinality(v_ids) > 1 and v_cel is not null then
    select coalesce(array_agg(m.id), '{}') into v_filtro
    from public.motoristas m
    where m.id = any (v_ids) and right(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g'), 11) = v_cel;
    if cardinality(v_filtro) > 0 then v_ids := v_filtro; end if;
  end if;

  if cardinality(v_ids) > 1 and v_nome is not null then
    select coalesce(array_agg(m.id), '{}') into v_filtro
    from public.motoristas m
    where m.id = any (v_ids) and public.normalizar_nome(m.nome_completo) = v_nome;
    if cardinality(v_filtro) > 0 then v_ids := v_filtro; end if;
  end if;

  return v_ids;
end;
$$;

revoke all on function public.placas_do_texto(text) from public, anon, authenticated;
revoke all on function public.normalizar_nome(text) from public, anon, authenticated;
revoke all on function public.candidatos_motorista(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Preenchimento do código: usa o desempate. Entrada ganha nome_completo.
-- ---------------------------------------------------------------------
create or replace function public.buscar_codigos_planilha(p_linhas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_ids   uuid[];
  v_cod   text;
  v_saida jsonb := '[]'::jsonb;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_linhas) loop
    v_ids := public.candidatos_motorista(v_item ->> 'placa', v_item ->> 'celular', v_item ->> 'nome_completo');
    v_cod := case when cardinality(v_ids) = 1
                  then (select m.codigo from public.motoristas m where m.id = v_ids[1]) end;
    v_saida := v_saida || jsonb_build_object(
      'linha', v_item -> 'linha',
      'codigo', v_cod,
      'situacao', case cardinality(v_ids) when 0 then 'nao_encontrado' when 1 then 'ok' else 'ambiguo' end
    );
  end loop;
  return v_saida;
end;
$$;

-- ---------------------------------------------------------------------
-- Aba INATIVOS: código primeiro; senão candidatos com desempate.
-- Empate → não inativa ninguém e devolve em "ambiguos".
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_inativos_planilha(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item          jsonb;
  v_idx           bigint;
  v_linha         text;
  v_codigo        text;
  v_placa         text;
  v_cel           text;
  v_data          date;
  v_motivo_txt    text;
  v_motivo        text;
  v_obs           text;
  v_chave         text;
  v_hoje          date := (now() at time zone 'America/Sao_Paulo')::date;
  v_quando        timestamptz;
  v_ids           uuid[];
  v_m             public.motoristas;
  v_inativados    integer := 0;
  v_ja_inativos   integer := 0;
  v_ja_processados integer := 0;
  v_nao_encontrados jsonb := '[]'::jsonb;
  v_qtd_nao_encontrados integer := 0;
  v_ambiguos      jsonb := '[]'::jsonb;
  v_erros         jsonb := '[]'::jsonb;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item, v_idx in
    select t.dado, t.ordem from jsonb_array_elements(p_linhas) with ordinality as t(dado, ordem)
  loop
    v_linha := coalesce(v_item ->> 'linha', v_idx::text);
    begin
      v_codigo := nullif(btrim(v_item ->> 'codigo'), '');
      v_placa  := nullif(upper(regexp_replace(coalesce(v_item ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')), '');
      v_cel    := nullif(right(regexp_replace(coalesce(v_item ->> 'celular', ''), '\D', '', 'g'), 11), '');
      if v_codigo is null and v_placa is null and v_cel is null then
        raise exception 'linha sem código, placa e celular';
      end if;

      begin
        v_data := public.converter_data_csv(v_item ->> 'data');
      exception when others then
        v_data := null;
      end;

      v_chave := case
        when v_placa is null and v_cel is null then 'codigo:' || v_codigo || '|' || coalesce(v_data::text, '')
        else coalesce(v_placa, '') || '|' || coalesce(v_cel, '') || '|' || coalesce(v_data::text, '')
      end;
      if exists (select 1 from public.planilha_inativacoes_processadas p where p.chave = v_chave) then
        v_ja_processados := v_ja_processados + 1;
        continue;
      end if;

      v_m := null;
      if v_codigo is not null then
        select * into v_m from public.motoristas m where m.codigo = v_codigo for update;
      end if;
      if v_m.id is null then
        v_ids := public.candidatos_motorista(v_item ->> 'placa', v_item ->> 'celular', v_item ->> 'nome_completo');
        if cardinality(v_ids) > 1 then
          if jsonb_array_length(v_ambiguos) < 200 then
            v_ambiguos := v_ambiguos || jsonb_build_object('linha', v_linha, 'placa', v_placa);
          end if;
          continue;
        elsif cardinality(v_ids) = 1 then
          select * into v_m from public.motoristas m where m.id = v_ids[1] for update;
        end if;
      end if;

      if v_m.id is null then
        v_qtd_nao_encontrados := v_qtd_nao_encontrados + 1;
        if jsonb_array_length(v_nao_encontrados) < 200 then
          v_nao_encontrados := v_nao_encontrados || jsonb_build_object('linha', v_linha, 'codigo', v_codigo, 'placa', v_placa);
        end if;
        continue;
      end if;

      if v_m.status = 'ativo' then
        v_motivo_txt := nullif(btrim(v_item ->> 'motivo'), '');
        if v_motivo_txt in ('Parou de rodar', 'Saiu da operação', 'Documentação', 'Outro') then
          v_motivo := v_motivo_txt;
          v_obs := 'Inativado na planilha';
        else
          v_motivo := 'Outro';
          v_obs := left('Inativado na planilha' || coalesce(': ' || v_motivo_txt, ''), 500);
        end if;

        v_quando := case
          when v_data is null or v_data >= v_hoje then now()
          else (v_data + time '12:00') at time zone 'America/Sao_Paulo'
        end;

        update public.motoristas m set
          status            = 'inativo',
          inativo_desde     = coalesce(v_data, v_hoje),
          motivo_inativacao = v_motivo,
          atualizado_em     = v_quando,
          atualizado_por    = null
        where m.id = v_m.id;

        insert into public.motorista_historico
          (motorista_id, galpao, status_anterior, status_novo, motivo, observacao,
           alterado_por, alterado_por_nome, alterado_em, origem)
        values
          (v_m.id, v_m.galpao, 'ativo', 'inativo', v_motivo, v_obs,
           null, 'Planilha', v_quando, 'planilha');

        v_inativados := v_inativados + 1;
      else
        v_ja_inativos := v_ja_inativos + 1;
      end if;

      insert into public.planilha_inativacoes_processadas (chave, motorista_id)
      values (v_chave, v_m.id)
      on conflict do nothing;
    exception when others then
      v_erros := v_erros || jsonb_build_object('linha', v_linha, 'erro', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'inativados', v_inativados,
    'ja_inativos', v_ja_inativos,
    'ja_processados', v_ja_processados,
    'qtd_nao_encontrados', v_qtd_nao_encontrados,
    'nao_encontrados', v_nao_encontrados,
    'ambiguos', v_ambiguos,
    'erros', v_erros
  );
end;
$$;
