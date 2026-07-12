import { pool } from "./src/db.js";

async function run() {
  try {
    console.log("Truncating scalp_predictions and scalp_results tables to clear history...");
    await pool.query("TRUNCATE TABLE scalp_results, scalp_predictions RESTART IDENTITY CASCADE");
    console.log("Database history cleared successfully.");
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
