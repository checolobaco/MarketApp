import { pool } from "../db.js";
import {
  getCurrentPrice,
  getCandlesBetween
} from "../data_provider/marketData.js";
import { simulateXauTpSl } from "./xauTpSlSimulator.js";
import { sendTelegramCloseSignal } from "../services/telegramService.js";
import { logOrderClose } from "../services/tradingJournalService.js";

export async function runXauScalpBacktesting() {
  console.log("Ejecutando backtesting XAU scalping...");

  const { rows } = await pool.query(`
    SELECT *
    FROM scalp_predictions
    WHERE status = 'PENDING'
    AND target_check_time <= NOW()
    ORDER BY prediction_time ASC
    LIMIT 100
  `);

  if (!rows.length) {
    return { checked: 0 };
  }

  let checked = 0;

  for (const prediction of rows) {
    try {
      const entryPrice = Number(prediction.entry_price);

      const candles = await getCandlesBetween(
        prediction.symbol || "XAUUSD",
        prediction.prediction_time,
        prediction.target_check_time
      );

      const exitPrice = candles.length > 0
        ? Number(candles[candles.length - 1].close)
        : await getCurrentPrice(prediction.symbol || "XAUUSD");

      const actualDirection = getActualDirection(entryPrice, exitPrice);

      const pipsResult = calculatePipsResult(
        prediction.predicted_direction,
        entryPrice,
        exitPrice
      );

      const windowStats = calculateWindowStatsFromCandles(
        candles,
        prediction
      );

      const tpSl = simulateXauTpSl({
        candles,
        prediction
      });

      const finalRealPips =
        tpSl.real_pips_result !== null
          ? tpSl.real_pips_result
          : pipsResult;

      // Adjust resultType based on simulator outcome:
      let resultType = "LOSS";
      if (tpSl.first_hit === "TP1" || tpSl.first_hit === "TP2") {
        resultType = "WIN";
      } else if (tpSl.first_hit === "SL") {
        resultType = "LOSS";
      } else {
        resultType = getResultType(
          prediction.predicted_direction,
          actualDirection
        );
        if (finalRealPips < 0) {
          resultType = "LOSS";
        }
      }

      const wasCorrect = resultType === "WIN";

      const theoreticalProfitPercent = calculatePercent(
        entryPrice,
        exitPrice,
        prediction.predicted_direction
      );

      const durationMinutes = calculateDurationMinutes(
        prediction.prediction_time
      );

      const metadata = extractMetadata(prediction);

      await pool.query("BEGIN");

      await pool.query(
        `
        UPDATE scalp_predictions
        SET actual_price = $1,
            actual_direction = $2,
            result_type = $3,
            pips_result = $4,
            was_correct = $5,
            checked_at = NOW(),
            status = 'CHECKED'
        WHERE id = $6
        `,
        [
          exitPrice,
          actualDirection,
          resultType,
          finalRealPips,
          wasCorrect,
          prediction.id
        ]
      );

      await pool.query(
        `
        INSERT INTO scalp_results
        (
          scalp_prediction_id,
          symbol,
          entry_price,
          exit_price,
          predicted_direction,
          actual_direction,
          stop_loss,
          take_profit_1,
          take_profit_2,
          pips_result,
          theoretical_profit_percent,
          result_type,
          was_correct,
          max_gain_pips,
          max_loss_pips,
          prediction_time,
          checked_at,
          duration_minutes,
          tp1_hit,
          tp2_hit,
          sl_hit,
          first_hit,
          first_hit_price,
          minutes_to_first_hit,
          real_exit_reason,
          real_pips_result,
          session_name,
          trade_quality,
          adx_signal,
          atr_signal,
          prediction_hour
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,
          $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
        )
        `,
        [
          prediction.id,
          prediction.symbol,
          entryPrice,
          exitPrice,
          prediction.predicted_direction,
          actualDirection,
          prediction.stop_loss,
          prediction.take_profit_1,
          prediction.take_profit_2,
          finalRealPips,
          theoreticalProfitPercent,
          resultType,
          wasCorrect,
          windowStats.maxGainPips,
          windowStats.maxLossPips,
          prediction.prediction_time,
          durationMinutes,
          tpSl.tp1_hit,
          tpSl.tp2_hit,
          tpSl.sl_hit,
          tpSl.first_hit,
          tpSl.first_hit_price,
          tpSl.minutes_to_first_hit,
          tpSl.real_exit_reason,
          finalRealPips,
          metadata.sessionName,
          metadata.tradeQuality,
          metadata.adxSignal,
          metadata.atrSignal,
          metadata.predictionHour
        ]
      );

      await pool.query("COMMIT");

      if (prediction.smart_allowed) {
        sendTelegramCloseSignal(prediction, resultType, finalRealPips, tpSl)
          .catch(err => console.error("Error Telegram cierre:", err));

        // Evitar cerrar el diario desde el backtester si la orden tiene un broker_position_id activo.
        // Esto permite que el scheduler closeExpiredPositions la gestione y la cierre de verdad en el broker.
        const { rows: journalRows } = await pool.query(
          "SELECT id, broker_position_id FROM trading_journal WHERE prediction_id = $1 LIMIT 1",
          [prediction.id]
        );
        const hasBrokerId = journalRows.length > 0 && journalRows[0].broker_position_id;

        if (!hasBrokerId) {
          logOrderClose({
            predictionId: prediction.id,
            exitPrice: exitPrice,
            pipsResult: finalRealPips,
            notes: `Motivo salida: ${tpSl.real_exit_reason}`
          }).catch(err => console.error("Error al registrar cierre diario en backtesting:", err.message));
        } else {
          console.log(`[Backtest] Conservando orden abierta en diario para predicción #${prediction.id} porque tiene broker_position_id (${journalRows[0].broker_position_id}).`);
        }
      }

      checked++;

      console.log(
        `XAU ${prediction.predicted_direction} | ${tpSl.real_exit_reason} | ${finalRealPips} pips`
      );

    } catch (error) {
      await pool.query("ROLLBACK");

      console.error(`Error evaluando scalp ${prediction.id}:`, error.message);

      await pool.query(
        `
        UPDATE scalp_predictions
        SET status = 'ERROR'
        WHERE id = $1
        `,
        [prediction.id]
      );
    }
  }

  return { checked };
}

