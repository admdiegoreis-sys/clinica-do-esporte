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
let resumo = null;        // KPIs e series dos graficos, ja somados no servidor
let paginaRows = [];      // apenas as linhas da pagina visivel da tabela
let totalFiltrado = 0;    // quantas linhas o filtro atual retorna no total
let filtrosAtuais = {};   // usado pela exportacao, que busca sob demanda
let currentPage = 1;
const PAGE_SIZE = 25;
let evolucaoGranularidade = 'dia';
let filtroRequestId = 0;
let currentUser = null;
const charts = {};

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401 && path !== '/auth-login' && path !== '/auth-me') {
    showLoginView('Sua sessão expirou. Faça login novamente.');
    throw new Error('Sessão expirada.');
  }
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

/* KPIs e graficos vem somados do servidor; a tabela busca so a pagina visivel.
   Antes a tela baixava TODAS as linhas do filtro (30 colunas) a cada clique. */
async function fetchResumo(filterParams) {
  const qs = buildFilterQuery(filterParams);
  return api(`/exames-resumo${qs ? '?' + qs : ''}`);
}

async function fetchPagina(filterParams, pagina) {
  const qs = buildFilterQuery(filterParams);
  const sep = qs ? '&' : '';
  const offset = (pagina - 1) * PAGE_SIZE;
  return api(`/exames?${qs}${sep}limit=${PAGE_SIZE}&offset=${offset}`);
}

/** Usado so na exportacao, sob demanda — nunca no fluxo de filtrar. */
async function fetchTodasAsLinhas(filterParams, aoProgredir) {
  const LOTE = 5000;
  const qs = buildFilterQuery(filterParams);
  const sep = qs ? '&' : '';
  let todas = [];
  let offset = 0;
  let total = null;

  do {
    const p = await api(`/exames?${qs}${sep}modo=exportacao&limit=${LOTE}&offset=${offset}`);
    if (total === null) total = p.total;
    todas = todas.concat(p.rows);
    offset += LOTE;
    if (aoProgredir) aoProgredir(todas.length, total);
  } while (offset < total);

  return todas;
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
  filtrosAtuais = f;
  currentPage = 1;
  const requestId = ++filtroRequestId;
  setLoading(true);
  try {
    const [r, pagina] = await Promise.all([fetchResumo(f), fetchPagina(f, 1)]);
    if (requestId !== filtroRequestId) return; // resposta obsoleta, filtros mudaram nesse meio-tempo
    resumo = r;
    paginaRows = pagina.rows;
    totalFiltrado = pagina.total;
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

/** Troca de pagina busca so aquela pagina; KPIs e graficos nao mudam. */
async function irParaPagina(pagina) {
  const requestId = ++filtroRequestId;
  setLoading(true);
  try {
    const p = await fetchPagina(filtrosAtuais, pagina);
    if (requestId !== filtroRequestId) return;
    currentPage = pagina;
    paginaRows = p.rows;
    totalFiltrado = p.total;
    renderTabela();
  } catch (e) {
    console.error(e);
    if (requestId === filtroRequestId) showStatus('Erro ao carregar a página: ' + e.message, 'error');
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
  const k = resumo ? resumo.kpis : null;
  const txt = (id, v) => { document.getElementById(id).textContent = v; };
  if (!k) {
    ['kpi-total', 'kpi-pacientes', 'kpi-dias', 'kpi-media', 'kpi-tempo-laudo', 'kpi-concluido']
      .forEach(id => txt(id, '—'));
    return;
  }
  txt('kpi-total', fmtInt(k.total));
  txt('kpi-pacientes', fmtInt(k.pacientes));
  txt('kpi-dias', fmtInt(k.dias));
  txt('kpi-media', fmtDec(k.media, 1));
  txt('kpi-tempo-laudo', k.tempoMedioLaudo === null ? '—' : `${fmtDec(k.tempoMedioLaudo, 1)} dias`);
  txt('kpi-concluido', `${fmtDec(k.pctConcluido, 1)}%`);
}

/** Series vem do servidor como pares [rotulo, quantidade]. */
function serie(nome) {
  return (resumo && resumo.graficos && resumo.graficos[nome]) || [];
}

/* ======================= charts ======================= */
function upsertChart(id, config) {
  const ctx = document.getElementById(id).getContext('2d');
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, config);
}

function renderChartEvolucao() {
  const pares = serie(evolucaoGranularidade === 'mes' ? 'evolucaoMes' : 'evolucaoDia');
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
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

function renderChartSetor() {
  const pares = serie('setor');
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
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
  const pares = serie('categoria');
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
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
  const pares = serie('convenio'); // ja vem ordenado desc do servidor
  let labels = pares.map(p => p[0]);
  let data = pares.map(p => p[1]);
  if (labels.length > 8) {
    const outros = data.slice(8).reduce((a, b) => a + b, 0);
    labels = [...labels.slice(0, 8), 'Outros'];
    data = [...data.slice(0, 8), outros];
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
  const pares = serie('medicos'); // top 10, ja ordenado no servidor
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
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
  const pares = serie('pacientes'); // top 10, ja ordenado no servidor
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
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
  const m = new Map(serie('situacao'));
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
  const total = totalFiltrado;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const body = document.getElementById('tabela-exames-body');
  body.innerHTML = paginaRows.map(r => `
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

/* A exportacao e' o unico ponto que legitimamente precisa de todas as linhas —
   por isso ela as busca aqui, no clique, e nao mais a cada filtro digitado. */
async function comLinhasCompletas(botaoId, rotuloOriginal, tarefa) {
  const btn = document.getElementById(botaoId);
  if (!totalFiltrado) { alert('Não há registros para exportar com os filtros atuais.'); return; }
  btn.disabled = true;
  try {
    const linhas = await fetchTodasAsLinhas(filtrosAtuais, (carregadas, total) => {
      btn.textContent = `Baixando ${fmtInt(carregadas)}/${fmtInt(total)}...`;
    });
    btn.textContent = 'Gerando arquivo...';
    await tarefa(linhas);
  } catch (e) {
    console.error(e);
    alert('Erro ao exportar: ' + e.message);
  } finally {
    btn.textContent = rotuloOriginal;
    btn.disabled = false;
  }
}

function exportarExcel() {
  return comLinhasCompletas('btn-export-excel', 'Exportar Excel', (linhas) => {
    const dados = linhas.map(r => {
      const obj = {};
      EXPORT_COLUMNS.forEach(col => { obj[col.header] = col.get(r); });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Exames');
    XLSX.writeFile(wb, `exames_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}

function exportarPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('Biblioteca de PDF não carregada.'); return; }
  return comLinhasCompletas('btn-export-pdf', 'Exportar PDF', (linhas) => {
    const rows = linhas.slice(0, PDF_EXPORT_LIMIT);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    doc.setFontSize(12);
    doc.text('Hospital Clínica do Esporte — Exames', 40, 30);
    doc.setFontSize(9);
    const subtitulo = `Gerado em ${fmtDateTime(new Date())} — ${fmtInt(linhas.length)} registro(s)`
      + (linhas.length > PDF_EXPORT_LIMIT ? ` (exibindo os primeiros ${fmtInt(PDF_EXPORT_LIMIT)})` : '');
    doc.text(subtitulo, 40, 46);

    doc.autoTable({
      startY: 58,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [31, 111, 235] },
      head: [EXPORT_COLUMNS.map(c => c.header)],
      body: rows.map(r => EXPORT_COLUMNS.map(c => c.get(r))),
    });

    doc.save(`exames_${new Date().toISOString().slice(0, 10)}.pdf`);
  });
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
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (currentPage > 1) irParaPagina(currentPage - 1);
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(totalFiltrado / PAGE_SIZE));
    if (currentPage < totalPages) irParaPagina(currentPage + 1);
  });
}

