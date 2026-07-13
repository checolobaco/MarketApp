// src/services/tradingJournalService.js
import { pool } from "../db.js";

/**
 * Normaliza el volumen ingresado a lotes estándar según el tipo de activo y el broker.
 * En Forex.com y Oanda, el volumen suele ingresarse en unidades (ej. 1000, 10000).
 * En Xpro y MarketApp Main, se suele ingresar en lotes estándar (ej. 0.01, 0.1).
 */
export function getStandardLots(symbol, volume) {
  const cleanSymbol = String(symbol || "").toUpperCase().trim();
  const vol = Number(volume) || 0;
  
  const isForex = cleanSymbol.includes("/") || cleanSymbol.length === 6 || cleanSymbol.startsWith("USD") || cleanSymbol.startsWith("EUR") || cleanSymbol.startsWith("GBP") || cleanSymbol.startsWith("AUD") || cleanSymbol.startsWith("NZD") || !isNaN(cleanSymbol);
  const isGold = cleanSymbol.startsWith("XAU") || cleanSymbol === "GOLD" || cleanSymbol === "GC=F" || cleanSymbol === "401203119";

  if (isGold) {
    // Para Oro: 1 lote estándar = 100 onzas.
    // Si es >= 5, asumimos que viene en onzas (unidades) y lo dividimos por 100.
    if (vol >= 5) {
      return vol / 100;
    }
    return vol;
  }

  if (isForex) {
    // Para Forex: 1 lote estándar = 100,000 unidades.
    // Si es >= 50, asumimos que viene en unidades directas y lo dividimos por 100,000.
    if (vol >= 50) {
      return vol / 100000;
    }
    return vol;
  }
  
  return vol; // Otros CFDs/Acciones
}

/**
 * Calcula el beneficio o pérdida estimado en dólares (USD) según el activo y lotaje.
 */
