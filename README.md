# Painel de Atendimentos — Clínica do Esporte

Aplicativo web (MVP) para gestão e visualização dos atendimentos/exames da clínica: importação da base de exames, filtros e dashboards de evolução.

## Stack

- HTML/CSS/JS puro no front-end (sem build), como nos demais projetos internos
- [Chart.js](https://www.chartjs.org/) para os gráficos
- [SheetJS (xlsx.js)](https://sheetjs.com/) para leitura do Excel na importação
- [Neon](https://neon.tech/) (Postgres serverless) como banco de dados, acessado via **Netlify Functions** (mesmo padrão do projeto Physiofit) — a string de conexão fica só no servidor, nunca no navegador
- Publicação via Netlify

## Estrutura

- `index.html` — layout (filtros, KPIs, gráficos, tabela, importação)
- `app.js` — lógica do front-end (filtros, gráficos, importação), fala com a API via `fetch`
- `styles.css` — estilo visual
- `netlify/functions/_db.mjs` — conexão com o Neon (`@neondatabase/serverless`) e helpers
- `netlify/functions/exames.mjs` — API (GET lista tudo, POST insere em lote, DELETE limpa a base)
- `netlify/functions/db-health.mjs` — endpoint simples para testar a conexão com o banco
- `setup_exames.sql` — script de criação da tabela `exames` (rodar uma vez no editor SQL do Neon)
- `netlify/functions/sync-ingest.mjs` — endpoint de upsert protegido por chave (`SYNC_API_KEY`), usado pela sincronização automática
- `sync-firebird.mjs` — script que roda numa máquina com acesso ao banco Firebird de origem (Gesthor), busca exames novos e envia para o `sync-ingest` (ver `sync-firebird.env.example` para as variáveis necessárias)
- `logo.png` — logo do Hospital Clínica do Esporte

## Como configurar (primeira vez)

1. Crie um banco no [Neon](https://neon.tech/) (ou use a integração nativa "Neon" dentro do próprio Netlify: **Site configuration → Integrations → Neon**, que já cria o banco e configura a variável de ambiente sozinho).
2. Pegue a **connection string** do banco (algo como `postgresql://usuario:senha@ep-xxxx.neon.tech/neondb?sslmode=require`).
3. No Netlify, vá em **Site configuration → Environment variables** e adicione `DATABASE_URL` com essa string (ou peça para eu configurar via `netlify env:set`).
4. No editor SQL do Neon, rode o conteúdo de `setup_exames.sql` para criar a tabela.
5. Abra o app publicado → aba **Importar dados** → envie a planilha no layout da aba **Base** (.xlsx) e confirme a importação (recomendado: "Substituir toda a base" a cada nova exportação do sistema).

## Rodando localmente

```
npm install
netlify dev
```

Isso sobe o site estático e as functions juntos (precisa de `DATABASE_URL` no `.env` local ou já vinculado ao site no Netlify).

## Colunas esperadas na planilha (aba "Base")

ID, Rex.ID, Tipo, Situação, Exec., Dt.Requisição, Previsão, Paciente, Cp, Lado, Exame, Convênio, Solicitante, Laudista, Executante, Usuário Resp. Rex, Técnico, Setor, Usuário Digitou, Data/Hora Digitação, Log de Usuário Laudo, Usuário Resp. Laudo, Data Laudo, Médico Autenticador, Médico Revisor, Empresa.

## Importação via XML

Ainda não implementada — o layout exato do XML exportado pelo sistema da clínica precisa ser enviado como modelo para o mapeamento dos campos ser ajustado.

## Sincronização automática com o Firebird (Gesthor)

O sistema de origem da clínica é o **Gesthor Hospitalar**, rodando em um banco **Firebird**. Em vez de exportar/importar Excel manualmente, um script (`sync-firebird.mjs`) roda numa máquina com acesso ao banco (via rede local ou Tailscale), busca os exames novos e envia para `/.netlify/functions/sync-ingest`, que faz *upsert* por `id_origem` (sem duplicar nem precisar apagar tudo).

1. Copie `sync-firebird.env.example` para `.env.local` (não versionado) e preencha `FB_HOST`, `FB_DATABASE` (caminho completo do `.fdb`), `FB_USER`, `FB_PASSWORD` e `SYNC_API_KEY` (mesma chave configurada no Netlify).
2. Rode `node --env-file=.env.local sync-firebird.mjs`. Ele guarda o maior `EXR_ID` já visto por fora (variável `SYNC_DESDE_ID`) para sincronizar só o que é novo — em produção, isso deve ser automatizado (ex: salvar o último ID sincronizado e agendar via Task Scheduler no Windows).
3. Consultar por `EXR_ID` (chave primária) em vez de data — o campo de data de digitação não tem índice no banco de origem e torna a consulta extremamente lenta.

**Mapeamento de tabelas do Gesthor** (schema com 700+ tabelas, sem view pronta) está documentado na memória do projeto — ver `sync-firebird.mjs` para a query completa com todos os `JOIN`s já validados contra dados reais.
