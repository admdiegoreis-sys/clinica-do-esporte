import Firebird from 'node-firebird';

for (const key of ['FB_HOST', 'FB_DATABASE', 'FB_USER', 'FB_PASSWORD', 'SYNC_API_KEY']) {
  if (!process.env[key]) throw new Error(`Variavel de ambiente ${key} nao configurada.`);
}

const FB_OPTIONS = {
  host: process.env.FB_HOST,
  port: Number(process.env.FB_PORT || 3050),
  database: process.env.FB_DATABASE,
  user: process.env.FB_USER,
  password: process.env.FB_PASSWORD,
  lowercase_keys: false,
};

const API_BASE = process.env.SYNC_API_BASE || 'https://clinicadoesport.netlify.app';
const SYNC_API_KEY = process.env.SYNC_API_KEY;
const DESDE_ID = Number(process.env.SYNC_DESDE_ID || 0);

const SITUACAO_MAP = { S: 'Solicitado', L: 'Laudado', E: 'Entregue', V: 'V', C: 'C', R: 'R' };
const TIPO_MAP = { X: 'Externo', I: 'Interno' };
const LADO_MAP = { 0: null, 1: 'ESQ', 2: 'DIR' };
const CATEGORIA_MAP = { I: 'Imagem', L: 'Laboratório' };

function siglaFromDescricao(desc) {
  const prefixo = (desc || '').trim().split(' ')[0].toUpperCase();
  if (prefixo === 'RM') return 'RM';
  if (prefixo === 'TC') return 'TC';
  if (prefixo === 'RX') return 'RX';
  if (prefixo === 'ENMG') return 'EN';
  if ((desc || '').toUpperCase().startsWith('DENSITOMETRIA')) return 'DE';
  return '';
}

function iso(date) {
  return date ? new Date(date).toISOString() : null;
}

const SQL = `
with recent as (
  select first ${Number(process.env.SYNC_BATCH || 2000)}
    er.EXR_ID, er.REX_ID, er.EXA_ID, er.MED_ID, er.MED_ID_EXECUTANTE,
    er.MED_ID_SOLICITANTE_INTERNO, er.MED_ID_SOLICITANTE_EXTERNO, er.MED_ID_AUTENTICA,
    er.MED_ID_REVISOR, er.TEC_ID, er.USR_ID_LAUDO, er.USR_ID_LAUDO_ULTIMO,
    er.EMPRESA_ID, er.EXR_STATUS, er.EXR_EXECUTADO, er.EXR_DATA_PREVISAO,
    er.EXR_LATERALIDADE, er.EXR_DATA_HORA_DIGITADO,
    rex.REX_TIPO, rex.REX_DATA_REQUISICAO, rex.SET_ID, rex.HAT_ID, rex.PLN_ID, rex.OWNER_ID
  from EXAME_REQUISICAO er
  join REQUISICAO_EXAME rex on rex.REX_ID = er.REX_ID
  where er.EXR_ID > ?
  order by er.EXR_ID asc
)
select
  recent.EXR_ID as ID_ORIGEM,
  recent.REX_ID as REX_ID,
  recent.REX_TIPO as TIPO_RAW,
  recent.EXR_STATUS as SITUACAO_RAW,
  recent.EXR_EXECUTADO as EXEC_RAW,
  recent.REX_DATA_REQUISICAO as DT_REQUISICAO,
  recent.EXR_DATA_PREVISAO as PREVISAO,
  pes_pac.PES_NOME as PACIENTE,
  recent.EXR_LATERALIDADE as LADO_RAW,
  exa.EXA_SIGLA as TIPO_EXAME_RAW,
  exa.EXA_DESCRICAO as EXAME,
  grx.GRX_TIPO as CATEGORIA_RAW,
  cnv.CNV_NOME as CONVENIO,
  coalesce(mex.MEX_NOME, pes_sol_int.PES_NOME) as SOLICITANTE,
  pes_laud.PES_NOME as LAUDISTA,
  pes_exec.PES_NOME as EXECUTANTE,
  usr_rex.USR_NOME_USUARIO as USUARIO_RESP_REX,
  tec.TEC_NOME as TECNICO,
  setor.SET_DESCRICAO as SETOR,
  usr_dig.USR_NOME_USUARIO as USUARIO_DIGITOU,
  recent.EXR_DATA_HORA_DIGITADO as DATA_HORA_DIGITACAO,
  usr_log.USR_NOME_USUARIO as LOG_USUARIO_LAUDO,
  usr_resp_laudo.USR_NOME_USUARIO as USUARIO_RESP_LAUDO,
  lau.LAU_DATA as DATA_LAUDO,
  pes_autentica.PES_NOME as MEDICO_AUTENTICADOR,
  pes_revisor.PES_NOME as MEDICO_REVISOR,
  emp.EMP_NOME_FANTASIA as EMPRESA
from recent
left join EXAME exa on exa.EXA_ID = recent.EXA_ID
left join GRUPO_EXAME grx on grx.GRX_ID = exa.GRX_ID
left join SETOR setor on setor.SET_ID = recent.SET_ID
left join HISTORICO_ATENDIMENTO hat on hat.HAT_ID = recent.HAT_ID
left join ATENDIMENTO atd on atd.ATE_ID = hat.ATE_ID
left join PACIENTE pac on pac.PAC_ID = atd.PAC_ID
left join PESSOA pes_pac on pes_pac.PES_ID = pac.PES_ID
left join PLANO pln on pln.PLN_ID = recent.PLN_ID
left join CONVENIO cnv on cnv.CNV_ID = pln.CNV_ID
left join MEDICO_EXTERNO mex on mex.MEX_ID = recent.MED_ID_SOLICITANTE_EXTERNO
left join MEDICO med_sol_int on med_sol_int.MED_ID = recent.MED_ID_SOLICITANTE_INTERNO
left join PESSOA pes_sol_int on pes_sol_int.PES_ID = med_sol_int.PES_ID
left join MEDICO med_laud on med_laud.MED_ID = recent.MED_ID
left join PESSOA pes_laud on pes_laud.PES_ID = med_laud.PES_ID
left join MEDICO med_exec on med_exec.MED_ID = recent.MED_ID_EXECUTANTE
left join PESSOA pes_exec on pes_exec.PES_ID = med_exec.PES_ID
left join MEDICO med_autentica on med_autentica.MED_ID = recent.MED_ID_AUTENTICA
left join PESSOA pes_autentica on pes_autentica.PES_ID = med_autentica.PES_ID
left join MEDICO med_revisor on med_revisor.MED_ID = recent.MED_ID_REVISOR
left join PESSOA pes_revisor on pes_revisor.PES_ID = med_revisor.PES_ID
left join USUARIO usr_rex on usr_rex.USR_ID = recent.OWNER_ID
left join TECNICO tec on tec.TEC_ID = recent.TEC_ID
left join USUARIO usr_dig on usr_dig.USR_ID = recent.USR_ID_LAUDO
left join USUARIO usr_log on usr_log.USR_ID = recent.USR_ID_LAUDO_ULTIMO
left join USUARIO usr_resp_laudo on usr_resp_laudo.USR_ID = med_autentica.USR_ID
left join LAUDO lau on lau.EXR_ID = recent.EXR_ID
left join EMPRESA emp on emp.EMP_ID = recent.EMPRESA_ID
`;

