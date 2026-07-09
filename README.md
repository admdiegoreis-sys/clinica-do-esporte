# Painel de Atendimentos — Clínica do Esporte

Aplicativo web (MVP) para gestão e visualização dos atendimentos/exames da clínica: importação da base de exames, filtros e dashboards de evolução.

## Stack

- HTML/CSS/JS puro (sem build), como nos demais projetos internos
- [Chart.js](https://www.chartjs.org/) para os gráficos
- [SheetJS (xlsx.js)](https://sheetjs.com/) para leitura do Excel na importação
- [Supabase](https://supabase.com/) como banco de dados (Postgres + REST)
- Publicação estática via Netlify

## Estrutura

- `index.html` — layout (filtros, KPIs, gráficos, tabela, importação)
- `app.js` — lógica (conexão Supabase, filtros, gráficos, importação)
- `styles.css` — estilo visual
- `setup_exames.sql` — script de criação da tabela `exames` no Supabase (rodar uma vez no SQL Editor do projeto)
- `logo.png` — logo do Hospital Clínica do Esporte

## Como configurar (primeira vez)

1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. No **SQL Editor** do projeto, rode o conteúdo de `setup_exames.sql`.
3. Em **Project Settings → API**, copie a **URL** e a **anon public key**.
4. Abra o app publicado, clique no ícone de engrenagem (⚙) no topo e cole a URL e a chave. Fica salvo no navegador.
5. Vá em **Importar dados**, envie a planilha no layout da aba **Base** (.xlsx) e confirme a importação (recomendado: "Substituir toda a base" a cada nova exportação do sistema).

## Colunas esperadas na planilha (aba "Base")

ID, Rex.ID, Tipo, Situação, Exec., Dt.Requisição, Previsão, Paciente, Cp, Lado, Exame, Convênio, Solicitante, Laudista, Executante, Usuário Resp. Rex, Técnico, Setor, Usuário Digitou, Data/Hora Digitação, Log de Usuário Laudo, Usuário Resp. Laudo, Data Laudo, Médico Autenticador, Médico Revisor, Empresa.

## Importação via XML

Ainda não implementada — o layout exato do XML exportado pelo sistema da clínica precisa ser enviado como modelo para o mapeamento dos campos ser ajustado.

## Publicação no Netlify

Projeto estático, sem etapa de build (`netlify.toml` já configurado com `command = ""`).
