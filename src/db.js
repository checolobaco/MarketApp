import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const createTableQuery = `
  CREATE TABLE IF NOT EXISTS api_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT NOW(),
    provider VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    request_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    response_time_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_cache (
    cache_key VARCHAR(255) PRIMARY KEY,
    response JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trading_journal (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    action VARCHAR(10) NOT NULL,
    volume NUMERIC(10, 4) NOT NULL,
    entry_price NUMERIC(15, 5) NOT NULL,
    exit_price NUMERIC(15, 5),
    stop_loss NUMERIC(15, 5),
    take_profit NUMERIC(15, 5),
    pips_result NUMERIC(12, 2),
    profit_loss_usd NUMERIC(15, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    source VARCHAR(30) NOT NULL,
    prediction_id INTEGER,
    broker_position_id VARCHAR(100),
    commission NUMERIC(10, 2) DEFAULT 0.00,
    swap NUMERIC(10, 2) DEFAULT 0.00,
    net_profit_loss_usd NUMERIC(15, 2),
    created_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP,
    notes TEXT
  );

  ALTER TABLE trading_journal ADD COLUMN IF NOT EXISTS commission NUMERIC(10, 2) DEFAULT 0.00;
  ALTER TABLE trading_journal ADD COLUMN IF NOT EXISTS swap NUMERIC(10, 2) DEFAULT 0.00;
  ALTER TABLE trading_journal ADD COLUMN IF NOT EXISTS net_profit_loss_usd NUMERIC(15, 2);

  CREATE TABLE IF NOT EXISTS automation_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  );
`;

pool.query(createTableQuery)
  .then(() => console.log("Tablas api_logs, ai_cache y trading_journal inicializadas correctamente con soporte de costos."))
  .catch((err) => console.error("Error al inicializar tablas:", err.message));