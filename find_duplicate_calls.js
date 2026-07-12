import { pool } from "./src/db.js";

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM api_logs 
      ORDER BY timestamp DESC 
      LIMIT 100
    `);
    
    console.log("=== TODOS LOS LOGS DE API ===");
    rows.forEach(r => {
      console.log(`[${r.timestamp.toISOString()}] ${r.provider} - ${r.symbol} - ${r.request_type} - Status: ${r.status} (${r.response_time_ms}ms)`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
