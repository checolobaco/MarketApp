import { XAU_SCORING_CONFIG } from "../config/xauScoringConfig.js";

export function applyXauSmartFilter({
  indicators,
  aiResult,
  riskFilter,
  tradeQuality,
  macroRisk,
  date = new Date()
}) {
  const reasons = [];
  const hour = getBogotaHour(date);

  const cfg = XAU_SCORING_CONFIG;
  const quality = tradeQuality.trade_quality;
  const adx = indicators.signals.adx;
  const atr = indicators.signals.atr;
  const direction = aiResult.direction;

  let allowed = true;

  if (cfg.smartFilter.blockNeutral && direction === "NEUTRAL") {
    allowed = false;
    reasons.push("Dirección NEUTRAL");
  }

  if (
    cfg.smartFilter.blockVeryHighMacro &&
    macroRisk.macro_risk === "VERY_HIGH"
  ) {
    allowed = false;
    reasons.push("Macro risk VERY_HIGH");
  }

  if (
    cfg.smartFilter.blockRiskFilter &&
    riskFilter.should_enter === false
  ) {
    allowed = false;
    reasons.push(`Risk filter bloqueó: ${riskFilter.blocked_reason}`);
  }

  if (
    cfg.smartFilter.blockBadHours &&
    cfg.hours.blocked.includes(hour)
  ) {
    allowed = false;
    reasons.push(`Hora bloqueada por bajo rendimiento histórico: ${hour}`);
  }

  if (
    cfg.smartFilter.blockNoTrade &&
    quality === "NO_TRADE"
  ) {
    allowed = false;
    reasons.push("Trade quality NO_TRADE");
  }

  if (!cfg.smartFilter.allowQualities.includes(quality)) {
    allowed = false;
    reasons.push(`Calidad no permitida: ${quality}`);
  }

  return {
    smart_allowed: allowed,
    smart_blocked_reason: reasons.join(" | ") || null,
    checks: {
      hour,
      quality,
      adx,
      atr,
      direction,
      hour_group: getHourGroup(hour),
      blocked_hour: cfg.hours.blocked.includes(hour),
      risk_allowed: riskFilter.should_enter,
      macro_risk: macroRisk.macro_risk
    }
  };
}

function getHourGroup(hour) {
  const cfg = XAU_SCORING_CONFIG;

  if (cfg.hours.aPlus.includes(hour)) return "A_PLUS_HOUR";
  if (cfg.hours.a.includes(hour)) return "A_HOUR";
  if (cfg.hours.b.includes(hour)) return "B_HOUR";
  if (cfg.hours.blocked.includes(hour)) return "BLOCKED_HOUR";

  return "DEFAULT_HOUR";
}

function getBogotaHour(date) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      hour12: false
    }).format(new Date(date))
  );
}