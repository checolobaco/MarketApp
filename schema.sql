-- Esquema de base de datos para MarketApp
-- Crear tablas necesarias en PostgreSQL

-- 1. Tabla de Logs de API
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

-- 2. Tabla de Cache de Inteligencia Artificial (Gemini)
CREATE TABLE IF NOT EXISTS ai_cache (
    cache_key VARCHAR(255) PRIMARY KEY,
    response JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- 3. Tabla de Predicciones Generales (Acciones y otros activos)
CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    prediction_time TIMESTAMP DEFAULT NOW(),
    symbol VARCHAR(20) NOT NULL,
    predicted_direction VARCHAR(10),
    probability_up NUMERIC,
    probability_down NUMERIC,
    confidence VARCHAR(20),
    entry_price NUMERIC,
    actual_price NUMERIC,
    actual_direction VARCHAR(10),
    was_correct BOOLEAN,
    target_check_time TIMESTAMP,
    checked_at TIMESTAMP,
    indicators JSONB,
    ai_response JSONB,
    status VARCHAR(20) DEFAULT 'PENDING',
    strategy VARCHAR(50),
    horizon_hours INTEGER DEFAULT 4
);

-- 4. Tabla de Resultados de Predicciones Generales
CREATE TABLE IF NOT EXISTS prediction_results (
    id SERIAL PRIMARY KEY,
    prediction_id INTEGER REFERENCES predictions(id) ON DELETE CASCADE,
    symbol VARCHAR(20),
    entry_price NUMERIC,
    exit_price NUMERIC,
    predicted_direction VARCHAR(10),
    actual_direction VARCHAR(10),
    change_percent NUMERIC,
    theoretical_profit_percent NUMERIC,
    was_correct BOOLEAN,
    result_type VARCHAR(20),
    max_gain_percent NUMERIC,
    max_loss_percent NUMERIC,
    prediction_time TIMESTAMP,
    checked_at TIMESTAMP,
    duration_minutes INTEGER
);

-- 5. Tabla de Predicciones Scalp (XAUUSD / Oro)
CREATE TABLE IF NOT EXISTS scalp_predictions (
    id SERIAL PRIMARY KEY,
    prediction_time TIMESTAMP DEFAULT NOW(),
    symbol VARCHAR(20) DEFAULT 'XAUUSD',
    predicted_direction VARCHAR(10),
    probability_buy NUMERIC,
    probability_sell NUMERIC,
    confidence VARCHAR(20),
    entry_price NUMERIC,
    target_check_time TIMESTAMP,
    stop_loss NUMERIC,
    take_profit_1 NUMERIC,
    take_profit_2 NUMERIC,
    risk_reward NUMERIC,
    indicators JSONB,
    ai_response JSONB,
    status VARCHAR(20) DEFAULT 'PENDING',
    strategy VARCHAR(50) DEFAULT 'XAU_SCALP',
    session_id VARCHAR(50),
    signal_time_label VARCHAR(50),
    should_enter BOOLEAN,
    risk_filter JSONB,
    blocked_reason TEXT,
    macro_risk VARCHAR(50),
    trade_score NUMERIC,
    trade_quality VARCHAR(50),
    recommendation TEXT,
    quality_details JSONB,
    smart_filter JSONB,
    smart_allowed BOOLEAN,
    smart_blocked_reason TEXT,
    actual_price NUMERIC,
    actual_direction VARCHAR(10),
    result_type VARCHAR(20),
    pips_result NUMERIC,
    was_correct BOOLEAN,
    checked_at TIMESTAMP
);

-- 6. Tabla de Resultados Scalp
CREATE TABLE IF NOT EXISTS scalp_results (
    id SERIAL PRIMARY KEY,
    scalp_prediction_id INTEGER REFERENCES scalp_predictions(id) ON DELETE CASCADE,
    symbol VARCHAR(20) DEFAULT 'XAUUSD',
    entry_price NUMERIC,
    exit_price NUMERIC,
    predicted_direction VARCHAR(10),
    actual_direction VARCHAR(10),
    stop_loss NUMERIC,
    take_profit_1 NUMERIC,
    take_profit_2 NUMERIC,
    pips_result NUMERIC,
    theoretical_profit_percent NUMERIC,
    result_type VARCHAR(20),
    was_correct BOOLEAN,
    max_gain_pips NUMERIC,
    max_loss_pips NUMERIC,
    prediction_time TIMESTAMP,
    checked_at TIMESTAMP,
    duration_minutes INTEGER,
    tp1_hit BOOLEAN,
    tp2_hit BOOLEAN,
    sl_hit BOOLEAN,
    first_hit VARCHAR(50),
    first_hit_price NUMERIC,
    minutes_to_first_hit NUMERIC,
    real_exit_reason VARCHAR(100),
    real_pips_result NUMERIC,
    session_name VARCHAR(50),
    trade_quality VARCHAR(50),
    adx_signal VARCHAR(50),
    atr_signal VARCHAR(50),
    prediction_hour INTEGER
);
