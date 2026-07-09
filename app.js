/* ======================= chart.js defaults ======================= */
if (window.Chart) {
  Chart.defaults.font.family = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#6b7688';
}

/* ======================= api ======================= */
const API_BASE = '/.netlify/functions';
let allRows = [];
let filteredRows = [];
let currentPage = 1;
const PAGE_SIZE = 25;
let evolucaoGranularidade = 'dia';
const charts = {};

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Erro ${res.status} ao acessar o banco de dados.`);
  return payload;
}

/* ======================= util ======================= */
function normalizeName(s) {
  if (!s) return '';
  return s.toString().trim().replace(/\s+/g, ' ').toUpperCase();
}

const DIACRITICS_RE = new RegExp(String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93), 'g');

function normalizeHeader(h) {
  return h.toString().normalize('NFD').replace(DIACRITICS_RE, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function slug(s) {
  return (s || '').toString().normalize('NFD').replace(DIACRITICS_RE, '').replace(/\s+/g, '-').toLowerCase();
}

function fmtInt(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function fmtDec(n, d = 1) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('pt-BR');
}

function localDateKey(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localMonthKey(d) {
  const key = localDateKey(d);
  return key ? key.slice(0, 7) : null;
}

function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleString('pt-BR');
}

function categoriaExame(exame) {
  const prefixo = (exame || '').trim().split(' ')[0].toUpperCase();
  if (prefixo === 'RM') return 'Ressonância Magnética';
  if (prefixo === 'TC') return 'Tomografia Computadorizada';
  if (prefixo === 'ENMG') return 'Eletroneuromiografia';
  if ((exame || '').toUpperCase().startsWith('DENSITOMETRIA')) return 'Densitometria Óssea';
  return 'Outros';
}

const CHART_COLORS = ['#1f6feb', '#4a90e2', '#7dd3fc', '#0b3d91', '#a5b4fc', '#93c5fd', '#38bdf8', '#60a5fa', '#2563eb', '#93c5fd'];

/* ======================= carregamento de dados ======================= */
async function fetchAllRows() {
  return api('/exames');
}

async function loadData() {
  const statusEl = document.getElementById('import-status');
  try {
    allRows = await fetchAllRows();
  } catch (e) {
    console.error(e);
    allRows = [];
    if (statusEl) {
      statusEl.textContent = 'Erro ao carregar dados: ' + e.message;
      statusEl.className = 'import-status error';
    }
  }
  populateFilterOptions();
  applyFilters();
  renderHistoricoImportacoes();
}

/* ======================= filtros ======================= */
function populateFilterOptions() {
  const convenios = [...new Set(allRows.map(r => r.convenio).filter(Boolean))].sort();
  const setores = [...new Set(allRows.map(r => r.setor).filter(Boolean))].sort();
  const exames = [...new Set(allRows.map(r => r.exame).filter(Boolean))].sort();
  const situacoes = [...new Set(allRows.map(r => r.situacao).filter(Boolean))];
  const solicitantes = [...new Set(allRows.map(r => r.solicitante).filter(Boolean))].sort();
  const pacientes = [...new Set(allRows.map(r => r.paciente).filter(Boolean))].sort();
  const laudistas = [...new Set(allRows.map(r => r.laudista).filter(Boolean))].sort();
  const executantes = [...new Set(allRows.map(r => r.executante).filter(Boolean))].sort();
  const tecnicos = [...new Set(allRows.map(r => r.tecnico).filter(Boolean))].sort();
  const empresas = [...new Set(allRows.map(r => r.empresa).filter(Boolean))].sort();

  const ordemSituacao = ['Solicitado', 'Em Laudo', 'Laudado', 'Entregue'];
  situacoes.sort((a, b) => {
    const ia = ordemSituacao.indexOf(a), ib = ordemSituacao.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  fillSelect('f-convenio', convenios);
  fillSelect('f-setor', setores);
  fillSelect('f-exame', exames);
  fillSelect('f-situacao', situacoes);
  fillSelect('f-laudista', laudistas);
  fillSelect('f-executante', executantes);
  fillSelect('f-tecnico', tecnicos);
  fillSelect('f-empresa', empresas);

  const dl = document.getElementById('dl-solicitantes');
  dl.innerHTML = solicitantes.map(s => `<option value="${escapeHtml(s)}">`).join('');

  const dlPacientes = document.getElementById('dl-pacientes');
  dlPacientes.innerHTML = pacientes.map(p => `<option value="${escapeHtml(p)}">`).join('');
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  const current = el.value;
  const firstOption = el.querySelector('option');
  el.innerHTML = '';
  el.appendChild(firstOption);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
  if (values.includes(current)) el.value = current;
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getFilters() {
  return {
    dataIni: document.getElementById('f-data-ini').value,
    dataFim: document.getElementById('f-data-fim').value,
    laudoDataIni: document.getElementById('f-laudo-data-ini').value,
    laudoDataFim: document.getElementById('f-laudo-data-fim').value,
    convenio: document.getElementById('f-convenio').value,
    setor: document.getElementById('f-setor').value,
    exame: document.getElementById('f-exame').value,
    situacao: document.getElementById('f-situacao').value,
    laudista: document.getElementById('f-laudista').value,
    executante: document.getElementById('f-executante').value,
    tecnico: document.getElementById('f-tecnico').value,
    empresa: document.getElementById('f-empresa').value,
    paciente: normalizeName(document.getElementById('f-paciente').value),
    solicitante: normalizeName(document.getElementById('f-solicitante').value),
    busca: normalizeName(document.getElementById('f-busca-tabela').value)
  };
}

function applyFilters() {
  const f = getFilters();
  filteredRows = allRows.filter(r => {
    if (f.dataIni && (!r.dt_requisicao || localDateKey(r.dt_requisicao) < f.dataIni)) return false;
    if (f.dataFim && (!r.dt_requisicao || localDateKey(r.dt_requisicao) > f.dataFim)) return false;
    if (f.laudoDataIni && (!r.data_laudo || localDateKey(r.data_laudo) < f.laudoDataIni)) return false;
    if (f.laudoDataFim && (!r.data_laudo || localDateKey(r.data_laudo) > f.laudoDataFim)) return false;
    if (f.convenio && r.convenio !== f.convenio) return false;
    if (f.setor && r.setor !== f.setor) return false;
    if (f.exame && r.exame !== f.exame) return false;
    if (f.situacao && r.situacao !== f.situacao) return false;
    if (f.laudista && r.laudista !== f.laudista) return false;
    if (f.executante && r.executante !== f.executante) return false;
    if (f.tecnico && r.tecnico !== f.tecnico) return false;
    if (f.empresa && r.empresa !== f.empresa) return false;
    if (f.paciente && !normalizeName(r.paciente).includes(f.paciente)) return false;
    if (f.solicitante && !normalizeName(r.solicitante).includes(f.solicitante)) return false;
    if (f.busca) {
      const hay = normalizeName([r.paciente, r.exame, r.solicitante, r.laudista, r.convenio].join(' '));
      if (!hay.includes(f.busca)) return false;
    }
    return true;
  });
  currentPage = 1;
  renderAll();
}

function limparFiltros() {
  [
    'f-data-ini', 'f-data-fim', 'f-laudo-data-ini', 'f-laudo-data-fim',
    'f-convenio', 'f-setor', 'f-exame', 'f-situacao',
    'f-laudista', 'f-executante', 'f-tecnico', 'f-empresa',
    'f-paciente', 'f-solicitante'
  ].forEach(id => {
    document.getElementById(id).value = '';
  });
  applyFilters();
}

/* ======================= render geral ======================= */
function renderAll() {
  renderKpis();
  renderChartEvolucao();
  renderChartSetor();
  renderChartCategoria();
  renderChartConvenio();
  renderChartMedicos();
  renderChartSituacao();
  renderChartPacientes();
  renderTabela();
}

/* ======================= KPIs ======================= */
function renderKpis() {
  const rows = filteredRows;
  const total = rows.length;
  const pacientes = new Set(rows.map(r => normalizeName(r.paciente))).size;
  const dias = new Set(rows.filter(r => r.dt_requisicao).map(r => localDateKey(r.dt_requisicao))).size;
  const media = dias > 0 ? total / dias : 0;

  const temposLaudo = rows
    .filter(r => r.dt_requisicao && r.data_laudo)
    .map(r => (new Date(r.data_laudo) - new Date(r.dt_requisicao)) / 86400000)
    .filter(v => v >= 0);
  const tempoMedio = temposLaudo.length ? temposLaudo.reduce((a, b) => a + b, 0) / temposLaudo.length : null;

  const concluidos = rows.filter(r => r.situacao === 'Laudado' || r.situacao === 'Entregue').length;
  const pctConcluido = total ? (concluidos / total) * 100 : 0;

  document.getElementById('kpi-total').textContent = fmtInt(total);
  document.getElementById('kpi-pacientes').textContent = fmtInt(pacientes);
  document.getElementById('kpi-dias').textContent = fmtInt(dias);
  document.getElementById('kpi-media').textContent = fmtDec(media, 1);
  document.getElementById('kpi-tempo-laudo').textContent = tempoMedio === null ? '—' : `${fmtDec(tempoMedio, 1)} dias`;
  document.getElementById('kpi-concluido').textContent = `${fmtDec(pctConcluido, 1)}%`;
}

/* ======================= charts ======================= */
function upsertChart(id, config) {
  const ctx = document.getElementById(id).getContext('2d');
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, config);
}

function renderChartEvolucao() {
  const buckets = new Map();
  filteredRows.forEach(r => {
    if (!r.dt_requisicao) return;
    const key = evolucaoGranularidade === 'mes' ? localMonthKey(r.dt_requisicao) : localDateKey(r.dt_requisicao);
    if (!key) return;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });
  const labels = [...buckets.keys()].sort();
  const data = labels.map(l => buckets.get(l));
  const labelsFmt = labels.map(l => {
    const [y, m, d] = l.split('-').map(Number);
    return evolucaoGranularidade === 'mes'
      ? new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
      : new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  });

  upsertChart('chart-evolucao', {
    type: 'line',
    data: {
      labels: labelsFmt,
      datasets: [{
        label: 'Exames',
        data,
        borderColor: '#1f6feb',
        backgroundColor: 'rgba(31,111,235,0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function countBy(rows, field) {
  const m = new Map();
  rows.forEach(r => {
    const v = r[field] || '—';
    m.set(v, (m.get(v) || 0) + 1);
  });
  return m;
}

function renderChartSetor() {
  const m = countBy(filteredRows, 'setor');
  const labels = [...m.keys()].sort((a, b) => m.get(b) - m.get(a));
  const data = labels.map(l => m.get(l));
  upsertChart('chart-setor', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 35, minRotation: 0, autoSkip: false } },
        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } }
      }
    }
  });
}

function renderChartCategoria() {
  const m = new Map();
  filteredRows.forEach(r => {
    const c = categoriaExame(r.exame);
    m.set(c, (m.get(c) || 0) + 1);
  });
  const labels = [...m.keys()];
  const data = labels.map(l => m.get(l));
  upsertChart('chart-categoria', {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
  });
}

function renderChartConvenio() {
  const m = countBy(filteredRows, 'convenio');
  let labels = [...m.keys()].sort((a, b) => m.get(b) - m.get(a));
  let data = labels.map(l => m.get(l));
  if (labels.length > 8) {
    const top = labels.slice(0, 8);
    const topData = data.slice(0, 8);
    const outros = data.slice(8).reduce((a, b) => a + b, 0);
    labels = [...top, 'Outros'];
    data = [...topData, outros];
  }
  upsertChart('chart-convenio', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#1f6feb' }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderChartMedicos() {
  const m = countBy(filteredRows, 'solicitante');
  const labels = [...m.keys()].sort((a, b) => m.get(b) - m.get(a)).slice(0, 10);
  const data = labels.map(l => m.get(l));
  upsertChart('chart-medicos', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#0b3d91' }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderChartPacientes() {
  const m = new Map();
  filteredRows.forEach(r => {
    if (!r.paciente) return;
    const key = normalizeName(r.paciente);
    m.set(key, (m.get(key) || 0) + 1);
  });
  const labels = [...m.keys()].sort((a, b) => m.get(b) - m.get(a)).slice(0, 10);
  const data = labels.map(l => m.get(l));
  upsertChart('chart-pacientes', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#2563eb' }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderChartSituacao() {
  const ordem = ['Solicitado', 'Em Laudo', 'Laudado', 'Entregue'];
  const m = countBy(filteredRows, 'situacao');
  const labels = ordem.filter(l => m.has(l)).concat([...m.keys()].filter(l => !ordem.includes(l)));
  const data = labels.map(l => m.get(l));
  const cores = { 'Solicitado': '#d94c4c', 'Em Laudo': '#d98c1c', 'Laudado': '#1a9c6b', 'Entregue': '#1f6feb' };
  upsertChart('chart-situacao', {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: labels.map(l => cores[l] || '#6b7688') }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

/* ======================= tabela ======================= */
function renderTabela() {
  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

  const body = document.getElementById('tabela-exames-body');
  body.innerHTML = pageRows.map(r => `
    <tr>
      <td>${fmtDate(r.dt_requisicao)}</td>
      <td>${escapeHtml(r.paciente)}</td>
      <td>${escapeHtml(r.exame)}</td>
      <td>${escapeHtml(r.convenio)}</td>
      <td>${escapeHtml(r.setor)}</td>
      <td><span class="badge badge-${slug(r.situacao)}">${escapeHtml(r.situacao)}</span></td>
      <td>${escapeHtml(r.solicitante)}</td>
      <td>${escapeHtml(r.laudista)}</td>
      <td>${fmtDate(r.data_laudo)}</td>
    </tr>
  `).join('');

  document.getElementById('tabela-count').textContent = `${fmtInt(total)} registros`;
  document.getElementById('pagina-info').textContent = `Página ${currentPage} de ${totalPages}`;
  document.getElementById('btn-prev-page').disabled = currentPage <= 1;
  document.getElementById('btn-next-page').disabled = currentPage >= totalPages;
}

/* ======================= importação Excel ======================= */
const HEADER_MAP_RAW = {
  'ID': 'id_origem',
  'Rex.ID': 'rex_id',
  'Tipo': 'tipo',
  'Situação': 'situacao',
  'Exec.': 'exec',
  'Dt.Requisição': 'dt_requisicao',
  'Previsão': 'previsao',
  'Paciente': 'paciente',
  'Cp': 'cp',
  'Lado': 'lado',
  'Exame': 'exame',
  'Convênio': 'convenio',
  'Solicitante': 'solicitante',
  'Laudista': 'laudista',
  'Executante': 'executante',
  'Usuário Resp. Rex': 'usuario_resp_rex',
  'Técnico': 'tecnico',
  'Setor': 'setor',
  'Usuário Digitou': 'usuario_digitou',
  'Data/Hora Digitação': 'data_hora_digitacao',
  'Log de Usuário Laudo': 'log_usuario_laudo',
  'Usuário Resp. Laudo': 'usuario_resp_laudo',
  'Data Laudo': 'data_laudo',
  'Médico Autenticador': 'medico_autenticador',
  'Médico Revisor': 'medico_revisor',
  'Empresa': 'empresa'
};
const HEADER_MAP_NORM = {};
Object.entries(HEADER_MAP_RAW).forEach(([k, v]) => { HEADER_MAP_NORM[normalizeHeader(k)] = v; });

const DATE_COLS = new Set(['dt_requisicao', 'previsao', 'data_hora_digitacao', 'data_laudo']);
const INT_COLS = new Set(['id_origem', 'rex_id']);

let pendingImportRows = null;

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames.includes('Base') ? 'Base' : wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function mapImportRow(raw, loteId) {
  const out = { lote_importacao: loteId };
  Object.keys(raw).forEach(header => {
    const col = HEADER_MAP_NORM[normalizeHeader(header)];
    if (!col) return;
    let val = raw[header];
    if (val === undefined || val === '') val = null;
    if (val !== null && DATE_COLS.has(col)) {
      val = val instanceof Date ? val.toISOString() : new Date(val).toISOString();
    } else if (val !== null && INT_COLS.has(col)) {
      val = parseInt(val, 10);
      if (isNaN(val)) val = null;
    } else if (val !== null) {
      val = val.toString();
    }
    out[col] = val;
  });
  return out;
}

async function handleExcelFile(file) {
  const statusEl = document.getElementById('import-status');
  statusEl.className = 'import-status';
  statusEl.textContent = 'Lendo arquivo...';
  try {
    const rows = await parseExcelFile(file);
    if (!rows.length) throw new Error('Nenhum registro encontrado no arquivo.');
    pendingImportRows = rows;
    document.getElementById('import-preview-count').textContent = fmtInt(rows.length);
    document.getElementById('import-preview').hidden = false;
    statusEl.textContent = '';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Erro ao ler o arquivo: ' + err.message;
    statusEl.className = 'import-status error';
  }
}

async function confirmarImportacao() {
  if (!pendingImportRows) return;
  const modo = document.querySelector('input[name="import-mode"]:checked').value;
  const btn = document.getElementById('btn-confirmar-importacao');
  const statusEl = document.getElementById('import-status');
  btn.disabled = true;
  statusEl.className = 'import-status';

  const loteId = `imp_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const mapped = pendingImportRows.map(r => mapImportRow(r, loteId));

  try {
    if (modo === 'substituir') {
      statusEl.textContent = 'Removendo dados atuais...';
      await api('/exames', { method: 'DELETE', body: JSON.stringify({ all: true }) });
    }

    const CHUNK = 500;
    for (let i = 0; i < mapped.length; i += CHUNK) {
      statusEl.textContent = `Importando registros ${i + 1} a ${Math.min(i + CHUNK, mapped.length)} de ${mapped.length}...`;
      await api('/exames', { method: 'POST', body: JSON.stringify({ rows: mapped.slice(i, i + CHUNK) }) });
    }

    statusEl.textContent = `Importação concluída: ${fmtInt(mapped.length)} registros.`;
    statusEl.className = 'import-status ok';
    pendingImportRows = null;
    document.getElementById('import-preview').hidden = true;
    document.getElementById('input-excel').value = '';
    await loadData();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Erro na importação: ' + err.message;
    statusEl.className = 'import-status error';
  } finally {
    btn.disabled = false;
  }
}