/* ======================= autenticação ======================= */
let appInitialized = false;

function showLoginView(mensagem) {
  currentUser = null;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('view-login').hidden = false;
  document.getElementById('painel-trocar-senha').hidden = true;
  const erroEl = document.getElementById('login-erro');
  if (mensagem) {
    erroEl.textContent = mensagem;
    erroEl.hidden = false;
  } else {
    erroEl.hidden = true;
  }
}

function onLoginSuccess(usuario) {
  currentUser = usuario;
  document.getElementById('view-login').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('login-erro').hidden = true;
  document.getElementById('topbar-user-nome').textContent = usuario.nome;
  document.getElementById('nav-btn-acessos').hidden = usuario.papel !== 'admin';

  if (!appInitialized) {
    appInitialized = true;
    setupFiltros();
    setupToggleEvolucao();
    setupPaginacao();
    setupExportacao();
    loadData();
  }
}

async function checkSession() {
  try {
    const { usuario } = await api('/auth-me');
    if (!currentUser) onLoginSuccess(usuario);
  } catch {
    if (!currentUser) showLoginView();
  }
}

function setupLogin() {
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const erroEl = document.getElementById('login-erro');
    const btn = document.getElementById('btn-login');
    erroEl.hidden = true;
    btn.disabled = true;
    try {
      const { usuario } = await api('/auth-login', { method: 'POST', body: JSON.stringify({ email, senha }) });
      document.getElementById('login-senha').value = '';
      onLoginSuccess(usuario);
    } catch (err) {
      erroEl.textContent = err.message;
      erroEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

function setupLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await api('/auth-logout', { method: 'POST' }); } catch { /* ignora falha de rede no logout */ }
    showLoginView();
  });
}

