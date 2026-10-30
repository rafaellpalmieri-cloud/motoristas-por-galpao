-- =====================================================================
-- CRM direto do Supabase dele (decisão de 30/10/2026), no lugar da aba
-- BASE - SUPABASE.
--  - A Edge Function sincronizar-crm lê a visão app_frota.motoristas do CRM
--    (usuário só-leitura) a cada 5 minutos e usa sincronizar_base_crm.
--  - As rotas continuam vindo da aba BASE - POWER BI pelo Apps Script, agora
--    numa chamada própria (sincronizar_rotas_cpf), já somadas por CPF.
-- =====================================================================

-- ---------------------------------------------------------------------
-- BASE - POWER BI → rotas por CPF (só service_role / Edge Function).
-- Linha: { cpf, qtd_rotas, ultima_rota }. CPF fora da lista não é tocado.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_rotas_cpf(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item        jsonb;
  v_cpf         text;
  v_qtd         integer;
  v_ultima      date;
  v_n           integer;
  v_atualizados integer := 0;
  v_sem_cadastro integer := 0;
  v_erros       integer := 0;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Formato inválido: esperado um array de linhas.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Lote muito grande (máximo 1000 linhas por envio).' using errcode = '22023';
  end if;

  for v_item in select t.dado from jsonb_array_elements(p_linhas) as t(dado)
  loop
    begin
      v_cpf := public.normalizar_cpf(v_item ->> 'cpf');
      if v_cpf is null then
        raise exception 'CPF inválido';
      end if;
      v_qtd := greatest(coalesce(nullif(btrim(v_item ->> 'qtd_rotas'), '')::integer, 0), 0);
      begin
        v_ultima := public.converter_data_csv(v_item ->> 'ultima_rota');
      exception when others then
        v_ultima := null;
      end;

      update public.motoristas m set
        realizou_rotas = v_qtd > 0,
        qtd_rotas      = v_qtd,
        ultima_rota    = v_ultima
      where m.cpf = v_cpf
        and (m.realizou_rotas, m.qtd_rotas, m.ultima_rota) is distinct from (v_qtd > 0, v_qtd, v_ultima);
      get diagnostics v_n = row_count;
      v_atualizados := v_atualizados + v_n;
      if v_n = 0 and not exists (select 1 from public.motoristas m where m.cpf = v_cpf) then
        v_sem_cadastro := v_sem_cadastro + 1;
      end if;
    exception when others then
      v_erros := v_erros + 1;
    end;
  end loop;

  return jsonb_build_object('atualizados', v_atualizados, 'sem_cadastro', v_sem_cadastro, 'erros', v_erros);
end;
$$;

revoke all on function public.sincronizar_rotas_cpf(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_rotas_cpf(jsonb) to service_role;

-- ---------------------------------------------------------------------
-- pg_cron → Edge Function sincronizar-crm. Usa o mesmo endereço e token do
-- Vault dos avisos (notificar_url / notificar_token), trocando só o nome da função.
-- ---------------------------------------------------------------------
create or replace function public.disparar_sincronizacao_crm()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_token text;
begin
  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return;
  end if;
  perform net.http_post(
    url     := regexp_replace(v_url, '/functions/v1/.*$', '/functions/v1/sincronizar-crm'),
    body    := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token),
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.disparar_sincronizacao_crm() from public, anon, authenticated;

-- A cada 5 minutos.
select cron.schedule('sincronizar-crm', '*/5 * * * *', $$select public.disparar_sincronizacao_crm()$$);
