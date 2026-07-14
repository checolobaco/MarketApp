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
import { pool } from "../db.js";
import { logOrderClose } from "../services/tradingJournalService.js";
import { ForexComClient } from "../forexcom/client.js";
import { XproClient } from "../xpro/client.js";
import { cleanAndTranslateSymbol } from "../services/telegramService.js";

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

      // — Validar y Cerrar Posiciones Expiradas (30 minutos) —
      await closeExpiredPositions();

      // — Validar y Aplicar Breakeven a Posiciones Abiertas —
      await applyBreakevenAndTrailingStop();

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
        horizon_minutes: 30,
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
        horizon_minutes: 30,
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

async function sendTelegramSessionExpiredAlert({
  symbol,
  direction,
  volume,
  entryPrice,
  exitPrice,
  profitLossUsd,
  pips,
  predictionId
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  const cleanSymbol = String(symbol || "").toUpperCase().trim();
  const symbolMap = {
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
  const displaySymbol = symbolMap[cleanSymbol] || symbol;

  const emoji = direction.toUpperCase() === "BUY" ? "🟢 COMPRA (BUY)" : "🔴 VENTA (SELL)";
  const pipsFormatted = pips >= 0 ? `+${Number(pips).toFixed(1)}` : Number(pips).toFixed(1);
  const pnlFormatted = profitLossUsd !== null && profitLossUsd !== undefined
    ? `${Number(profitLossUsd) >= 0 ? "+" : ""}$${Number(profitLossUsd).toFixed(2)} USD`
    : "N/A";

  const message = `
⌛ *OPERACIÓN CERRADA POR EXPIRACIÓN DE SESIÓN (30 MIN)*
────────────────────────
*Instrumento*: ${displaySymbol}
*Dirección*: ${emoji}
*Volumen*: ${volume} lotes
*Beneficio/Pérdida*: *${pipsFormatted} pips* (${pnlFormatted})

*Detalles del Cierre*:
📌 *Motivo*: Expiración del tiempo límite de sesión (30 minutos)
⏱️ *Duración*: 30 minutos
💵 *Entrada*: $${entryPrice}
🚪 *Salida*: $${exitPrice}

*ID de la Predicción*: #${predictionId || 'N/A'}
────────────────────────
_Registro automático por MarketApp._
`;

  const startTime = Date.now();
  let status = "FAILED";
  let errorMessage = null;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });

    const data = await response.json();
    if (!data.ok) {
      errorMessage = data.description;
      console.error("❌ Error de Telegram al enviar alerta de expiración directa:", data.description);
    } else {
      status = "SUCCESS";
      console.log(`⚡ Alerta de expiración de sesión para ${symbol} enviada a Telegram.`);
    }
  } catch (error) {
    errorMessage = error.message;
    console.error("❌ Error al enviar alerta de expiración directa a Telegram:", error);
  } finally {
    const responseTime = Date.now() - startTime;
    try {
      await pool.query(`
        INSERT INTO api_logs (provider, symbol, request_type, status, error_message, response_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['TELEGRAM', symbol, 'SEND_EXPIRY_ALERT', status, errorMessage, responseTime]);
    } catch (e) {
      console.error("Error al registrar log de Telegram en db:", e.message);
    }
  }
}

async function closeExpiredPositions() {
  try {
    const { rows } = await pool.query(
      "SELECT id, symbol, action, volume, entry_price, status, source, prediction_id, broker_position_id, created_at FROM trading_journal WHERE status = 'OPEN' AND broker_position_id IS NOT NULL AND broker_position_id <> ''"
    );

    if (rows.length === 0) return;

    const now = new Date();
    const expiredPositions = rows.filter(row => {
      const createdAt = new Date(row.created_at);
      const diffMinutes = (now - createdAt) / (1000 * 60);
      return diffMinutes >= 30; // 30 minutos o más
    });

    if (expiredPositions.length === 0) return;

    console.log(`[SessionExpiry] Se encontraron ${expiredPositions.length} posiciones abiertas candidatas a expiración.`);

    let forexClient = null;
    let xproClient = null;

    for (const pos of expiredPositions) {
      try {
        if (pos.source === "FOREX_COM") {
          if (!forexClient) {
            const envUser = process.env.FOREX_USERNAME;
            const envPass = process.env.FOREX_PASSWORD;
            const envAppKey = process.env.FOREX_APPKEY;
            const sessionToken = process.env.FOREX_SESSION_TOKEN;
            
            forexClient = new ForexComClient({
              username: envUser,
              password: envPass,
              appKey: envAppKey,
              isDemo: process.env.FOREX_IS_DEMO === "true"
            });

            if (sessionToken) {
              forexClient.setSession(sessionToken, envUser);
            } else if (envUser && (envPass || envAppKey)) {
              await forexClient.login();
            } else {
              throw new Error("No hay credenciales o sesión de Forex.com configurada.");
            }
          }

          const positionsResult = await forexClient.getOpenPositions();
          const openPositions = positionsResult.OpenPositions || [];
          const activePos = openPositions.find(p => String(p.OrderId || p.PositionId) === String(pos.broker_position_id));

          if (activePos) {
            console.log(`[SessionExpiry] Cerrando posición activa en Forex.com: ID=${pos.broker_position_id} (${pos.symbol})`);
            const closeResult = await forexClient.closePosition({
              positionId: pos.broker_position_id,
              quantity: Number(pos.volume),
              marketId: activePos.MarketId,
              direction: activePos.Direction
            });

            const exitPrice = closeResult.Price || (closeResult.Orders && closeResult.Orders[0] && closeResult.Orders[0].Price) || activePos.Price || pos.entry_price;

            await logOrderClose({
              brokerPositionId: pos.broker_position_id,
              exitPrice: exitPrice,
              notes: "Cierre automático al vencimiento de sesión (30 minutos)."
            });

            // Cerrado en broker y guardado en diario local. Evitamos doble envío a Telegram delegando al motor de backtesting.
          } else {
            console.log(`[SessionExpiry] La posición #${pos.broker_position_id} ya no está activa en Forex.com. Cerrando localmente en DB.`);
            
            let exitPrice = pos.entry_price;
            try {
              const marketInfo = await forexClient.getMarketInformation(pos.symbol);
              exitPrice = marketInfo?.MarketInformation?.Bid || pos.entry_price;
            } catch (errPrice) {}

            await logOrderClose({
              brokerPositionId: pos.broker_position_id,
              exitPrice: exitPrice,
              notes: "Cerrada externamente (detectado al validar expiración)."
            });
          }

        } else if (pos.source === "XPRO" || pos.source === "XPRO_TERMINAL") {
          if (!xproClient) {
            xproClient = new XproClient({ token: process.env.XPRO_API_KEY });
          }

          const openPositions = await xproClient.getOpenPositions().catch(() => []);
          const activePos = (Array.isArray(openPositions) ? openPositions : []).find(p => String(p.positionId || p.PositionId || p.position) === String(pos.broker_position_id));

          if (activePos) {
            console.log(`[SessionExpiry] Cerrando posición activa en XPRO: ID=${pos.broker_position_id} (${pos.symbol})`);
            const closeResult = await xproClient.closePosition({
              positionId: pos.broker_position_id,
              volume: Number(pos.volume)
            });

            const exitPrice = closeResult?.price || activePos.price || pos.entry_price;

            await logOrderClose({
              brokerPositionId: pos.broker_position_id,
              exitPrice: exitPrice,
              notes: "Cierre automático al vencimiento de sesión (30 minutos)."
            });

            // Cerrado en broker y guardado en diario local. Evitamos doble envío a Telegram delegando al motor de backtesting.
          } else {
            console.log(`[SessionExpiry] La posición #${pos.broker_position_id} ya no está activa en XPRO. Cerrando localmente en DB.`);
            await logOrderClose({
              brokerPositionId: pos.broker_position_id,
              exitPrice: pos.entry_price,
              notes: "Cerrada externamente (detectado al validar expiración)."
            });
          }
        }
      } catch (innerErr) {
        console.error(`[SessionExpiry] Error al procesar expiración de posición #${pos.broker_position_id}:`, innerErr.message);
      }
    }
  } catch (err) {
    console.error("[SessionExpiry] Error en closeExpiredPositions:", err.message);
  }
}

