import { getSql, json } from "./_db.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(204, {});

  try {
    const sql = getSql();
    const rows = await sql`select now() as server_time`;

    return json(200, {
      ok: true,
      provider: "neon",
      serverTime: rows[0]?.server_time,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message,
    });
  }
}
