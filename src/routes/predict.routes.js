import express from "express";
import { pool } from "../db.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";
import { analyzeWithGemini } from "../ai/geminiAnalysis.js";
import { runBacktesting } from "../backtesting/backtestEngine.js";

const router = express.Router();

router.post("/predict", async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "El campo symbol es obligatorio"
      });
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
	  return res.status(409).json({
		ok: false,
		error: "Ya existe una predicción pendiente para este símbolo",
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

    res.json({
      ok: true,
      prediction_id: predictionInsert.rows[0].id,
      symbol: indicators.symbol,
      horizon: "4h",
      prediction_time: predictionInsert.rows[0].prediction_time,
      target_check_time: predictionInsert.rows[0].target_check_time,
      entry_price: indicators.lastPrice,
      indicators,
      analysis: aiResult
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post("/backtest/run", async (req, res) => {
  try {
    const result = await runBacktesting();

    res.json({
      ok: true,
      result
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/predictions", async (req, res) => {
  try {
    const { symbol, status } = req.query;

    const params = [];
    const conditions = [];

    if (symbol) {
      params.push(symbol.toUpperCase());
      conditions.push(`symbol = $${params.length}`);
    }

    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`status = $${params.length}`);
    }

    const where =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const { rows } = await pool.query(
      `
      SELECT *
      FROM predictions
      ${where}
      ORDER BY prediction_time DESC
      LIMIT 100
      `,
      params
    );

    res.json({
      ok: true,
      total: rows.length,
      predictions: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const { symbol } = req.query;

    const params = [];

    let where = `
      WHERE result_type IS NOT NULL
    `;

    if (symbol) {
      params.push(symbol.toUpperCase());
      where += ` AND symbol = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        symbol,

        COUNT(*)::int AS total_predictions,

        SUM(CASE WHEN result_type = 'WIN' THEN 1 ELSE 0 END)::int AS wins,

        SUM(CASE WHEN result_type = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,

        SUM(CASE WHEN result_type = 'NEUTRAL_HIT' THEN 1 ELSE 0 END)::int AS neutral_hits,

        SUM(CASE WHEN result_type = 'NEUTRAL_MISS' THEN 1 ELSE 0 END)::int AS neutral_misses,

        ROUND(
          SUM(CASE WHEN result_type IN ('WIN','NEUTRAL_HIT') THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100,
          2
        ) AS accuracy_percent,

        ROUND(AVG(change_percent), 4) AS avg_market_move_percent,

        ROUND(AVG(theoretical_profit_percent), 4) AS avg_theoretical_profit_percent,

        ROUND(SUM(theoretical_profit_percent), 4) AS total_theoretical_profit_percent,

        ROUND(MAX(theoretical_profit_percent), 4) AS best_result_percent,

        ROUND(MIN(theoretical_profit_percent), 4) AS worst_result_percent,

        ROUND(AVG(max_gain_percent), 4) AS avg_max_gain_percent,

        ROUND(AVG(max_loss_percent), 4) AS avg_max_loss_percent,

        ROUND(AVG(duration_minutes), 2) AS avg_duration_minutes

      FROM prediction_results
      ${where}
      GROUP BY symbol
      ORDER BY accuracy_percent DESC
      `,
      params
    );

    res.json({
      ok: true,
      stats: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/results", async (req, res) => {
  try {
    const { symbol } = req.query;

    const params = [];
    let where = "";

    if (symbol) {
      params.push(symbol.toUpperCase());
      where = `WHERE symbol = $${params.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT *
      FROM prediction_results
      ${where}
      ORDER BY created_at DESC
      LIMIT 100
      `,
      params
    );

    res.json({
      ok: true,
      total: rows.length,
      results: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});


export default router;