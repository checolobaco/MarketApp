import express from "express";
import { pool } from "../db.js";
import { getXauMarketData, getXauHistoricalCandles } from "../data_provider/xauData.js";
import { getHistoricalCandles } from "../data_provider/marketData.js";
import { calculateXauScalpIndicators } from "../indicators/xauScalpIndicators.js";
import { analyzeXauScalpWithGemini } from "../ai/xauScalpAi.js";
import { runXauScalpBacktesting } from "../backtesting/xauScalpBacktestEngine.js";
import { applyXauScalpRiskFilter } from "../risk/xauScalpRiskFilter.js";
import { getMacroRiskNow } from "../risk/macroRisk.js";
import { calculateXauTradeQuality } from "../risk/xauTradeQuality.js";
import { shouldUseGeminiForXau } from "../risk/xauGeminiGate.js";
import { applyXauSmartFilter } from "../risk/xauSmartFilter.js";
import { sendTelegramSignal } from "../services/telegramService.js";
import { logOrderOpen } from "../services/tradingJournalService.js";

function formatForexXproSymbolDisplayName(symbol) {
  const clean = String(symbol || "").toUpperCase().trim();
  const map = {
    // Forex.com IDs
    "402044083": "XAU/USD (Gold)",
    "402044081": "XAU/USD (Gold Micro)",
    "401449254": "EUR/USD",
    "401203130": "GBP/USD",
    "401203195": "USD/JPY",
    "402044422": "BTC/USD (Bitcoin)",
    
    // Standard names
    "XAUUSD": "XAU/USD (Gold)",
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
    "BTCUSD": "BTC/USD (Bitcoin)"
  };
  return map[clean] || clean;
}

const router = express.Router();

const ALLOWED_SIGNALS = [
  "SCALP_000",
  "SCALP_005",
  "SCALP_010",
  "SCALP_015"
];

