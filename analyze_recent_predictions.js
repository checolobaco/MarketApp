import { pool } from "./src/db.js";

async function run() {
  try {
    console.log("Fetching predictions from the last 3 hours...");
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    
    const { rows: scalp } = await pool.query(
      `
      SELECT sp.*, sr.result_type, sr.pips_result, sr.exit_price, sr.checked_at
      FROM scalp_predictions sp
      LEFT JOIN scalp_results sr ON sp.id = sr.scalp_prediction_id
      WHERE sp.prediction_time >= $1
      ORDER BY sp.prediction_time DESC
      `,
      [threeHoursAgo]
    );

    const { rows: general } = await pool.query(
      `
      SELECT * FROM predictions
      WHERE prediction_time >= $1
      ORDER BY prediction_time DESC
      `,
      [threeHoursAgo]
    );

    console.log("=== RECENT GOLD SCALP PREDICTIONS ===");
    console.log(`Found: ${scalp.length}`);
    scalp.forEach(p => {
      console.log(`[${p.prediction_time.toISOString()}] ${p.symbol} - Dir: ${p.predicted_direction} - Entry: ${p.entry_price} - Allowed: ${p.smart_allowed} - Result: ${p.result_type} (${p.pips_result} pips)`);
    });

    console.log("\n=== RECENT GENERAL STOCK PREDICTIONS ===");
    console.log(`Found: ${general.length}`);
    general.forEach(p => {
      console.log(`[${p.prediction_time.toISOString()}] ${p.symbol} - Dir: ${p.predicted_direction} - Entry: ${p.entry_price} - Correct: ${p.was_correct} - Status: ${p.status}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
