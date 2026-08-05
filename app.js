/* ======================= chart.js defaults ======================= */
if (window.Chart) {
  Chart.defaults.font.family = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#6b7688';
  if (window.ChartDataLabels) {
    Chart.register(ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', {
      display: ctx => ctx.dataset.data[ctx.dataIndex] > 0,
      formatter: v => fmtInt(v)
    });
  }
}

/* ======================= api ======================= */
const API_BASE = '/.netlify/functions';
let meta = { filtros: {}, status: null, lotes: [] };
let filteredRows = [];
let currentPage = 1;
const PAGE_SIZE = 25;
let evolucaoGranularidade = 'dia';
let filtroRequestId = 0;
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

const TIPO_EXAME_LABELS = {
  'RM': 'Ressonância Magnética',
  'TC': 'Tomografia Computadorizada',
  'RX': 'Raio-X',
  'EN': 'Eletroneuromiografia',
  'DE': 'Densitometria Óssea'
};

function categoriaExame(row) {
  const sigla = (row.tipo_exame || '').trim().toUpperCase();
  if (sigla) return TIPO_EXAME_LABELS[sigla] || sigla;

  const exame = row.exame || '';
  const prefixo = exame.trim().split(' ')[0].toUpperCase();
  if (prefixo === 'RM') return 'Ressonância Magnética';
  if (prefixo === 'TC') return 'Tomografia Computadorizada';
  if (prefixo === 'ENMG') return 'Eletroneuromiografia';
  if (exame.toUpperCase().startsWith('DENSITOMETRIA')) return 'Densitometria Óssea';
  return 'Outros';
}

const ORIGEM_LABELS = {
  excel: 'Planilha Excel',
  firebird: 'Banco de dados (Firebird)'
};

const CHART_COLORS = ['#1f6feb', '#4a90e2', '#7dd3fc', '#0b3d91', '#a5b4fc', '#93c5fd', '#38bdf8', '#60a5fa', '#2563eb', '#93c5fd'];

/* ======================= carregamento de dados ======================= */
function buildFilterQuery(f) {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  return qs.toString();
}

async function fetchFilteredRows(filterParams) {
  const PAGE = 5000;
  const qs = buildFilterQuery(filterParams);
  const sep = qs ? '&' : '';
  const first = await api(`/exames?${qs}${sep}limit=${PAGE}&offset=0`);
  let all = first.rows;
  const total = first.total ?? first.rows.length;

  const remainingOffsets = [];
  for (let offset = PAGE; offset < total; offset += PAGE) remainingOffsets.push(offset);

  const remainingPages = await Promise.all(
    remainingOffsets.map(offset => api(`/exames?${qs}${sep}limit=${PAGE}&offset=${offset}`))
  );
  remainingPages.forEach(page => { all = all.concat(page.rows); });

  return all;
}

async function fetchMeta() {
  return api('/exames-meta');
}

function showStatus(message, type) {
  const el = document.getElementById('app-status');
  if (!el) return;
  el.textContent = message;
  el.className = `app-status ${type}`;
  el.hidden = false;
}

function hideStatus() {
  const el = document.getElementById('app-status');
  if (el) el.hidden = true;
}

async function loadData() {
  try {
    meta = await fetchMeta();
    hideStatus();
  } catch (e) {
    console.error(e);
    meta = { filtros: {}, status: null, lotes: [] };
    showStatus('Erro ao carregar dados: ' + e.message, 'error');
  }
  populateFilterOptions();
  renderStatusTopo();
  await applyFilters();
}

function renderStatusTopo() {
  const atualizacaoEl = document.getElementById('status-atualizacao');
  const ultimoRegistroEl = document.getElementById('status-ultimo-registro');
  if (!meta.status) {
    if (atualizacaoEl) atualizacaoEl.textContent = '—';
    if (ultimoRegistroEl) ultimoRegistroEl.textContent = '—';
    return;
  }
  if (atualizacaoEl) atualizacaoEl.textContent = fmtDateTime(meta.status.ultimaAtualizacao);
  if (ultimoRegistroEl) ultimoRegistroEl.textContent = fmtDate(meta.status.ultimoRegistro);
}

