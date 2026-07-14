import express from "express";
import { pool } from "../db.js";
import { XproClient } from "./client.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";
import { analyzeWithGemini } from "../ai/geminiAnalysis.js";
import { logOrderOpen, logOrderClose, getHighestOpenTradeScore } from "../services/tradingJournalService.js";

const router = express.Router();

// Helper to get client from request headers or process.env fallback
function getClient(req) {
  const token = req.headers["x-xpro-token"] || process.env.XPRO_API_KEY;
  return new XproClient({ token });
}

function formatXproSymbolDisplayName(symbol) {
  const clean = String(symbol || "").toUpperCase().trim();
  const map = {
    "XAUUSD": "XAU/USD (Gold)",
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
    "BTCUSD": "BTC/USD (Bitcoin)"
  };
  return map[clean] || clean;
}

// 1. Verify Connection / Auth Status
router.get("/auth/status", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getAuthStatus();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 2. Get Account Information
router.get("/account", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getAccount();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 3. List Symbols
router.get("/symbols", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.listSymbols();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 4. Get Symbol Specs
router.get("/symbol", async (req, res) => {
  const { symbol } = req.query;
  try {
    const client = getClient(req);
    const result = await client.getSymbolSpecification(symbol);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 5. Get Symbol Live Quote
router.get("/quote", async (req, res) => {
  const { symbol } = req.query;
  try {
    const client = getClient(req);
    const result = await client.getQuote(symbol);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 6. Get Open Positions
router.get("/positions", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getOpenPositions();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 7. Get Pending Orders
router.get("/orders", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getPendingOrders();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 8. Get Deal History
router.get("/history", async (req, res) => {
  const { period } = req.query;
  try {
    const client = getClient(req);
    const result = await client.getDealHistory(period || "last_week");
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 9. Place Order
router.post("/trade", async (req, res) => {
  const { symbol, action, volume, type, price, sl, tp } = req.body;
  try {
    const client = getClient(req);
    const result = await client.placeOrder({
      symbol,
      action,
      volume,
      type,
      price,
      sl,
      tp
    });

    logOrderOpen({
      symbol: symbol,
      action: action,
      volume: volume,
      entryPrice: price || result.price || 0,
      stopLoss: sl,
      takeProfit: tp,
      source: "XPRO_TERMINAL",
      brokerPositionId: result.position || result.orderId || null,
      notes: `Tipo: ${type || 'MARKET'}`
    }).catch(err => console.error("Error al registrar diario en XPRO trade:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 10. Close Position
router.post("/close_position", async (req, res) => {
  const { positionId, volume } = req.body;
  try {
    const client = getClient(req);
    const result = await client.closePosition({
      positionId,
      volume
    });

    logOrderClose({
      brokerPositionId: positionId,
      exitPrice: result.price || 0,
      notes: `Cierre solicitado de volumen: ${volume || 'total'}`
    }).catch(err => console.error("Error al registrar cierre diario en XPRO:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 11. Modify Position SL/TP
router.post("/modify_position", async (req, res) => {
  const { positionId, sl, tp } = req.body;
  try {
    const client = getClient(req);
    const result = await client.modifyPosition({
      positionId,
      sl,
      tp
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 12. Predict and Auto-Trade
router.post("/predict", async (req, res) => {
  const { symbol, autoTrade, volume } = req.body;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    
    // 1. Fetch market data
    const marketData = await getMarketData(cleanSymbol, "XPRO");
    
    // 2. Calculate Indicators
    const indicators = calculateIndicators(marketData);
    
    // 3. AI Analysis with Gemini
    const aiResult = await analyzeWithGemini(indicators);
    
    // Calculate Dynamic SL & TP based on ATR
    const lastPrice = indicators.lastPrice;
    const atr = indicators.atr_value || indicators.atr || 1.0;
    
    let sl = null;
    let tp = null;
    let orderPlaced = false;
    let orderResult = null;
    
    if (aiResult.direction === "SUBE") {
      sl = lastPrice - (atr * 1.5);
      tp = lastPrice + (atr * 2.5);
    } else if (aiResult.direction === "BAJA") {
      sl = lastPrice + (atr * 1.5);
      tp = lastPrice - (atr * 2.5);
    }
    
    // Round to standard 2 decimal places
    const roundToDigits = (num, d = 2) => Number(num.toFixed(d));
    if (sl) sl = roundToDigits(sl, 2);
    if (tp) tp = roundToDigits(tp, 2);
    
    // 4. Auto trade if enabled, direction is clear, and confidence is appropriate
    if (autoTrade && (aiResult.direction === "SUBE" || aiResult.direction === "BAJA")) {
      const client = getClient(req);
      const action = aiResult.direction === "SUBE" ? "BUY" : "SELL";
      const tradeVolume = volume ? Number(volume) : 0.01;
      
      orderResult = await client.placeOrder({
        symbol: cleanSymbol,
        action,
        volume: tradeVolume,
        type: "MARKET",
        sl,
        tp
      });
      orderPlaced = true;
    }

    // 5. Save prediction in 'predictions' table with a 15-minute check horizon
    const dbResult = await pool.query(
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
      VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '15 minutes', $7, $8, 'PENDING')
      RETURNING id, prediction_time, target_check_time
      `,
      [
        cleanSymbol,
        aiResult.direction,
        aiResult.probability_up,
        aiResult.probability_down,
        aiResult.confidence,
        lastPrice,
        indicators,
        aiResult
      ]
    );
    
    // Send Telegram Notification
    try {
      const { sendTelegramSignal } = await import("../services/telegramService.js");
      sendTelegramSignal(
        {
          id: dbResult.rows[0].id,
          symbol: formatXproSymbolDisplayName(cleanSymbol),
          predicted_direction: aiResult.direction === "SUBE" ? "BUY" : "SELL",
          entry_price: lastPrice
        },
        {
          take_profit_1: tp,
          take_profit_2: tp,
          stop_loss: sl,
          risk_reward: 1.6
        },
        {
          trade_quality: aiResult.confidence || "MEDIA",
          trade_score: aiResult.probability_up || aiResult.probability_down || 50
        }
      ).catch(err => console.error("Error Telegram señal:", err));
    } catch (tgErr) {
      console.error("Error Telegram:", tgErr.message);
    }
    
    res.json({
      ok: true,
      prediction_id: dbResult.rows[0].id,
      prediction_time: dbResult.rows[0].prediction_time,
      target_check_time: dbResult.rows[0].target_check_time,
      analysis: aiResult,
      indicators: {
        lastPrice,
        atr,
        sl,
        tp
      },
      orderPlaced,
      orderResult
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 13. Get Price Candles (for charting)
router.get("/candles", async (req, res) => {
  const { symbol, days, interval } = req.query;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    const queryDays = days ? Number(days) : 3;
    const queryInterval = interval || "15m";
    
    const { getHistoricalCandles } = await import("../data_provider/marketData.js");
    const { candles } = await getHistoricalCandles(cleanSymbol, queryDays, queryInterval, "XPRO");
    res.json({ ok: true, data: candles });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 14. Predict with XAU Scalping Strategy
router.post("/predict_scalp", async (req, res) => {
  const { symbol, autoTrade, volume } = req.body;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    
    // 1. Fetch market data
    const marketData = await getMarketData(cleanSymbol, "XPRO");
    
    // 2. Calculate XAU Scalp Indicators
    const { calculateXauScalpIndicators } = await import("../indicators/xauScalpIndicators.js");
    const indicators = calculateXauScalpIndicators(marketData);
    indicators.symbol = cleanSymbol; // Override hardcoded XAUUSD
    
    // 3. Risk and Gemini gate check
    const { shouldUseGeminiForXau } = await import("../risk/xauGeminiGate.js");
    const { getMacroRiskNow } = await import("../risk/macroRisk.js");
    const macroRisk = getMacroRiskNow();
    const preRiskFilter = { should_enter: true, risk_level: "PRE_CHECK", blocked_reason: null };
    const geminiGate = shouldUseGeminiForXau(indicators, preRiskFilter, macroRisk);
    
    // 4. AI analysis
    const { analyzeXauScalpWithGemini } = await import("../ai/xauScalpAi.js");
    const cacheKey = `scalp_pred_${cleanSymbol}_${indicators.rsi || '0'}_${indicators.lastPrice || '0'}`;
    const aiResult = await analyzeXauScalpWithGemini(indicators, {
      useGemini: geminiGate.useGemini,
      cacheKey
    });
    
    // 5. Apply filters & Quality scoring
    const { applyXauScalpRiskFilter } = await import("../risk/xauScalpRiskFilter.js");
    const { calculateXauTradeQuality } = await import("../risk/xauTradeQuality.js");
    const { applyXauSmartFilter } = await import("../risk/xauSmartFilter.js");
    
    const riskFilter = applyXauScalpRiskFilter(indicators, aiResult);
    if (macroRisk.macro_risk === "VERY_HIGH") {
      riskFilter.should_enter = false;
      riskFilter.risk_level = "VERY_HIGH";
      riskFilter.blocked_reason = (riskFilter.blocked_reason || "") + " | Evento macro de riesgo muy alto";
    }
    
    const tradeQuality = calculateXauTradeQuality(indicators, aiResult, riskFilter, macroRisk, { date: new Date() });
    const smartFilter = applyXauSmartFilter({ indicators, aiResult, riskFilter, tradeQuality, macroRisk });
    
    if (smartFilter.smart_allowed) {
      const maxOpenScore = await getHighestOpenTradeScore(cleanSymbol);
      if (tradeQuality.trade_score <= maxOpenScore) {
        smartFilter.smart_allowed = false;
        smartFilter.smart_blocked_reason = `Posición abierta existente con score igual/superior (${maxOpenScore})`;
      }
    }
    
    // Set Target Check Time based on 15 minutes (scalping)
    const sl = indicators.stop_loss;
    const tp = indicators.take_profit_1; // Scalp uses take_profit_1 as first target
    
    let orderPlaced = false;
    let orderResult = null;
    
    // 6. Place order if auto-trade is enabled, direction is clear, and smart filter allows it
    const direction = aiResult.direction; // BUY, SELL, NEUTRAL
    if (autoTrade && (direction === "BUY" || direction === "SELL") && smartFilter.smart_allowed) {
      const client = getClient(req);
      const action = direction; // BUY or SELL
      const tradeVolume = volume ? Number(volume) : 0.01;
      
      orderResult = await client.placeOrder({
        symbol: cleanSymbol,
        action,
        volume: tradeVolume,
        type: "MARKET",
        sl,
        tp
      });
      orderPlaced = true;
    }
    
    // 7. Save prediction in 'scalp_predictions' table
    const sessionId = "XPRO_SCALP_" + Date.now();
    const dbResult = await pool.query(
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
        $1, $2, $3, $4, $5, $6, NOW() + INTERVAL '30 minutes', $7, $8, $9, $10,
        $11, $12, 'PENDING', 'XAU_SCALP', $13, 'SCALP_000', $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24
      )
      RETURNING id, prediction_time, target_check_time
      `,
      [
        cleanSymbol,
        direction,
        aiResult.probability_buy || 0,
        aiResult.probability_sell || 0,
        aiResult.confidence || 'MEDIA',
        indicators.lastPrice,
        sl,
        tp,
        indicators.take_profit_2,
        indicators.risk_reward,
        indicators,
        aiResult,
        sessionId,
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
    
    if (orderPlaced) {
      try {
        const { logOrderOpen } = await import("../services/tradingJournalService.js");
        const brokerPositionId = orderResult?.position || orderResult?.orderId || null;
        await logOrderOpen({
          symbol: cleanSymbol,
          action: direction,
          volume: volume ? Number(volume) : 0.01,
          entryPrice: indicators.lastPrice,
          stopLoss: sl,
          takeProfit: tp,
          source: "XPRO_TERMINAL",
          predictionId: dbResult.rows[0].id,
          brokerPositionId,
          notes: `Manual Trade Scalp XPRO | Señal: SCALP_000`
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora manual scalp XPRO:", logErr.message);
      }
    }
    
    // Send Telegram Notification ONLY if smart allowed is true
    if (smartFilter && smartFilter.smart_allowed === true) {
      try {
        const { sendTelegramSignal } = await import("../services/telegramService.js");
        sendTelegramSignal(
          {
            id: dbResult.rows[0].id,
            symbol: formatXproSymbolDisplayName(cleanSymbol),
            predicted_direction: direction,
            entry_price: indicators.lastPrice,
            smart_allowed: true
          },
          {
            take_profit_1: tp,
            take_profit_2: indicators.take_profit_2 || tp,
            stop_loss: sl,
            risk_reward: indicators.risk_reward || 2.4
          },
          {
            trade_quality: tradeQuality.trade_quality,
            trade_score: tradeQuality.trade_score
          }
        ).catch(err => console.error("Error Telegram scalp señal:", err));
      } catch (tgErr) {
        console.error("Error Telegram scalp:", tgErr.message);
      }
    }
    
    res.json({
      ok: true,
      prediction_id: dbResult.rows[0].id,
      prediction_time: dbResult.rows[0].prediction_time,
      target_check_time: dbResult.rows[0].target_check_time,
      analysis: {
        direction: direction === "BUY" ? "SUBE" : direction === "SELL" ? "BAJA" : "NEUTRAL", // translate for standard UI
        probability_up: aiResult.probability_buy || 0,
        probability_down: aiResult.probability_sell || 0,
        confidence: aiResult.confidence,
        technical_summary: aiResult.technical_summary || aiResult.macro_summary,
        main_reasons: aiResult.main_reasons,
        risks: aiResult.risks
      },
      indicators: {
        lastPrice: indicators.lastPrice,
        atr: indicators.atr,
        sl,
        tp
      },
      orderPlaced,
      orderResult,
      smartFilter
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
