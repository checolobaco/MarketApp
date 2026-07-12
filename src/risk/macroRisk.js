export function getMacroRiskNow() {
  const now = new Date();

  const bogotaHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      hour12: false
    }).format(now)
  );

  const bogotaMinute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      minute: "2-digit"
    }).format(now)
  );

  const totalMinutes = bogotaHour * 60 + bogotaMinute;

  const macroWindows = [
    {
      name: "US_MARKET_OPEN",
      start: 8 * 60 + 20,
      end: 9 * 60,
      risk: "HIGH"
    },
    {
      name: "US_DATA_WINDOW",
      start: 7 * 60 + 20,
      end: 8 * 60,
      risk: "HIGH"
    },
    {
      name: "FOMC_WINDOW",
      start: 12 * 60 + 45,
      end: 13 * 60 + 30,
      risk: "VERY_HIGH"
    }
  ];

  const active = macroWindows.find(
    w => totalMinutes >= w.start && totalMinutes <= w.end
  );

  if (!active) {
    return {
      macro_risk: "NORMAL",
      event: null
    };
  }

  return {
    macro_risk: active.risk,
    event: active.name
  };
}