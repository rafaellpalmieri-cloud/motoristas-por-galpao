-- =====================================================================
-- CPF e dados de rota também para quem está na aba INATIVOS.
-- Só completa dados (CPF, fez rota, quantidade, última rota): NÃO mexe
-- em status, histórico nem alertas. Campo em branco não apaga o que existe.
-- Chamada só pela Edge Function (service_role).
-- =====================================================================
create or replace function public.atualizar_complemento_planilha(p_linhas jsonb)
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
  v_ids         uuid[];
  v_id          uuid;
  v_atualizados integer := 0;
  v_sem_dados   integer := 0;
  v_nao_achados integer := 0;
  v_ambiguos    integer := 0;
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
    v_linha := coalesce(v_item ->> 'linha', v_idx::text);
    begin
      if public.normalizar_cpf(v_item ->> 'cpf') is null
         and public.converter_sim_nao(v_item ->> 'realizou_rotas') is null
         and public.converter_inteiro(v_item ->> 'qtd_rotas') is null
         and public.converter_data_tolerante(v_item ->> 'ultima_rota') is null then
        v_sem_dados := v_sem_dados + 1;
        continue;
      end if;

      v_id := null;
      v_codigo := nullif(btrim(v_item ->> 'codigo'), '');
      if v_codigo is not null then
        select m.id into v_id from public.motoristas m where m.codigo = v_codigo;
      end if;
      if v_id is null then
        v_ids := public.candidatos_motorista(v_item ->> 'placa', v_item ->> 'celular', v_item ->> 'nome_completo');
        if cardinality(v_ids) > 1 then
          v_ambiguos := v_ambiguos + 1;
          continue;
        elsif cardinality(v_ids) = 1 then
          v_id := v_ids[1];
        end if;
      end if;
      if v_id is null then
        v_nao_achados := v_nao_achados + 1;
        continue;
      end if;

      update public.motoristas m set
        cpf            = coalesce(public.normalizar_cpf(v_item ->> 'cpf'), m.cpf),
        realizou_rotas = coalesce(public.converter_sim_nao(v_item ->> 'realizou_rotas'), m.realizou_rotas),
        qtd_rotas      = coalesce(public.converter_inteiro(v_item ->> 'qtd_rotas'), m.qtd_rotas),
        ultima_rota    = coalesce(public.converter_data_tolerante(v_item ->> 'ultima_rota'), m.ultima_rota)
      where m.id = v_id;
      v_atualizados := v_atualizados + 1;
    exception when others then
      v_erros := v_erros || jsonb_build_object('linha', v_linha, 'erro', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'atualizados', v_atualizados,
    'sem_dados', v_sem_dados,
    'nao_encontrados', v_nao_achados,
    'ambiguos', v_ambiguos,
    'erros', v_erros
  );
end;
$$;

revoke all on function public.atualizar_complemento_planilha(jsonb) from public, anon, authenticated;
grant execute on function public.atualizar_complemento_planilha(jsonb) to service_role;
