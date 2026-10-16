-- =====================================================================
-- Sincronização da aba INATIVOS da planilha interna → app
-- A planilha envia (via Apps Script → Edge Function) só nome, celular,
-- placa, galpão, modal, data e motivo. CPF/RG/endereço nunca chegam aqui.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Privilégios do service_role (usado SÓ dentro das Edge Functions).
-- Com "Automatically expose new tables" desligado, ele não recebe grants
-- automáticos; sem isto, criar/desativar dispatcher falha.
-- ---------------------------------------------------------------------
grant usage on schema public to service_role;
grant select, insert, update on public.perfis             to service_role;
grant select, insert         on public.user_roles         to service_role;
grant select, insert         on public.dispatcher_galpoes to service_role;
grant select                 on public.motoristas         to service_role;
grant select                 on public.motorista_historico to service_role;

-- Origem de cada mudança no histórico (app, planilha).
alter table public.motorista_historico
  add column origem text not null default 'app' check (origem in ('app', 'planilha'));

-- Cada inativação da planilha é aplicada uma única vez (evita "re-inativar"
-- um motorista que o dispatcher reativou no app depois).
create table public.planilha_inativacoes_processadas (
  chave         text primary key,
  motorista_id  uuid references public.motoristas (id) on delete cascade,
  processado_em timestamptz not null default now()
);
alter table public.planilha_inativacoes_processadas enable row level security;
revoke all on public.planilha_inativacoes_processadas from anon, authenticated;

-- Busca por placa normalizada e por celular (só dígitos, últimos 11).
create index motoristas_placa_normalizada_idx
  on public.motoristas (upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')));
create index motoristas_celular_normalizado_idx
  on public.motoristas (right(regexp_replace(celular, '\D', '', 'g'), 11));

-- ---------------------------------------------------------------------
-- Recebe as linhas da aba INATIVOS e inativa no app quem ainda está ativo.
-- Chamada só pela Edge Function (service_role).
-- Entrada: [{ "linha", "nome_completo", "celular", "placa", "galpao", "modal", "data", "motivo" }]
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
      v_placa := nullif(upper(regexp_replace(coalesce(v_item ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')), '');
      v_cel   := nullif(right(regexp_replace(coalesce(v_item ->> 'celular', ''), '\D', '', 'g'), 11), '');
      if v_placa is null and v_cel is null then
        raise exception 'linha sem placa e sem celular';
      end if;

      begin
        v_data := public.converter_data_csv(v_item ->> 'data');
      exception when others then
        v_data := null;
      end;

      v_chave := coalesce(v_placa, '') || '|' || coalesce(v_cel, '') || '|' || coalesce(v_data::text, '');
      if exists (select 1 from public.planilha_inativacoes_processadas p where p.chave = v_chave) then
        v_ja_processados := v_ja_processados + 1;
        continue;
      end if;

      -- Localiza o motorista: placa primeiro, celular como reserva.
      v_m := null;
      if v_placa is not null then
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
        -- Não marca como processada: pode ser importado depois.
        v_qtd_nao_encontrados := v_qtd_nao_encontrados + 1;
        if jsonb_array_length(v_nao_encontrados) < 200 then
          v_nao_encontrados := v_nao_encontrados || jsonb_build_object('linha', v_linha, 'placa', v_placa);
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

        -- Data da planilha vira a data do histórico (inativações antigas não
        -- disparam alerta de "novo"); sem data ou com data de hoje, usa agora.
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

revoke all on function public.sincronizar_inativos_planilha(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_inativos_planilha(jsonb) to service_role;
