export function shouldUseGeminiForXau(indicators, riskFilter, macroRisk) {
  const session = indicators.signals.market_session;
  const adx = indicators.signals.adx;
  const atr = indicators.signals.atr;

  const maxProbability = Math.max(
    Number(indicators.buy_score || 0),
    Number(indicators.sell_score || 0)
  );

  const reasons = [];

  if (session === "ASIA") {
    reasons.push("Sesión ASIA: se omite Gemini para ahorrar cuota");
  }

  if (session === "LOW_LIQUIDITY") {
    reasons.push("Baja liquidez: se omite Gemini");
  }

  if (adx === "WEAK_TREND") {
    reasons.push("ADX débil: no vale la pena consultar Gemini");
  }

  if (atr === "LOW_VOLATILITY") {
    reasons.push("ATR bajo: se omite Gemini");
  }

  if (maxProbability < 65) {
    reasons.push("Score técnico menor a 65");
  }

  if (macroRisk.macro_risk === "VERY_HIGH") {
    reasons.push("Evento macro muy alto: no consultar Gemini");
  }

  const useGemini = reasons.length === 0;

  return {
    useGemini,
    reasons
  };
}