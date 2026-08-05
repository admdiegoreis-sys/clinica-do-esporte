import { getSql, json, quoteIdentifier } from "./_db.mjs";
import { requireAuth, requireAdmin } from "./_auth.mjs";
import { buildWhere } from "./_filtros.mjs";

const COLUMNS = [
  "id_origem", "rex_id", "tipo", "situacao", "exec", "dt_requisicao", "previsao",
  "paciente", "cp", "lado", "tipo_exame", "categoria_exame", "exame", "convenio", "solicitante", "laudista",
  "executante", "usuario_resp_rex", "tecnico", "setor", "usuario_digitou",
  "data_hora_digitacao", "log_usuario_laudo", "usuario_resp_laudo", "data_laudo",
  "medico_autenticador", "medico_revisor", "empresa", "lote_importacao", "origem",
];

/* So o que a tabela e os relatorios exibem. Trazer as 30 colunas para uma tela que
   mostra 10 era o que inflava o trafego. Lista fixa = nome de coluna nunca vem do
   usuario. */
const CAMPOS_TABELA = [
  "id", "dt_requisicao", "paciente", "exame", "convenio", "setor",
  "situacao", "solicitante", "laudista", "data_laudo", "origem",
];

const LIMITE_TABELA = 200;      // pagina da tela
const LIMITE_EXPORTACAO = 5000; // lote da exportacao

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

function listaDeCampos(params) {
  return params.campos === "todos" ? "*" : CAMPOS_TABELA.map(quoteIdentifier).join(", ");
}

async function handleGet(sql, params, event) {
  const teto = params.modo === "exportacao" ? LIMITE_EXPORTACAO : LIMITE_TABELA;
  const limit = Math.min(Math.max(Number(params.limit) || 25, 1), teto);
  const offset = Math.max(Number(params.offset) || 0, 0);
  const { where, values } = buildWhere(params);

  const rowsQuery = `select ${listaDeCampos(params)} from public.exames ${where}
                     order by id asc limit $${values.length + 1} offset $${values.length + 2}`;

  const [rows, countResult] = await Promise.all([
    sql.query(rowsQuery, [...values, limit, offset]),
    sql.query(`select count(*)::int as total from public.exames ${where}`, values),
  ]);

  return json(200, { rows, total: countResult[0].total }, { event });
}

async function handleInsert(sql, rows, event) {
  if (!Array.isArray(rows) || !rows.length) return json(400, { error: "Nenhum registro enviado." }, { event });

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
  return json(200, { inserted: rows.length }, { event });
}

async function handleDeleteAll(sql, event) {
  await sql.query(`delete from public.exames`);
  return json(200, { deleted: true }, { event });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });

  try {
    if (event.httpMethod === "GET") {
      const user = await requireAuth(event);
      if (!user) return json(401, { error: "Nao autenticado." }, { event });
      return await handleGet(getSql(), event.queryStringParameters || {}, event);
    }

    if (event.httpMethod === "POST") {
      const admin = await requireAdmin(event);
      if (!admin) return json(403, { error: "Acesso restrito a administradores." }, { event });
      return await handleInsert(getSql(), parseBody(event).rows, event);
    }

    if (event.httpMethod === "DELETE") {
      const admin = await requireAdmin(event);
      if (!admin) return json(403, { error: "Acesso restrito a administradores." }, { event });
      if (parseBody(event).all !== true) {
        return json(400, { error: "Confirmacao de exclusao total ausente." }, { event });
      }
      return await handleDeleteAll(getSql(), event);
    }

    return json(405, { error: "Metodo nao permitido." }, { event });
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
