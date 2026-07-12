import {
  RSI,
  EMA,
  MACD,
  BollingerBands,
  ATR,
  ADX,
  StochasticRSI
} from "technicalindicators";

export function calculateIndicators(marketData) {
  const candles = marketData.candles;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const lastPrice = last(closes);

  const rsi = last(RSI.calculate({ values: closes, period: 14 }));

  const ema20 = last(EMA.calculate({ values: closes, period: 20 }));
  const ema50 = last(EMA.calculate({ values: closes, period: 50 }));
  const ema200 = last(EMA.calculate({ values: closes, period: 200 }));

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

  const lastVolume = last(volumes);
  const avgVolume20 = average(volumes.slice(-20));

  const trend15m = calculateTrend(closes.slice(-2));
  const trend1h = calculateTrend(closes.slice(-4));
  const trend4h = calculateTrend(closes.slice(-16));
  const trend1d = calculateTrend(closes.slice(-26));

  const signals = {
    rsi: getRsiSignal(rsi),
    macd: getMacdSignal(macd),
    ema20: lastPrice > ema20 ? "BULLISH" : "BEARISH",
    ema50: lastPrice > ema50 ? "BULLISH" : "BEARISH",
    ema200: ema200 ? lastPrice > ema200 ? "BULLISH" : "BEARISH" : "UNKNOWN",
    bollinger: getBollingerSignal(lastPrice, bb),
    atr: getAtrSignal(atr, lastPrice),
    adx: getAdxSignal(adx),
    stochastic_rsi: getStochRsiSignal(stochRsi),
    volume: lastVolume > avgVolume20 ? "HIGH" : "LOW",
    trend15m,
    trend1h,
    trend4h,
    trend1d
  };

  const score = calculateScore(signals);

  return {
    symbol: marketData.symbol,
    lastPrice: round(lastPrice),

    rsi: round(rsi),
    macd_value: round(macd?.MACD),
    macd_signal_value: round(macd?.signal),
    macd_histogram: round(macd?.histogram),

    ema20_value: round(ema20),
    ema50_value: round(ema50),
    ema200_value: round(ema200),

    bollinger_upper: round(bb?.upper),
    bollinger_middle: round(bb?.middle),
    bollinger_lower: round(bb?.lower),

    atr: round(atr),
    adx: round(adx?.adx),
    pdi: round(adx?.pdi),
    mdi: round(adx?.mdi),

    stochastic_k: round(stochRsi?.k),
    stochastic_d: round(stochRsi?.d),

    last_volume: lastVolume,
    avg_volume_20: Math.round(avgVolume20),

    signals,

    bull_score: score.bull,
    bear_score: score.bear,
    direction_score: score.direction,
    confidence_score: score.confidence,

    candles_used: candles.length
  };
}

function calculateScore(signals) {
  let bull = 0;
  let bear = 0;

  addSignal(signals.rsi, 10);
  addSignal(signals.macd, 15);
  addSignal(signals.ema20, 10);
  addSignal(signals.ema50, 10);
  addSignal(signals.ema200, 10);
  addSignal(signals.bollinger, 8);
  addSignal(signals.stochastic_rsi, 8);

  if (signals.volume === "HIGH") bull += 5;

  addTrend(signals.trend15m, 5);
  addTrend(signals.trend1h, 10);
  addTrend(signals.trend4h, 14);
  addTrend(signals.trend1d, 10);

  if (signals.adx === "STRONG_BULLISH_TREND") bull += 10;
  if (signals.adx === "STRONG_BEARISH_TREND") bear += 10;

  function addSignal(signal, weight) {
    if (signal === "BULLISH" || signal === "OVERSOLD") bull += weight;
    if (signal === "BEARISH" || signal === "OVERBOUGHT") bear += weight;
  }

  function addTrend(trend, weight) {
    if (trend === "ALCISTA") bull += weight;
    if (trend === "BAJISTA") bear += weight;
  }

  const total = bull + bear || 1;

  const bullPercent = Math.round((bull / total) * 100);
  const bearPercent = 100 - bullPercent;

  let direction = "NEUTRAL";
  if (bullPercent >= 58) direction = "SUBE";
  if (bearPercent >= 58) direction = "BAJA";

  let confidence = "BAJA";
  if (Math.abs(bullPercent - bearPercent) >= 20) confidence = "MEDIA";
  if (Math.abs(bullPercent - bearPercent) >= 35) confidence = "ALTA";

  return {
    bull: bullPercent,
    bear: bearPercent,
    direction,
    confidence
  };
}

function getRsiSignal(rsi) {
  if (rsi >= 70) return "OVERBOUGHT";
  if (rsi <= 30) return "OVERSOLD";
  if (rsi > 52) return "BULLISH";
  if (rsi < 48) return "BEARISH";
  return "NEUTRAL";
}

function getMacdSignal(macd) {
  if (!macd) return "UNKNOWN";
  if (macd.MACD > macd.signal && macd.histogram > 0) return "BULLISH";
  if (macd.MACD < macd.signal && macd.histogram < 0) return "BEARISH";
  return "NEUTRAL";
}

function getBollingerSignal(price, bb) {
  if (!bb) return "UNKNOWN";
  if (price <= bb.lower) return "OVERSOLD";
  if (price >= bb.upper) return "OVERBOUGHT";
  if (price > bb.middle) return "BULLISH";
  if (price < bb.middle) return "BEARISH";
  return "NEUTRAL";
}

function getAtrSignal(atr, price) {
  if (!atr || !price) return "UNKNOWN";

  const atrPercent = (atr / price) * 100;

  if (atrPercent >= 3) return "HIGH_VOLATILITY";
  if (atrPercent >= 1.5) return "MEDIUM_VOLATILITY";

  return "LOW_VOLATILITY";
}

function getAdxSignal(adx) {
  if (!adx) return "UNKNOWN";

  if (adx.adx >= 25 && adx.pdi > adx.mdi) {
    return "STRONG_BULLISH_TREND";
  }

  if (adx.adx >= 25 && adx.mdi > adx.pdi) {
    return "STRONG_BEARISH_TREND";
  }

  if (adx.adx >= 20) return "TRENDING";

  return "WEAK_TREND";
}

function getStochRsiSignal(stoch) {
  if (!stoch) return "UNKNOWN";

  if (stoch.k <= 20 && stoch.d <= 20) return "OVERSOLD";
  if (stoch.k >= 80 && stoch.d >= 80) return "OVERBOUGHT";
  if (stoch.k > stoch.d) return "BULLISH";
  if (stoch.k < stoch.d) return "BEARISH";

  return "NEUTRAL";
}

function calculateTrend(values) {
  if (!values || values.length < 2) return "NEUTRAL";

  const first = values[0];
  const lastValue = values[values.length - 1];

  const changePercent = ((lastValue - first) / first) * 100;

  if (changePercent > 0.3) return "ALCISTA";
  if (changePercent < -0.3) return "BAJISTA";

  return "NEUTRAL";
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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