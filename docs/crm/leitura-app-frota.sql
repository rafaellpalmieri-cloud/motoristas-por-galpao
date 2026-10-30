-- =====================================================================
-- Rodar NO SUPABASE DO CRM (projeto "Loogirio"), no SQL Editor do painel.
-- NÃO é migração do app: este arquivo fica fora de supabase/migrations.
--
-- Cria um acesso SÓ DE LEITURA para o robô sincronizar-crm do LoogiRio Frota:
--  - schema "app_frota", fora da API (anon/authenticated não enxergam);
--  - visão "app_frota.motoristas" com só as colunas que o app usa
--    (nunca RG, endereço, filiação, renavam, chassi...);
--  - usuário "app_frota_leitura", que só pode ler essa visão.
--
-- A senha NÃO fica aqui. Use a versão com senha gerada no seu computador
-- (supabase/.crm_leitura.sql, fora do git) ou troque SENHA_AQUI por uma
-- senha longa e aleatória.
-- =====================================================================

create schema if not exists app_frota;
revoke all on schema app_frota from public, anon, authenticated;

create or replace view app_frota.motoristas as
select
  c.id,
  c.status,
  c.nome_completo,
  c.cpf,
  c.celular,
  c.galpao,
  c.tipo_veiculo,
  c.placa,
  c.id_coopmetro,
  c.encerramento_motivo,
  c.updated_at
from public.cadastros c;

revoke all on app_frota.motoristas from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_frota_leitura') then
    create role app_frota_leitura login password 'SENHA_AQUI'
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
      connection limit 3;
  else
    alter role app_frota_leitura password 'SENHA_AQUI';
  end if;
end
$$;

alter role app_frota_leitura set default_transaction_read_only = on;
alter role app_frota_leitura set statement_timeout = '30s';

grant usage on schema app_frota to app_frota_leitura;
grant select on app_frota.motoristas to app_frota_leitura;

-- Conferência: deve listar só a visão app_frota.motoristas.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'app_frota_leitura';

-- Para desligar o acesso de vez:
--   drop owned by app_frota_leitura; drop role app_frota_leitura;
