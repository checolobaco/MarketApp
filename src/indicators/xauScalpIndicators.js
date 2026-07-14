import {
  RSI,
  EMA,
  MACD,
  BollingerBands,
  ATR,
  ADX,
  StochasticRSI,
  CCI,
  WilliamsR
} from "technicalindicators";

export function calculateXauScalpIndicators(marketData) {
  const candles = marketData.candles;
  const symbol = marketData.symbol || "XAUUSD";

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const lastPrice = last(closes);

  const rsi = last(RSI.calculate({ values: closes, period: 14 }));

  const ema9 = last(EMA.calculate({ values: closes, period: 9 }));
  const ema20 = last(EMA.calculate({ values: closes, period: 20 }));
  const ema50 = last(EMA.calculate({ values: closes, period: 50 }));

  const macd = last(MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  }));

  const bb = last(BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  }));

  const atr = last(ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  }));

  const adx = last(ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  }));

  const stochRsi = last(StochasticRSI.calculate({
    values: closes,
    rsiPeriod: 14,
    stochasticPeriod: 14,
    kPeriod: 3,
    dPeriod: 3
  }));

  const cci = last(CCI.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 20
  }));

  const williams = last(WilliamsR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  }));

  const trend5m = calculateTrend(closes.slice(-2), 0.08);
  const trend15m = calculateTrend(closes.slice(-3), 0.12);
  const trend30m = calculateTrend(closes.slice(-6), 0.18);
  const trend1h = calculateTrend(closes.slice(-12), 0.25);

  const signals = {
    rsi: getRsiSignal(rsi),
    macd: getMacdSignal(macd),
    ema9: lastPrice > ema9 ? "BUY" : "SELL",
    ema20: lastPrice > ema20 ? "BUY" : "SELL",
    ema50: lastPrice > ema50 ? "BUY" : "SELL",
    bollinger: getBollingerSignal(lastPrice, bb),
    atr: getAtrSignal(atr, lastPrice, symbol),
    adx: getAdxSignal(adx),
    stochastic_rsi: getStochRsiSignal(stochRsi),
    cci: getCciSignal(cci),
    williams_r: getWilliamsSignal(williams),
    trend5m,
    trend15m,
    trend30m,
    trend1h,
    market_session: getMarketSession()
  };

  const score = calculateScalpScore(signals);

  const tradePlan = buildTradePlan(
    lastPrice,
    atr,
    score.direction
  );

  return {
    symbol: symbol,
    providerSymbol: marketData.providerSymbol,

    lastPrice: round(lastPrice),

    rsi: round(rsi),
    macd_value: round(macd?.MACD),
    macd_signal_value: round(macd?.signal),
    macd_histogram: round(macd?.histogram),

    ema9_value: round(ema9),
    ema20_value: round(ema20),
    ema50_value: round(ema50),

    bollinger_upper: round(bb?.upper),
    bollinger_middle: round(bb?.middle),
    bollinger_lower: round(bb?.lower),

    atr: round(atr),
    adx: round(adx?.adx),
    pdi: round(adx?.pdi),
    mdi: round(adx?.mdi),

    stochastic_k: round(stochRsi?.k),
    stochastic_d: round(stochRsi?.d),

    cci: round(cci),
    williams_r: round(williams),

    signals,

    buy_score: score.buy,
    sell_score: score.sell,
    direction_score: score.direction,
    confidence_score: score.confidence,

    entry: tradePlan.entry,
    stop_loss: tradePlan.stopLoss,
    take_profit_1: tradePlan.takeProfit1,
    take_profit_2: tradePlan.takeProfit2,
    risk_reward: tradePlan.riskReward,

    candles_used: candles.length
  };
}

function calculateScalpScore(signals) {
  let buy = 0;
  let sell = 0;

  addSignal(signals.rsi, 10);
  addSignal(signals.macd, 15);
  addSignal(signals.ema9, 12);
  addSignal(signals.ema20, 10);
  addSignal(signals.ema50, 8);
  addSignal(signals.bollinger, 8);
  addSignal(signals.stochastic_rsi, 8);
  addSignal(signals.cci, 7);
  addSignal(signals.williams_r, 7);

  addTrend(signals.trend5m, 10);
  addTrend(signals.trend15m, 15);
  addTrend(signals.trend30m, 15);
  addTrend(signals.trend1h, 10);

  if (signals.adx === "STRONG_BUY_TREND") buy += 12;
  if (signals.adx === "STRONG_SELL_TREND") sell += 12;

  function addSignal(signal, weight) {
    if (signal === "BUY" || signal === "OVERSOLD") buy += weight;
    if (signal === "SELL" || signal === "OVERBOUGHT") sell += weight;
  }

  function addTrend(trend, weight) {
    if (trend === "ALCISTA") buy += weight;
    if (trend === "BAJISTA") sell += weight;
  }

  const total = buy + sell || 1;

  const buyPercent = Math.round((buy / total) * 100);
  const sellPercent = 100 - buyPercent;

  let direction = "NEUTRAL";

  if (buyPercent >= 60) direction = "BUY";
  if (sellPercent >= 60) direction = "SELL";

  let confidence = "BAJA";

  if (Math.abs(buyPercent - sellPercent) >= 20) {
    confidence = "MEDIA";
  }

  if (Math.abs(buyPercent - sellPercent) >= 35) {
    confidence = "ALTA";
  }

  return {
    buy: buyPercent,
    sell: sellPercent,
    direction,
    confidence
  };
}

