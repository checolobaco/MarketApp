import { pool } from "../db.js";

export async function getAiCache(cacheKey) {
  const { rows } = await pool.query(
    `
    SELECT response
    FROM ai_cache
    WHERE cache_key = $1
    AND expires_at > NOW()
    LIMIT 1
    `,
    [cacheKey]
  );

  return rows.length ? rows[0].response : null;
}

export async function setAiCache(cacheKey, response, ttlMinutes = 30) {
  await pool.query(
    `
    INSERT INTO ai_cache
    (cache_key, response, expires_at)
    VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
    ON CONFLICT (cache_key)
    DO UPDATE SET
      response = EXCLUDED.response,
      created_at = NOW(),
      expires_at = EXCLUDED.expires_at
    `,
    [cacheKey, response, ttlMinutes]
  );
}