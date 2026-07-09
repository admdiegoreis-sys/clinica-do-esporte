import { getSql, json, quoteIdentifier } from "./_db.mjs";

const COLUMNS = [
  "id_origem", "rex_id", "tipo", "situacao", "exec", "dt_requisicao", "previsao",
  "paciente", "cp", "lado", "exame", "convenio", "solicitante", "laudista",
  "executante", "usuario_resp_rex", "tecnico", "setor", "usuario_digitou",
  "data_hora_digitacao", "log_usuario_laudo", "usuario_resp_laudo", "data_laudo",
  "medico_autenticador", "medico_revisor", "empresa", "lote_importacao",
];

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

async function handleGet(sql) {
  const rows = await sql.query(
    `select * from public.exames order by dt_requisicao desc nulls last`
  );
  return json(200, rows);
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
      return await handleGet(sql);
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