router.post("/xau/scalp/predict", async (req, res) => {
  try {
    const {
      signal = "SCALP_000",
      horizon_minutes = 30
    } = req.body;

    if (!ALLOWED_SIGNALS.includes(signal)) {
      return res.status(400).json({
        ok: false,
        error: "signal inválido. Usa SCALP_000, SCALP_005, SCALP_010 o SCALP_015"
      });
    }

    const sessionId = buildScalpSessionId();

    const duplicate = await pool.query(
      `
      SELECT id
      FROM scalp_predictions
      WHERE session_id = $1
      AND signal_time_label = $2
      LIMIT 1
      `,
      [sessionId, signal]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe esta señal para la sesión scalp",
        session_id: sessionId,
        signal
      });
    }

    const marketData = await getXauMarketData();
	
	
	const indicators = calculateXauScalpIndicators(marketData);

	const macroRisk = getMacroRiskNow();

	const preRiskFilter = {
	  should_enter: true,
	  risk_level: "PRE_CHECK",
	  blocked_reason: null
	};

	const geminiGate = shouldUseGeminiForXau(
	  indicators,
	  preRiskFilter,
	  macroRisk
	);

	const cacheKey = buildXauAiCacheKey(indicators);

	const aiResult = await analyzeXauScalpWithGemini(
	  indicators,
	  {
		useGemini: geminiGate.useGemini,
		cacheKey
	  }
	);

	const riskFilter = applyXauScalpRiskFilter(indicators, aiResult);

	if (macroRisk.macro_risk === "VERY_HIGH") {
	  riskFilter.should_enter = false;
	  riskFilter.risk_level = "VERY_HIGH";
	  riskFilter.blocked_reason =
		(riskFilter.blocked_reason || "") +
		" | Evento macro de riesgo muy alto";
	}

	const tradePlan = buildFinalTradePlan(indicators, aiResult);
	
	
	const tradeQuality = calculateXauTradeQuality(
	  indicators,
	  aiResult,
	  riskFilter,
	  macroRisk,
	  {
		date: new Date()
	  }
	);
	
	const smartFilter = applyXauSmartFilter({
	  indicators,
	  aiResult,
	  riskFilter,
	  tradeQuality,
	  macroRisk
	});
	
	if (macroRisk.macro_risk === "VERY_HIGH") {
	  riskFilter.should_enter = false;
	  riskFilter.risk_level = "VERY_HIGH";
	  riskFilter.blocked_reason =
		(riskFilter.blocked_reason || "") +
		" | Evento macro de riesgo muy alto";
	}


    const inserted = await pool.query(
      `
      INSERT INTO scalp_predictions
      (
        symbol,
        predicted_direction,
        probability_buy,
        probability_sell,
        confidence,
        entry_price,
        target_check_time,
        stop_loss,
        take_profit_1,
        take_profit_2,
        risk_reward,
		indicators,
		ai_response,
		status,
		strategy,
		session_id,
		signal_time_label,
		should_enter,
		risk_filter,
		blocked_reason,
		macro_risk,
		trade_score,
		trade_quality,
		recommendation,
		quality_details,
		smart_filter,
		smart_allowed,
		smart_blocked_reason
      )
      VALUES
      (
        'XAUUSD',
        $1,$2,$3,$4,$5,
        NOW() + ($6 || ' minutes')::interval,
        $7,$8,$9,$10,
        $11,$12,
		'PENDING',
		'XAU_SCALP',
		$13,$14,
		$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      )
      RETURNING id, prediction_time, target_check_time
      `,
      [
        aiResult.direction,
        aiResult.probability_buy,
        aiResult.probability_sell,
        aiResult.confidence,
        indicators.lastPrice,
        horizon_minutes,
        tradePlan.stop_loss,
        tradePlan.take_profit_1,
        tradePlan.take_profit_2,
        tradePlan.risk_reward,
        indicators,
        aiResult,
        sessionId,
        signal,
        riskFilter.should_enter,
	    riskFilter,
	    riskFilter.blocked_reason,
	    macroRisk.macro_risk,
		tradeQuality.trade_score,
		tradeQuality.trade_quality,
		tradeQuality.recommendation,
		tradeQuality.details,
		smartFilter,
		smartFilter.smart_allowed,
		smartFilter.smart_blocked_reason
      ]
    );

    if (smartFilter.smart_allowed) {
      sendTelegramSignal(
        {
          id: inserted.rows[0].id,
          symbol: formatForexXproSymbolDisplayName("XAUUSD"),
          predicted_direction: aiResult.direction,
          entry_price: indicators.lastPrice,
          smart_allowed: true
        },
        {
          stop_loss: tradePlan.stop_loss,
          take_profit_1: tradePlan.take_profit_1,
          take_profit_2: tradePlan.take_profit_2,
          risk_reward: tradePlan.risk_reward
        },
        tradeQuality
      ).catch(err => console.error("Error asincrono Telegram:", err));

      logOrderOpen({
        symbol: "XAUUSD",
        action: aiResult.direction,
        volume: 0.1, // Default lot size
        entryPrice: indicators.lastPrice,
        stopLoss: tradePlan.stop_loss,
        takeProfit: tradePlan.take_profit_1,
        source: "MARKETAPP_MAIN",
        predictionId: inserted.rows[0].id,
        notes: `Sesión: ${indicators.signals.market_session} | Calidad: ${tradeQuality.trade_quality}`
      }).catch(err => console.error("Error al registrar bitácora:", err.message));
    }

    res.json({
      ok: true,
	  scalp_prediction_id: inserted.rows[0].id,
	  symbol: "XAUUSD",
	  session_id: sessionId,
	  strategy: "XAU_SCALP",
	  signal,
	  horizon_minutes,
	  prediction_time: inserted.rows[0].prediction_time,
	  target_check_time: inserted.rows[0].target_check_time,
	  entry_price: indicators.lastPrice,
	  trade_plan: tradePlan,
	  risk_filter: riskFilter,
	  macro_risk: macroRisk,
	  trade_quality: tradeQuality,
	  smart_filter: smartFilter,
	  smart_allowed: smartFilter.smart_allowed,
	  smart_blocked_reason: smartFilter.smart_blocked_reason,
	  gemini_gate: geminiGate,
	  ai_cache_key: cacheKey,
	  should_enter: riskFilter.should_enter,
	  blocked_reason: riskFilter.blocked_reason,
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

router.get("/xau/scalp/session", async (req, res) => {
  try {
    const { session_id } = req.query;

    const finalSessionId = session_id || buildScalpSessionId();

    const { rows } = await pool.query(
      `
      SELECT *
      FROM scalp_predictions
      WHERE session_id = $1
      ORDER BY signal_time_label ASC
      `,
      [finalSessionId]
    );

    res.json({
      ok: true,
      session_id: finalSessionId,
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

router.get("/xau/scalp/decision", async (req, res) => {
  try {
    const { session_id } = req.query;

    const finalSessionId = session_id || buildScalpSessionId();

    const { rows } = await pool.query(
      `
      SELECT *
      FROM scalp_predictions
      WHERE session_id = $1
      ORDER BY signal_time_label ASC
      `,
      [finalSessionId]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "No hay señales scalp para esta sesión",
        session_id: finalSessionId
      });
    }

    const decision = buildScalpDecision(finalSessionId, rows);

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

router.post("/xau/scalp/backtest/run", async (req, res) => {
  try {
    const result = await runXauScalpBacktesting();

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

router.get("/xau/scalp/results", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM scalp_results
      ORDER BY created_at DESC
      LIMIT 100
      `
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

router.get("/xau/scalp/stats", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        symbol,
        COUNT(*)::int AS total_predictions,

        SUM(CASE WHEN result_type = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN result_type = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN result_type = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS neutrals,

        ROUND(
          SUM(CASE WHEN result_type = 'WIN' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100,
          2
        ) AS win_rate,

        ROUND(AVG(pips_result), 2) AS avg_pips,
        ROUND(SUM(pips_result), 2) AS total_pips,

        ROUND(AVG(max_gain_pips), 2) AS avg_max_gain_pips,
        ROUND(AVG(max_loss_pips), 2) AS avg_max_loss_pips,

        ROUND(AVG(duration_minutes), 2) AS avg_duration_minutes

      FROM scalp_results
      GROUP BY symbol
      `
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

function buildFinalTradePlan(indicators, aiResult) {
  if (aiResult.direction === "BUY") {
    return {
      entry: indicators.lastPrice,
      stop_loss: indicators.stop_loss,
      take_profit_1: indicators.take_profit_1,
      take_profit_2: indicators.take_profit_2,
      risk_reward: indicators.risk_reward
    };
  }

  if (aiResult.direction === "SELL") {
    return {
      entry: indicators.lastPrice,
      stop_loss: indicators.stop_loss,
      take_profit_1: indicators.take_profit_1,
      take_profit_2: indicators.take_profit_2,
      risk_reward: indicators.risk_reward
    };
  }

  return {
    entry: indicators.lastPrice,
    stop_loss: null,
    take_profit_1: null,
    take_profit_2: null,
    risk_reward: 0
  };
}

function buildScalpDecision(sessionId, signals) {
  const votes = {
    BUY: 0,
    SELL: 0,
    NEUTRAL: 0
  };

  let weightedBuy = 0;
  let weightedSell = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const direction = signal.predicted_direction || "NEUTRAL";

	if (signal.should_enter === false) {
	  continue;
	}

	if (signal.smart_allowed === false) {
	  continue;
	}

    if (votes[direction] !== undefined) {
      votes[direction]++;
    }

	const qualityWeight = getQualityWeight(signal.trade_quality);
	const weight = getScalpSignalWeight(signal.signal_time_label) * qualityWeight;
	
    weightedBuy += Number(signal.probability_buy || 0) * weight;
    weightedSell += Number(signal.probability_sell || 0) * weight;
    totalWeight += weight;
  }

  const avgBuy = totalWeight > 0 ? weightedBuy / totalWeight : 0;
  const avgSell = totalWeight > 0 ? weightedSell / totalWeight : 0;

  let decision = "NEUTRAL";

  if (votes.BUY >= 2 && avgBuy >= 62) decision = "BUY";
  if (votes.SELL >= 2 && avgSell >= 62) decision = "SELL";

  const validSignals = signals.filter(
	  s =>
		s.should_enter !== false &&
		s.smart_allowed !== false
	);

  const avgTradeScore = calculateAvgTradeScore(validSignals);

  const shouldEnter =
	  decision !== "NEUTRAL" &&
	  validSignals.length >= 2 &&
	  avgTradeScore >= 70;

  let confidence = "BAJA";

  if (shouldEnter && Math.max(avgBuy, avgSell) >= 65) {
    confidence = "MEDIA";
  }

  if (shouldEnter && Math.max(avgBuy, avgSell) >= 72) {
    confidence = "ALTA";
  }

  return {
    symbol: "XAUUSD",
    session_id: sessionId,
    total_signals: signals.length,
    decision,
    should_enter: shouldEnter,
    confidence,
    avg_probability_buy: Number(avgBuy.toFixed(2)),
    avg_probability_sell: Number(avgSell.toFixed(2)),
    votes,
	valid_signals: validSignals.length,
	avg_trade_score: avgTradeScore,
    signals
  };
}

function calculateAvgTradeScore(signals) {
  if (!signals.length) return 0;

  const total = signals.reduce(
    (sum, s) => sum + Number(s.trade_score || 0),
    0
  );

  return Number((total / signals.length).toFixed(2));
}

function getQualityWeight(quality) {
  if (quality === "A+") return 1.5;
  if (quality === "A") return 1.3;
  if (quality === "B") return 1.1;
  if (quality === "C") return 0.8;
  return 0.3;
}

function getScalpSignalWeight(signal) {
  if (signal === "SCALP_015") return 1.4;
  if (signal === "SCALP_010") return 1.25;
  if (signal === "SCALP_005") return 1.1;
  return 1;
}

function buildScalpSessionId() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false
  }).format(now);

  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      minute: "2-digit"
    }).format(now)
  );

  const block = Math.floor(minute / 15) * 15;

  return `XAUUSD_${date}_${hour}${String(block).padStart(2, "0")}_SCALP`;
}

function buildXauAiCacheKey(indicators) {
  const session = indicators.signals.market_session;
  const direction = indicators.direction_score;
  const dateBlock = getColombiaDateTimeBlock();

  return `XAU_SCALP_AI_${dateBlock}_${session}_${direction}`;
}

function getColombiaDateTimeBlock() {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false
  }).format(now);

  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      minute: "2-digit"
    }).format(now)
  );

  const block = Math.floor(minute / 30) * 30;

  return `${date}_${hour}${String(block).padStart(2, "0")}`;
}

router.get("/xau/candles", async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const requestedSymbol = (req.query.symbol || "XAUUSD").toUpperCase().trim();
    
    let candles = [];
    let dbSymbol = requestedSymbol;
    let predictionsQuery = "";
    
    if (requestedSymbol === "XAUUSD" || requestedSymbol === "GC=F") {
      candles = await getXauHistoricalCandles(days, "5m");
      dbSymbol = "XAUUSD";
      predictionsQuery = `
        SELECT sp.id, sp.prediction_time, sp.entry_price, sp.smart_allowed, sp.predicted_direction,
               sr.result_type, sr.pips_result, sr.checked_at AS exit_time, sr.exit_price
        FROM scalp_predictions sp
        LEFT JOIN scalp_results sr ON sp.id = sr.scalp_prediction_id
        WHERE sp.prediction_time >= NOW() - ($1 || ' days')::interval
        AND sp.symbol = $2
        ORDER BY sp.prediction_time ASC
      `;
    } else {
      // Default to 15m for stocks as used in the system
      ({ candles } = await getHistoricalCandles(requestedSymbol, days, "15m"));
      dbSymbol = requestedSymbol;
      predictionsQuery = `
        SELECT p.id, p.prediction_time, p.entry_price, 
               true AS smart_allowed, p.predicted_direction,
               CASE WHEN p.was_correct THEN 'WIN' ELSE 'LOSS' END AS result_type,
               (p.actual_price - p.entry_price) AS pips_result,
               p.checked_at AS exit_time, p.actual_price AS exit_price
        FROM predictions p
        WHERE p.prediction_time >= NOW() - ($1 || ' days')::interval
        AND p.symbol = $2
        ORDER BY p.prediction_time ASC
      `;
    }
    
    const { rows: predictions } = await pool.query(predictionsQuery, [days, dbSymbol]);

    res.json({
      ok: true,
      candles,
      predictions
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/ai/test-connection", async (req, res) => {
  const requestedSymbol = (req.query.symbol || "XAUUSD").toUpperCase().trim();
  
  let testData = null;
  let dataSource = "MOCK";

  try {
    const { getMarketData } = await import("../data_provider/marketData.js");
    const { calculateXauScalpIndicators } = await import("../indicators/xauScalpIndicators.js");
    
    console.log(`Buscando datos reales en vivo para el símbolo: ${requestedSymbol}`);
    const marketData = await getMarketData(requestedSymbol);
    const indicators = calculateXauScalpIndicators(marketData);
    indicators.symbol = requestedSymbol;
    testData = indicators;
    dataSource = `LIVE_MARKET_DATA (${requestedSymbol})`;
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: `No se pudo obtener datos reales en vivo para el activo ${requestedSymbol}: ${err.message}`
    });
  }

  const results = {};

  // 1. Test Gemini
  try {
    const { analyzeXauScalpWithGemini } = await import("../ai/xauScalpAi.js");
    const originalGroq = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY; // Temporarily hide Groq
    
    const startTime = Date.now();
    const geminiResult = await analyzeXauScalpWithGemini(testData, { useGemini: true, cacheKey: null });
    const duration = Date.now() - startTime;
    
    if (originalGroq) {
      process.env.GROQ_API_KEY = originalGroq;
    }
    
    results.gemini = {
      ok: true,
      duration_ms: duration,
      response: geminiResult
    };
  } catch (err) {
    results.gemini = {
      ok: false,
      error: err.message
    };
  }

  // 2. Test Groq Fallback
  if (process.env.GROQ_API_KEY) {
    try {
      const { analyzeXauScalpWithGemini } = await import("../ai/xauScalpAi.js");
      const originalGemini = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = "API_KEY_INVALIDA_PARA_TEST"; // Force failover
      
      const startTime = Date.now();
      const groqResult = await analyzeXauScalpWithGemini(testData, { useGemini: true, cacheKey: null });
      const duration = Date.now() - startTime;
      
      process.env.GEMINI_API_KEY = originalGemini; // Restore
      
      results.groq = {
        ok: true,
        duration_ms: duration,
        response: groqResult
      };
    } catch (err) {
      results.groq = {
        ok: false,
        error: err.message
      };
    }
  } else {
    results.groq = {
      ok: false,
      error: "GROQ_API_KEY no configurado en el archivo .env"
    };
  }

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    symbol_tested: requestedSymbol,
    data_source: dataSource,
    results
  });
});

export default router;