import { json } from "./_db.mjs";
import { buildClearCookie } from "./_auth.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo nao permitido." }, { event });

  return json(200, { ok: true }, { event, cookies: buildClearCookie(event) });
}
