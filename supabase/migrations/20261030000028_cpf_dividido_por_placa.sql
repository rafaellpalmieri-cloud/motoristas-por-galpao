-- =====================================================================
-- BASE - POWER BI: motoristas com o mesmo nome saem com os CPFs juntos na
-- mesma célula, repetidos em cada linha (uma por placa). Para não dar as rotas
-- de um para o outro, o Apps Script pergunta ao app de quem é cada linha pela
-- placa: o dono é o cadastro cuja placa é a da linha e cujo CPF está na célula.
-- Sem placa correspondente (ou com mais de um dono possível), a linha não vale
-- para ninguém.
-- =====================================================================

-- Linha: { i, cpfs: ["...", "..."], placa }. Devolve [{ i, cpf }] só das resolvidas.
create or replace function public.resolver_cpfs_por_placa(p_linhas jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_cpfs   text[];
  v_placa  text;
  v_donos  text[];
  v_saida  jsonb := '[]'::jsonb;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item in select t.dado from jsonb_array_elements(p_linhas) as t(dado)
  loop
    if jsonb_typeof(v_item -> 'cpfs') <> 'array' then
      continue;
    end if;
    select array_agg(distinct c) into v_cpfs
    from (select public.normalizar_cpf(x) as c from jsonb_array_elements_text(v_item -> 'cpfs') as x) s
    where c is not null;
    v_placa := upper(regexp_replace(coalesce(v_item ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g'));
    if v_cpfs is null or v_placa = '' then
      continue;
    end if;

    select array_agg(distinct m.cpf) into v_donos
    from public.motoristas m
    where m.cpf = any(v_cpfs)
      and upper(regexp_replace(coalesce(m.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_placa;

    if cardinality(v_donos) = 1 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('i', v_item -> 'i', 'cpf', v_donos[1]));
    end if;
  end loop;

  return v_saida;
end;
$$;

revoke all on function public.resolver_cpfs_por_placa(jsonb) from public, anon, authenticated;
grant execute on function public.resolver_cpfs_por_placa(jsonb) to service_role;
