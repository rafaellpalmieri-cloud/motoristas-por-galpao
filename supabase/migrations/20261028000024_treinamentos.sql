-- =====================================================================
-- Treinamentos (decisão de 28/10/2026)
--  - O admin continua marcando com a skill /marcar-treinamento (CRM, Google
--    Agenda, WhatsApp). O Apps Script lê as agendas dos galpões e manda os
--    eventos "TREINAMENTO ..." para cá (sincronizar_treinamentos).
--  - Dispatcher vê os treinamentos dos galpões dele e, depois do horário,
--    marca Compareceu ou Faltou. Admin vê todos e pode corrigir.
--  - Avisos: treinamento novo → dispatchers do galpão; "Faltou" → admins.
--    No sino: trein:<id> (dispatcher, treinamento novo) e falta:<id> (admin).
-- =====================================================================

create table public.treinamentos (
  id                bigint generated always as identity primary key,
  evento_id         text not null unique check (length(evento_id) <= 300),
  galpao            text not null check (galpao = any (public.galpoes_validos())),
  nome              text check (nome is null or length(nome) <= 200),
  telefone          text check (telefone is null or telefone ~ '^\d{8,13}$'),
  inicio            timestamptz not null,
  status            text not null default 'agendado' check (status in ('agendado', 'cancelado')),
  presenca          text check (presenca is null or presenca in ('compareceu', 'faltou')),
  presenca_obs      text check (presenca_obs is null or length(presenca_obs) <= 500),
  presenca_por      uuid references auth.users (id) on delete set null,
  presenca_por_nome text,
  presenca_em       timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create index treinamentos_galpao_inicio_idx on public.treinamentos (galpao, inicio);
create index treinamentos_inicio_idx on public.treinamentos (inicio);

alter table public.treinamentos enable row level security;
revoke all on public.treinamentos from anon, authenticated;
grant select on public.treinamentos to authenticated;
grant select on public.treinamentos to service_role;

create policy treinamentos_select on public.treinamentos
  for select to authenticated
  using (public.pode_gerir_galpao(galpao));

-- ---------------------------------------------------------------------
-- Agenda → app (só service_role / Edge Function).
-- p_eventos: [{ evento_id, galpao, nome, telefone, inicio }]
-- Eventos agendados entre p_de e p_ate que não vieram na lista viram cancelados.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_treinamentos(p_eventos jsonb, p_de timestamptz, p_ate timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item       jsonb;
  v_evento     text;
  v_galpao     text;
  v_nome       text;
  v_tel        text;
  v_inicio     timestamptz;
  v_ids        text[] := '{}';
  v_novos      integer := 0;
  v_atualizados integer := 0;
  v_cancelados integer := 0;
  v_erros      jsonb := '[]'::jsonb;
begin
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then
    raise exception 'Formato inválido: esperado um array de eventos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_eventos) > 2000 then
    raise exception 'Muitos eventos de uma vez (máximo 2000).' using errcode = '22023';
  end if;
  if p_de is null or p_ate is null or p_ate <= p_de or p_ate - p_de > interval '120 days' then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_eventos) loop
    begin
      v_evento := nullif(left(btrim(coalesce(v_item ->> 'evento_id', '')), 300), '');
      v_galpao := upper(btrim(coalesce(v_item ->> 'galpao', '')));
      v_nome   := nullif(upper(left(btrim(coalesce(v_item ->> 'nome', '')), 200)), '');
      v_tel    := nullif(regexp_replace(coalesce(v_item ->> 'telefone', ''), '\D', '', 'g'), '');
      if v_tel !~ '^\d{8,13}$' then v_tel := null; end if;
      v_inicio := (v_item ->> 'inicio')::timestamptz;
      if v_evento is null or v_inicio is null then
        raise exception 'evento sem id ou horário';
      end if;
      if not (v_galpao = any (public.galpoes_validos())) then
        raise exception 'galpão inválido';
      end if;
      v_ids := v_ids || v_evento;

      insert into public.treinamentos (evento_id, galpao, nome, telefone, inicio)
      values (v_evento, v_galpao, v_nome, v_tel, v_inicio)
      on conflict (evento_id) do nothing;
      if found then
        v_novos := v_novos + 1;
      else
        update public.treinamentos t set
          galpao = v_galpao, nome = v_nome, telefone = v_tel, inicio = v_inicio,
          status = 'agendado', atualizado_em = now()
        where t.evento_id = v_evento
          and (t.galpao, t.nome, t.telefone, t.inicio, t.status)
              is distinct from (v_galpao, v_nome, v_tel, v_inicio, 'agendado');
        if found then v_atualizados := v_atualizados + 1; end if;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_object('evento', left(coalesce(v_item ->> 'evento_id', '?'), 60), 'erro', sqlerrm);
    end;
  end loop;

  update public.treinamentos t set status = 'cancelado', atualizado_em = now()
  where t.status = 'agendado' and t.inicio >= p_de and t.inicio < p_ate
    and not (t.evento_id = any (v_ids));
  get diagnostics v_cancelados = row_count;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados,
                            'cancelados', v_cancelados, 'erros', v_erros);
