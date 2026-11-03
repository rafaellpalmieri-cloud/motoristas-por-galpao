-- =====================================================================
-- Remarcar treinamento pelo app (decisão de 03/11/2026)
--  - Dispatcher (galpões dele) e admin escolhem nova data e horário.
--  - Quem faltou pode ser remarcado: a presença volta a ficar em aberto.
--    Quem compareceu não é remarcado.
--  - O app não altera a Google Agenda. agenda_inicio guarda o último horário
--    visto lá: a agenda só muda o treinamento quando o horário DELA muda,
--    para a sincronização não desfazer a remarcação feita no app.
--  - O lembrete de 16 h vale de novo para o novo horário (lembrete_inicio).
-- =====================================================================

alter table public.treinamentos
  add column agenda_inicio      timestamptz,
  add column remarcado_de       timestamptz,
  add column remarcado_por_nome text,
  add column remarcado_em       timestamptz;

update public.treinamentos set agenda_inicio = inicio;

-- ---------------------------------------------------------------------
-- Agenda → app: mudança de horário na agenda vence e apaga a remarcação.
-- O cancelamento olha o horário da agenda: treinamento remarcado para dentro
-- da janela, com o evento já fora dela, não pode virar cancelado.
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

      insert into public.treinamentos (evento_id, galpao, nome, telefone, inicio, agenda_inicio)
      values (v_evento, v_galpao, v_nome, v_tel, v_inicio, v_inicio)
      on conflict (evento_id) do nothing;
      if found then
        v_novos := v_novos + 1;
      else
        update public.treinamentos t set
          galpao = v_galpao, nome = v_nome, telefone = v_tel,
          inicio             = case when t.agenda_inicio is distinct from v_inicio then v_inicio else t.inicio end,
          remarcado_de       = case when t.agenda_inicio is distinct from v_inicio then null else t.remarcado_de end,
          remarcado_por_nome = case when t.agenda_inicio is distinct from v_inicio then null else t.remarcado_por_nome end,
          remarcado_em       = case when t.agenda_inicio is distinct from v_inicio then null else t.remarcado_em end,
          agenda_inicio = v_inicio,
          status = 'agendado', atualizado_em = now()
        where t.evento_id = v_evento
          and (t.galpao, t.nome, t.telefone, t.agenda_inicio, t.status)
              is distinct from (v_galpao, v_nome, v_tel, v_inicio, 'agendado');
        if found then v_atualizados := v_atualizados + 1; end if;
      end if;
    exception when others then
      v_erros := v_erros || jsonb_build_object('evento', left(coalesce(v_item ->> 'evento_id', '?'), 60), 'erro', sqlerrm);
    end;
  end loop;

  update public.treinamentos t set status = 'cancelado', atualizado_em = now()
  where t.status = 'agendado'
    and coalesce(t.agenda_inicio, t.inicio) >= p_de and coalesce(t.agenda_inicio, t.inicio) < p_ate
    and not (t.evento_id = any (v_ids));
  get diagnostics v_cancelados = row_count;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados,
                            'cancelados', v_cancelados, 'erros', v_erros);
end;
$$;

-- ---------------------------------------------------------------------
-- Remarcar. A data fica no máximo 60 dias à frente, a mesma janela da tela.
-- ---------------------------------------------------------------------
create or replace function public.remarcar_treinamento(p_id bigint, p_inicio timestamptz)
returns public.treinamentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.treinamentos;
  v_nome text;
begin
  if v_uid is null or not public.usuario_ativo(v_uid) then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_t from public.treinamentos t where t.id = p_id for update;
  if v_t.id is null or not public.pode_gerir_galpao(v_t.galpao) then
    raise exception 'Treinamento não encontrado.' using errcode = '42501';
  end if;
  if v_t.status <> 'agendado' then
    raise exception 'Este treinamento foi cancelado.' using errcode = '22023';
  end if;
  if v_t.presenca = 'compareceu' then
    raise exception 'O motorista já compareceu a este treinamento.' using errcode = '22023';
  end if;
  if p_inicio is null or p_inicio <= now() then
    raise exception 'Escolha uma data e um horário no futuro.' using errcode = '22023';
  end if;
  if p_inicio > now() + interval '60 days' then
    raise exception 'Escolha uma data em até 60 dias.' using errcode = '22023';
  end if;
  if p_inicio = v_t.inicio then
    raise exception 'O treinamento já está nessa data e horário.' using errcode = '22023';
  end if;

  select p.nome into v_nome from public.perfis p where p.user_id = v_uid;

  update public.treinamentos t set
    inicio             = p_inicio,
    remarcado_de       = v_t.inicio,
    remarcado_por_nome = v_nome,
    remarcado_em       = now(),
    presenca           = null,
    presenca_obs       = null,
    presenca_por       = null,
    presenca_por_nome  = null,
    presenca_em        = null,
    atualizado_em      = now()
  where t.id = p_id
  returning * into v_t;
  return v_t;
end;
$$;
revoke all on function public.remarcar_treinamento(bigint, timestamptz) from public, anon;
grant execute on function public.remarcar_treinamento(bigint, timestamptz) to authenticated;
