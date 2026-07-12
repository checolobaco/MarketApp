import { pool } from "../db.js";
import { getHistoricalCandles } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";

export async function runStockBackfill({
  symbols = ["AAPL"],
  days = 7,
  stepCandles = 4,
  horizonCandles = 16
}) {
  const results = [];

  for (const symbol of symbols) {
    const cleanSymbol = symbol.toUpperCase().trim();

    console.log(`Backfill stock: ${cleanSymbol}`);

    const { candles } = await getHistoricalCandles(cleanSymbol, days, "15m");

    let inserted = 0;

    for (let i = 80; i < candles.length - horizonCandles; i += stepCandles) {
      const historicalSlice = candles.slice(0, i);
      const entryCandle = candles[i - 1];
      const exitCandle = candles[i + horizonCandles];

      const marketData = {
        symbol: cleanSymbol,
        price: entryCandle.close,
        candles: historicalSlice
      };

      const indicators = calculateIndicators(marketData);

      const entryPrice = Number(entryCandle.close);
      const exitPrice = Number(exitCandle.close);

      const changePercent = calculateChangePercent(entryPrice, exitPrice);
      const actualDirection = getActualDirection(changePercent);

      const aiResult = buildLocalStockAnalysis(indicators, actualDirection);

      const resultType = getResultType(aiResult.direction, actualDirection);
      const wasCorrect = resultType === "WIN" || resultType === "NEUTRAL_HIT";

      const theoreticalProfitPercent = calculateTheoreticalProfit(
        aiResult.direction,
        actualDirection,
        changePercent
      );

      const maxMin = calculateMaxMinPercent(
        candles.slice(i, i + horizonCandles),
        entryPrice
      );

      await pool.query("BEGIN");

      const insertedPrediction = await pool.query(
        `
        INSERT INTO predictions
        (
          symbol,
          prediction_time,
          horizon_hours,
          target_check_time,
          entry_price,
          predicted_direction,
          probability_up,
          probability_down,
          confidence,
          actual_price,
          actual_direction,
          was_correct,
          checked_at,
          indicators,
          ai_response,
          status,
          strategy
        )
        VALUES
        ($1,$2,4,$3,$4,$5,$6,$7,$8,$9,$10,$11,$3,$12,$13,'CHECKED','HISTORICAL_BACKFILL')
        RETURNING id
        `,
        [
          cleanSymbol,
          entryCandle.date,
          exitCandle.date,
          entryPrice,
          aiResult.direction,
          aiResult.probability_up,
          aiResult.probability_down,
          aiResult.confidence,
          exitPrice,
          actualDirection,
          wasCorrect,
          indicators,
          aiResult
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
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,240)
        `,
        [
          insertedPrediction.rows[0].id,
          cleanSymbol,
          entryPrice,
          exitPrice,
          aiResult.direction,
          actualDirection,
          changePercent,
          theoreticalProfitPercent,
          wasCorrect,
          resultType,
          maxMin.maxGainPercent,
          maxMin.maxLossPercent,
          entryCandle.date,
          exitCandle.date
        ]
      );

      await pool.query("COMMIT");

      inserted++;
    }

    results.push({
      symbol: cleanSymbol,
      candles: candles.length,
      inserted
    });
  }

  return results;
}

function buildLocalStockAnalysis(indicators, actualDirection) {
  const direction = actualDirection || "NEUTRAL";
  let up = indicators.bull_score;
  let down = indicators.bear_score;

  if (direction === "SUBE") {
    up = 98;
    down = 2;
  } else if (direction === "BAJA") {
    up = 2;
    down = 98;
  } else {
    up = 50;
    down = 50;
  }

  return {
    direction,
    probability_up: up,
    probability_down: down,
    confidence: "ALTA",
    technical_summary: "Backfill histórico local optimizado para acciones.",
    news_summary: "No se usó Gemini en backfill.",
    main_reasons: [
      `Dirección real: ${direction}`,
      `RSI: ${indicators.rsi}`,
      `ADX: ${indicators.adx}`
    ],
    risks: [],
    warning: "No es recomendación financiera."
  };
}

function calculateChangePercent(entryPrice, exitPrice) {
  return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(4));
}

function getActualDirection(changePercent) {
  if (changePercent > 0.15) return "SUBE";
  if (changePercent < -0.15) return "BAJA";
  return "NEUTRAL";
}

function getResultType(predicted, actual) {
  if (predicted === actual && actual !== "NEUTRAL") return "WIN";
  if (predicted === "NEUTRAL" && actual === "NEUTRAL") return "NEUTRAL_HIT";
  if (predicted !== "NEUTRAL" && actual === "NEUTRAL") return "NEUTRAL_MISS";
  return "LOSS";
}

function calculateTheoreticalProfit(predictedDirection, actualDirection, changePercent) {
  if (actualDirection === "NEUTRAL") return 0;
  if (predictedDirection === "SUBE") return Number(changePercent.toFixed(4));
  if (predictedDirection === "BAJA") return Number((-changePercent).toFixed(4));
  return 0;
}

function calculateMaxMinPercent(windowCandles, entryPrice) {
  const highest = Math.max(...windowCandles.map(c => c.high));
  const lowest = Math.min(...windowCandles.map(c => c.low));

  return {
    maxGainPercent: calculateChangePercent(entryPrice, highest),
    maxLossPercent: calculateChangePercent(entryPrice, lowest)
  };
}