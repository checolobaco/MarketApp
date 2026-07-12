export function simulateXauTpSl({
  candles,
  prediction
}) {
  const direction = prediction.predicted_direction;

  if (direction === "NEUTRAL") {
    return {
      tp1_hit: false,
      tp2_hit: false,
      sl_hit: false,
      first_hit: "NONE",
      first_hit_price: null,
      minutes_to_first_hit: null,
      real_exit_reason: "NEUTRAL_SIGNAL",
      real_pips_result: 0
    };
  }

  const entry = Number(prediction.entry_price);
  const stopLoss = Number(prediction.stop_loss);
  const tp1 = Number(prediction.take_profit_1);
  const tp2 = Number(prediction.take_profit_2);

  let tp1Hit = false;
  let tp2Hit = false;
  let slHit = false;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    const high = Number(candle.high);
    const low = Number(candle.low);

    const minutes = (i + 1) * 5;

    if (direction === "BUY") {
      const hitSl = low <= stopLoss;
      const hitTp2 = high >= tp2;
      const hitTp1 = high >= tp1;

      if (hitSl) {
        slHit = true;

        return buildResult({
          entry,
          exitPrice: stopLoss,
          firstHit: "SL",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }

      if (hitTp2) {
        tp1Hit = true;
        tp2Hit = true;

        return buildResult({
          entry,
          exitPrice: tp2,
          firstHit: "TP2",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }

      if (hitTp1) {
        tp1Hit = true;

        return buildResult({
          entry,
          exitPrice: tp1,
          firstHit: "TP1",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }
    }

    if (direction === "SELL") {
      const hitSl = high >= stopLoss;
      const hitTp2 = low <= tp2;
      const hitTp1 = low <= tp1;

      if (hitSl) {
        slHit = true;

        return buildResult({
          entry,
          exitPrice: stopLoss,
          firstHit: "SL",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }

      if (hitTp2) {
        tp1Hit = true;
        tp2Hit = true;

        return buildResult({
          entry,
          exitPrice: tp2,
          firstHit: "TP2",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }

      if (hitTp1) {
        tp1Hit = true;

        return buildResult({
          entry,
          exitPrice: tp1,
          firstHit: "TP1",
          minutes,
          tp1Hit,
          tp2Hit,
          slHit,
          direction
        });
      }
    }
  }

  return {
    tp1_hit: tp1Hit,
    tp2_hit: tp2Hit,
    sl_hit: slHit,
    first_hit: "NONE",
    first_hit_price: null,
    minutes_to_first_hit: null,
    real_exit_reason: "TIME_EXIT",
    real_pips_result: null
  };
}

function buildResult({
  entry,
  exitPrice,
  firstHit,
  minutes,
  tp1Hit,
  tp2Hit,
  slHit,
  direction
}) {
  return {
    tp1_hit: tp1Hit,
    tp2_hit: tp2Hit,
    sl_hit: slHit,
    first_hit: firstHit,
    first_hit_price: Number(exitPrice.toFixed(4)),
    minutes_to_first_hit: minutes,
    real_exit_reason: firstHit,
    real_pips_result: calculatePipsResult(direction, entry, exitPrice)
  };
}

function calculatePipsResult(direction, entry, exitPrice) {
  if (direction === "BUY") {
    return Number(((exitPrice - entry) * 10).toFixed(2));
  }

  if (direction === "SELL") {
    return Number(((entry - exitPrice) * 10).toFixed(2));
  }

  return 0;
}