function extractMetadata(prediction) {
  const indicators = prediction.indicators || {};
  const signals = indicators.signals || {};

  return {
    sessionName: signals.market_session || null,
    tradeQuality: prediction.trade_quality || null,
    adxSignal: signals.adx || null,
    atrSignal: signals.atr || null,
    predictionHour: new Date(prediction.prediction_time).getHours()
  };
}

function calculateWindowStatsFromCandles(candles, prediction) {
  if (!candles.length) {
    return {
      maxGainPips: 0,
      maxLossPips: 0
    };
  }

  const entryPrice = Number(prediction.entry_price);
  const highestHigh = Math.max(...candles.map(c => Number(c.high)));
  const lowestLow = Math.min(...candles.map(c => Number(c.low)));

  if (prediction.predicted_direction === "BUY") {
    return {
      maxGainPips: calculatePips(highestHigh - entryPrice),
      maxLossPips: calculatePips(lowestLow - entryPrice)
    };
  }

  if (prediction.predicted_direction === "SELL") {
    return {
      maxGainPips: calculatePips(entryPrice - lowestLow),
      maxLossPips: calculatePips(entryPrice - highestHigh)
    };
  }

  return {
    maxGainPips: 0,
    maxLossPips: 0
  };
}

function getActualDirection(entryPrice, exitPrice) {
  const pips = calculatePips(exitPrice - entryPrice);

  if (pips >= 15) return "BUY";
  if (pips <= -15) return "SELL";

  return "NEUTRAL";
}

function getResultType(predicted, actual) {
  if (predicted === actual) return "WIN";
  if (actual === "NEUTRAL") return "NEUTRAL";
  return "LOSS";
}

function calculatePipsResult(direction, entryPrice, exitPrice) {
  if (direction === "BUY") return calculatePips(exitPrice - entryPrice);
  if (direction === "SELL") return calculatePips(entryPrice - exitPrice);
  return 0;
}

function calculatePips(priceDiff) {
  return Number((priceDiff * 10).toFixed(2));
}

function calculatePercent(entryPrice, exitPrice, direction) {
  let percent = ((exitPrice - entryPrice) / entryPrice) * 100;

  if (direction === "SELL") {
    percent = -percent;
  }

  return Number(percent.toFixed(4));
}

function calculateDurationMinutes(predictionTime) {
  const start = new Date(predictionTime).getTime();
  const end = Date.now();

  return Math.round((end - start) / 60000);
}