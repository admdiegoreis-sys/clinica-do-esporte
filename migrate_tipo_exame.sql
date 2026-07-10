alter table public.exames add column if not exists tipo_exame text;
create index if not exists exames_tipo_exame_idx on public.exames(tipo_exame);