end;
$$;
revoke all on function public.sincronizar_treinamentos(jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.sincronizar_treinamentos(jsonb, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- Compareceu / Faltou. Só depois do horário. Dispatcher marca uma vez;
-- admin pode corrigir (ou limpar, com p_presenca nulo).
-- ---------------------------------------------------------------------
create or replace function public.marcar_presenca_treinamento(p_id bigint, p_presenca text, p_observacao text default null)
returns public.treinamentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.treinamentos;
  v_obs  text := nullif(btrim(p_observacao), '');
  v_nome text;
begin
  if v_uid is null or not public.usuario_ativo(v_uid) then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if p_presenca is not null and p_presenca not in ('compareceu', 'faltou') then
    raise exception 'Presença inválida.' using errcode = '22023';
  end if;
  if p_presenca is null and not public.eh_admin() then
    raise exception 'Só o admin pode limpar a presença.' using errcode = '42501';
  end if;
  if v_obs is not null and length(v_obs) > 500 then
    raise exception 'Observação muito longa (máximo 500 caracteres).' using errcode = '22023';
  end if;

  select * into v_t from public.treinamentos t where t.id = p_id for update;
  if v_t.id is null or not public.pode_gerir_galpao(v_t.galpao) then
    raise exception 'Treinamento não encontrado.' using errcode = '42501';
  end if;
  if v_t.status <> 'agendado' then
    raise exception 'Este treinamento foi cancelado.' using errcode = '22023';
  end if;
  if v_t.inicio > now() then
    raise exception 'A presença só pode ser marcada depois do horário do treinamento.' using errcode = '22023';
  end if;
  if v_t.presenca is not null and not public.eh_admin() then
    raise exception 'A presença já foi marcada. Para corrigir, fale com o admin.' using errcode = '42501';
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  update public.treinamentos t set
    presenca          = p_presenca,
    presenca_obs      = case when p_presenca is null then null else v_obs end,
    presenca_por      = case when p_presenca is null then null else v_uid end,
    presenca_por_nome = case when p_presenca is null then null else v_nome end,
    presenca_em       = case when p_presenca is null then null else now() end,
    atualizado_em     = now()
  where t.id = p_id
  returning * into v_t;
  return v_t;
end;
$$;
revoke all on function public.marcar_presenca_treinamento(bigint, text, text) from public, anon;
grant execute on function public.marcar_presenca_treinamento(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Avisos (push) pela função notificar-movimentacao.
-- ---------------------------------------------------------------------
create or replace function public.disparar_notificacao_treinamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_token  text;
  v_evento text;
begin
  if tg_op = 'INSERT' and new.status = 'agendado' and new.inicio > now() then
    v_evento := 'novo';
  elsif tg_op = 'UPDATE' and new.presenca = 'faltou' and old.presenca is distinct from 'faltou' then
    v_evento := 'faltou';
  else
    return new;
  end if;

  select s.decrypted_secret into v_url   from vault.decrypted_secrets s where s.name = 'notificar_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'notificar_token';
  if v_url is null or v_token is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('treinamento_id', new.id, 'evento', v_evento),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token)
  );
  return new;
exception when others then
  raise warning 'aviso de treinamento não enviado (%): %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function public.disparar_notificacao_treinamento() from public, anon, authenticated;

create trigger treinamentos_notificar
  after insert or update of presenca on public.treinamentos
  for each row execute function public.disparar_notificacao_treinamento();

-- ---------------------------------------------------------------------
-- Sino: trein:<id> (dispatcher, treinamento novo ainda por acontecer) e
-- falta:<id> (admin, "Faltou" marcado nos últimos 30 dias).
-- ---------------------------------------------------------------------
create or replace function public.marcar_alertas_lidos(p_chaves text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if coalesce(cardinality(p_chaves), 0) = 0 then
    return 0;
  end if;
  if cardinality(p_chaves) > 2000 then
    raise exception 'Muitos alertas de uma vez (máximo 2000).' using errcode = '22023';
  end if;
  insert into public.alertas_lidos (user_id, chave)
  select auth.uid(), c from unnest(p_chaves) c
  where c ~ '^(mov|rota|pedido|trein|falta):[0-9a-f:-]{1,110}$'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.alertas_nao_lidos()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  with lidos as (select l.chave from public.alertas_lidos l where l.user_id = (select auth.uid()))
  select (
    (select count(*) from public.motorista_historico h
      where h.status_novo = 'inativo'
        and h.alterado_em > now() - interval '30 days'
        and (h.alterado_por is null or h.alterado_por <> (select auth.uid()))
        and ('mov:' || h.id) not in (select chave from lidos))
    +
    (select count(*) from public.motoristas m
      where m.status = 'ativo'
        and m.ultima_rota is not null
        and not (m.realizou_rotas = false or coalesce(m.qtd_rotas, 1) = 0)
        and m.ultima_rota <= (now() at time zone 'America/Sao_Paulo')::date - public.dias_corte_sem_rota()
        and ('rota:' || m.id || ':' || m.ultima_rota) not in (select chave from lidos))
    +
    (select count(distinct coalesce(s.grupo::text, s.id::text)) from public.solicitacoes_inativacao s
      where s.solicitado_por = (select auth.uid())
        and s.status in ('aprovada', 'recusada')
        and s.decidido_em > now() - interval '30 days'
        and ('pedido:' || coalesce(s.grupo::text, s.id::text)) not in (select chave from lidos))
    +
    (select count(*) from public.treinamentos t
      where not public.eh_admin()
        and t.status = 'agendado'
        and t.inicio > now()
        and ('trein:' || t.id) not in (select chave from lidos))
    +
    (select count(*) from public.treinamentos t
      where public.eh_admin()
        and t.presenca = 'faltou'
        and t.presenca_em > now() - interval '30 days'
        and ('falta:' || t.id) not in (select chave from lidos))
  )::integer;
$$;
