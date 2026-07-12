import { XAU_SCORING_CONFIG } from "../config/xauScoringConfig.js";

export function calculateXauTradeQuality(
  indicators,
  aiResult,
  riskFilter,
  macroRisk,
  options = {}
) {
  const hour = options.hour ?? getBogotaHour(options.date);

  const technicalScore = getTechnicalScore(aiResult);
  const hourScore = getHourScore(hour);
  const atrScore = getMapScore("atr", indicators.signals.atr);
  const adxScore = getMapScore("adx", indicators.signals.adx);
  const sessionScore = getMapScore("session", indicators.signals.market_session);
  const confidenceScore = getMapScore("confidence", aiResult.confidence);
  const macroScore = getMapScore("macro", macroRisk.macro_risk);

  const w = XAU_SCORING_CONFIG.weights;

  let finalScore =
    hourScore * w.hour +
    technicalScore * w.technical +
    atrScore * w.atr +
    adxScore * w.adx +
    confidenceScore * w.confidence +
    sessionScore * w.session +
    macroScore * w.macro;

  if (aiResult.direction === "NEUTRAL") {
    finalScore = Math.min(finalScore, 49);
  }

  if (riskFilter.should_enter === false) {
    finalScore = Math.min(finalScore, 51);
  }

  if (macroRisk.macro_risk === "VERY_HIGH") {
    finalScore = Math.min(finalScore, 39);
  }

  finalScore = Number(finalScore.toFixed(2));

  const tradeQuality = getTradeQuality(finalScore);
  const recommendation = getRecommendation(finalScore, aiResult.direction, riskFilter);

  return {
    trade_score: finalScore,
    trade_quality: tradeQuality,
    recommendation,
    details: {
      hour,
      technical_score: technicalScore,
      hour_score: hourScore,
      atr_score: atrScore,
      adx_score: adxScore,
      session_score: sessionScore,
      confidence_score: confidenceScore,
      macro_score: macroScore,
      direction: aiResult.direction,
      risk_allowed: riskFilter.should_enter,
      risk_level: riskFilter.risk_level,
      blocked_reason: riskFilter.blocked_reason,
      macro_risk: macroRisk.macro_risk,
      macro_event: macroRisk.event
    }
  };
}

function getTechnicalScore(aiResult) {
  const buy = Number(aiResult.probability_buy || 0);
  const sell = Number(aiResult.probability_sell || 0);
  return Math.max(buy, sell);
}

function getHourScore(hour) {
  const cfg = XAU_SCORING_CONFIG;

  if (cfg.hours.aPlus.includes(hour)) return cfg.scores.hour.aPlus;
  if (cfg.hours.a.includes(hour)) return cfg.scores.hour.a;
  if (cfg.hours.b.includes(hour)) return cfg.scores.hour.b;
  if (cfg.hours.blocked.includes(hour)) return cfg.scores.hour.blocked;

  return cfg.scores.hour.default;
}

function getMapScore(group, value) {
  const map = XAU_SCORING_CONFIG.scores[group] || {};
  return map[value] ?? map.UNKNOWN ?? 50;
}

function getTradeQuality(score) {
  const t = XAU_SCORING_CONFIG.qualityThresholds;

  if (score >= t.aPlus) return "A+";
  if (score >= t.a) return "A";
  if (score >= t.b) return "B";
  if (score >= t.c) return "C";

  return "NO_TRADE";
}

function getRecommendation(score, direction, riskFilter) {
  const t = XAU_SCORING_CONFIG.qualityThresholds;

  if (direction === "NEUTRAL") return "NO_TRADE";
  if (riskFilter.should_enter === false) return "NO_TRADE";

  if (score >= t.aPlus) return `STRONG_${direction}`;
  if (score >= t.a) return direction;
  if (score >= t.b) return `CAUTIOUS_${direction}`;
  if (score >= t.c) return `WEAK_${direction}`;

  return "NO_TRADE";
}

function getBogotaHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      hour12: false
    }).format(new Date(date))
  );
}