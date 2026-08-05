import bcrypt from "bcryptjs";
import { getSql, json } from "./_db.mjs";
import { requireAuth } from "./_auth.mjs";

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo nao permitido." }, { event });

  const user = await requireAuth(event);
  if (!user) return json(401, { error: "Nao autenticado." }, { event });

  const { senhaAtual, novaSenha } = parseBody(event);
  if (!senhaAtual || !novaSenha || novaSenha.length < 8) {
    return json(400, { error: "Informe a senha atual e uma nova senha com pelo menos 8 caracteres." }, { event });
  }

  try {
    const sql = getSql();
    const rows = await sql.query(`select * from public.usuarios where id = $1`, [user.id]);
    const usuario = rows[0];
    if (!usuario) return json(404, { error: "Usuario nao encontrado." }, { event });

    const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha_hash);
    if (!senhaValida) return json(401, { error: "Senha atual incorreta." }, { event });

    const novoHash = await bcrypt.hash(novaSenha, 12);
    await sql.query(`update public.usuarios set senha_hash = $1 where id = $2`, [novoHash, usuario.id]);

    return json(200, { ok: true }, { event });
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
