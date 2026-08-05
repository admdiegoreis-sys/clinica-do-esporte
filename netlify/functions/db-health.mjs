import { getSql, json } from "./_db.mjs";
import { requireAuth } from "./_auth.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });

  const user = await requireAuth(event);
  if (!user) return json(401, { error: "Nao autenticado." }, { event });

  try {
    const sql = getSql();
    await sql`select now() as server_time`;
    return json(200, { ok: true }, { event });
  } catch (error) {
    console.error("db-health error:", error);
    return json(500, { ok: false, error: "Falha ao conectar ao banco de dados." }, { event });
  }
}
