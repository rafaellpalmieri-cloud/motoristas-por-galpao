-- =====================================================================
-- Mesma pessoa com várias placas.
--  - Cada placa continua sendo um cadastro (código), como na planilha/Coopmetro.
--  - pessoa_id agrupa os cadastros da mesma pessoa: pelo CPF; sem CPF, pelo
--    celular. É um uuid aleatório (não revela CPF nem celular).
--  - Inativar/solicitar/decidir em lote: o motorista inteiro (todas as
--    placas) ou só algumas placas.
-- =====================================================================

alter table public.motoristas add column pessoa_id uuid;
create index motoristas_pessoa_idx on public.motoristas (pessoa_id);

-- Dispatcher pode ler o agrupamento (colunas liberadas por coluna desde a 0012).
grant select (pessoa_id) on public.motoristas to authenticated;

create or replace function public.definir_pessoa_motorista()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cel    text := nullif(right(regexp_replace(coalesce(new.celular, ''), '\D', '', 'g'), 11), '');
  v_pessoa uuid;
begin
  if new.cpf is not null then
    -- Mesmo CPF = mesma pessoa.
    select m.pessoa_id into v_pessoa from public.motoristas m
    where m.cpf = new.cpf and m.id <> new.id and m.pessoa_id is not null
    limit 1;
    if v_pessoa is not null then
      new.pessoa_id := v_pessoa;
    elsif new.pessoa_id is null or exists (
      -- O grupo atual tem outro CPF (ex.: celular de família): separa.
      select 1 from public.motoristas m
      where m.pessoa_id = new.pessoa_id and m.id <> new.id and m.cpf is not null and m.cpf <> new.cpf
    ) then
      new.pessoa_id := gen_random_uuid();
    end if;
  elsif new.pessoa_id is null then
    -- Sem CPF: junta pelo celular (só com quem também não tem CPF diferente).
    if v_cel is not null then
      select m.pessoa_id into v_pessoa from public.motoristas m
      where m.id <> new.id and m.pessoa_id is not null
        and right(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g'), 11) = v_cel
      order by (m.cpf is null) desc
      limit 1;
    end if;
    new.pessoa_id := coalesce(v_pessoa, gen_random_uuid());
  end if;
  return new;
end;
$$;
revoke all on function public.definir_pessoa_motorista() from public, anon, authenticated;

create trigger motoristas_definir_pessoa
  before insert or update of cpf, celular on public.motoristas
  for each row execute function public.definir_pessoa_motorista();

-- Preenche quem já existe: por CPF, depois por celular, senão sozinho.
with grupos as (
  select m.id,
         coalesce('cpf:' || m.cpf,
                  'cel:' || nullif(right(regexp_replace(coalesce(m.celular, ''), '\D', '', 'g'), 11), ''),
                  'id:' || m.id::text) as chave
  from public.motoristas m
),
ids as (
  select chave, gen_random_uuid() as pessoa from (select distinct chave from grupos) d
)
update public.motoristas m set pessoa_id = ids.pessoa
from grupos g join ids on ids.chave = g.chave
where g.id = m.id;

-- ---------------------------------------------------------------------
-- Pedidos agrupados
-- ---------------------------------------------------------------------
alter table public.solicitacoes_inativacao add column grupo uuid;
create index solicitacoes_grupo_idx on public.solicitacoes_inativacao (grupo);

-- Dispatcher (ou admin) pede a inativação de uma ou mais placas.
create or replace function public.solicitar_inativacao_lote(
  p_motorista_ids uuid[], p_motivo text, p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_id    uuid;
  v_sol   public.solicitacoes_inativacao;
begin
  if coalesce(cardinality(p_motorista_ids), 0) = 0 then
    raise exception 'Escolha ao menos uma placa.' using errcode = '22023';
  end if;
  if cardinality(p_motorista_ids) > 20 then
    raise exception 'Máximo de 20 placas por pedido.' using errcode = '22023';
  end if;
  foreach v_id in array p_motorista_ids loop
    v_sol := public.solicitar_inativacao(v_id, p_motivo, p_observacao);
    update public.solicitacoes_inativacao s set grupo = v_grupo where s.id = v_sol.id;
  end loop;
  return v_grupo;
end;
$$;

-- Admin aprova/recusa todas as placas pendentes do grupo.
create or replace function public.decidir_grupo_inativacao(
  p_grupo uuid, p_aprovar boolean, p_resposta text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_n  integer := 0;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores aprovam ou recusam solicitações.' using errcode = '42501';
  end if;
  for v_id in
    select s.id from public.solicitacoes_inativacao s where s.grupo = p_grupo and s.status = 'pendente' order by s.id
  loop
    perform public.decidir_solicitacao_inativacao(v_id, p_aprovar, p_resposta);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Nenhuma solicitação pendente neste pedido.' using errcode = '22023';
  end if;
  return v_n;
end;
$$;

-- Quem pediu (ou admin) cancela as placas pendentes do grupo.
create or replace function public.cancelar_grupo_inativacao(p_grupo uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_n  integer := 0;
begin
  for v_id in
    select s.id from public.solicitacoes_inativacao s where s.grupo = p_grupo and s.status = 'pendente' order by s.id
  loop
    perform public.cancelar_solicitacao_inativacao(v_id);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Nenhuma solicitação pendente neste pedido.' using errcode = '22023';
  end if;
  return v_n;
end;
$$;

-- Admin inativa direto (ou qualquer um reativa) várias placas de uma vez.
create or replace function public.alterar_status_lote(
  p_motorista_ids uuid[], p_novo_status text, p_motivo text default null, p_observacao text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  if coalesce(cardinality(p_motorista_ids), 0) = 0 then
    raise exception 'Escolha ao menos uma placa.' using errcode = '22023';
  end if;
  if cardinality(p_motorista_ids) > 20 then
    raise exception 'Máximo de 20 placas por vez.' using errcode = '22023';
  end if;
  foreach v_id in array p_motorista_ids loop
    perform public.alterar_status_motorista(v_id, p_novo_status, p_motivo, p_observacao);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.solicitar_inativacao_lote(uuid[], text, text) from public, anon;
revoke all on function public.decidir_grupo_inativacao(uuid, boolean, text) from public, anon;
revoke all on function public.cancelar_grupo_inativacao(uuid) from public, anon;
revoke all on function public.alterar_status_lote(uuid[], text, text, text) from public, anon;
grant execute on function public.solicitar_inativacao_lote(uuid[], text, text) to authenticated;
grant execute on function public.decidir_grupo_inativacao(uuid, boolean, text) to authenticated;
grant execute on function public.cancelar_grupo_inativacao(uuid) to authenticated;
grant execute on function public.alterar_status_lote(uuid[], text, text, text) to authenticated;
