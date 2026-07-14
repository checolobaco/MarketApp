import { pool } from "../db.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateXauScalpIndicators } from "../indicators/xauScalpIndicators.js";
import { analyzeXauScalpWithGemini } from "../ai/xauScalpAi.js";
import { applyXauScalpRiskFilter } from "../risk/xauScalpRiskFilter.js";
import { getMacroRiskNow } from "../risk/macroRisk.js";
import { calculateXauTradeQuality } from "../risk/xauTradeQuality.js";
import { shouldUseGeminiForXau } from "../risk/xauGeminiGate.js";
import { applyXauSmartFilter } from "../risk/xauSmartFilter.js";
import { sendTelegramSignal, cleanAndTranslateSymbol } from "./telegramService.js";
import { getHighestOpenTradeScore } from "./tradingJournalService.js";

function formatForexXproSymbolDisplayName(symbol) {
  return cleanAndTranslateSymbol(symbol);
}

const ALLOWED_SIGNALS = [
  "SCALP_000",
  "SCALP_005",
  "SCALP_010",
  "SCALP_015"
];

export async function createXauScalpPrediction({
  symbol = "XAUUSD",
  signal = "SCALP_000",
  horizon_minutes = 30,
  isXpro = false,
  preferredProvider = null,
  volume = null
} = {}) {
  if (!ALLOWED_SIGNALS.includes(signal)) {
    throwApiError(
      400,
      "signal inválido. Usa SCALP_000, SCALP_005, SCALP_010 o SCALP_015"
    );
  }

  const sessionId = buildScalpSessionId(symbol, isXpro);

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
    throwApiError(409, "Ya existe esta señal para la sesión scalp", {
      session_id: sessionId,
      signal
    });
  }

  const resolvedProvider = preferredProvider || (isXpro ? "XPRO" : "FOREX_COM");
  const marketData = await getMarketData(symbol, resolvedProvider);
  const indicators = calculateXauScalpIndicators(marketData);
  indicators.symbol = symbol; // Override symbol field
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

  const cacheKey = buildXauAiCacheKey(symbol, indicators);

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
    macroRisk
  );

  const smartFilter = applyXauSmartFilter({
    indicators,
    aiResult,
    riskFilter,
    tradeQuality,
    macroRisk
  });

  if (smartFilter.smart_allowed) {
    const maxOpenScore = await getHighestOpenTradeScore(symbol);
    if (tradeQuality.trade_score <= maxOpenScore) {
      smartFilter.smart_allowed = false;
      smartFilter.smart_blocked_reason = `Posición abierta existente con score igual/superior (${maxOpenScore})`;
    }
  }

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
      $26,
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
      smartFilter.smart_blocked_reason,
      symbol
    ]
  );

  if (smartFilter.smart_allowed) {
    sendTelegramSignal(
      {
        id: inserted.rows[0].id,
        symbol: formatForexXproSymbolDisplayName(symbol),
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
    ).catch(err => console.error("Error asincrono Telegram automatico:", err));

  }

  return {
    ok: true,
    scalp_prediction_id: inserted.rows[0].id,
    symbol: symbol,
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
  };
}

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

function buildScalpSessionId(symbol, isXpro = false) {
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

  const suffix = isXpro ? "XPRO_SCALP" : "SCALP";
  return `${symbol}_${date}_${hour}${String(block).padStart(2, "0")}_${suffix}`;
}

function buildXauAiCacheKey(symbol, indicators) {
  const session = indicators.signals.market_session;
  const direction = indicators.direction_score;
  const dateBlock = getColombiaDateTimeBlock();

  return `SCALP_AI_${symbol}_${dateBlock}_${session}_${direction}`;
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

function throwApiError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  throw error;
}