function fetchFirebirdRows() {
  return new Promise((resolve, reject) => {
    Firebird.attach(FB_OPTIONS, (err, db) => {
      if (err) { reject(err); return; }
      db.query(SQL, [DESDE_ID], (err, result) => {
        db.detach();
        if (err) reject(err);
        else resolve(result);
      });
    });
  });
}

function mapRow(row) {
  return {
    id_origem: row.ID_ORIGEM,
    rex_id: row.REX_ID,
    tipo: TIPO_MAP[row.TIPO_RAW] || row.TIPO_RAW || null,
    situacao: SITUACAO_MAP[row.SITUACAO_RAW] || row.SITUACAO_RAW || null,
    exec: row.EXEC_RAW ? 'Sim' : 'Não',
    dt_requisicao: iso(row.DT_REQUISICAO),
    previsao: iso(row.PREVISAO),
    paciente: row.PACIENTE ? row.PACIENTE.trim() : null,
    cp: null,
    lado: LADO_MAP[row.LADO_RAW] ?? null,
    tipo_exame: (row.TIPO_EXAME_RAW || '').trim() || siglaFromDescricao(row.EXAME),
    categoria_exame: CATEGORIA_MAP[row.CATEGORIA_RAW] || row.CATEGORIA_RAW || null,
    exame: row.EXAME ? row.EXAME.trim() : null,
    convenio: row.CONVENIO ? row.CONVENIO.trim() : null,
    solicitante: row.SOLICITANTE ? row.SOLICITANTE.trim() : null,
    laudista: row.LAUDISTA ? row.LAUDISTA.trim() : null,
    executante: row.EXECUTANTE ? row.EXECUTANTE.trim() : null,
    usuario_resp_rex: row.USUARIO_RESP_REX ? row.USUARIO_RESP_REX.trim() : null,
    tecnico: row.TECNICO ? row.TECNICO.trim() : null,
    setor: row.SETOR ? row.SETOR.trim() : null,
    usuario_digitou: row.USUARIO_DIGITOU ? row.USUARIO_DIGITOU.trim() : null,
    data_hora_digitacao: iso(row.DATA_HORA_DIGITACAO),
    log_usuario_laudo: row.LOG_USUARIO_LAUDO ? row.LOG_USUARIO_LAUDO.trim() : null,
    usuario_resp_laudo: row.USUARIO_RESP_LAUDO ? row.USUARIO_RESP_LAUDO.trim() : null,
    data_laudo: iso(row.DATA_LAUDO),
    medico_autenticador: row.MEDICO_AUTENTICADOR ? row.MEDICO_AUTENTICADOR.trim() : null,
    medico_revisor: row.MEDICO_REVISOR ? row.MEDICO_REVISOR.trim() : null,
    empresa: row.EMPRESA ? row.EMPRESA.trim() : null,
    lote_importacao: `sync_${new Date().toISOString().replace(/[:.]/g, '-')}`,
    origem: 'firebird',
  };
}

async function pushChunk(rows) {
  const res = await fetch(`${API_BASE}/.netlify/functions/sync-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SYNC_API_KEY },
    body: JSON.stringify({ rows }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload;
}

async function main() {
  console.log(`Buscando exames com EXR_ID > ${DESDE_ID}...`);
  const rows = await fetchFirebirdRows();
  console.log(`Encontrados: ${rows.length}`);
  if (!rows.length) return;

  const mapped = rows.map(mapRow);
  const CHUNK = 300;
  let total = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const chunk = mapped.slice(i, i + CHUNK);
    const result = await pushChunk(chunk);
    total += result.upserted || 0;
    console.log(`Enviado lote ${i + 1}-${Math.min(i + CHUNK, mapped.length)}`);
  }
  console.log(`Concluido. Total sincronizado: ${total}`);
}

main().catch(err => {
  console.error('ERRO NA SINCRONIZACAO:', err.message);
  process.exit(1);
});
