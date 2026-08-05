import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "session";
const SESSION_SECONDS = 8 * 60 * 60; // 8 horas

function getSecretKey() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET nao configurada no Netlify.");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user) {
  return new SignJWT({ sub: String(user.id), email: user.email, nome: user.nome, papel: user.papel })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(getSecretKey());
}

function isSecureRequest(event) {
  const host = event?.headers?.host || event?.headers?.Host || "";
  return !host.startsWith("localhost");
}

export function buildSessionCookie(token, event) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_SECONDS}`,
  ];
  if (isSecureRequest(event)) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(event) {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(event)) parts.push("Secure");
  return parts.join("; ");
}

function parseCookie(event, name) {
  const header = event?.headers?.cookie || event?.headers?.Cookie || "";
  const match = header.split(";").map(p => p.trim()).find(p => p.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

export async function getSessionUser(event) {
  const token = parseCookie(event, COOKIE_NAME);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return { id: Number(payload.sub), email: payload.email, nome: payload.nome, papel: payload.papel };
  } catch {
    return null;
  }
}

export async function requireAuth(event) {
  const user = await getSessionUser(event);
  if (!user) return null;
  return user;
}

export async function requireAdmin(event) {
  const user = await getSessionUser(event);
  if (!user || user.papel !== "admin") return null;
  return user;
}
