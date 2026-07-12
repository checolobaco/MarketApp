// src/services/tradingJournalService.js
import { pool } from "../db.js";

/**
 * Calcula el beneficio o pérdida estimado en dólares (USD) según el activo y lotaje.
 */
export function calculateUsdProfitLoss(symbol, action, volume, entryPrice, exitPrice) {
  if (entryPrice === null || exitPrice === null || !volume) return 0;
  const cleanSymbol = symbol.toUpperCase().trim();
  const diff = Number(exitPrice) - Number(entryPrice);
  const factor = action.toUpperCase() === "BUY" ? 1 : -1;
  
  if (cleanSymbol.startsWith("XAU") || cleanSymbol === "GOLD" || cleanSymbol === "GC=F") {
    // Oro (XAU/USD): 1 lote estándar = 100 onzas de oro.
    // USD = diferencia de precio * 100 onzas * volumen
    return diff * 100 * Number(volume) * factor;
  }
  
  if (
    cleanSymbol.endsWith("USD") || 
    cleanSymbol.startsWith("EUR") || 
    cleanSymbol.startsWith("GBP") ||
    cleanSymbol.startsWith("AUD")
  ) {
    // Forex (Divisas cotizadas en USD): 1 lote estándar = 100,000 unidades de divisa base.
    // Ej: EURUSD con precio 1.0800 a 1.0900 es +0.0100 * 100,000 * vol = +$1000 por lote.
    return diff * 100000 * Number(volume) * factor;
  }
  
  // Acciones y CFDs sobre índices (habitualmente 1 contrato = 1 acción/unidad de índice)
  return diff * Number(volume) * factor;
}

/**
 * Calcula el costo de comisión estimado según el broker/fuente de la orden y volumen.
 */
export function calculateCommission(source, volume) {
  const cleanSource = String(source).toUpperCase().trim();
  const vol = Number(volume) || 0;

  if (cleanSource === "XPRO_TERMINAL") {
    // Xpro (XBTFX) ECN: Comisión típica de $3.00 USD por lado por lote ($6.00 por lote round-turn)
    return vol * 6.00;
  }
  
  if (cleanSource === "FOREX_COM") {
    // Forex.com: Cuenta de comisiones estándar es $5.00 USD por lado por lote ($10.00 por lote round-turn)
    return vol * 10.00;
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
    const commission = calculateCommission(source, volume);
    
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
    console.log(`[Journal] Orden #${rows[0].id} abierta (${symbol} ${action}) Lotes: ${volume} Comisión: $${commission} USD`);
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
      if (record.symbol === "XAUUSD") {
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
      finalUsd = calculateUsdProfitLoss(
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
