-- =====================================================================
-- Telefone de contato dos usuários do app (dispatchers e admins).
-- Só dígitos (DDD + número, opcionalmente com 55). Visível para o próprio
-- usuário e para admins (mesma RLS de perfis).
-- =====================================================================
alter table public.perfis
  add column telefone text check (telefone is null or telefone ~ '^\d{10,13}$');