export async function calculateUsdProfitLoss(symbol, action, volume, entryPrice, exitPrice) {
  if (entryPrice === null || exitPrice === null || !volume) return 0;
  const cleanSymbol = symbol.toUpperCase().trim();
  const diff = Number(exitPrice) - Number(entryPrice);
  const factor = action.toUpperCase() === "BUY" ? 1 : -1;
  
  const lots = getStandardLots(cleanSymbol, volume);
  
  if (cleanSymbol.startsWith("XAU") || cleanSymbol === "GOLD" || cleanSymbol === "GC=F" || cleanSymbol === "401203119") {
    // Oro (XAU/USD): 1 lote estándar = 100 onzas de oro.
    return diff * 100 * lots * factor;
  }

  // Identificar divisa de cotización (segunda divisa del par)
  let quoteCurrency = "USD";
  if (cleanSymbol.includes("/JPY") || cleanSymbol.endsWith("JPY") || cleanSymbol.includes("401203119")) {
    quoteCurrency = "JPY";
  } else if (cleanSymbol.includes("/NZD") || cleanSymbol.endsWith("NZD") || cleanSymbol.includes("401203116")) {
    quoteCurrency = "NZD";
  } else if (cleanSymbol.includes("/GBP") || cleanSymbol.endsWith("GBP")) {
    quoteCurrency = "GBP";
  } else if (cleanSymbol.includes("/EUR") || cleanSymbol.endsWith("EUR")) {
    quoteCurrency = "EUR";
  } else if (cleanSymbol.includes("/CHF") || cleanSymbol.endsWith("CHF")) {
    quoteCurrency = "CHF";
  } else if (cleanSymbol.includes("/CAD") || cleanSymbol.endsWith("CAD")) {
    quoteCurrency = "CAD";
  } else if (cleanSymbol.includes("/AUD") || cleanSymbol.endsWith("AUD")) {
    quoteCurrency = "AUD";
  }

  // Forex P&L en divisa secundaria = diff * 100,000 * lots * factor
  const rawPnl = diff * 100000 * lots * factor;

  // Convertir a USD si la divisa secundaria es diferente
  if (quoteCurrency !== "USD") {
    try {
      const { getCurrentPrice } = await import("../data_provider/marketData.js");
      if (quoteCurrency === "JPY") {
        const rate = await getCurrentPrice("USDJPY").catch(() => 161.7);
        return rawPnl / rate;
      } else if (quoteCurrency === "NZD") {
        const rate = await getCurrentPrice("NZDUSD").catch(() => 0.61);
        return rawPnl * rate;
      } else if (quoteCurrency === "GBP") {
        const rate = await getCurrentPrice("GBPUSD").catch(() => 1.28);
        return rawPnl * rate;
      } else if (quoteCurrency === "EUR") {
        const rate = await getCurrentPrice("EURUSD").catch(() => 1.09);
        return rawPnl * rate;
      } else if (quoteCurrency === "CHF") {
        const rate = await getCurrentPrice("USDCHF").catch(() => 0.89);
        return rawPnl / rate;
      } else if (quoteCurrency === "CAD") {
        const rate = await getCurrentPrice("USDCAD").catch(() => 1.36);
        return rawPnl / rate;
      } else if (quoteCurrency === "AUD") {
        const rate = await getCurrentPrice("AUDUSD").catch(() => 0.67);
        return rawPnl * rate;
      }
    } catch (e) {
      console.warn(`[calculateUsdProfitLoss] Error al obtener tasa de conversión para ${quoteCurrency}, usando fallback:`, e.message);
    }
    
    // Fallbacks estáticos si falla la red
    const staticRates = {
      "JPY": 1.0 / 161.7,
      "NZD": 0.61,
      "GBP": 1.28,
      "EUR": 1.09,
      "CHF": 1.0 / 0.89,
      "CAD": 1.0 / 1.36,
      "AUD": 0.67
    };
    const rate = staticRates[quoteCurrency] || 1.0;
    return rawPnl * (quoteCurrency === "JPY" || quoteCurrency === "CHF" || quoteCurrency === "CAD" ? 1.0 / (1.0 / rate) : rate);
  }

  return rawPnl;
}

/**
 * Calcula el costo de comisión estimado según el broker/fuente de la orden, volumen y símbolo.
 */
export function calculateCommission(source, volume, symbol) {
  const cleanSource = String(source).toUpperCase().trim();
  const lots = getStandardLots(symbol, volume);

  if (cleanSource === "XPRO_TERMINAL") {
    // Xpro (XBTFX) ECN: Comisión típica de $3.00 USD por lado por lote ($6.00 por lote round-turn)
    return lots * 6.00;
  }
  
  if (cleanSource === "FOREX_COM") {
    // Forex.com: Cuenta de comisiones estándar es $5.00 USD por lado por lote ($10.00 por lote round-turn)
    return lots * 10.00;
  }

  // Oanda y MarketApp Main operan con cuentas spread-only por defecto (comisión cero)
  return 0.00;
}

/**
 * Registra la apertura de una posición en el diario de trading.
 */
export async function logOrderOpen({
  symbol,
  action,
  volume,
  entryPrice,
  stopLoss = null,
  takeProfit = null,
  source,
  predictionId = null,
  brokerPositionId = null,
  notes = null
}) {
  try {
    const commission = calculateCommission(source, volume, symbol);
    
    const query = `
      INSERT INTO trading_journal (
        symbol, action, volume, entry_price, stop_loss, take_profit,
        status, source, prediction_id, broker_position_id, commission, swap, notes, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9, $10, 0.00, $11, NOW())
      RETURNING id
    `;
    
    const values = [
      symbol.toUpperCase().trim(),
      action.toUpperCase().trim(),
      Number(volume),
      Number(entryPrice),
      stopLoss ? Number(stopLoss) : null,
      takeProfit ? Number(takeProfit) : null,
      source,
      predictionId,
      brokerPositionId ? String(brokerPositionId) : null,
      commission,
      notes
    ];
    
    const { rows } = await pool.query(query, values);
    console.log(`[Journal] Orden #${rows[0].id} abierta (${symbol} ${action}) Lotes/Units: ${volume} Comisión: $${commission.toFixed(2)} USD`);
    return rows[0].id;
  } catch (error) {
    console.error("❌ Error al guardar apertura en trading_journal:", error.message);
    return null;
  }
}

