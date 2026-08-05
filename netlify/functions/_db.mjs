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
