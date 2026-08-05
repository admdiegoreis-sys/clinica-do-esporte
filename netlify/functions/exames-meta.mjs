import { getSql, json } from "./_db.mjs";
import { requireAuth } from "./_auth.mjs";

const DISTINCT_COLUMNS = {
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

const AUTOCOMPLETE_FIELDS = {
  paciente: "paciente",
  solicitante: "solicitante",
};

async function handleAutocomplete(sql, params, event) {
  const campo = AUTOCOMPLETE_FIELDS[params.autocomplete];
  if (!campo) return json(400, { error: "Campo de busca invalido." }, { event });
  const q = (params.q || "").trim();
  if (q.length < 2) return json(200, { options: [] }, { event });

  const rows = await sql.query(
    `select distinct ${campo} as v from public.exames where ${campo} ilike $1 order by ${campo} limit 20`,
    [`%${q}%`]
  );
  return json(200, { options: rows.map((r) => r.v) }, { event });
}

async function handleMeta(sql, event) {
  const distinctEntries = await Promise.all(
    Object.entries(DISTINCT_COLUMNS).map(async ([key, col]) => {
      const rows = await sql.query(
        `select distinct ${col} as v from public.exames where ${col} is not null and ${col} <> '' order by 1`
      );
      return [key, rows.map((r) => r.v)];
    })
  );

  const [tipoExameRows, categoriaRows, statusRows, lotesRows] = await Promise.all([
    sql.query(
      `select distinct upper(trim(tipo_exame)) as v from public.exames where tipo_exame is not null and trim(tipo_exame) <> '' order by 1`
    ),
    sql.query(`
      select distinct
        case
          when categoria_exame is not null and categoria_exame <> '' then categoria_exame
          when tipo_exame is not null and trim(tipo_exame) <> '' then 'Imagem'
          else 'Outros'
        end as v
      from public.exames
      order by 1
    `),
    sql.query(
      `select max(importado_em) as ultima_atualizacao, max(dt_requisicao) as ultimo_registro, count(*)::int as total from public.exames`
    ),
    sql.query(`
      select lote_importacao, count(*)::int as total, max(importado_em) as data
      from public.exames
      where lote_importacao is not null
      group by lote_importacao
      order by data desc nulls last
    `),
  ]);

  const filtros = Object.fromEntries(distinctEntries);
  filtros.tipoExame = tipoExameRows.map((r) => r.v);
  filtros.categoria = categoriaRows.map((r) => r.v);

  return json(200, {
    filtros,
    status: {
      ultimaAtualizacao: statusRows[0].ultima_atualizacao,
      ultimoRegistro: statusRows[0].ultimo_registro,
      total: statusRows[0].total,
    },
    lotes: lotesRows.map((l) => ({ lote: l.lote_importacao, total: l.total, data: l.data })),
  }, { event });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "GET") return json(405, { error: "Metodo nao permitido." }, { event });

  const user = await requireAuth(event);
  if (!user) return json(401, { error: "Nao autenticado." }, { event });

  try {
    const sql = getSql();
    const params = event.queryStringParameters || {};

    if (params.autocomplete) return await handleAutocomplete(sql, params, event);
    return await handleMeta(sql, event);
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
