import express from "express";
import { pool } from "../db.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";
import { analyzeWithGemini } from "../ai/geminiAnalysis.js";

const router = express.Router();

const ALLOWED_SIGNALS = [
  "OPENING_0800",
  "OPENING_0815",
  "OPENING_0830"
];

router.post("/opening/predict", async (req, res) => {
  try {
    const { symbol, signal } = req.body;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "El campo symbol es obligatorio"
      });
    }

    if (!signal || !ALLOWED_SIGNALS.includes(signal)) {
      return res.status(400).json({
        ok: false,
        error: "signal inválido. Usa OPENING_0800, OPENING_0815 u OPENING_0830"
      });
    }

    const cleanSymbol = symbol.toUpperCase().trim();
    const sessionId = buildOpeningSessionId(cleanSymbol);

    const duplicate = await pool.query(
      `
      SELECT id
      FROM predictions
      WHERE symbol = $1
      AND session_id = $2
      AND signal_time_label = $3
      LIMIT 1
      `,
      [cleanSymbol, sessionId, signal]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe esta señal para la sesión de apertura",
        symbol: cleanSymbol,
        session_id: sessionId,
        signal
      });
    }

    const marketData = await getMarketData(cleanSymbol);
    const indicators = calculateIndicators(marketData);
    const aiResult = await analyzeWithGemini(indicators);

    const inserted = await pool.query(
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
        status,
        strategy,
        session_id,
        signal_time_label
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '4 hours',$7,$8,'PENDING',$9,$10,$11)
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
        aiResult,
        "OPENING_CONFIRMATION",
        sessionId,
        signal
      ]
    );

    res.json({
      ok: true,
      prediction_id: inserted.rows[0].id,
      symbol: cleanSymbol,
      session_id: sessionId,
      strategy: "OPENING_CONFIRMATION",
      signal,
      horizon: "4h",
      prediction_time: inserted.rows[0].prediction_time,
      target_check_time: inserted.rows[0].target_check_time,
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

router.get("/opening/session", async (req, res) => {
  try {
    const { symbol, date } = req.query;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "El query param symbol es obligatorio"
      });
    }

    const cleanSymbol = symbol.toUpperCase().trim();
    const sessionId = buildOpeningSessionId(cleanSymbol, date);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        symbol,
        prediction_time,
        target_check_time,
        signal_time_label,
        predicted_direction,
        probability_up,
        probability_down,
        confidence,
        entry_price,
        status
      FROM predictions
      WHERE session_id = $1
      ORDER BY signal_time_label ASC
      `,
      [sessionId]
    );

    res.json({
      ok: true,
      symbol: cleanSymbol,
      session_id: sessionId,
      total_signals: rows.length,
      signals: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/opening/decision", async (req, res) => {
  try {
    const { symbol, date } = req.query;

    if (!symbol) {
      return res.status(400).json({
        ok: false,
        error: "El query param symbol es obligatorio"
      });
    }

    const cleanSymbol = symbol.toUpperCase().trim();
    const sessionId = buildOpeningSessionId(cleanSymbol, date);

    const { rows } = await pool.query(
      `
      SELECT
        id,
        signal_time_label,
        predicted_direction,
        probability_up,
        probability_down,
        confidence,
        entry_price,
        prediction_time
      FROM predictions
      WHERE session_id = $1
      ORDER BY signal_time_label ASC
      `,
      [sessionId]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "No hay señales para esta sesión",
        session_id: sessionId
      });
    }

    const decision = buildDecision(cleanSymbol, sessionId, rows);

    res.json({
      ok: true,
      ...decision
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

function buildDecision(symbol, sessionId, signals) {
  const votes = {
    SUBE: 0,
    BAJA: 0,
    NEUTRAL: 0
  };

  let weightedUp = 0;
  let weightedDown = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const direction = signal.predicted_direction || "NEUTRAL";

    if (votes[direction] !== undefined) {
      votes[direction]++;
    }

    const weight = getSignalWeight(signal.signal_time_label);

    weightedUp += Number(signal.probability_up || 0) * weight;
    weightedDown += Number(signal.probability_down || 0) * weight;
    totalWeight += weight;
  }

  const avgProbabilityUp =
    totalWeight > 0 ? weightedUp / totalWeight : 0;

  const avgProbabilityDown =
    totalWeight > 0 ? weightedDown / totalWeight : 0;

  let finalDecision = "NEUTRAL";

  if (votes.SUBE >= 2 && avgProbabilityUp >= 58) {
    finalDecision = "SUBE";
  }

  if (votes.BAJA >= 2 && avgProbabilityDown >= 58) {
    finalDecision = "BAJA";
  }

  const shouldEnter =
    finalDecision !== "NEUTRAL" &&
    signals.length >= 2;

  let confidence = "BAJA";

  if (
    shouldEnter &&
    Math.max(avgProbabilityUp, avgProbabilityDown) >= 62
  ) {
    confidence = "MEDIA";
  }

  if (
    shouldEnter &&
    Math.max(avgProbabilityUp, avgProbabilityDown) >= 70
  ) {
    confidence = "ALTA";
  }

  return {
    symbol,
    session_id: sessionId,
    total_signals: signals.length,
    decision: finalDecision,
    should_enter: shouldEnter,
    confidence,
    avg_probability_up: Number(avgProbabilityUp.toFixed(2)),
    avg_probability_down: Number(avgProbabilityDown.toFixed(2)),
    votes,
    signals
  };
}

function getSignalWeight(signal) {
  if (signal === "OPENING_0830") return 1.5;
  if (signal === "OPENING_0815") return 1.2;
  return 1;
}

function buildOpeningSessionId(symbol, date) {
  const sessionDate = date || getColombiaDate();

  return `${symbol}_${sessionDate}_OPENING`;
}

function getColombiaDate() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(now);
}

export default router;