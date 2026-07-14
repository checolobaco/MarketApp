import { pool } from "../db.js";

export function cleanAndTranslateSymbol(symbol) {
  const str = String(symbol || "").toUpperCase().trim();
  
  // Extraer cualquier número de 9 dígitos que represente el ID de Forex.com
  const match = str.match(/\b(40\d{7})\b/);
  const cleanId = match ? match[1] : str.replace(/[\/-]/g, "");

  const symMap = {
    // Forex.com IDs correctos (consultados del broker)
    "402044083": "XAU/USD",
    "402044081": "EUR/USD",
    "401449254": "USD/JPY",
    "402044082": "GBP/USD",
    "401203127": "EUR/NZD",
    "402044078": "US Tech 100",
    "401203188": "AUD/USD",
    "401203139": "NZD/CHF",
    "401203129": "GBP/AUD",
    "401203130": "GBP/CAD",
    "401203195": "USD/CAD",
    "402044422": "BTC/USD",
    "401483119": "ETH/USD",
    
    // Standard names
    "XAUUSD": "XAU/USD",
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
    "EURNZD": "EUR/NZD",
    "AUDUSD": "AUD/USD",
    "NZDCHF": "NZD/CHF",
    "GBPAUD": "GBP/AUD",
    "GBPCAD": "GBP/CAD",
    "USDCAD": "USD/CAD",
    "BTCUSD": "BTC/USD",
    "ETHUSD": "ETH/USD"
  };

  return symMap[cleanId] || symMap[str] || symbol;
}

export async function sendTelegramSignal(prediction, tradePlan, tradeQuality) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("⚠️ Telegram no configurado en el archivo .env");
    return;
  }

  let symbol = cleanAndTranslateSymbol(prediction.symbol || "XAUUSD");

  const emoji = prediction.predicted_direction === "BUY" ? "🟢 COMPRA (BUY)" : "🔴 VENTA (SELL)";
  const smartAllowedText = prediction.smart_allowed !== undefined
    ? (prediction.smart_allowed ? '✅ Sí' : '❌ No')
    : 'N/A';
  const message = `
🚀 *NUEVA SEÑAL ALINEADA - ${symbol}*
────────────────────────
*Dirección*: ${emoji}
*Calidad*: ⭐ *${tradeQuality.trade_quality}* (Score: ${tradeQuality.trade_score})
*Smart Allowed*: ${smartAllowedText}

*Plan de Trading*:
📥 *Entrada*: $${prediction.entry_price}
🎯 *TP 1*: $${tradePlan.take_profit_1} (+1.0 ATR)
🎯 *TP 2*: $${tradePlan.take_profit_2}
🛑 *Stop Loss*: $${tradePlan.stop_loss} (-1.2 ATR)

*Riesgo/Beneficio*: 1:${tradePlan.risk_reward || '1.5'}
*ID de la Predicción*: #${prediction.id}
────────────────────────
_Analizado automáticamente por MarketApp. Opera con gestión de riesgo._
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
      console.error("❌ Error de la API de Telegram:", data.description);
    } else {
      status = "SUCCESS";
      console.log(`⚡ Señal de apertura #${prediction.id} enviada a Telegram con éxito.`);
    }
  } catch (error) {
    errorMessage = error.message;
    console.error("❌ Error al enviar mensaje a Telegram:", error);
  } finally {
    const responseTime = Date.now() - startTime;
    try {
      await pool.query(`
        INSERT INTO api_logs (provider, symbol, request_type, status, error_message, response_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['TELEGRAM', symbol, 'SEND_OPEN_ALERT', status, errorMessage, responseTime]);
    } catch (e) {
      console.error("Error al registrar log de Telegram en db:", e.message);
    }
  }
}

export async function sendTelegramCloseSignal(prediction, resultType, pipsResult, tpSl) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  let symbol = cleanAndTranslateSymbol(prediction.symbol || "XAUUSD");

  const direction = prediction.predicted_direction;
  const smartAllowedText = prediction.smart_allowed !== undefined
    ? prediction.smart_allowed ? '✅ Sí' : '❌ No'
    : prediction.smart_filter?.smart_allowed !== undefined
      ? prediction.smart_filter.smart_allowed ? '✅ Sí' : '❌ No'
      : 'N/A';
  const pipsFormatted = pipsResult >= 0 ? `+${Number(pipsResult).toFixed(1)}` : Number(pipsResult).toFixed(1);
  const emoji = resultType === "WIN" ? "✅ GANADA (WIN)" : "❌ PERDIDA (LOSS)";
  
  let exitReasonDetail = "";
  if (tpSl.first_hit === "TP1") {
    exitReasonDetail = `🎯 Hizo Target TP1 ($${prediction.take_profit_1})`;
  } else if (tpSl.first_hit === "TP2") {
    exitReasonDetail = `🎯 Hizo Target TP2 ($${prediction.take_profit_2})`;
  } else if (tpSl.first_hit === "SL") {
    exitReasonDetail = `🛑 Tocó Stop Loss ($${prediction.stop_loss})`;
  } else {
    exitReasonDetail = `⌛ Cierre al vencimiento de sesión`;
  }

  const duration = tpSl.minutes_to_first_hit || 30;

  const message = `
🏁 *OPERACIÓN CERRADA - ${symbol}*
────────────────────────
*Resultado*: ${emoji}
*Dirección*: ${direction === "BUY" ? "🟢 COMPRA" : "🔴 VENTA"}
*Smart Allowed*: ${smartAllowedText}
*Beneficio/Pérdida*: *${pipsFormatted} pips*

*Detalles del Cierre*:
📌 *Motivo*: ${exitReasonDetail}
⏱️ *Duración*: ${duration} minutos
💵 *Entrada*: $${prediction.entry_price}
*ID de la Predicción*: #${prediction.id}
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
      console.error("❌ Error de Telegram al cerrar:", data.description);
    } else {
      status = "SUCCESS";
      console.log(`⚡ Señal de cierre #${prediction.id} enviada a Telegram.`);
    }
  } catch (error) {
    errorMessage = error.message;
    console.error("❌ Error al enviar mensaje de cierre a Telegram:", error);
  } finally {
    const responseTime = Date.now() - startTime;
    try {
      await pool.query(`
        INSERT INTO api_logs (provider, symbol, request_type, status, error_message, response_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, ['TELEGRAM', symbol, 'SEND_CLOSE_ALERT', status, errorMessage, responseTime]);
    } catch (e) {
      console.error("Error al registrar log de Telegram en db:", e.message);
    }
  }
}