export function buildTradePlan(price, atr, direction) {
  const safeAtr = atr || price * 0.001;

  const stopDistance = safeAtr * 1.5; // SL a 1.5 * ATR para dar respiro
  const tp1Distance = safeAtr * 0.5;  // TP1 ajustado a 0.5 * ATR para alta probabilidad
  const tp2Distance = safeAtr * 1.2;  // TP2 ajustado a 1.2 * ATR

  if (direction === "BUY") {
    return {
      entry: round(price),
      stopLoss: round(price - stopDistance),
      takeProfit1: round(price + tp1Distance),
      takeProfit2: round(price + tp2Distance),
      riskReward: 1.5
    };
  }

  if (direction === "SELL") {
    return {
      entry: round(price),
      stopLoss: round(price + stopDistance),
      takeProfit1: round(price - tp1Distance),
      takeProfit2: round(price - tp2Distance),
      riskReward: 1.5
    };
  }

  return {
    entry: round(price),
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    riskReward: 0
  };
}

function getRsiSignal(rsi) {
  if (rsi >= 70) return "OVERBOUGHT";
  if (rsi <= 30) return "OVERSOLD";
  if (rsi > 52) return "BUY";
  if (rsi < 48) return "SELL";
  return "NEUTRAL";
}

function getMacdSignal(macd) {
  if (!macd) return "UNKNOWN";
  if (macd.MACD > macd.signal && macd.histogram > 0) return "BUY";
  if (macd.MACD < macd.signal && macd.histogram < 0) return "SELL";
  return "NEUTRAL";
}

function getBollingerSignal(price, bb) {
  if (!bb) return "UNKNOWN";
  if (price <= bb.lower) return "OVERSOLD";
  if (price >= bb.upper) return "OVERBOUGHT";
  if (price > bb.middle) return "BUY";
  if (price < bb.middle) return "SELL";
  return "NEUTRAL";
}

function getAtrSignal(atr, price, symbol = "XAUUSD") {
  if (!atr || !price) return "UNKNOWN";

  const atrPercent = (atr / price) * 100;
  const cleanSymbol = String(symbol || "").toUpperCase();
  const isMetalOrGold = cleanSymbol.includes("XAU") || cleanSymbol.includes("GOLD") || cleanSymbol.includes("XAG") || cleanSymbol.includes("SILVER") || cleanSymbol.includes("402044083") || cleanSymbol.includes("402044081");

  // Si no es un metal (divisas estándares o índices), la volatilidad porcentual es naturalmente menor.
  // Ajustamos los umbrales para que no se bloqueen con "ATR bajo".
  const highThreshold = isMetalOrGold ? 0.35 : 0.035;
  const medThreshold = isMetalOrGold ? 0.15 : 0.015;

  if (atrPercent >= highThreshold) return "HIGH_VOLATILITY";
  if (atrPercent >= medThreshold) return "MEDIUM_VOLATILITY";

  return "LOW_VOLATILITY";
}

function getAdxSignal(adx) {
  if (!adx) return "UNKNOWN";

  if (adx.adx >= 25 && adx.pdi > adx.mdi) return "STRONG_BUY_TREND";
  if (adx.adx >= 25 && adx.mdi > adx.pdi) return "STRONG_SELL_TREND";
  if (adx.adx >= 20) return "TRENDING";

  return "WEAK_TREND";
}

function getStochRsiSignal(stoch) {
  if (!stoch) return "UNKNOWN";

  if (stoch.k <= 20 && stoch.d <= 20) return "OVERSOLD";
  if (stoch.k >= 80 && stoch.d >= 80) return "OVERBOUGHT";
  if (stoch.k > stoch.d) return "BUY";
  if (stoch.k < stoch.d) return "SELL";

  return "NEUTRAL";
}

function getCciSignal(cci) {
  if (cci >= 100) return "BUY";
  if (cci <= -100) return "SELL";
  return "NEUTRAL";
}

function getWilliamsSignal(value) {
  if (value <= -80) return "OVERSOLD";
  if (value >= -20) return "OVERBOUGHT";
  if (value > -50) return "BUY";
  if (value < -50) return "SELL";
  return "NEUTRAL";
}

function calculateTrend(values, threshold) {
  if (!values || values.length < 2) return "NEUTRAL";

  const first = values[0];
  const lastValue = values[values.length - 1];

  const changePercent = ((lastValue - first) / first) * 100;

  if (changePercent > threshold) return "ALCISTA";
  if (changePercent < -threshold) return "BAJISTA";

  return "NEUTRAL";
}

function getMarketSession() {
  const now = new Date();

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false
    }).format(now)
  );

  if (hour >= 19 || hour < 3) return "ASIA";
  if (hour >= 3 && hour < 8) return "LONDON";
  if (hour >= 8 && hour < 12) return "LONDON_NEWYORK_OVERLAP";
  if (hour >= 12 && hour < 17) return "NEWYORK";

  return "LOW_LIQUIDITY";
}

function last(values) {
  if (!values || !values.length) return null;
  return values[values.length - 1];
}

function round(value) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  return Number(Number(value).toFixed(4));
}