-- =====================================================================
-- Presença no treinamento exige comentário (decisão de 29/10/2026):
-- tanto Compareceu quanto Faltou só são salvos com um comentário de
-- pelo menos 3 caracteres (como foi o treino / motivo da falta).
-- Limpar a presença (só admin) continua sem comentário.
-- =====================================================================

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
  if p_presenca is not null and coalesce(length(v_obs), 0) < 3 then
    raise exception 'Escreva um comentário sobre o treinamento.' using errcode = '22023';
  end if;
  if v_obs is not null and length(v_obs) > 500 then
    raise exception 'Comentário muito longo (máximo 500 caracteres).' using errcode = '22023';
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