function renderHistoricoImportacoes() {
  const el = document.getElementById('import-historico');
  const m = new Map();
  allRows.forEach(r => {
    const lote = r.lote_importacao || 'sem-lote';
    if (!m.has(lote)) m.set(lote, { count: 0, data: r.importado_em });
    const entry = m.get(lote);
    entry.count++;
    if (r.importado_em && (!entry.data || r.importado_em > entry.data)) entry.data = r.importado_em;
  });
  const lotes = [...m.entries()].sort((a, b) => (b[1].data || '').localeCompare(a[1].data || ''));
  if (!lotes.length) {
    el.innerHTML = '<p class="import-hint">Nenhuma importação realizada ainda.</p>';
    return;
  }
  el.innerHTML = lotes.map(([lote, info]) => `
    <div class="hist-row">
      <span>${fmtDateTime(info.data)}</span>
      <span>${fmtInt(info.count)} registros</span>
    </div>
  `).join('');
}

/* ======================= eventos ======================= */
function setupNav() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
  });
}

function setupFiltros() {
  [
    'f-data-ini', 'f-data-fim', 'f-laudo-data-ini', 'f-laudo-data-fim',
    'f-convenio', 'f-setor', 'f-exame', 'f-situacao',
    'f-laudista', 'f-executante', 'f-tecnico', 'f-empresa'
  ].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });
  document.getElementById('f-paciente').addEventListener('input', debounce(applyFilters, 250));
  document.getElementById('f-solicitante').addEventListener('input', debounce(applyFilters, 250));
  document.getElementById('f-busca-tabela').addEventListener('input', debounce(applyFilters, 250));
  document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setupToggleEvolucao() {
  document.querySelectorAll('#toggle-evolucao .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#toggle-evolucao .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      evolucaoGranularidade = btn.dataset.gran;
      renderChartEvolucao();
    });
  });
}

function setupPaginacao() {
  document.getElementById('btn-prev-page').addEventListener('click', () => { currentPage--; renderTabela(); });
  document.getElementById('btn-next-page').addEventListener('click', () => { currentPage++; renderTabela(); });
}

function setupImport() {
  const drop = document.getElementById('drop-excel');
  const input = document.getElementById('input-excel');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = '#1f6feb'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = '';
    if (e.dataTransfer.files.length) handleExcelFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files.length) handleExcelFile(input.files[0]); });
  document.getElementById('btn-confirmar-importacao').addEventListener('click', confirmarImportacao);
}

/* ======================= init ======================= */
window.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupFiltros();
  setupToggleEvolucao();
  setupPaginacao();
  setupImport();
  loadData();
});