function setupTrocarSenha() {
  const painel = document.getElementById('painel-trocar-senha');
  const statusEl = document.getElementById('trocar-senha-status');

  document.getElementById('btn-trocar-senha').addEventListener('click', () => {
    painel.hidden = !painel.hidden;
  });
  document.getElementById('btn-cancelar-trocar-senha').addEventListener('click', () => {
    painel.hidden = true;
    document.getElementById('form-trocar-senha').reset();
    statusEl.hidden = true;
  });
  document.getElementById('form-trocar-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    const senhaAtual = document.getElementById('senha-atual').value;
    const novaSenha = document.getElementById('senha-nova').value;
    statusEl.hidden = true;
    try {
      await api('/auth-trocar-senha', { method: 'POST', body: JSON.stringify({ senhaAtual, novaSenha }) });
      statusEl.textContent = 'Senha alterada com sucesso.';
      statusEl.className = 'trocar-senha-status ok';
      statusEl.hidden = false;
      document.getElementById('form-trocar-senha').reset();
      setTimeout(() => { painel.hidden = true; statusEl.hidden = true; }, 1500);
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'trocar-senha-status error';
      statusEl.hidden = false;
    }
  });
}

/* ======================= gestão de acessos ======================= */
async function loadAcessos() {
  try {
    const [{ usuarios }, { logs }] = await Promise.all([api('/usuarios'), api('/usuarios?logs=1')]);
    renderUsuarios(usuarios);
    renderLogs(logs);
  } catch (err) {
    console.error(err);
  }
}

function renderUsuarios(usuarios) {
  const body = document.getElementById('tabela-usuarios-body');
  body.innerHTML = usuarios.map(u => `
    <tr>
      <td>${escapeHtml(u.nome)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.papel === 'admin' ? 'Administrador' : 'Usuário'}</td>
      <td><span class="badge ${u.ativo ? 'badge-ativo' : 'badge-inativo'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
      <td>${fmtDateTime(u.ultimo_login)}</td>
      <td>
        <button class="acao-btn" data-acao="toggle-ativo" data-id="${u.id}" data-ativo="${u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button>
        <button class="acao-btn" data-acao="toggle-papel" data-id="${u.id}" data-papel="${u.papel}">${u.papel === 'admin' ? 'Tornar usuário' : 'Tornar admin'}</button>
        <button class="acao-btn danger" data-acao="resetar-senha" data-id="${u.id}">Redefinir senha</button>
      </td>
    </tr>
  `).join('');
}

function renderLogs(logs) {
  const body = document.getElementById('tabela-logs-body');
  body.innerHTML = logs.map(l => `
    <tr>
      <td>${fmtDateTime(l.criado_em)}</td>
      <td>${escapeHtml(l.usuario_nome) || '—'}</td>
      <td>${escapeHtml(l.email_tentativa)}</td>
      <td><span class="badge ${l.sucesso ? 'badge-sucesso' : 'badge-falha'}">${l.sucesso ? 'Sucesso' : 'Falha'}</span></td>
      <td>${escapeHtml(l.motivo) || '—'}</td>
      <td>${escapeHtml(l.ip) || '—'}</td>
    </tr>
  `).join('');
}

function setupAcessos() {
  document.getElementById('form-novo-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('novo-usuario-nome').value.trim();
    const email = document.getElementById('novo-usuario-email').value.trim();
    const senha = document.getElementById('novo-usuario-senha').value;
    const papel = document.getElementById('novo-usuario-papel').value;
    const statusEl = document.getElementById('novo-usuario-status');
    statusEl.hidden = true;
    try {
      await api('/usuarios', { method: 'POST', body: JSON.stringify({ nome, email, senha, papel }) });
      document.getElementById('form-novo-usuario').reset();
      statusEl.textContent = 'Usuário criado com sucesso.';
      statusEl.className = 'import-status ok';
      statusEl.hidden = false;
      loadAcessos();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'import-status error';
      statusEl.hidden = false;
    }
  });

  document.getElementById('tabela-usuarios-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    try {
      if (btn.dataset.acao === 'toggle-ativo') {
        const ativo = btn.dataset.ativo === 'true';
        await api('/usuarios', { method: 'PATCH', body: JSON.stringify({ id, ativo: !ativo }) });
      } else if (btn.dataset.acao === 'toggle-papel') {
        const papel = btn.dataset.papel === 'admin' ? 'usuario' : 'admin';
        await api('/usuarios', { method: 'PATCH', body: JSON.stringify({ id, papel }) });
      } else if (btn.dataset.acao === 'resetar-senha') {
        const novaSenha = prompt('Digite a nova senha temporaria (minimo 8 caracteres):');
        if (!novaSenha) return;
        if (novaSenha.length < 8) { alert('A senha deve ter pelo menos 8 caracteres.'); return; }
        await api('/usuarios', { method: 'PATCH', body: JSON.stringify({ id, novaSenha }) });
        alert('Senha redefinida com sucesso.');
      }
      loadAcessos();
    } catch (err) {
      alert(err.message);
    }
  });
}

function setupNav() {
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
      if (btn.dataset.view === 'acessos') loadAcessos();
    });
  });
}

/* ======================= init ======================= */
window.addEventListener('DOMContentLoaded', () => {
  setupLogin();
  setupLogout();
  setupNav();
  setupTrocarSenha();
  setupAcessos();
  checkSession();
});
