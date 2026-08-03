delete from public.exames a using public.exames b
where a.id_origem is not null
and a.id_origem = b.id_origem
and a.id < b.id;

create unique index if not exists exames_id_origem_uq on public.exames(id_origem) where id_origem is not null;