/**
 * Registra el cierre de una posición en el diario de trading.
 */
export async function logOrderClose({
  brokerPositionId = null,
  predictionId = null,
  exitPrice,
  pipsResult = null,
  profitLossUsd = null,
  swap = 0.00,
  notes = null
}) {
  try {
    // 1. Buscar la orden abierta por broker_position_id o prediction_id
    let findQuery = "";
    let findValue = null;
    
    if (brokerPositionId) {
      findQuery = "WHERE broker_position_id = $1";
      findValue = String(brokerPositionId);
    } else if (predictionId) {
      findQuery = "WHERE prediction_id = $1";
      findValue = predictionId;
    } else {
      console.warn("[Journal] No se suministró identificador para cerrar el diario.");
      return false;
    }
    
    const { rows } = await pool.query(
      `SELECT id, symbol, action, volume, entry_price, commission FROM trading_journal ${findQuery} AND status = 'OPEN' LIMIT 1`,
      [findValue]
    );
    
    if (!rows.length) {
      console.log(`[Journal] No se encontró orden abierta para ${brokerPositionId || predictionId}. Ignorando o ya cerrada.`);
      return false;
    }
    
    const record = rows[0];
    const finalExitPrice = Number(exitPrice);
    
    // 2. Calcular valores si faltan
    let finalPips = pipsResult;
    if (finalPips === null) {
      const priceDiff = Math.abs(finalExitPrice - Number(record.entry_price));
      const cleanSymbol = record.symbol.toUpperCase();
      if (cleanSymbol === "XAUUSD" || cleanSymbol === "GOLD" || cleanSymbol === "GC=F" || cleanSymbol === "401203119") {
        finalPips = priceDiff * 10;
      } else {
        finalPips = priceDiff * 10000;
      }
      if (record.action === "SELL" ? finalExitPrice > Number(record.entry_price) : finalExitPrice < Number(record.entry_price)) {
        finalPips = -finalPips;
      }
    }
    
    let finalUsd = profitLossUsd;
    if (finalUsd === null) {
      finalUsd = await calculateUsdProfitLoss(
        record.symbol,
        record.action,
        record.volume,
        record.entry_price,
        finalExitPrice
      );
    }
    
    // Calcular Neto = Bruto - Comisiones - Swap
    const commissionCost = Number(record.commission) || 0;
    const swapCost = Number(swap) || 0;
    const netProfitLoss = finalUsd - commissionCost - swapCost;
    
    // 3. Actualizar base de datos
    await pool.query(
      `
      UPDATE trading_journal
      SET exit_price = $1,
          pips_result = $2,
          profit_loss_usd = $3,
          swap = $4,
          net_profit_loss_usd = $5,
          status = 'CLOSED',
          closed_at = NOW(),
          notes = COALESCE(notes || ' | ', '') || $6
      WHERE id = $7
      `,
      [finalExitPrice, finalPips, finalUsd, swapCost, netProfitLoss, notes || '', record.id]
    );
    
    console.log(`[Journal] Orden #${record.id} cerrada. Pips: ${finalPips} | Bruto: $${finalUsd.toFixed(2)} | Comisión: -$${commissionCost.toFixed(2)} | Swap: -$${swapCost.toFixed(2)} | Neto: $${netProfitLoss.toFixed(2)} USD`);
    return true;
  } catch (error) {
    console.error("❌ Error al guardar cierre en trading_journal:", error.message);
    return false;
  }
}
