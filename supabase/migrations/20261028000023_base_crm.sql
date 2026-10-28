-- =====================================================================
-- Aba "BASE - SUPABASE" (exportação do CRM de cadastros) como origem dos
-- motoristas, no lugar das abas ATIVOS e INATIVOS (decisão de 28/10/2026).
--  - Cada cadastro do CRM é identificado pelo id (crm_id).
--  - Código exibido no app = ID Coopmetro; sem ele, código provisório CRM-xxxx.
--  - Entram status ativo, inativo e pausado (pausado = inativo no app).
--  - O CRM manda no status, mas só quando ELE muda (crm_status guarda o
--    último status visto): inativar/reativar no app não é desfeito pela
--    próxima sincronização.
--  - Rotas vêm da aba BASE - POWER BI, já somadas pelo Apps Script por CPF.
--  - RG, endereço e demais colunas do CRM nunca chegam aqui.
-- =====================================================================

alter table public.motoristas
  add column crm_id       uuid unique,
  add column crm_status   text check (crm_status is null or length(crm_status) <= 50),
  add column id_coopmetro text check (id_coopmetro is null or id_coopmetro ~ '^\d{1,12}$');

-- ---------------------------------------------------------------------
-- Planilha/CRM mudou o status: fecha os pedidos pendentes que perderam o sentido.
-- ---------------------------------------------------------------------
create or replace function public.fechar_pendencias_apos_planilha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'planilha' and new.status_novo = 'inativo' then
    perform public.fechar_solicitacoes_pendentes(new.motorista_id, null, 'CRM', 'Inativado no CRM');
  elsif new.origem = 'planilha' and new.status_novo = 'ativo' then
    update public.solicitacoes_inativacao s set
      status            = case when s.tipo = 'reativacao' then 'aprovada' else 'cancelada' end,
      decidido_por      = null,
      decidido_por_nome = 'CRM',
      decidido_em       = now(),
      resposta          = 'Reativado no CRM'
    where s.motorista_id = new.motorista_id and s.status = 'pendente';
  end if;
  return new;
