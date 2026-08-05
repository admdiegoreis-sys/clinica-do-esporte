import bcrypt from "bcryptjs";
import { getSql, json } from "./_db.mjs";
import { createSessionToken, buildSessionCookie } from "./_auth.mjs";

const MAX_TENTATIVAS = 5;
const JANELA_MINUTOS = 15;

function getIp(event) {
  return event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "desconhecido";
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

async function logTentativa(sql, { usuarioId = null, email, sucesso, motivo, ip, userAgent }) {
  await sql.query(
    `insert into public.acessos_log (usuario_id, email_tentativa, sucesso, motivo, ip, user_agent) values ($1, $2, $3, $4, $5, $6)`,
    [usuarioId, email, sucesso, motivo, ip, userAgent]
  );
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {}, { event });
  if (event.httpMethod !== "POST") return json(405, { error: "Metodo nao permitido." }, { event });

  const { email, senha } = parseBody(event);
  const ip = getIp(event);
  const userAgent = event.headers["user-agent"] || "";
  const emailNormalizado = (email || "").trim().toLowerCase();

  if (!emailNormalizado || !senha) {
    return json(400, { error: "Informe e-mail e senha." }, { event });
  }

  try {
    const sql = getSql();

    const recentes = await sql.query(
      `select count(*)::int as n from public.acessos_log
       where email_tentativa = $1 and sucesso = false and criado_em > now() - interval '${JANELA_MINUTOS} minutes'`,
      [emailNormalizado]
    );
    if (recentes[0].n >= MAX_TENTATIVAS) {
      await logTentativa(sql, { email: emailNormalizado, sucesso: false, motivo: "bloqueado_por_tentativas", ip, userAgent });
      return json(429, { error: `Muitas tentativas de login. Aguarde ${JANELA_MINUTOS} minutos e tente novamente.` }, { event });
    }

    const rows = await sql.query(`select * from public.usuarios where lower(email) = $1`, [emailNormalizado]);
    const usuario = rows[0];

    if (!usuario) {
      await logTentativa(sql, { email: emailNormalizado, sucesso: false, motivo: "usuario_nao_encontrado", ip, userAgent });
      return json(401, { error: "E-mail ou senha invalidos." }, { event });
    }

    if (!usuario.ativo) {
      await logTentativa(sql, { usuarioId: usuario.id, email: emailNormalizado, sucesso: false, motivo: "usuario_inativo", ip, userAgent });
      return json(401, { error: "Este usuario esta desativado. Contate um administrador." }, { event });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaValida) {
      await logTentativa(sql, { usuarioId: usuario.id, email: emailNormalizado, sucesso: false, motivo: "senha_invalida", ip, userAgent });
      return json(401, { error: "E-mail ou senha invalidos." }, { event });
    }

    await logTentativa(sql, { usuarioId: usuario.id, email: emailNormalizado, sucesso: true, motivo: null, ip, userAgent });
    await sql.query(`update public.usuarios set ultimo_login = now() where id = $1`, [usuario.id]);

    const token = await createSessionToken(usuario);
    const cookie = buildSessionCookie(token, event);

    return json(200, {
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    }, { event, cookies: cookie });
  } catch (error) {
    return json(500, { error: error.message }, { event });
  }
}
