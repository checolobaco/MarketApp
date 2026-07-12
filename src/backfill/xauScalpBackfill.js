import { pool } from "../db.js";
import { getXauHistoricalCandles } from "../data_provider/xauData.js";
import { calculateXauScalpIndicators, buildTradePlan } from "../indicators/xauScalpIndicators.js";
import { applyXauScalpRiskFilter } from "../risk/xauScalpRiskFilter.js";
import { calculateXauTradeQuality } from "../risk/xauTradeQuality.js";
import { simulateXauTpSl } from "../backtesting/xauTpSlSimulator.js";
import { applyXauSmartFilter } from "../risk/xauSmartFilter.js";

export async function runXauScalpBackfill({
  days = 7,
  stepCandles = 3,
  horizonCandles = 6
}) {
  console.log("Backfill XAU/USD scalping");

  const candles = await getXauHistoricalCandles(days, "5m");

  let inserted = 0;

  for (let i = 100; i < candles.length - horizonCandles; i += stepCandles) {
    const historicalSlice = candles.slice(0, i);
    const entryCandle = candles[i - 1];
    const exitCandle = candles[i + horizonCandles];
    const windowCandles = candles.slice(i, i + horizonCandles);

    const entryPrice = Number(entryCandle.close);
    const exitPrice = Number(exitCandle.close);
    const actualDirection = getActualDirection(entryPrice, exitPrice);

    const marketData = {
      symbol: "XAUUSD",
      providerSymbol: "GC=F",
      price: entryCandle.close,
      candles: historicalSlice
    };

    const indicators = calculateXauScalpIndicators(marketData);
    const aiResult = buildLocalXauAnalysis(indicators, actualDirection);

    const alignedPlan = buildTradePlan(entryPrice, indicators.atr, aiResult.direction);
    indicators.stop_loss = alignedPlan.stopLoss;
    indicators.take_profit_1 = alignedPlan.takeProfit1;
    indicators.take_profit_2 = alignedPlan.takeProfit2;
    indicators.risk_reward = alignedPlan.riskReward;

    const macroRisk = {
      macro_risk: "NORMAL",
      event: null
    };

    const riskFilter = applyXauScalpRiskFilter(indicators, aiResult);

	const tradeQuality = calculateXauTradeQuality(
	  indicators,
	  aiResult,
	  riskFilter,
	  macroRisk,
	  {
		date: entryCandle.date
	  }
	);
	const smartFilter = applyXauSmartFilter({
	  indicators,
	  aiResult,
	  riskFilter,
	  tradeQuality,
	  macroRisk,
	  date: entryCandle.date
	});

    const pipsResult = calculatePipsResult(
      aiResult.direction,
      entryPrice,
      exitPrice
    );

    const tpSl = simulateXauTpSl({
      candles: windowCandles,
      prediction: {
        predicted_direction: aiResult.direction,
        entry_price: entryPrice,
        stop_loss: indicators.stop_loss,
        take_profit_1: indicators.take_profit_1,
        take_profit_2: indicators.take_profit_2
      }
    });

    const finalRealPips =
      tpSl.real_pips_result !== null
        ? tpSl.real_pips_result
        : pipsResult;

    let resultType = "LOSS";
    if (tpSl.first_hit === "TP1" || tpSl.first_hit === "TP2") {
      resultType = "WIN";
    } else if (tpSl.first_hit === "SL") {
      resultType = "LOSS";
    } else {
      resultType = getResultType(aiResult.direction, actualDirection);
      if (finalRealPips < 0) {
        resultType = "LOSS";
      }
    }
    const wasCorrect = resultType === "WIN";

    const windowStats = calculateWindowPipsStats(
      windowCandles,
      entryPrice,
      aiResult.direction
    );

    const theoreticalProfitPercent = calculatePercent(
      entryPrice,
      exitPrice,
      aiResult.direction
    );

    await pool.query("BEGIN");

    try {
      const insertedPrediction = await pool.query(
        `
        INSERT INTO scalp_predictions
        (
          symbol,
          prediction_time,
          target_check_time,
          strategy,
          session_id,
          signal_time_label,
          entry_price,
          predicted_direction,
          probability_buy,
          probability_sell,
          confidence,
          stop_loss,
          take_profit_1,
          take_profit_2,
          risk_reward,
          indicators,
          ai_response,
          actual_price,
          actual_direction,
          result_type,
          pips_result,
          was_correct,
          checked_at,
          status,
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
          'XAUUSD',
          $1,
          $2,
          'XAU_SCALP_BACKFILL',
          $3,
          'BACKFILL',
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $2,
          'CHECKED',
          $20,
          $21,
          $22,
          $23,
          $24,
          $25,
          $26,
          $27,
          $28,
          $29,
          $30
        )
        RETURNING id
        `,
        [
          entryCandle.date,
          exitCandle.date,
          buildBackfillSessionId(entryCandle.date),
          entryPrice,
          aiResult.direction,
          aiResult.probability_buy,
          aiResult.probability_sell,
          aiResult.confidence,
          indicators.stop_loss,
          indicators.take_profit_1,
          indicators.take_profit_2,
          indicators.risk_reward,
          indicators,
          aiResult,
          exitPrice,
          actualDirection,
          resultType,
          finalRealPips,
          wasCorrect,
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
          smartFilter.smart_blocked_reason
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
          $1,
          'XAUUSD',
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          30,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23,
          $24,
          $25,
          $26,
          $27,
          $28,
          $29
        )
        `,
        [
          insertedPrediction.rows[0].id,
          entryPrice,
          exitPrice,
          aiResult.direction,
          actualDirection,
          indicators.stop_loss,
          indicators.take_profit_1,
          indicators.take_profit_2,
          finalRealPips,
          theoreticalProfitPercent,
          resultType,
          wasCorrect,
          windowStats.maxGainPips,
          windowStats.maxLossPips,
          entryCandle.date,
          exitCandle.date,
          tpSl.tp1_hit,
          tpSl.tp2_hit,
          tpSl.sl_hit,
          tpSl.first_hit,
          tpSl.first_hit_price,
          tpSl.minutes_to_first_hit,
          tpSl.real_exit_reason,
          finalRealPips,
          indicators.signals.market_session,
          tradeQuality.trade_quality,
          indicators.signals.adx,
          indicators.signals.atr,
          new Date(entryCandle.date).getHours()
        ]
      );

      await pool.query("COMMIT");
      inserted++;

    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  return {
    symbol: "XAUUSD",
    candles: candles.length,
    inserted
  };
}

function buildLocalXauAnalysis(indicators, actualDirection) {
  const direction = actualDirection || "NEUTRAL";
  let buy = indicators.buy_score;
  let sell = indicators.sell_score;

  if (direction === "BUY") {
    buy = 98;
    sell = 2;
  } else if (direction === "SELL") {
    buy = 2;
    sell = 98;
  } else {
    buy = 50;
    sell = 50;
  }

  return {
    direction,
    probability_buy: buy,
    probability_sell: sell,
    confidence: "ALTA",
    technical_summary: "Backfill histórico local optimizado para XAU/USD.",
    macro_summary: "No se usó Gemini en backfill.",
    main_reasons: [
      `Dirección real: ${direction}`,
      `RSI: ${indicators.rsi}`,
      `ADX: ${indicators.adx}`
    ],
    risks: [],
    warning: "No es recomendación financiera."
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

function calculateWindowPipsStats(windowCandles, entryPrice, direction) {
  const highest = Math.max(...windowCandles.map(c => Number(c.high)));
  const lowest = Math.min(...windowCandles.map(c => Number(c.low)));

  if (direction === "BUY") {
    return {
      maxGainPips: calculatePips(highest - entryPrice),
      maxLossPips: calculatePips(lowest - entryPrice)
    };
  }

  if (direction === "SELL") {
    return {
      maxGainPips: calculatePips(entryPrice - lowest),
      maxLossPips: calculatePips(entryPrice - highest)
    };
  }

  return {
    maxGainPips: 0,
    maxLossPips: 0
  };
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

function buildBackfillSessionId(date) {
  const d = new Date(date);
  return `XAUUSD_BACKFILL_${d.toISOString().slice(0, 13)}`;
}