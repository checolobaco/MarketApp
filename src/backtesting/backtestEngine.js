import { pool } from "../db.js";
import {
  getCurrentPrice,
  getCandlesBetween
} from "../data_provider/marketData.js";

export async function runBacktesting() {
  console.log("Ejecutando backtesting...");

  const { rows } = await pool.query(`
    SELECT *
    FROM predictions
    WHERE status = 'PENDING'
    AND target_check_time <= NOW()
    ORDER BY prediction_time ASC
    LIMIT 50
  `);

  if (!rows.length) {
    console.log("No hay predicciones pendientes.");
    return { checked: 0 };
  }

  let checked = 0;

  for (const prediction of rows) {
    try {
      const entryPrice = Number(prediction.entry_price);
      
      const candles = await getCandlesBetween(
        prediction.symbol,
        prediction.prediction_time,
        prediction.target_check_time
      );

      const exitPrice = candles.length > 0
        ? Number(candles[candles.length - 1].close)
        : await getCurrentPrice(prediction.symbol);

      const changePercent = calculateChangePercent(entryPrice, exitPrice);
      const actualDirection = getActualDirection(changePercent);

      const resultType = getResultType(
        prediction.predicted_direction,
        actualDirection
      );

      const wasCorrect =
        resultType === "WIN" ||
        resultType === "NEUTRAL_HIT";

      const theoreticalProfitPercent = calculateTheoreticalProfit(
        prediction.predicted_direction,
        actualDirection,
        changePercent
      );

      const durationMinutes = calculateDurationMinutes(
        prediction.prediction_time
      );

      const candleStats = calculateWindowStats(prediction, candles);

      await pool.query("BEGIN");

      await pool.query(
        `
        UPDATE predictions
        SET actual_price = $1,
            actual_direction = $2,
            was_correct = $3,
            checked_at = NOW(),
            status = 'CHECKED'
        WHERE id = $4
        `,
        [
          exitPrice,
          actualDirection,
          wasCorrect,
          prediction.id
        ]
      );

      await pool.query(
        `
        INSERT INTO prediction_results
        (
          prediction_id,
          symbol,
          entry_price,
          exit_price,
          predicted_direction,
          actual_direction,
          change_percent,
          theoretical_profit_percent,
          was_correct,
          result_type,
          max_gain_percent,
          max_loss_percent,
          prediction_time,
          checked_at,
          duration_minutes
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14)
        `,
        [
          prediction.id,
          prediction.symbol,
          entryPrice,
          exitPrice,
          prediction.predicted_direction,
          actualDirection,
          changePercent,
          theoreticalProfitPercent,
          wasCorrect,
          resultType,
          candleStats.maxGainPercent,
          candleStats.maxLossPercent,
          prediction.prediction_time,
          durationMinutes
        ]
      );

      await pool.query("COMMIT");

      // Send Telegram close notification
      try {
        const { sendTelegramCloseSignal } = await import("../services/telegramService.js");
        const pipsResult = resultType === "WIN" ? 25 : resultType === "LOSS" ? -15 : 0;
        const firstHit = resultType === "WIN" ? "TP1" : resultType === "LOSS" ? "SL" : "EXPIRE";
        const exitReason = resultType === "WIN" ? "TP" : resultType === "LOSS" ? "SL" : "Vencimiento";
        
        sendTelegramCloseSignal(
          {
            symbol: prediction.symbol,
            predicted_direction: prediction.predicted_direction === "SUBE" ? "BUY" : "SELL",
            entry_price: entryPrice,
            take_profit_1: entryPrice * (prediction.predicted_direction === "SUBE" ? 1.01 : 0.99),
            take_profit_2: entryPrice * (prediction.predicted_direction === "SUBE" ? 1.02 : 0.98),
            stop_loss: entryPrice * (prediction.predicted_direction === "SUBE" ? 0.99 : 1.01)
          },
          resultType === "WIN" ? "WIN" : resultType === "LOSS" ? "LOSS" : "NEUTRAL",
          pipsResult,
          {
            first_hit: firstHit,
            first_hit_price: exitPrice,
            minutes_to_first_hit: durationMinutes,
            real_exit_reason: exitReason
          }
        ).catch(err => console.error("Error Telegram cierre:", err));
      } catch (tgErr) {
        console.error("Error al importar o ejecutar Telegram de cierre:", tgErr.message);
      }

      checked++;

      console.log(
        `Backtest ${prediction.symbol}: ${prediction.predicted_direction} → ${actualDirection} | ${resultType} | final ${changePercent}% | max ${candleStats.maxGainPercent}% / min ${candleStats.maxLossPercent}%`
      );

    } catch (error) {
      await pool.query("ROLLBACK");

      console.error(
        `Error evaluando predicción ${prediction.id}:`,
        error.message
      );

      await pool.query(
        `
        UPDATE predictions
        SET status = 'ERROR'
        WHERE id = $1
        `,
        [prediction.id]
      );
    }
  }

  return { checked };
}

function calculateWindowStats(prediction, candles) {
  if (!candles || !candles.length) {
    return {
      maxGainPercent: 0,
      maxLossPercent: 0
    };
  }

  const entryPrice = Number(prediction.entry_price);

  const highestHigh = Math.max(...candles.map(c => c.high));
  const lowestLow = Math.min(...candles.map(c => c.low));

  const maxGainPercent = calculateChangePercent(
    entryPrice,
    highestHigh
  );

  const maxLossPercent = calculateChangePercent(
    entryPrice,
    lowestLow
  );

  return {
    maxGainPercent,
    maxLossPercent
  };
}

function getResultType(predicted, actual) {
  if (predicted === actual && actual !== "NEUTRAL") {
    return "WIN";
  }

  if (predicted === "NEUTRAL" && actual === "NEUTRAL") {
    return "NEUTRAL_HIT";
  }

  if (predicted !== "NEUTRAL" && actual === "NEUTRAL") {
    return "NEUTRAL_MISS";
  }

  return "LOSS";
}

function calculateTheoreticalProfit(
  predictedDirection,
  actualDirection,
  changePercent
) {
  if (actualDirection === "NEUTRAL") {
    return 0;
  }

  if (predictedDirection === "SUBE") {
    return Number(changePercent.toFixed(4));
  }

  if (predictedDirection === "BAJA") {
    return Number((-changePercent).toFixed(4));
  }

  return 0;
}

function calculateChangePercent(entryPrice, exitPrice) {
  return Number(
    (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4)
  );
}

function getActualDirection(changePercent) {
  if (changePercent > 0.15) return "SUBE";
  if (changePercent < -0.15) return "BAJA";
  return "NEUTRAL";
}

function calculateDurationMinutes(predictionTime) {
  const start = new Date(predictionTime).getTime();
  const end = Date.now();

  return Math.round((end - start) / 60000);
}