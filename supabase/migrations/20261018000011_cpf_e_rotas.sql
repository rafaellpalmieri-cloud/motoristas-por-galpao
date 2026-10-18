-- =====================================================================
-- CPF e dados de rota dos motoristas (decisão do responsável pelo app em
-- 18/10/2026, substituindo a regra original de não guardar CPF).
-- Visibilidade: a mesma dos motoristas (RLS por galpão). RG e endereço
-- continuam fora do app. O CPF não vai para WhatsApp nem para a aba de
-- movimentações.
-- =====================================================================

alter table public.motoristas
  add column cpf            text check (cpf is null or cpf ~ '^\d{11}$'),
  add column realizou_rotas boolean,
  add column qtd_rotas      integer check (qtd_rotas is null or qtd_rotas >= 0),
  add column ultima_rota    date;

create index motoristas_cpf_idx on public.motoristas (cpf);

-- ---------------------------------------------------------------------
-- Conversões tolerantes (valor inválido vira nulo, sem derrubar a linha).
-- ---------------------------------------------------------------------
create or replace function public.normalizar_cpf(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Só dígitos; completa zeros à esquerda (planilha costuma perder o zero).
  select case
    when length(regexp_replace(coalesce(p_texto, ''), '\D', '', 'g')) between 9 and 11
      then lpad(regexp_replace(p_texto, '\D', '', 'g'), 11, '0')
  end;
$$;

create or replace function public.converter_sim_nao(p_texto text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim(coalesce(p_texto, '')))
    when 'SIM' then true when 'S' then true when 'TRUE' then true when '1' then true
    when 'NAO' then false when 'NÃO' then false when 'N' then false when 'FALSE' then false when '0' then false
  end;
$$;

create or replace function public.converter_inteiro(p_texto text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when btrim(coalesce(p_texto, '')) ~ '^\d{1,9}$' then btrim(p_texto)::integer end;
$$;

create or replace function public.converter_data_tolerante(p_texto text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return public.converter_data_csv(p_texto);
exception when others then
  return null;
end;
$$;

revoke all on function public.normalizar_cpf(text) from public, anon, authenticated;
revoke all on function public.converter_sim_nao(text) from public, anon, authenticated;
revoke all on function public.converter_inteiro(text) from public, anon, authenticated;
revoke all on function public.converter_data_tolerante(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Núcleo da importação (CSV e aba ATIVOS) com os campos novos.
-- Status e inativo_desde de quem já existe continuam intocados.
-- Campos novos em branco não apagam o valor que já existe.
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
        (codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde,
         cpf, realizou_rotas, qtd_rotas, ultima_rota, atualizado_em, atualizado_por)
      values (
        v_codigo,
        nullif(btrim(v_item ->> 'nome_completo'), ''),
        nullif(btrim(v_item ->> 'celular'), ''),
        nullif(upper(btrim(v_item ->> 'placa')), ''),
        nullif(btrim(v_item ->> 'modal'), ''),
        v_galpao,
        v_status,
        v_inativo,
        public.normalizar_cpf(v_item ->> 'cpf'),
        public.converter_sim_nao(v_item ->> 'realizou_rotas'),
        public.converter_inteiro(v_item ->> 'qtd_rotas'),
        public.converter_data_tolerante(v_item ->> 'ultima_rota'),
        now(),
        p_autor
      )
      on conflict (codigo) do update set
        nome_completo  = excluded.nome_completo,
        celular        = excluded.celular,
        placa          = excluded.placa,
        modal          = excluded.modal,
        galpao         = excluded.galpao,
        cpf            = coalesce(excluded.cpf, m.cpf),
        realizou_rotas = coalesce(excluded.realizou_rotas, m.realizou_rotas),
        qtd_rotas      = coalesce(excluded.qtd_rotas, m.qtd_rotas),
        ultima_rota    = coalesce(excluded.ultima_rota, m.ultima_rota)
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
-- Exportação com os campos novos (muda o formato de retorno).
-- ---------------------------------------------------------------------
drop function public.exportar_motoristas();

create function public.exportar_motoristas()
returns table (
  codigo                text,
  nome_completo         text,
  cpf                   text,
  celular               text,
  placa                 text,
  modal                 text,
  galpao                text,
  status                text,
  inativo_desde         date,
  motivo_inativacao     text,
  realizou_rotas        boolean,
  qtd_rotas             integer,
  ultima_rota           date,
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
    select m.codigo, m.nome_completo, m.cpf, m.celular, m.placa, m.modal, m.galpao, m.status,
           m.inativo_desde, m.motivo_inativacao, m.realizou_rotas, m.qtd_rotas, m.ultima_rota,
           m.atualizado_em, p.nome
    from public.motoristas m
    left join public.perfis p on p.user_id = m.atualizado_por
    order by m.galpao nulls first, m.nome_completo;
end;
$$;

revoke all on function public.exportar_motoristas() from public, anon;
grant execute on function public.exportar_motoristas() to authenticated;
