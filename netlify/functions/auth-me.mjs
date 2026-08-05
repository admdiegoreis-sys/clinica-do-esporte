import { json } from "./_db.mjs";
import { getSessionUser } from "./_auth.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "GET") return json(405, { error: "Metodo nao permitido." }, { event });

  const user = await getSessionUser(event);
  if (!user) return json(401, { error: "Nao autenticado." }, { event });

  return json(200, { usuario: user }, { event });
}
