import { getSql, json, quoteIdentifier } from "./_db.mjs";

const COLUMNS = [
  "id_origem", "rex_id", "tipo", "situacao", "exec", "dt_requisicao", "previsao",
  "paciente", "cp", "lado", "tipo_exame", "categoria_exame", "exame", "convenio", "solicitante", "laudista",
  "executante", "usuario_resp_rex", "tecnico", "setor", "usuario_digitou",
  "data_hora_digitacao", "log_usuario_laudo", "usuario_resp_laudo", "data_laudo",
  "medico_autenticador", "medico_revisor", "empresa", "lote_importacao", "origem",
];

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

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

function buildWhere(params) {
  const clauses = [];
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
  if (params.categoria) {
    add(
      `(case when categoria_exame is not null and categoria_exame <> '' then categoria_exame when tipo_exame is not null and trim(tipo_exame) <> '' then 'Imagem' else 'Outros' end) = $$`,
      params.categoria
    );
  }

  return { where: clauses.length ? `where ${clauses.join(" and ")}` : "", values };
}

async function handleGet(sql, params) {
  const limit = Math.min(Number(params.limit) || 5000, 5000);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const { where, values } = buildWhere(params);

  const rowsQuery = `select * from public.exames ${where} order by id asc limit $${values.length + 1} offset $${values.length + 2}`;
  const rowsPromise = sql.query(rowsQuery, [...values, limit, offset]);

  if (offset > 0) {
    return json(200, { rows: await rowsPromise, total: null });
  }

  const countQuery = `select count(*)::int as total from public.exames ${where}`;
  const [rows, countResult] = await Promise.all([rowsPromise, sql.query(countQuery, values)]);
  return json(200, { rows, total: countResult[0].total });
}

async function handleInsert(sql, rows) {
  if (!Array.isArray(rows) || !rows.length) return json(400, { error: "Nenhum registro enviado." });

  const columnList = COLUMNS.map(quoteIdentifier).join(", ");
  const valuesSql = [];
  const params = [];

  rows.forEach((row, rowIndex) => {
    const placeholders = COLUMNS.map((col, colIndex) => {
      params.push(row[col] === undefined ? null : row[col]);
      return `$${rowIndex * COLUMNS.length + colIndex + 1}`;
    });
    valuesSql.push(`(${placeholders.join(", ")})`);
  });

  const query = `insert into public.exames (${columnList}) values ${valuesSql.join(", ")}`;
  await sql.query(query, params);
  return json(200, { inserted: rows.length });
}

async function handleDeleteAll(sql) {
  await sql.query(`delete from public.exames`);
  return json(200, { deleted: true });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  try {
    const sql = getSql();

    if (event.httpMethod === "GET") {
      return await handleGet(sql, event.queryStringParameters || {});
    }

    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      return await handleInsert(sql, body.rows);
    }

    if (event.httpMethod === "DELETE") {
      const body = parseBody(event);
      if (body.all !== true) return json(400, { error: "Confirmacao de exclusao total ausente." });
      return await handleDeleteAll(sql);
    }

    return json(405, { error: "Metodo nao permitido." });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
