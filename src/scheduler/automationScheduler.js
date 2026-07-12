// src/scheduler/automationScheduler.js
import cron from "node-cron";
import { runBacktesting } from "../backtesting/backtestEngine.js";
import { runXauScalpBacktesting } from "../backtesting/xauScalpBacktestEngine.js";
import { createStockPrediction } from "../services/stockPredictionService.js";
import { createXauScalpPrediction } from "../services/xauScalpPredictionService.js";
import { autoTradeXpro, autoTradeForex } from "../services/autoTradeService.js";
import {
  getAutomationState,
  markAutomationRun
} from "./automationState.js";

let isRunning = false;

export function startAutomationScheduler() {
  console.log("Scheduler de automatización iniciado.");

  cron.schedule("* * * * *", async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const state = getAutomationState();
      console.log("[Scheduler] Ejecutando ciclo de automatización", {
        auto_predict_xau: state.auto_predict_xau,
        xpro_auto_predict: state.xpro_auto_predict,
        forex_auto_predict: state.forex_auto_predict,
        forex_auto_trade: state.forex_auto_trade,
        forex_automation_list_length: (state.forex_automation_list || []).length
      });

      // — Auto-Evaluar (Fondo) —
      if (state.auto_evaluate || state.xpro_auto_evaluate || state.forex_auto_evaluate) {
        await runAutoEvaluation();
      }

      // — Auto-Predecir XAU (MarketApp Main) —
      if (state.auto_predict_xau) {
        await runAutoXauPrediction(state);
      }

      // — Auto-Predecir Stocks —
      if (state.auto_predict_stocks) {
        await runAutoStockPredictions(state);
      }

      // — Auto-Predecir XPRO (+ Auto-Operar si habilitado) —
      if (state.xpro_auto_predict) {
        await runAutoXproPrediction(state);
      }

      // — Auto-Predecir Forex.com (+ Auto-Operar si habilitado) —
      if (state.forex_auto_predict) {
        await runAutoForexPrediction(state);
      }

      markAutomationRun({ last_error: null });
    } catch (error) {
      console.error("Error en scheduler de automatización:", error.message);
      markAutomationRun({ last_error: error.message });
    } finally {
      isRunning = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Auto-Evaluar (Fondo)
// ─────────────────────────────────────────────────────────────
async function runAutoEvaluation() {
  const [stocksResult, xauResult] = await Promise.all([
    runBacktesting(),
    runXauScalpBacktesting()
  ]);

  markAutomationRun({ last_auto_evaluate_at: new Date().toISOString() });

  return { stocks: stocksResult, xau: xauResult };
}

// ─────────────────────────────────────────────────────────────
// Auto-Predecir XAU (MarketApp principal)
// ─────────────────────────────────────────────────────────────
async function runAutoXauPrediction(state) {
  const signal = getDueXauSignal();
  if (!signal) return null;

  const runKey = buildMinuteRunKey(signal);
  if (state.last_xau_predict_at === runKey) return null;

  try {
    const result = await createXauScalpPrediction({
      signal,
      horizon_minutes: state.xau_horizon_minutes
    });

    markAutomationRun({
      last_xau_predict_at: runKey,
      last_xau_signal: signal
    });

    return result;
  } catch (error) {
    if (error.statusCode === 409) {
      markAutomationRun({ last_xau_predict_at: runKey, last_xau_signal: signal });
      return null;
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Auto-Predecir XPRO (+ Auto-Operar señales)
// ─────────────────────────────────────────────────────────────
async function runAutoXproPrediction(state) {
  const list = state.xpro_automation_list || [];
  if (!list.length) return null;

  const signal = getDueXauSignal();
  if (!signal) return null;

  const results = [];
  for (const item of list) {
    if (!item.auto_predict) continue;

    const symbol = item.symbol;
    const runKey = buildMinuteRunKey(`${symbol}_${signal}`);
    if (state.last_xpro_predict_at === runKey) continue;

    try {
      const prediction = await createXauScalpPrediction({
        symbol,
        signal,
        horizon_minutes: 15,
        isXpro: true,
        volume: item.volume !== undefined ? item.volume : undefined
      });

      markAutomationRun({ last_xpro_predict_at: runKey });

      // — Auto-Operar señales (si está habilitado para el símbolo o a nivel global) —
      const shouldTrade = item.auto_trade || state.xpro_auto_trade;
      if (
        shouldTrade &&
        prediction?.ok &&
        prediction?.smart_allowed === true
      ) {
        const tradePlan = prediction.trade_plan || {};
        const volume = item.volume || 1;
        autoTradeXpro({ prediction, tradePlan, symbol, volume }).catch(err =>
          console.error(`[Scheduler] Error auto-trade XPRO ${symbol}:`, err.message)
        );
      }

      results.push(prediction);
    } catch (error) {
      if (error.statusCode === 409) {
        markAutomationRun({ last_xpro_predict_at: runKey });
      } else {
        console.error(`[Scheduler] Error auto-predicting XPRO ${symbol}:`, error.message);
      }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Auto-Predecir Forex.com (+ Auto-Operar señales)
// ─────────────────────────────────────────────────────────────
async function runAutoForexPrediction(state) {
  const list = state.forex_automation_list || [];
  if (!list.length) {
    console.log("[Scheduler] No hay instrumentos Forex.com en la lista de automatización.");
    return null;
  }

  const signal = getDueXauSignal();
  if (!signal) {
    console.log("[Scheduler] No hay señal due para Forex.com en este minuto.");
    return null;
  }

  console.log("[Scheduler] runAutoForexPrediction", {
    signal,
    list_length: list.length,
    forex_auto_trade: state.forex_auto_trade
  });

  const results = [];
  for (const item of list) {
    if (!item.auto_predict) {
      console.log(`[Scheduler] Omite ${item.symbol} porque auto_predict=false`);
      continue;
    }

    const symbol = item.symbol;
    const runKey = buildMinuteRunKey(`FOREX_${symbol}_${signal}`);
    if (state.last_forex_predict_at === runKey) {
      console.log(`[Scheduler] Ya se ejecutó Forex.com para ${symbol} en este bloque: ${runKey}`);
      continue;
    }

    try {
      const prediction = await createXauScalpPrediction({
        symbol,
        signal,
        horizon_minutes: 15,
        isXpro: false,
        preferredProvider: "FOREX_COM",
        volume: item.volume !== undefined ? item.volume : undefined
      });

      markAutomationRun({ last_forex_predict_at: runKey });
      console.log(`[Scheduler] Forex.com prediction creada para ${symbol}`, {
        prediction_id: prediction?.scalp_prediction_id || prediction?.prediction_id,
        ok: prediction?.ok,
        smart_allowed: prediction?.smart_allowed,
        volume: item.volume
      });

      // — Auto-Operar señales (si está habilitado para el símbolo o a nivel global) —
      const shouldTrade = item.auto_trade || state.forex_auto_trade;
      const smartAllowed = state.forex_force_smart_allowed || prediction?.smart_allowed === true;
      console.log(`[Scheduler] Forex.com auto-trade decision para ${symbol}:`, {
        item_auto_trade: item.auto_trade,
        global_auto_trade: state.forex_auto_trade,
        force_smart_allowed: state.forex_force_smart_allowed,
        prediction_smart_allowed: prediction?.smart_allowed,
        effective_smart_allowed: smartAllowed,
        shouldTrade
      });

      if (
        prediction?.ok &&
        smartAllowed
      ) {
        const tradePlan = prediction.trade_plan || {};
        // Determinar volumen: si el item tiene volumen explícito usarlo; si no, usar volumen mínimo por instrumento
        let volume = item.volume;
        if (volume === undefined || volume === null) {
          const { getMinVolumeForSymbolAsync, getMinVolumeForSymbol } = await import("../services/tradingConfig.js");
          volume = await getMinVolumeForSymbolAsync(symbol).catch(() => getMinVolumeForSymbol(symbol));
        }

        if (!shouldTrade) {
          console.log(
            `[Scheduler] Señal enviada a Telegram para ${symbol} pero no se abrió operación Forex.com porque auto-trade está deshabilitado.`,
            {
              smart_filter: prediction.smart_filter,
              smart_blocked_reason: prediction.smart_blocked_reason,
              item_auto_trade: item.auto_trade,
              global_auto_trade: state.forex_auto_trade
            }
          );
        } else {
          const orderResult = await autoTradeForex({ prediction, tradePlan, symbol, volume }).catch(err => {
            console.error(`[Scheduler] Error auto-trade Forex.com ${symbol}:`, err.message);
            return null;
          });

          if (!orderResult) {
            console.log(
              `[Scheduler] Señal enviada a Telegram para ${symbol} pero no se abrió operación Forex.com.`,
              {
                smart_filter: prediction.smart_filter,
                smart_blocked_reason: prediction.smart_blocked_reason,
                orderResult: !!orderResult,
                item_auto_trade: item.auto_trade,
                global_auto_trade: state.forex_auto_trade
              }
            );
          }
        }
      }

      results.push(prediction);
    } catch (error) {
      if (error.statusCode === 409) {
        markAutomationRun({ last_forex_predict_at: runKey });
      } else {
        console.error(`[Scheduler] Error auto-predicting Forex.com ${symbol}:`, error.message);
      }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// Auto-Predecir Stocks
// ─────────────────────────────────────────────────────────────
async function runAutoStockPredictions(state) {
  const symbols = state.stock_symbols;
  if (!symbols.length) return [];

  const runKey = buildMinuteRunKey("STOCKS");
  if (state.last_stock_predict_at === runKey) return [];

  const results = [];
  for (const symbol of symbols) {
    try {
      const result = await createStockPrediction(symbol);
      results.push({ symbol, ok: true, prediction_id: result.prediction_id });
    } catch (error) {
      if (error.statusCode === 409) {
        results.push({ symbol, ok: true, skipped: true, reason: "PENDING_EXISTS" });
        continue;
      }
      results.push({ symbol, ok: false, error: error.message });
    }
  }

  markAutomationRun({ last_stock_predict_at: runKey });
  return results;
}

// ─────────────────────────────────────────────────────────────
// Helpers de tiempo
// ─────────────────────────────────────────────────────────────
function getDueXauSignal() {
  const minute = getColombiaPart("minute");
  const elapsed = minute % 15;

  if (elapsed === 0) return "SCALP_000";
  if (elapsed === 5) return "SCALP_005";
  if (elapsed === 10) return "SCALP_010";
  if (elapsed === 14) return "SCALP_015";

  return null;
}

function buildMinuteRunKey(label) {
  const now = new Date();

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const hour = String(getColombiaPart("hour")).padStart(2, "0");
  const minute = String(getColombiaPart("minute")).padStart(2, "0");

  return `${date}_${hour}${minute}_${label}`;
}

function getColombiaPart(part) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      [part]: "2-digit",
      hour12: false
    }).format(new Date())
  );
}
