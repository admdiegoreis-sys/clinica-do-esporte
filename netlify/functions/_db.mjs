import { neon } from "@neondatabase/serverless";

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nao configurada no Netlify.");
  }

  return neon(process.env.DATABASE_URL);
}

const ALLOWED_ORIGINS = new Set([
  "https://clinicadoesporte.netlify.app",
  "http://localhost:5180",
  "http://localhost:8888",
]);

export function corsOrigin(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin;
  return origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://clinicadoesporte.netlify.app";
}

export function json(statusCode, body, options = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": options.event ? corsOrigin(options.event) : "https://clinicadoesporte.netlify.app",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    ...(options.headers || {}),
  };
  if (options.cookies) {
    headers["Set-Cookie"] = options.cookies;
  }
  return { statusCode, headers, body: JSON.stringify(body) };
}

export function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/* Unidades que ficam FORA do painel a pedido da clinica (2026-08-05).
   Os dados continuam no banco — isto e' filtro de visualizacao apenas.
   Para voltar a exibir alguma, basta remover a linha daqui. */
export const EMPRESAS_OCULTAS = [
  "BURITI CENTRO MEDICO PARTICIPACAO LTDA",
  "PLANALTO CENTRO MEDICO E PARTICIPACOES",
  "FISIOTERAPIA BURITI",
  "FISIOTERAPIA PLANALTO",
];

const listaSql = EMPRESAS_OCULTAS.map((e) => `'${e.replaceAll("'", "''")}'`).join(", ");

/** Clausula pronta para concatenar em WHERE (nomes sao constantes internas, nao entrada do usuario). */
export const FILTRO_EMPRESAS = `(empresa is null or empresa not in (${listaSql}))`;
