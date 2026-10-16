-- =====================================================================
-- Cria o PRIMEIRO ADMIN do app.
--
-- 1. No painel do Supabase: Authentication > Users > Add user > Create new user
--    (e-mail + senha, marque "Auto Confirm User").
-- 2. Troque os dois valores abaixo (e-mail e nome).
-- 3. Cole este arquivo no SQL Editor e clique em Run.
--
-- Pode rodar de novo sem problema (é idempotente).
-- =====================================================================
do $$
declare
  v_email text := 'COLOQUE_SEU_EMAIL_AQUI@exemplo.com';
  v_nome  text := 'Seu Nome';
  v_uid   uuid;
begin
  select u.id into v_uid from auth.users u where lower(u.email) = lower(v_email);

  if v_uid is null then
    raise exception 'Usuário % não encontrado. Crie-o antes em Authentication > Users.', v_email;
  end if;

  insert into public.perfis (user_id, nome, email, ativo, trocar_senha)
  values (v_uid, v_nome, lower(v_email), true, false)
  on conflict (user_id) do update set ativo = true, nome = excluded.nome;

  insert into public.user_roles (user_id, role)
  values (v_uid, 'admin')
  on conflict do nothing;

  raise notice 'Pronto: % agora é admin.', v_email;
end;
$$;
