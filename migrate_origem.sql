alter table public.exames add column if not exists origem text;

update public.exames set origem = 'excel' where lote_importacao like 'imp_%' and origem is null;
update public.exames set origem = 'firebird' where lote_importacao like 'sync_%' and origem is null;

create index if not exists exames_origem_idx on public.exames(origem);