/* ======================= filtros ======================= */
function populateFilterOptions() {
  const f = meta.filtros || {};
  const situacoes = [...(f.situacao || [])];
  const tiposExame = [...(f.tipoExame || [])];
  const categorias = [...(f.categoria || [])];

  const ordemSituacao = ['Solicitado', 'Em Laudo', 'Laudado', 'Entregue'];
  situacoes.sort((a, b) => {
    const ia = ordemSituacao.indexOf(a), ib = ordemSituacao.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const ordemTipoExame = Object.keys(TIPO_EXAME_LABELS);
  tiposExame.sort((a, b) => {
    const ia = ordemTipoExame.indexOf(a), ib = ordemTipoExame.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  fillSelect('f-convenio', f.convenio || []);
  fillSelect('f-setor', f.setor || []);
  fillSelect('f-exame', f.exame || []);
  fillSelect('f-situacao', situacoes);
  fillSelect('f-laudista', f.laudista || []);
  fillSelect('f-executante', f.executante || []);
  fillSelect('f-tecnico', f.tecnico || []);
  fillSelect('f-empresa', f.empresa || []);
  fillSelect('f-origem', f.origem || [], o => ORIGEM_LABELS[o] || o);
  fillSelect('f-tipo-exame', tiposExame, sigla => TIPO_EXAME_LABELS[sigla] || sigla);
  fillSelect('f-categoria', categorias);
}

async function updateAutocomplete(campo, inputEl, datalistEl) {
  const q = inputEl.value.trim();
  if (q.length < 2) { datalistEl.innerHTML = ''; return; }
  try {
    const { options } = await api(`/exames-meta?autocomplete=${campo}&q=${encodeURIComponent(q)}`);
    datalistEl.innerHTML = options.map(o => `<option value="${escapeHtml(o)}">`).join('');
  } catch (e) {
    console.error(e);
  }
}

function fillSelect(id, values, labelFn) {
  const el = document.getElementById(id);
  const current = el.value;
  const firstOption = el.querySelector('option');
  el.innerHTML = '';
  el.appendChild(firstOption);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labelFn ? labelFn(v) : v;
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
    categoria: document.getElementById('f-categoria').value,
    tipoExame: document.getElementById('f-tipo-exame').value,
    exame: document.getElementById('f-exame').value,
    situacao: document.getElementById('f-situacao').value,
    laudista: document.getElementById('f-laudista').value,
    executante: document.getElementById('f-executante').value,
    tecnico: document.getElementById('f-tecnico').value,
    empresa: document.getElementById('f-empresa').value,
    origem: document.getElementById('f-origem').value,
    paciente: normalizeName(document.getElementById('f-paciente').value),
    solicitante: normalizeName(document.getElementById('f-solicitante').value),
    busca: normalizeName(document.getElementById('f-busca-tabela').value)
  };
}

function setLoading(isLoading) {
  const tabelaCard = document.querySelector('.table-card');
  if (tabelaCard) tabelaCard.classList.toggle('is-loading', isLoading);
  document.querySelectorAll('.chart-card').forEach(c => c.classList.toggle('is-loading', isLoading));
}

async function applyFilters() {
  const f = getFilters();
  const requestId = ++filtroRequestId;
  setLoading(true);
  try {
    const rows = await fetchFilteredRows(f);
    if (requestId !== filtroRequestId) return; // resposta obsoleta, filtros mudaram nesse meio-tempo
    filteredRows = rows;
    currentPage = 1;
    hideStatus();
    renderAll();
  } catch (e) {
    console.error(e);
    if (requestId !== filtroRequestId) return;
    showStatus('Erro ao consultar o banco de dados: ' + e.message, 'error');
  } finally {
    if (requestId === filtroRequestId) setLoading(false);
  }
}

function limparFiltros() {
  [
    'f-data-ini', 'f-data-fim', 'f-laudo-data-ini', 'f-laudo-data-fim',
    'f-convenio', 'f-setor', 'f-categoria', 'f-tipo-exame', 'f-exame', 'f-situacao',
    'f-laudista', 'f-executante', 'f-tecnico', 'f-empresa', 'f-origem',
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
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'top', color: '#0b3d91', font: { size: 9, weight: '600' } }
      },
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
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'top', color: '#1a2233', font: { size: 10, weight: '600' } }
      },
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
    const c = categoriaExame(r);
    m.set(c, (m.get(c) || 0) + 1);
  });
  const labels = [...m.keys()];
  const data = labels.map(l => m.get(l));
  upsertChart('chart-categoria', {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        datalabels: { color: '#fff', font: { size: 11, weight: '700' } }
      }
    }
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
      layout: { padding: { right: 26 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'right', clamp: true, color: '#1a2233', font: { size: 10, weight: '600' } }
      },
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
      layout: { padding: { right: 26 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'right', clamp: true, color: '#1a2233', font: { size: 10, weight: '600' } }
      },
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
      layout: { padding: { right: 26 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'right', clamp: true, color: '#1a2233', font: { size: 10, weight: '600' } }
      },
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
      layout: { padding: { top: 18 } },
      plugins: {
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'top', color: '#1a2233', font: { size: 10, weight: '600' } }
      },
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
      <td>${escapeHtml(ORIGEM_LABELS[r.origem] || r.origem)}</td>
    </tr>
  `).join('');

  document.getElementById('tabela-count').textContent = `${fmtInt(total)} registros`;
  document.getElementById('pagina-info').textContent = `Página ${currentPage} de ${totalPages}`;
  document.getElementById('btn-prev-page').disabled = currentPage <= 1;
  document.getElementById('btn-next-page').disabled = currentPage >= totalPages;
}

/* ======================= exportação ======================= */
const EXPORT_COLUMNS = [
  { header: 'Data Requisição', get: r => fmtDate(r.dt_requisicao) },
  { header: 'Paciente', get: r => r.paciente || '' },
  { header: 'Exame', get: r => r.exame || '' },
  { header: 'Convênio', get: r => r.convenio || '' },
  { header: 'Setor', get: r => r.setor || '' },
  { header: 'Situação', get: r => r.situacao || '' },
  { header: 'Solicitante', get: r => r.solicitante || '' },
  { header: 'Laudista', get: r => r.laudista || '' },
  { header: 'Data Laudo', get: r => fmtDate(r.data_laudo) },
  { header: 'Origem', get: r => ORIGEM_LABELS[r.origem] || r.origem || '' },
];
const PDF_EXPORT_LIMIT = 5000;

function exportarExcel() {
  if (!filteredRows.length) { alert('Não há registros para exportar com os filtros atuais.'); return; }
  const dados = filteredRows.map(r => {
    const obj = {};
    EXPORT_COLUMNS.forEach(col => { obj[col.header] = col.get(r); });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Exames');
  XLSX.writeFile(wb, `exames_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportarPdf() {
  if (!filteredRows.length) { alert('Não há registros para exportar com os filtros atuais.'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('Biblioteca de PDF não carregada.'); return; }

  const rows = filteredRows.slice(0, PDF_EXPORT_LIMIT);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(12);
  doc.text('Hospital Clínica do Esporte — Exames', 40, 30);
  doc.setFontSize(9);
  const resumo = `Gerado em ${fmtDateTime(new Date())} — ${fmtInt(filteredRows.length)} registro(s)`
    + (filteredRows.length > PDF_EXPORT_LIMIT ? ` (exibindo os primeiros ${fmtInt(PDF_EXPORT_LIMIT)})` : '');
  doc.text(resumo, 40, 46);

  doc.autoTable({
    startY: 58,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [31, 111, 235] },
    head: [EXPORT_COLUMNS.map(c => c.header)],
    body: rows.map(r => EXPORT_COLUMNS.map(c => c.get(r))),
  });

  doc.save(`exames_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function setupExportacao() {
  document.getElementById('btn-export-excel').addEventListener('click', exportarExcel);
  document.getElementById('btn-export-pdf').addEventListener('click', exportarPdf);
}

/* ======================= eventos ======================= */
function setupFiltros() {
  [
    'f-data-ini', 'f-data-fim', 'f-laudo-data-ini', 'f-laudo-data-fim',
    'f-convenio', 'f-setor', 'f-categoria', 'f-tipo-exame', 'f-exame', 'f-situacao',
    'f-laudista', 'f-executante', 'f-tecnico', 'f-empresa', 'f-origem'
  ].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
  });

  const pacienteInput = document.getElementById('f-paciente');
  const pacienteDl = document.getElementById('dl-pacientes');
  pacienteInput.addEventListener('input', debounce(() => updateAutocomplete('paciente', pacienteInput, pacienteDl), 250));
  pacienteInput.addEventListener('input', debounce(applyFilters, 400));

  const solicitanteInput = document.getElementById('f-solicitante');
  const solicitanteDl = document.getElementById('dl-solicitantes');
  solicitanteInput.addEventListener('input', debounce(() => updateAutocomplete('solicitante', solicitanteInput, solicitanteDl), 250));
  solicitanteInput.addEventListener('input', debounce(applyFilters, 400));

  document.getElementById('f-busca-tabela').addEventListener('input', debounce(applyFilters, 400));
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

/* ======================= init ======================= */
window.addEventListener('DOMContentLoaded', () => {
  setupFiltros();
  setupToggleEvolucao();
  setupPaginacao();
  setupExportacao();
  loadData();
});
