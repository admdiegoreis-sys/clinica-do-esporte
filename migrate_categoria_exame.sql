alter table public.exames add column if not exists categoria_exame text;
create index if not exists exames_categoria_exame_idx on public.exames(categoria_exame);
