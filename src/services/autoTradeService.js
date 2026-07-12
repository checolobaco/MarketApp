// src/services/autoTradeService.js
// Servicio de ejecución automática de órdenes en XPRO y Forex.com
// Se activa desde el scheduler cuando auto_trade está habilitado y se genera una señal.

import { XproClient } from "../xpro/client.js";
import { ForexComClient } from "../forexcom/client.js";
import { logOrderOpen } from "./tradingJournalService.js";

// ──────────────────────────────────────────────────────────────
// AUTO-TRADE XPRO
// ──────────────────────────────────────────────────────────────

/**
 * Ejecuta una orden en XPRO de forma automática basada en la predicción de scalp.
 * @param {object} prediction  - Resultado de createXauScalpPrediction
 * @param {object} tradePlan   - { stop_loss, take_profit_1, take_profit_2, risk_reward }
 * @param {string} symbol      - Símbolo a operar (ej. "XAUUSD")
 * @param {number} volume      - Tamaño del lote (ej. 0.01)
 */
export async function autoTradeXpro({ prediction, tradePlan, symbol = "XAUUSD", volume = 0.01 }) {
  try {
    if (!prediction || !prediction.direction) {
      console.warn("[AutoTrade XPRO] No hay dirección en la predicción, operación ignorada.");
      return null;
    }

    const client = new XproClient({ token: process.env.XPRO_API_KEY });

    // Obtener precio de mercado actual para calcular sl/tp relativos
    const quote = await client.getQuote(symbol).catch(() => null);
    const currentPrice = quote?.bid || quote?.ask || null;

    const result = await client.placeOrder({
      symbol,
      action: prediction.direction, // "BUY" o "SELL"
      volume,
      type: "MARKET",
      sl: tradePlan?.stop_loss || null,
      tp: tradePlan?.take_profit_1 || null
    });

    console.log(`[AutoTrade XPRO] ✅ Orden ejecutada: ${symbol} ${prediction.direction} ${volume} lotes`);

    // Registrar en libro de trading
    await logOrderOpen({
      symbol,
      action: prediction.direction,
      volume,
      entryPrice: currentPrice || tradePlan?.entry_price || 0,
      stopLoss: tradePlan?.stop_loss,
      takeProfit: tradePlan?.take_profit_1,
      source: "XPRO_TERMINAL",
      predictionId: prediction.scalp_prediction_id || prediction.prediction_id || null,
      brokerPositionId: result?.position || result?.orderId || null,
      notes: `Auto-Trade XPRO | Señal: ${prediction.signal || "N/A"} | Calidad: ${prediction.trade_quality || "N/A"}`
    });

    return result;
  } catch (error) {
    console.error("[AutoTrade XPRO] ❌ Error al ejecutar orden automática:", error.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// AUTO-TRADE FOREX.COM
// ──────────────────────────────────────────────────────────────

/**
 * Ejecuta una orden en Forex.com de forma automática basada en la predicción de scalp.
 * @param {object} prediction  - Resultado de createXauScalpPrediction
 * @param {object} tradePlan   - { stop_loss, take_profit_1, market }
 * @param {string} symbol      - Símbolo a operar (ej. "XAUUSD")
 * @param {number} volume      - Cantidad en lotes (ej. 0.01)
 */
async function resolveForexComMarket(client, symbol) {
  const cleanSymbol = String(symbol || "").toUpperCase().trim();
  const isNumericId = cleanSymbol !== "" && !isNaN(cleanSymbol);

  let market;
  if (isNumericId) {
    const marketId = Number(cleanSymbol);
    const marketInfo = await client.getMarketInformation(marketId).catch(() => null);
    const infoDetails = marketInfo?.MarketInformation || {};

    if (!infoDetails || Object.keys(infoDetails).length === 0) {
      throw new Error(`No se encontró información de mercado para Forex.com MarketId ${marketId}`);
    }

    market = {
      MarketId: marketId,
      Name: infoDetails.Name || `CFD ${marketId}`,
      Bid: infoDetails.Bid,
      Offer: infoDetails.Offer,
      MarketSpreads: infoDetails.MarketSpreads
    };
  } else {
    const searchSymbol = cleanSymbol === "XAUUSD" || cleanSymbol === "XAU/USD" ? "Gold" : cleanSymbol;
    const marketsResponse = await client.listMarkets(searchSymbol, 10).catch(() => ({ Markets: [] }));
    const markets = marketsResponse.Markets || [];
    market = markets.find(m =>
      String(m.MarketId) === cleanSymbol ||
      m.Name?.toUpperCase().includes(cleanSymbol) ||
      m.Name?.toUpperCase().includes(searchSymbol.toUpperCase())
    ) || markets[0];

    if (!market) {
      throw new Error(`No se encontró mercado Forex.com para ${symbol}`);
    }
  }

  let bid = market.Bid ? Number(market.Bid) : null;
  let offer = market.Offer ? Number(market.Offer) : null;

  if (!bid || !offer) {
    const marketInfo = await client.getMarketInformation(market.MarketId).catch(() => null);
    const infoDetails = marketInfo?.MarketInformation || {};
    bid = bid || (infoDetails.Bid ? Number(infoDetails.Bid) : null);
    offer = offer || (infoDetails.Offer ? Number(infoDetails.Offer) : null);

    if (!bid || !offer) {
      const bars = await client.getPriceBars(market.MarketId, "1m", 1).catch(() => null);
      const lastClose = bars?.PriceBars?.[0]?.Close ? Number(bars.PriceBars[0].Close) : null;
      if (lastClose) {
        const spreadObj = infoDetails.MarketSpreads?.[0];
        let spread = spreadObj?.Spread ? Number(spreadObj.Spread) : 0.0002;
        if (lastClose > 100 && !spreadObj?.Spread) {
          spread = 0.02;
        }
        bid = lastClose - spread / 2;
        offer = lastClose + spread / 2;
      }
    }
  }

  if (!bid || !offer) {
    throw new Error(`No se pudieron obtener precios Bid/Offer para ${symbol} en Forex.com`);
  }

  return {
    marketId: market.MarketId,
    bidPrice: bid,
    offerPrice: offer,
    name: market.Name || String(cleanSymbol)
  };
}

export async function autoTradeForex({ prediction, tradePlan, symbol = "XAUUSD", volume = 0.01 }) {
  try {
    const directionField = prediction?.direction || prediction?.predicted_direction || prediction?.analysis?.direction;
    if (!prediction || !directionField) {
      console.warn("[AutoTrade Forex.com] No hay dirección en la predicción (campos verificados: prediction.direction, prediction.predicted_direction, prediction.analysis.direction), operación ignorada.");
      return null;
    }

    const envUser = process.env.FOREX_USERNAME;
    const envPass = process.env.FOREX_PASSWORD;
    const envAppKey = process.env.FOREX_APPKEY;
    const sessionToken = process.env.FOREX_SESSION_TOKEN;
    const client = new ForexComClient({
      username: envUser,
      password: envPass,
      appKey: envAppKey,
      isDemo: process.env.FOREX_IS_DEMO === "true"
    });

    console.log("[AutoTrade Forex.com] Iniciando flujo de auto-trade", {
      symbol,
      direction: directionField,
      volume,
      sessionToken: !!sessionToken,
      envUser: !!envUser,
      envAppKey: !!envAppKey
    });

    if (sessionToken) {
      client.setSession(sessionToken, envUser);
      console.log("[AutoTrade Forex.com] Usando FOREX_SESSION_TOKEN existente para sesión.");
    }

    if (!sessionToken) {
      if (envUser && (envPass || envAppKey)) {
        try {
          const sessionInfo = await client.login();
          if (sessionInfo && sessionInfo.sessionToken) {
            console.log('[AutoTrade Forex.com] Login automático exitoso.');
          } else {
            console.warn('[AutoTrade Forex.com] Login automático falló, omitiendo auto-trade.');
            return null;
          }
        } catch (loginErr) {
          console.warn('[AutoTrade Forex.com] No se pudo iniciar sesión automáticamente:', loginErr.message);
          return null;
        }
      } else {
        console.warn('[AutoTrade Forex.com] FOREX_SESSION_TOKEN no configurado y credenciales .env incompletas. Auto-trade omitido.');
        return null;
      }
    }

    const normalizedVolume = Number(volume);
    if (Number.isNaN(normalizedVolume) || normalizedVolume <= 0) {
      console.warn(`[AutoTrade Forex.com] Volumen inválido para auto-trade: ${volume}`);
      return null;
    }

    const direction = String(directionField).toLowerCase();
    console.log(`[AutoTrade Forex.com] Resolviendo mercado Forex.com para ${symbol}`);
    const market = await resolveForexComMarket(client, symbol);
    console.log(`[AutoTrade Forex.com] Mercado resuelto`, {
      symbol,
      marketId: market.marketId,
      marketName: market.name,
      bidPrice: market.bidPrice,
      offerPrice: market.offerPrice
    });

    const entryPrice = direction === "buy" ? market.offerPrice : market.bidPrice;
    let quantity = normalizedVolume;

    // Verificar mínimo requerido por el proveedor y ajustar si es necesario
    try {
      const { getMinVolumeForSymbolAsync } = await import("./tradingConfig.js");
      const minFromProvider = await getMinVolumeForSymbolAsync(symbol).catch(() => null);
      if (minFromProvider && Number(minFromProvider) > 0 && quantity < Number(minFromProvider)) {
        console.log(`[AutoTrade Forex.com] Volumen ${quantity} menor al mínimo del proveedor (${minFromProvider}). Ajustando a mínimo.`);
        quantity = Number(minFromProvider);
      }
    } catch (e) {
      // no bloquear si falla la verificación
    }

    // Preparar SL/TP y validar distancia mínima contra precio y spread
    let sl = tradePlan?.stop_loss !== undefined ? tradePlan.stop_loss : null;
    let tp = tradePlan?.take_profit_1 !== undefined ? tradePlan.take_profit_1 : null;

    try {
      const spread = Math.abs((market.offerPrice || 0) - (market.bidPrice || 0)) || 0;
      // mínimo dinámico: 1.2x spread o 0.01% del precio, lo que sea mayor
      const minDistance = Math.max(spread * 1.2, Math.abs(entryPrice) * 0.0001);

      if (sl !== null && sl !== undefined) {
        const dist = Math.abs(entryPrice - Number(sl));
        if (dist < minDistance) {
          // Ajustar SL para mantener distancia mínima
          if (direction === "buy") sl = Number((entryPrice - minDistance).toFixed(4));
          else sl = Number((entryPrice + minDistance).toFixed(4));
          console.log(`[AutoTrade Forex.com] Ajustado SL a ${sl} para cumplir distancia mínima (${minDistance}).`);
        }
      }

      if (tp !== null && tp !== undefined) {
        const dist = Math.abs(Number(tp) - entryPrice);
        if (dist < minDistance) {
          if (direction === "buy") tp = Number((entryPrice + minDistance).toFixed(4));
          else tp = Number((entryPrice - minDistance).toFixed(4));
          console.log(`[AutoTrade Forex.com] Ajustado TP a ${tp} para cumplir distancia mínima (${minDistance}).`);
        }
      }
    } catch (e) {
      // no bloquear si falla validación
    }

    console.log(`[AutoTrade Forex.com] Intentando crear orden: symbol=${symbol} marketId=${market.marketId} direction=${direction} quantity=${quantity} entryPrice=${entryPrice} SL=${sl || null} TP=${tp || null}`);

    const result = await client.createOrder({
      marketId: market.marketId,
      direction,
      quantity,
      price: entryPrice,
      bidPrice: market.bidPrice,
      offerPrice: market.offerPrice,
      stopLoss: sl || null,
      takeProfit: tp || null
    });

    validateForexComOrderResponse(result);

    await ensureForexOrderHasStopTakeProfit(client, result, sl, tp);

    console.log(`[AutoTrade Forex.com] ✅ Orden ejecutada: ${symbol} ${directionField} ${quantity}`);

    await logOrderOpen({
      symbol,
      action: directionField,
      volume: quantity,
      entryPrice,
      stopLoss: sl,
      takeProfit: tp,
      source: "FOREX_COM",
      predictionId: prediction.scalp_prediction_id || prediction.prediction_id || null,
      brokerPositionId: result?.id || result?.orderId || result?.OrderId || (result?.Orders && result?.Orders[0]?.OrderId) || null,
      notes: `Auto-Trade Forex.com | MarketID: ${market.marketId} | Señal: ${prediction.signal || "N/A"}`
    });

    return result;
  } catch (error) {
    console.error("[AutoTrade Forex.com] ❌ Error al ejecutar orden automática:", error.message, error.stack || "");
    return null;
  }
}

async function ensureForexOrderHasStopTakeProfit(client, orderResult, stopLoss, takeProfit) {
  if (!client || !orderResult) return;
  if ((stopLoss === null || stopLoss === undefined) && (takeProfit === null || takeProfit === undefined)) return;

  const orders = orderResult.Orders || [];
  const hasIfDoneStop = orders.some(o => o.IfDone?.some(id => id.Stop !== null && id.Stop !== undefined));
  const hasIfDoneLimit = orders.some(o => o.IfDone?.some(id => id.Limit !== null && id.Limit !== undefined));

  const hasStop = orderResult.StopLoss !== undefined && orderResult.StopLoss !== null || hasIfDoneStop || orderResult.AssociatedOrders?.Stop?.TriggerPrice !== undefined;
  const hasTake = orderResult.TakeProfit !== undefined && orderResult.TakeProfit !== null || hasIfDoneLimit || orderResult.AssociatedOrders?.Limit?.TriggerPrice !== undefined;

  const needsStop = stopLoss !== null && stopLoss !== undefined && !hasStop;
  const needsTake = takeProfit !== null && takeProfit !== undefined && !hasTake;

  if (!needsStop && !needsTake) {
    return;
  }

  const orderId = orderResult?.id || orderResult?.orderId || orderResult?.OrderId || orderResult?.Orders?.[0]?.OrderId || null;
  if (!orderId) {
    console.warn("[AutoTrade Forex.com] No se pudo determinar OrderId para aplicar SL/TP de fallback.");
    return;
  }

  try {
    console.log(`[AutoTrade Forex.com] Aplicando fallback de SL/TP a la orden ${orderId}`);
    await client.modifyPosition({
      positionId: orderId,
      sl: stopLoss !== undefined ? stopLoss : null,
      tp: takeProfit !== undefined ? takeProfit : null
    });
    console.log(`[AutoTrade Forex.com] Fallback SL/TP aplicado a la orden ${orderId}`);
  } catch (modErr) {
    console.warn(`[AutoTrade Forex.com] No se pudo aplicar SL/TP por fallback a la orden ${orderId}:`, modErr.message);
  }
}

function validateForexComOrderResponse(result) {
  if (
    result &&
    (result.Status === 2 || result.OrderId === 0 || (result.Orders && result.Orders[0] && result.Orders[0].Status === 10))
  ) {
    const orderObj = result.Orders?.[0];
    const subReason = orderObj?.StatusReason || result.StatusReason;
    let reasonText = `Código ${subReason}`;

    if (subReason === 75) {
      reasonText = "Mercado Cerrado (Fuera de horario comercial)";
    } else if (subReason === 158) {
      reasonText = "Volumen Inválido (El broker requiere un tamaño mínimo de operación, ej: 1000 unidades)";
    } else if (subReason === 8) {
      reasonText = "Precio Inválido o Fuera de Tolerancia";
    } else if (subReason === 10) {
      reasonText = "Margen o Fondos Insuficientes en la Cuenta";
    }

    const errMsg = result.ErrorMessage || orderObj?.ErrorMessage || "";
    throw new Error(`Orden Rechazada por Forex.com: ${reasonText} (Status=${result.Status || orderObj?.Status}, Reason=${subReason})${errMsg ? ' | Info: ' + errMsg : ''}`);
  }
}
