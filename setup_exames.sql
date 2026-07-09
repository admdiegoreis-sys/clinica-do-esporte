create table if not exists public.exames (
  id bigserial primary key,
  id_origem bigint,
  rex_id bigint,
  tipo text,
  situacao text,
  exec text,
  dt_requisicao timestamptz,
  previsao timestamptz,
  paciente text,
  cp text,
  lado text,
  exame text,
  convenio text,
  solicitante text,
  laudista text,
  executante text,
  usuario_resp_rex text,
  tecnico text,
  setor text,
  usuario_digitou text,
  data_hora_digitacao timestamptz,
  log_usuario_laudo text,
  usuario_resp_laudo text,
  data_laudo timestamptz,
  medico_autenticador text,
  medico_revisor text,
  empresa text,
  lote_importacao text,
  importado_em timestamptz not null default now()
);

create index if not exists exames_dt_requisicao_idx on public.exames(dt_requisicao desc);
create index if not exists exames_situacao_idx on public.exames(situacao);
create index if not exists exames_convenio_idx on public.exames(convenio);
create index if not exists exames_setor_idx on public.exames(setor);
create index if not exists exames_exame_idx on public.exames(exame);
create index if not exists exames_solicitante_idx on public.exames(solicitante);
create index if not exists exames_paciente_idx on public.exames(paciente);
create index if not exists exames_lote_importacao_idx on public.exames(lote_importacao);

alter table public.exames enable row level security;

drop policy if exists "exames_select" on public.exames;
drop policy if exists "exames_insert" on public.exames;
drop policy if exists "exames_update" on public.exames;
drop policy if exists "exames_delete" on public.exames;

create policy "exames_select"
on public.exames for select
to anon
using (true);

create policy "exames_insert"
on public.exames for insert
to anon
with check (true);

create policy "exames_update"
on public.exames for update
to anon
using (true)
with check (true);

create policy "exames_delete"
on public.exames for delete
to anon
using (true);

notify pgrst, 'reload schema';
