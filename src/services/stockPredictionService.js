import { pool } from "../db.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";
import { analyzeWithGemini } from "../ai/geminiAnalysis.js";

export async function createStockPrediction(symbol) {
  if (!symbol) {
    throwApiError(400, "El campo symbol es obligatorio");
  }

  const cleanSymbol = symbol.toUpperCase().trim();

  const pendingCheck = await pool.query(
    `
    SELECT id, prediction_time, target_check_time
    FROM predictions
    WHERE symbol = $1
    AND status = 'PENDING'
    ORDER BY prediction_time DESC
    LIMIT 1
    `,
    [cleanSymbol]
  );

  if (pendingCheck.rows.length > 0) {
    throwApiError(409, "Ya existe una predicción pendiente para este símbolo", {
      pending_prediction: pendingCheck.rows[0]
    });
  }

  const marketData = await getMarketData(cleanSymbol);
  const indicators = calculateIndicators(marketData);
  const aiResult = await analyzeWithGemini(indicators);

  const predictionInsert = await pool.query(
    `
    INSERT INTO predictions
    (
      symbol,
      predicted_direction,
      probability_up,
      probability_down,
      confidence,
      entry_price,
      target_check_time,
      indicators,
      ai_response,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '4 hours',$7,$8,'PENDING')
    RETURNING id, prediction_time, target_check_time
    `,
    [
      indicators.symbol,
      aiResult.direction,
      aiResult.probability_up,
      aiResult.probability_down,
      aiResult.confidence,
      indicators.lastPrice,
      indicators,
      aiResult
    ]
  );

  return {
    ok: true,
    prediction_id: predictionInsert.rows[0].id,
    symbol: indicators.symbol,
    horizon: "4h",
    prediction_time: predictionInsert.rows[0].prediction_time,
    target_check_time: predictionInsert.rows[0].target_check_time,
    entry_price: indicators.lastPrice,
    indicators,
    analysis: aiResult
  };
}

function throwApiError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  throw error;
}
