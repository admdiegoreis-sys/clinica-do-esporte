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
