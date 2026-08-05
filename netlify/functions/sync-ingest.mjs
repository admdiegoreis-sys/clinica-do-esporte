import { timingSafeEqual } from "crypto";
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

function checkAuth(event) {
  const provided = event.headers["x-sync-key"] || event.headers["X-Sync-Key"];
  const expected = process.env.SYNC_API_KEY;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handleUpsert(sql, rows, event) {
  if (!Array.isArray(rows) || !rows.length) return json(400, { error: "Nenhum registro enviado." }, { event });

  const columnList = COLUMNS.map(quoteIdentifier).join(", ");
  const updateSet = COLUMNS.filter(c => c !== "id_origem")
    .map(c => `${quoteIdentifier(c)} = excluded.${quoteIdentifier(c)}`)
    .join(", ");

  const valuesSql = [];
  const params = [];

  rows.forEach((row, rowIndex) => {
    const placeholders = COLUMNS.map((col, colIndex) => {
      params.push(row[col] === undefined ? null : row[col]);
      return `$${rowIndex * COLUMNS.length + colIndex + 1}`;
    });
    valuesSql.push(`(${placeholders.join(", ")})`);
  });

  const query = `
    insert into public.exames (${columnList})
    values ${valuesSql.join(", ")}
    on conflict (id_origem) where id_origem is not null
    do update set ${updateSet}, importado_em = now()
  `;
  await sql.query(query, params);
  return json(200, { upserted: rows.length }, { event });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });

  if (!checkAuth(event)) {
    return json(401, { error: "Chave de sincronizacao invalida ou ausente." }, { event });
  }

  try {
    const sql = getSql();

    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      return await handleUpsert(sql, body.rows, event);
    }

    return json(405, { error: "Metodo nao permitido." }, { event });
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
