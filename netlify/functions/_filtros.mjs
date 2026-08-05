import { FILTRO_EMPRESAS } from "./_db.mjs";

/** Fuso do cliente. As agregacoes por data precisam bater com o que o navegador
 *  mostrava antes (o front agrupava usando a data local, nao UTC). */
export const TZ = "America/Sao_Paulo";

const EQ_FILTERS = {
  convenio: "convenio",
  setor: "setor",
  exame: "exame",
  situacao: "situacao",
  laudista: "laudista",
  executante: "executante",
  tecnico: "tecnico",
  empresa: "empresa",
  origem: "origem",
};

/** Expressao que reproduz categoriaExame() do app.js (grafico "por categoria"). */
export const EXPR_CATEGORIA = `
  case
    when upper(btrim(coalesce(tipo_exame,''))) = 'RM' then 'Ressonância Magnética'
    when upper(btrim(coalesce(tipo_exame,''))) = 'TC' then 'Tomografia Computadorizada'
    when upper(btrim(coalesce(tipo_exame,''))) = 'RX' then 'Raio-X'
    when upper(btrim(coalesce(tipo_exame,''))) = 'EN' then 'Eletroneuromiografia'
    when upper(btrim(coalesce(tipo_exame,''))) = 'DE' then 'Densitometria Óssea'
    when btrim(coalesce(tipo_exame,'')) <> '' then upper(btrim(tipo_exame))
    when upper(split_part(btrim(coalesce(exame,'')), ' ', 1)) = 'RM' then 'Ressonância Magnética'
    when upper(split_part(btrim(coalesce(exame,'')), ' ', 1)) = 'TC' then 'Tomografia Computadorizada'
    when upper(split_part(btrim(coalesce(exame,'')), ' ', 1)) = 'ENMG' then 'Eletroneuromiografia'
    when upper(coalesce(exame,'')) like 'DENSITOMETRIA%' then 'Densitometria Óssea'
    else 'Outros'
  end`;

/** Reproduz grupoCategoria() usado pelo filtro "Categoria" (Imagem/Laboratório). */
export const EXPR_GRUPO = `
  case
    when categoria_exame is not null and categoria_exame <> '' then categoria_exame
    when tipo_exame is not null and btrim(tipo_exame) <> '' then 'Imagem'
    else 'Outros'
  end`;

/** Reproduz normalizeName(): trim, colapsa espacos, maiusculas. */
export const EXPR_PACIENTE_NORM = `upper(regexp_replace(btrim(coalesce(paciente,'')), '\\s+', ' ', 'g'))`;

/** countBy() do app.js troca nulo E vazio por travessao. */
export const semValor = (col) => `case when ${col} is null or ${col} = '' then '—' else ${col} end`;

/** Data local (nao UTC) — igual ao localDateKey() do front. */
export const DATA_LOCAL = `(dt_requisicao at time zone '${TZ}')::date`;

/**
 * Monta o WHERE compartilhado por todos os endpoints de leitura.
 * Sempre inclui o filtro de unidades ocultas.
 */
export function buildWhere(params) {
  const clauses = [FILTRO_EMPRESAS];
  const values = [];
  const add = (clause, value) => {
    values.push(value);
    clauses.push(clause.replace("$$", `$${values.length}`));
  };

  if (params.dataIni) add(`dt_requisicao >= $$::date`, params.dataIni);
  if (params.dataFim) add(`dt_requisicao < ($$::date + interval '1 day')`, params.dataFim);
  if (params.laudoDataIni) add(`data_laudo >= $$::date`, params.laudoDataIni);
  if (params.laudoDataFim) add(`data_laudo < ($$::date + interval '1 day')`, params.laudoDataFim);

  Object.entries(EQ_FILTERS).forEach(([param, col]) => {
    if (params[param]) add(`${col} = $$`, params[param]);
  });

  if (params.tipoExame) add(`upper(trim(tipo_exame)) = $$`, params.tipoExame.toUpperCase());
  if (params.paciente) add(`paciente ilike $$`, `%${params.paciente}%`);
  if (params.solicitante) add(`solicitante ilike $$`, `%${params.solicitante}%`);
  if (params.busca) {
    add(
      `(coalesce(paciente,'') || ' ' || coalesce(exame,'') || ' ' || coalesce(solicitante,'') || ' ' || coalesce(laudista,'') || ' ' || coalesce(convenio,'')) ilike $$`,
      `%${params.busca}%`
    );
  }
  if (params.categoria) add(`(${EXPR_GRUPO}) = $$`, params.categoria);

  return { where: `where ${clauses.join(" and ")}`, values };
}
