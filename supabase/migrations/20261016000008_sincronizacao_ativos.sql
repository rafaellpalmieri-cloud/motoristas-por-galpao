-- =====================================================================
-- Planilha interna → app: aba ATIVOS (cadastro de motoristas novos e
-- atualização de dados) e preenchimento do código na planilha.
-- Regras iguais às do CSV: motorista existente NUNCA tem o status alterado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Núcleo da importação (sem checagem de permissão; não exposto).
-- ---------------------------------------------------------------------
create or replace function public.importar_motoristas_nucleo(p_linhas jsonb, p_autor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
        p_autor
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

revoke all on function public.importar_motoristas_nucleo(jsonb, uuid) from public, anon, authenticated;

-- Importação pelo app (CSV): só admin. Mesmo comportamento de antes.
create or replace function public.importar_motoristas(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem importar motoristas.' using errcode = '42501';
  end if;
  return public.importar_motoristas_nucleo(p_linhas, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- Aba ATIVOS da planilha → app (só service_role / Edge Function).
-- Motorista novo entra como ativo; existente só tem os dados atualizados.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_ativos_planilha(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas jsonb;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  -- Força status "ativo" (só vale para quem é novo; existentes mantêm o status).
  select coalesce(jsonb_agg(l || '{"status":"ativo"}'::jsonb), '[]'::jsonb) into v_linhas
  from jsonb_array_elements(p_linhas) l;
  return public.importar_motoristas_nucleo(v_linhas, null);
end;
$$;

revoke all on function public.sincronizar_ativos_planilha(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_ativos_planilha(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Para preencher a coluna "codigo" da planilha uma única vez:
-- recebe [{linha, placa, celular}] e devolve [{linha, codigo}] quando há
-- exatamente UM motorista com aquela placa (ou, sem placa, aquele celular).
-- ---------------------------------------------------------------------
create or replace function public.buscar_codigos_planilha(p_linhas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_placa   text;
  v_cel     text;
  v_codigos text[];
  v_saida   jsonb := '[]'::jsonb;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_linhas) loop
    v_placa := nullif(upper(regexp_replace(coalesce(v_item ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')), '');
    v_cel   := nullif(right(regexp_replace(coalesce(v_item ->> 'celular', ''), '\D', '', 'g'), 11), '');
    v_codigos := null;

    if v_placa is not null then
      select array_agg(m.codigo) into v_codigos from public.motoristas m
      where upper(regexp_replace(m.placa, '[^A-Za-z0-9]', '', 'g')) = v_placa;
    end if;
    if coalesce(cardinality(v_codigos), 0) = 0 and v_cel is not null then
      select array_agg(m.codigo) into v_codigos from public.motoristas m
      where right(regexp_replace(m.celular, '\D', '', 'g'), 11) = v_cel;
    end if;

    v_saida := v_saida || jsonb_build_object(
      'linha', v_item -> 'linha',
      'codigo', case when cardinality(v_codigos) = 1 then v_codigos[1] end,
      'situacao', case coalesce(cardinality(v_codigos), 0)
                    when 0 then 'nao_encontrado'
                    when 1 then 'ok'
                    else 'ambiguo' end
    );
  end loop;

  return v_saida;
end;
$$;

revoke all on function public.buscar_codigos_planilha(jsonb) from public, anon, authenticated;
grant execute on function public.buscar_codigos_planilha(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Aba INATIVOS: quando a linha tiver código, usa o código primeiro.
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
  v_m             public.motoristas;
  v_inativados    integer := 0;
  v_ja_inativos   integer := 0;
  v_ja_processados integer := 0;
  v_nao_encontrados jsonb := '[]'::jsonb;
  v_qtd_nao_encontrados integer := 0;
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

      -- Chave antiga (placa|celular|data) mantida para não reaplicar linhas já processadas;
      -- linha só com código usa o código na chave.
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
      if v_m.id is null and v_placa is not null then
        select * into v_m from public.motoristas m
        where upper(regexp_replace(m.placa, '[^A-Za-z0-9]', '', 'g')) = v_placa
        order by m.status = 'ativo' desc
        limit 1
        for update;
      end if;
      if v_m.id is null and v_cel is not null then
        select * into v_m from public.motoristas m
        where right(regexp_replace(m.celular, '\D', '', 'g'), 11) = v_cel
        order by m.status = 'ativo' desc
        limit 1
        for update;
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
    'erros', v_erros
  );
end;
$$;
