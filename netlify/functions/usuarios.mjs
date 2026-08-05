import bcrypt from "bcryptjs";
import { getSql, json } from "./_db.mjs";
import { requireAdmin } from "./_auth.mjs";

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleListUsuarios(sql, event) {
  const rows = await sql.query(
    `select id, nome, email, papel, ativo, criado_em, ultimo_login from public.usuarios order by nome asc`
  );
  return json(200, { usuarios: rows }, { event });
}

async function handleListLogs(sql, event) {
  const rows = await sql.query(`
    select l.id, l.email_tentativa, l.sucesso, l.motivo, l.ip, l.user_agent, l.criado_em, u.nome as usuario_nome
    from public.acessos_log l
    left join public.usuarios u on u.id = l.usuario_id
    order by l.criado_em desc
    limit 200
  `);
  return json(200, { logs: rows }, { event });
}

async function handleCreate(sql, body, event) {
  const nome = (body.nome || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const senha = body.senha || "";
  const papel = body.papel === "admin" ? "admin" : "usuario";

  if (!nome || !EMAIL_RE.test(email) || senha.length < 8) {
    return json(400, { error: "Informe nome, e-mail valido e senha com pelo menos 8 caracteres." }, { event });
  }

  const senhaHash = await bcrypt.hash(senha, 12);

  try {
    const rows = await sql.query(
      `insert into public.usuarios (nome, email, senha_hash, papel) values ($1, $2, $3, $4)
       returning id, nome, email, papel, ativo, criado_em, ultimo_login`,
      [nome, email, senhaHash, papel]
    );
    return json(201, { usuario: rows[0] }, { event });
  } catch (error) {
    if (error.message?.includes("usuarios_email_key")) {
      return json(409, { error: "Ja existe um usuario com este e-mail." }, { event });
    }
    throw error;
  }
}

async function handleUpdate(sql, body, event, adminId) {
  const id = Number(body.id);
  if (!id) return json(400, { error: "Id do usuario ausente." }, { event });

  if (id === adminId && body.ativo === false) {
    return json(400, { error: "Voce nao pode desativar sua propria conta." }, { event });
  }

  const sets = [];
  const values = [];
  let i = 1;

  if (typeof body.ativo === "boolean") { sets.push(`ativo = $${i++}`); values.push(body.ativo); }
  if (body.papel === "admin" || body.papel === "usuario") { sets.push(`papel = $${i++}`); values.push(body.papel); }
  if (typeof body.nome === "string" && body.nome.trim()) { sets.push(`nome = $${i++}`); values.push(body.nome.trim()); }
  if (typeof body.novaSenha === "string" && body.novaSenha) {
    if (body.novaSenha.length < 8) return json(400, { error: "A nova senha deve ter pelo menos 8 caracteres." }, { event });
    sets.push(`senha_hash = $${i++}`);
    values.push(await bcrypt.hash(body.novaSenha, 12));
  }

  if (!sets.length) return json(400, { error: "Nada para atualizar." }, { event });

  values.push(id);
  const rows = await sql.query(
    `update public.usuarios set ${sets.join(", ")} where id = $${i} returning id, nome, email, papel, ativo, criado_em, ultimo_login`,
    values
  );
  if (!rows.length) return json(404, { error: "Usuario nao encontrado." }, { event });
  return json(200, { usuario: rows[0] }, { event });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });

  const admin = await requireAdmin(event);
  if (!admin) return json(403, { error: "Acesso restrito a administradores." }, { event });

  try {
    const sql = getSql();
    const params = event.queryStringParameters || {};

    if (event.httpMethod === "GET") {
      if (params.logs === "1") return await handleListLogs(sql, event);
      return await handleListUsuarios(sql, event);
    }

    if (event.httpMethod === "POST") {
      return await handleCreate(sql, parseBody(event), event);
    }

    if (event.httpMethod === "PATCH") {
      return await handleUpdate(sql, parseBody(event), event, admin.id);
    }

    return json(405, { error: "Metodo nao permitido." }, { event });
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
