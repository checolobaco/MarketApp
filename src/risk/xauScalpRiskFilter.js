export function applyXauScalpRiskFilter(indicators, aiResult) {
  const session = indicators.signals.market_session;
  const adxSignal = indicators.signals.adx;
  const atrSignal = indicators.signals.atr;

  const reasons = [];

  let allowed = true;
  let riskLevel = "NORMAL";

  if (aiResult.direction === "NEUTRAL") {
    allowed = false;
    reasons.push("Dirección NEUTRAL");
  }

  if (session === "ASIA") {
    riskLevel = "HIGH";
    reasons.push("Sesión ASIA: menor liquidez para scalping agresivo");
  }

  if (session === "LOW_LIQUIDITY") {
    allowed = false;
    riskLevel = "VERY_HIGH";
    reasons.push("Sesión de baja liquidez");
  }

  if (adxSignal === "WEAK_TREND") {
    allowed = false;
    reasons.push("ADX débil: no hay fuerza de tendencia suficiente");
  }

  if (atrSignal === "LOW_VOLATILITY") {
    allowed = false;
    reasons.push("ATR bajo: poco rango para scalping");
  }

  if (
    aiResult.confidence === "BAJA" ||
    Math.max(
      Number(aiResult.probability_buy || 0),
      Number(aiResult.probability_sell || 0)
    ) < 65
  ) {
    allowed = false;
    reasons.push("Probabilidad/confianza insuficiente");
  }

  return {
    should_enter: allowed,
    risk_level: riskLevel,
    blocked_reason: reasons.join(" | ") || null,
    checks: {
      session,
      adx: adxSignal,
      atr: atrSignal,
      confidence: aiResult.confidence,
      probability_buy: aiResult.probability_buy,
      probability_sell: aiResult.probability_sell
    }
  };
}