import { pool } from "../db.js";

export async function logApiCall({ provider, symbol, requestType, action }) {
  const start = Date.now();
  let status = "SUCCESS";
  let errorMessage = null;
  let result = null;

  try {
    result = await action();
    return result;
  } catch (error) {
    status = "FAILED";
    errorMessage = error.message;
    throw error;
  } finally {
    const duration = Date.now() - start;
    // Guardar log en base de datos de manera asíncrona para no bloquear
    pool.query(
      `
      INSERT INTO api_logs (provider, symbol, request_type, status, error_message, response_time_ms)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [provider, symbol, requestType, status, errorMessage, duration]
    ).catch(err => {
      console.error("Falla al guardar log de API:", err.message);
    });
  }
}