end;
$$;
revoke all on function public.fechar_pendencias_apos_planilha() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- BASE - SUPABASE → app (só service_role / Edge Function).
-- Linha: { linha, crm_id, status, nome_completo, cpf, celular, galpao, modal,
--          placa, id_coopmetro, encerramento_motivo, atualizado_crm,
--          qtd_rotas, ultima_rota }
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_base_crm(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item       jsonb;
  v_idx        bigint;
  v_linha      text;
  v_crm_id     uuid;
  v_crm_status text;
  v_status     text;
  v_novo       text;
  v_nome       text;
  v_cpf        text;
  v_celular    text;
  v_placa      text;
  v_modal      text;
  v_galpao     text;
  v_coop       text;
  v_codigo     text;
  v_motivo_crm text;
  v_obs        text;
  v_desde      date;
  v_qtd        integer;
  v_ultima     date;
  v_tem_rotas  boolean;
  v_hoje       date := (now() at time zone 'America/Sao_Paulo')::date;
  v_m          public.motoristas;
  v_novos      integer := 0;
  v_atualizados integer := 0;
  v_inativados integer := 0;
  v_reativados integer := 0;
  v_ignorados  integer := 0;
  v_erros      jsonb := '[]'::jsonb;
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
      begin
        v_crm_id := nullif(btrim(v_item ->> 'crm_id'), '')::uuid;
      exception when others then
        raise exception 'id do CRM inválido';
      end;
      if v_crm_id is null then
        raise exception 'linha sem id do CRM';
      end if;

      v_crm_status := lower(left(nullif(btrim(v_item ->> 'status'), ''), 50));
      v_status := case v_crm_status
                    when 'ativo'   then 'ativo'
                    when 'inativo' then 'inativo'
                    when 'pausado' then 'inativo'
                  end;

      v_nome    := nullif(upper(left(btrim(coalesce(v_item ->> 'nome_completo', '')), 200)), '');
      v_cpf     := public.normalizar_cpf(v_item ->> 'cpf');
      v_celular := nullif(left(regexp_replace(coalesce(v_item ->> 'celular', ''), '\D', '', 'g'), 20), '');
      v_placa   := nullif(left(upper(regexp_replace(coalesce(v_item ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')), 10), '');
      v_modal   := nullif(upper(left(btrim(coalesce(v_item ->> 'modal', '')), 50)), '');
      v_galpao  := upper(btrim(coalesce(v_item ->> 'galpao', '')));
      if not (v_galpao = any (public.galpoes_validos())) then
        v_galpao := null;
      end if;
      v_coop := nullif(regexp_replace(coalesce(v_item ->> 'id_coopmetro', ''), '\D', '', 'g'), '');
      if length(v_coop) > 12 then v_coop := null; end if;
      v_motivo_crm := nullif(left(btrim(coalesce(v_item ->> 'encerramento_motivo', '')), 300), '');

      begin
        v_desde := ((v_item ->> 'atualizado_crm')::timestamptz at time zone 'America/Sao_Paulo')::date;
      exception when others then
        v_desde := null;
      end;

      v_tem_rotas := nullif(btrim(coalesce(v_item ->> 'qtd_rotas', '')), '') is not null;
      begin
        v_qtd := greatest(nullif(btrim(v_item ->> 'qtd_rotas'), '')::integer, 0);
      exception when others then
        v_qtd := null;
      end;
      begin
        v_ultima := public.converter_data_csv(v_item ->> 'ultima_rota');
      exception when others then
        v_ultima := null;
      end;

      select * into v_m from public.motoristas m where m.crm_id = v_crm_id for update;

      -- Código: ID Coopmetro; sem ele, provisório. Se já for de outro cadastro, ganha sufixo.
      v_codigo := coalesce(v_coop, 'CRM-' || upper(left(v_crm_id::text, 8)));
      if exists (select 1 from public.motoristas m
                 where m.codigo = v_codigo and m.crm_id is distinct from v_crm_id) then
        v_codigo := v_codigo || '-' || upper(left(v_crm_id::text, 4));
      end if;

      if v_m.id is null then
        if v_status is null then
          v_ignorados := v_ignorados + 1;
          continue;
        end if;
        insert into public.motoristas
          (codigo, crm_id, crm_status, id_coopmetro, nome_completo, cpf, celular, placa, modal, galpao,
           status, inativo_desde, motivo_inativacao, realizou_rotas, qtd_rotas, ultima_rota,
           atualizado_em, atualizado_por)
        values
          (v_codigo, v_crm_id, v_crm_status, v_coop, v_nome, v_cpf, v_celular, v_placa, v_modal, v_galpao,
           v_status,
           case when v_status = 'inativo' then coalesce(v_desde, v_hoje) end,
           case when v_status = 'inativo' then 'Outro' end,
           case when v_tem_rotas then coalesce(v_qtd, 0) > 0 end,
           case when v_tem_rotas then v_qtd end,
           case when v_tem_rotas then v_ultima end,
           now(), null);
        v_novos := v_novos + 1;
        continue;
      end if;

      -- Dados cadastrais (só grava se algo mudou).
      update public.motoristas m set
        codigo        = case when m.codigo like 'CRM-%' or v_coop is not null then v_codigo else m.codigo end,
        id_coopmetro  = coalesce(v_coop, m.id_coopmetro),
        nome_completo = coalesce(v_nome, m.nome_completo),
        cpf           = coalesce(v_cpf, m.cpf),
        celular       = coalesce(v_celular, m.celular),
        placa         = coalesce(v_placa, m.placa),
        modal         = coalesce(v_modal, m.modal),
        galpao        = coalesce(v_galpao, m.galpao),
        realizou_rotas = case when v_tem_rotas then coalesce(v_qtd, 0) > 0 else m.realizou_rotas end,
        qtd_rotas     = case when v_tem_rotas then v_qtd else m.qtd_rotas end,
        ultima_rota   = case when v_tem_rotas then v_ultima else m.ultima_rota end
      where m.id = v_m.id
        and (m.codigo, m.id_coopmetro, m.nome_completo, m.cpf, m.celular, m.placa, m.modal, m.galpao,
             m.realizou_rotas, m.qtd_rotas, m.ultima_rota)
            is distinct from
            (case when m.codigo like 'CRM-%' or v_coop is not null then v_codigo else m.codigo end,
             coalesce(v_coop, m.id_coopmetro), coalesce(v_nome, m.nome_completo), coalesce(v_cpf, m.cpf),
             coalesce(v_celular, m.celular), coalesce(v_placa, m.placa), coalesce(v_modal, m.modal),
             coalesce(v_galpao, m.galpao),
             case when v_tem_rotas then coalesce(v_qtd, 0) > 0 else m.realizou_rotas end,
             case when v_tem_rotas then v_qtd else m.qtd_rotas end,
             case when v_tem_rotas then v_ultima else m.ultima_rota end);
      if found then
        v_atualizados := v_atualizados + 1;
      end if;

      -- Status: só segue o CRM quando o status do CRM mudou desde a última sincronização.
      if v_m.crm_status is distinct from v_crm_status then
        v_novo := coalesce(v_status, 'inativo');
        if v_novo = 'inativo' and v_m.status = 'ativo' then
          v_obs := left('Inativado no CRM'
                        || case when v_crm_status = 'ativo' then '' else ' (' || coalesce(v_crm_status, 'sem status') || ')' end
                        || coalesce(': ' || v_motivo_crm, ''), 500);
          update public.motoristas m set
            status = 'inativo', inativo_desde = v_hoje, motivo_inativacao = 'Outro',
            atualizado_em = now(), atualizado_por = null
          where m.id = v_m.id;
          insert into public.motorista_historico
            (motorista_id, galpao, status_anterior, status_novo, motivo, observacao,
             alterado_por, alterado_por_nome, alterado_em, origem)
          values
            (v_m.id, coalesce(v_galpao, v_m.galpao), 'ativo', 'inativo', 'Outro', v_obs,
             null, 'CRM', now(), 'planilha');
          v_inativados := v_inativados + 1;
        elsif v_novo = 'ativo' and v_m.status = 'inativo' then
          update public.motoristas m set
            status = 'ativo', inativo_desde = null, motivo_inativacao = null,
            atualizado_em = now(), atualizado_por = null
          where m.id = v_m.id;
          insert into public.motorista_historico
            (motorista_id, galpao, status_anterior, status_novo, motivo, observacao,
             alterado_por, alterado_por_nome, alterado_em, origem)
          values
            (v_m.id, coalesce(v_galpao, v_m.galpao), 'inativo', 'ativo', 'Outro', 'Reativado no CRM',
             null, 'CRM', now(), 'planilha');
          v_reativados := v_reativados + 1;
        end if;
        update public.motoristas m set crm_status = v_crm_status where m.id = v_m.id;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_object('linha', v_linha, 'erro', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'novos', v_novos, 'atualizados', v_atualizados, 'inativados', v_inativados,
    'reativados', v_reativados, 'ignorados', v_ignorados, 'erros', v_erros
  );
end;
$$;

revoke all on function public.sincronizar_base_crm(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_base_crm(jsonb) to service_role;
