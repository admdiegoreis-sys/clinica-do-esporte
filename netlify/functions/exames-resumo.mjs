import { getSql, json } from "./_db.mjs";
import { requireAuth } from "./_auth.mjs";
import {
  buildWhere, DATA_LOCAL, EXPR_CATEGORIA, EXPR_PACIENTE_NORM, semValor,
} from "./_filtros.mjs";

/**
 * Devolve os KPIs e as series dos graficos ja agregados em SQL.
 *
 * Antes o navegador baixava TODAS as linhas do filtro (30 colunas) so pra somar
 * no cliente — dezenas de MB por clique de filtro. Aqui trafegam poucos KB.
 * Cada expressao abaixo reproduz exatamente o calculo que o app.js fazia, para
 * que nenhum numero da tela mude.
 */
async function handleResumo(sql, params, event) {
  const { where, values } = buildWhere(params);

  const [kpiRows, evolDia, evolMes, setor, categoria, situacao, convenio, medicos, pacientes] =
    await Promise.all([
      sql.query(
        `select
           count(*)::int as total,
           count(distinct ${EXPR_PACIENTE_NORM})::int as pacientes,
           count(distinct ${DATA_LOCAL}) filter (where dt_requisicao is not null)::int as dias,
           avg(extract(epoch from (data_laudo - dt_requisicao)) / 86400.0)
             filter (where dt_requisicao is not null and data_laudo is not null
                       and data_laudo >= dt_requisicao) as tempo_medio_laudo,
           count(*) filter (where situacao in ('Laudado','Entregue'))::int as concluidos
         from public.exames ${where}`,
        values
      ),
      sql.query(
        `select to_char(${DATA_LOCAL}, 'YYYY-MM-DD') as k, count(*)::int as n
         from public.exames ${where} and dt_requisicao is not null
         group by 1 order by 1`,
        values
      ),
      sql.query(
        `select to_char(${DATA_LOCAL}, 'YYYY-MM') as k, count(*)::int as n
         from public.exames ${where} and dt_requisicao is not null
         group by 1 order by 1`,
        values
      ),
      sql.query(
        `select ${semValor("setor")} as k, count(*)::int as n
         from public.exames ${where} group by 1 order by 2 desc`,
        values
      ),
      sql.query(
        `select (${EXPR_CATEGORIA}) as k, count(*)::int as n
         from public.exames ${where} group by 1 order by 2 desc`,
        values
      ),
      sql.query(
        `select ${semValor("situacao")} as k, count(*)::int as n
         from public.exames ${where} group by 1 order by 2 desc`,
        values
      ),
      sql.query(
        `select ${semValor("convenio")} as k, count(*)::int as n
         from public.exames ${where} group by 1 order by 2 desc`,
        values
      ),
      sql.query(
        `select ${semValor("solicitante")} as k, count(*)::int as n
         from public.exames ${where} group by 1 order by 2 desc limit 10`,
        values
      ),
      // o grafico de pacientes ignora linhas sem paciente; o KPI acima nao ignora
      sql.query(
        `select ${EXPR_PACIENTE_NORM} as k, count(*)::int as n
         from public.exames ${where} and paciente is not null and btrim(paciente) <> ''
         group by 1 order by 2 desc limit 10`,
        values
      ),
    ]);

  const k = kpiRows[0];
  const total = k.total;
  const dias = k.dias;
  const par = (rows) => rows.map((r) => [r.k, r.n]);

  return json(200, {
    kpis: {
      total,
      pacientes: k.pacientes,
      dias,
      media: dias > 0 ? total / dias : 0,
      tempoMedioLaudo: k.tempo_medio_laudo === null ? null : Number(k.tempo_medio_laudo),
      pctConcluido: total ? (k.concluidos / total) * 100 : 0,
    },
    graficos: {
      evolucaoDia: par(evolDia),
      evolucaoMes: par(evolMes),
      setor: par(setor),
      categoria: par(categoria),
      situacao: par(situacao),
      convenio: par(convenio),
      medicos: par(medicos),
      pacientes: par(pacientes),
    },
  }, { event });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "GET") return json(405, { error: "Metodo nao permitido." }, { event });

  const user = await requireAuth(event);
  if (!user) return json(401, { error: "Nao autenticado." }, { event });

  try {
    return await handleResumo(getSql(), event.queryStringParameters || {}, event);
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
