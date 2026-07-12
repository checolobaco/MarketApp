import { pool } from "./src/db.js";

async function run() {
  try {
    console.log("Analyzing XAU/USD Backfill Results (Last 30 Days)...");

    // Total predictions vs allowed ones
    const { rows: totals } = await pool.query(`
      SELECT 
        COUNT(*)::int AS total_predictions,
        SUM(CASE WHEN smart_allowed = true THEN 1 ELSE 0 END)::int AS allowed_trades,
        SUM(CASE WHEN smart_allowed = false THEN 1 ELSE 0 END)::int AS blocked_trades
      FROM scalp_predictions
    `);

    // Win Rate of ALLOWED Trades ONLY
    const { rows: allowedWins } = await pool.query(`
      SELECT 
        COUNT(*)::int AS total,
        SUM(CASE WHEN sr.result_type = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN sr.result_type = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN sr.result_type = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS neutrals,
        ROUND(
          SUM(CASE WHEN sr.result_type = 'WIN' THEN 1 ELSE 0 END)::numeric / 
          NULLIF(SUM(CASE WHEN sr.result_type IN ('WIN', 'LOSS') THEN 1 ELSE 0 END), 0) * 100, 
          2
        ) AS win_rate,
        ROUND(SUM(sr.pips_result), 2) AS total_pips
      FROM scalp_results sr
      JOIN scalp_predictions sp ON sr.scalp_prediction_id = sp.id
      WHERE sp.smart_allowed = true
    `);

    console.log("\n=== METRICAS CLAVE ===");
    console.log("Totales:", totals[0]);
    console.log("Rendimiento Trades Permitidos (Filtro Activo):", allowedWins[0]);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
