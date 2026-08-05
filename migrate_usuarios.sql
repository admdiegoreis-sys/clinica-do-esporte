create table if not exists public.usuarios (
  id serial primary key,
  nome text not null,
  email text not null unique,
  senha_hash text not null,
  papel text not null default 'usuario' check (papel in ('admin', 'usuario')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz
);

create table if not exists public.acessos_log (
  id serial primary key,
  usuario_id integer references public.usuarios(id) on delete set null,
  email_tentativa text not null,
  sucesso boolean not null,
  motivo text,
  ip text,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_acessos_log_email on public.acessos_log (email_tentativa, criado_em desc);
create index if not exists idx_acessos_log_criado_em on public.acessos_log (criado_em desc);
