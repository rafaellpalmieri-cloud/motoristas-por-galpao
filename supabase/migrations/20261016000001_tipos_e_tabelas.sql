-- =====================================================================
-- Motoristas por Galpão — tipos e tabelas
-- Dados pessoais permitidos: nome, e-mail (usuários), celular e placa (motoristas).
-- NÃO guardar CPF, RG ou endereço em nenhuma tabela.
-- =====================================================================

create type public.app_role as enum ('admin', 'dispatcher');

-- Lista oficial de galpões. Usada nos CHECKs e na importação.
create or replace function public.galpoes_validos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['SRJ1','SRJ2','SRJ4','SRJ5','SRJ8','SRJ9','SRJ10','SRJ13','SRJ17','HUB']::text[];
$$;

-- ---------------------------------------------------------------------
-- Perfis dos usuários do app (papéis ficam em user_roles, nunca aqui)
-- ---------------------------------------------------------------------
create table public.perfis (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  nome              text not null,
  email             text not null,
  ativo             boolean not null default true,
  trocar_senha      boolean not null default true,
  -- Até quando o usuário já viu os alertas de inativação (sino).
  alertas_vistos_em timestamptz not null default now(),
  criado_em         timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role    public.app_role not null,
  primary key (user_id, role)
);

create table public.dispatcher_galpoes (
  user_id uuid not null references auth.users (id) on delete cascade,
  galpao  text not null check (galpao = any (public.galpoes_validos())),
  primary key (user_id, galpao)
);

-- ---------------------------------------------------------------------
-- Motoristas
-- ---------------------------------------------------------------------
create table public.motoristas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique,
  nome_completo     text,
  celular           text,
  placa             text,
  modal             text,
  galpao            text check (galpao is null or galpao = any (public.galpoes_validos())),
  status            text not null check (status in ('ativo', 'inativo')),
  inativo_desde     date,
  -- Último motivo de inativação (cópia do histórico, para exibir na lista).
  motivo_inativacao text,
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid references auth.users (id) on delete set null
);

create table public.motorista_historico (
  id                bigint generated always as identity primary key,
  motorista_id      uuid not null references public.motoristas (id) on delete cascade,
  galpao            text,
  status_anterior   text,
  status_novo       text not null,
  motivo            text,
  observacao        text,
  alterado_por      uuid references auth.users (id) on delete set null,
  -- Nome de quem alterou, gravado no momento (dispatcher não lê perfis de outros).
  alterado_por_nome text,
  alterado_em       timestamptz not null default now()
);

alter table public.perfis              enable row level security;
alter table public.user_roles          enable row level security;
alter table public.dispatcher_galpoes  enable row level security;
alter table public.motoristas          enable row level security;
alter table public.motorista_historico enable row level security;
