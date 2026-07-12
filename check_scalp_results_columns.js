import { pool } from "./src/db.js";

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'scalp_results'
    `);
    console.log("Columns of scalp_results:", rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