async function sendTelegramBreakevenAlert(pos, entryPrice, newSl) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const displaySymbol = cleanAndTranslateSymbol(pos.symbol);
  const directionEmoji = (pos.action || "").toUpperCase() === "BUY" ? "🟢 COMPRA" : "🔴 VENTA";

  const message = `
🛡️ *OPERACIÓN PROTEGIDA (BREAKEVEN)*
────────────────────────
*Instrumento*: ${displaySymbol}
*Dirección*: ${directionEmoji}
*Volumen*: ${pos.volume} lotes
*Precio de Entrada*: $${entryPrice}
*Nuevo Stop Loss*: $${newSl} (Ajustado a precio de entrada)

_Riesgo eliminado para esta posición._
`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });
  } catch (err) {
    console.error("Error al enviar alerta de breakeven a Telegram:", err.message);
  }
}

async function applyBreakevenAndTrailingStop() {
  try {
    const { rows } = await pool.query(
      "SELECT id, symbol, action, volume, entry_price, status, source, prediction_id, broker_position_id, stop_loss FROM trading_journal WHERE status = 'OPEN' AND broker_position_id IS NOT NULL AND broker_position_id <> ''"
    );

    if (rows.length === 0) return;

    // Instanciar clientes
    // Forex.com
    const envUser = process.env.FOREX_USERNAME;
    const envPass = process.env.FOREX_PASSWORD;
    const envAppKey = process.env.FOREX_APPKEY;
    const sessionToken = process.env.FOREX_SESSION_TOKEN;
    const forexClient = new ForexComClient({
      username: envUser,
      password: envPass,
      appKey: envAppKey,
      isDemo: process.env.FOREX_IS_DEMO === "true"
    });
    let forexLoggedIn = false;

    // XPRO
    const xproClient = new XproClient({ token: process.env.XPRO_API_KEY });

    for (const pos of rows) {
      try {
        const entryPrice = Number(pos.entry_price);
        const predictionId = pos.prediction_id;

        // Obtener el ATR de la predicción
        let atr = entryPrice * 0.001; // fallback
        if (predictionId) {
          const predRes = await pool.query("SELECT indicators FROM scalp_predictions WHERE id = $1", [predictionId]);
          if (predRes.rows.length > 0) {
            const ind = predRes.rows[0].indicators || {};
            if (ind.atr && Number(ind.atr) > 0) {
              atr = Number(ind.atr);
            }
          }
        }

        const isBuy = pos.action.toUpperCase() === "BUY" || pos.action.toUpperCase() === "COMPRA";
        const triggerDistance = atr * 0.5;

        if (pos.source === "FOREX_COM") {
          // Iniciar sesión en Forex.com si aún no se ha hecho
          if (!forexLoggedIn) {
            if (sessionToken) {
              forexClient.setSession(sessionToken, envUser);
              forexLoggedIn = true;
            } else if (envUser && (envPass || envAppKey)) {
              const sessionInfo = await forexClient.login().catch(() => null);
              if (sessionInfo && sessionInfo.sessionToken) {
                forexLoggedIn = true;
              }
            }
          }

          if (!forexLoggedIn) continue;

          // Obtener posiciones abiertas en el broker
          const positionsResult = await forexClient.getOpenPositions().catch(() => null);
          const openPositions = positionsResult?.OpenPositions || [];
          const activePos = openPositions.find(p => String(p.OrderId || p.PositionId) === String(pos.broker_position_id));

          if (activePos) {
            // Obtener precio actual de bid/offer
            const marketInfo = await forexClient.getMarketInformation(pos.symbol).catch(() => null);
            const infoDetails = marketInfo?.MarketInformation || {};
            const bid = infoDetails.Bid ? Number(infoDetails.Bid) : activePos.Price;
            const offer = infoDetails.Offer ? Number(infoDetails.Offer) : activePos.Price;
            
            const currentExitPrice = isBuy ? bid : offer;
            const currentSl = activePos.StopLoss || activePos.StopOrder?.TriggerPrice || activePos.AssociatedOrders?.Stop?.TriggerPrice || null;

            if (isBuy) {
              // Si subió a favor por al menos 0.5 * ATR
              if (currentExitPrice >= entryPrice + triggerDistance) {
                // Si el SL no está en breakeven (o no tiene SL)
                if (currentSl === null || Number(currentSl) < entryPrice) {
                  console.log(`[Breakeven] Aplicando SL a breakeven para Forex.com posición #${pos.broker_position_id} (Precio actual: ${currentExitPrice}, Entrada: ${entryPrice})`);
                  await forexClient.modifyPosition({
                    positionId: pos.broker_position_id,
                    sl: entryPrice
                  });
                  await pool.query(
                    "UPDATE trading_journal SET stop_loss = $1, notes = COALESCE(notes || ' | ', '') || 'Breakeven activado' WHERE id = $2",
                    [entryPrice, pos.id]
                  );
                  await sendTelegramBreakevenAlert(pos, entryPrice, entryPrice);
                }
              }
            } else {
              // Para SELL: si cayó a favor por al menos 0.5 * ATR
              if (currentExitPrice <= entryPrice - triggerDistance) {
                if (currentSl === null || Number(currentSl) > entryPrice) {
                  console.log(`[Breakeven] Aplicando SL a breakeven para Forex.com posición #${pos.broker_position_id} (Precio actual: ${currentExitPrice}, Entrada: ${entryPrice})`);
                  await forexClient.modifyPosition({
                    positionId: pos.broker_position_id,
                    sl: entryPrice
                  });
                  await pool.query(
                    "UPDATE trading_journal SET stop_loss = $1, notes = COALESCE(notes || ' | ', '') || 'Breakeven activado' WHERE id = $2",
                    [entryPrice, pos.id]
                  );
                  await sendTelegramBreakevenAlert(pos, entryPrice, entryPrice);
                }
              }
            }
          }
        } else if (pos.source === "XPRO_TERMINAL" || pos.source === "XPRO") {
          const openPositions = await xproClient.getOpenPositions().catch(() => []);
          const activePos = (Array.isArray(openPositions) ? openPositions : []).find(p => String(p.positionId || p.PositionId || p.position) === String(pos.broker_position_id));

          if (activePos) {
            const quote = await xproClient.getQuote(pos.symbol).catch(() => null);
            const bid = quote?.bid ? Number(quote.bid) : null;
            const offer = quote?.ask ? Number(quote.ask) : null;

            if (bid && offer) {
              const currentExitPrice = isBuy ? bid : offer;
              const currentSl = activePos.sl || activePos.StopLoss || null;

              if (isBuy) {
                if (currentExitPrice >= entryPrice + triggerDistance) {
                  if (currentSl === null || Number(currentSl) < entryPrice) {
                    console.log(`[Breakeven] Aplicando SL a breakeven para XPRO posición #${pos.broker_position_id} (Precio actual: ${currentExitPrice}, Entrada: ${entryPrice})`);
                    await xproClient.modifyPosition({
                      positionId: pos.broker_position_id,
                      sl: entryPrice
                    });
                    await pool.query(
                      "UPDATE trading_journal SET stop_loss = $1, notes = COALESCE(notes || ' | ', '') || 'Breakeven activado' WHERE id = $2",
                      [entryPrice, pos.id]
                    );
                    await sendTelegramBreakevenAlert(pos, entryPrice, entryPrice);
                  }
                }
              } else {
                if (currentExitPrice <= entryPrice - triggerDistance) {
                  if (currentSl === null || Number(currentSl) > entryPrice) {
                    console.log(`[Breakeven] Aplicando SL a breakeven para XPRO posición #${pos.broker_position_id} (Precio actual: ${currentExitPrice}, Entrada: ${entryPrice})`);
                    await xproClient.modifyPosition({
                      positionId: pos.broker_position_id,
                      sl: entryPrice
                    });
                    await pool.query(
                      "UPDATE trading_journal SET stop_loss = $1, notes = COALESCE(notes || ' | ', '') || 'Breakeven activado' WHERE id = $2",
                      [entryPrice, pos.id]
                    );
                    await sendTelegramBreakevenAlert(pos, entryPrice, entryPrice);
                  }
                }
              }
            }
          }
        }
      } catch (posErr) {
        console.error(`[Breakeven] Error al procesar posición #${pos.broker_position_id}:`, posErr.message);
      }
    }
  } catch (err) {
    console.error("[Breakeven] Error en applyBreakevenAndTrailingStop:", err.message);
  }
}
