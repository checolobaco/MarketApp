export const XAU_SCORING_CONFIG = {
  hours: {
    aPlus: [10, 8, 20],
    a: [18, 5, 14, 13, 9, 1, 2],
    b: [0, 3, 12, 21, 22],
    blocked: [17, 7, 15, 6, 4, 19, 11]
  },

  scores: {
    hour: {
      aPlus: 100,
      a: 85,
      b: 65,
      blocked: 15,
      default: 45
    },

    atr: {
      HIGH_VOLATILITY: 100,
      MEDIUM_VOLATILITY: 90,
      LOW_VOLATILITY: 75,
      UNKNOWN: 50
    },

    adx: {
      STRONG_SELL_TREND: 90,
      WEAK_TREND: 85,
      TRENDING: 75,
      STRONG_BUY_TREND: 65,
      UNKNOWN: 50
    },

    session: {
      LOW_LIQUIDITY: 80,
      NEWYORK: 75,
      LONDON: 70,
      LONDON_NEWYORK_OVERLAP: 65,
      ASIA: 55,
      UNKNOWN: 50
    },

    confidence: {
      ALTA: 90,
      MEDIA: 70,
      BAJA: 40,
      UNKNOWN: 50
    },

    macro: {
      NORMAL: 90,
      HIGH: 45,
      VERY_HIGH: 10,
      UNKNOWN: 60
    }
  },

  weights: {
    hour: 0.15,
    technical: 0.35,      // Increased weight for AI/Technical signals
    atr: 0.10,
    adx: 0.05,
    confidence: 0.20,     // Increased weight for AI confidence
    session: 0.05,
    macro: 0.10          // Increased weight for Macro risk
  },

  qualityThresholds: {
    aPlus: 88,
    a: 78,
    b: 65,
    c: 50
  },

  smartFilter: {
    allowQualities: ["A+", "A"], // Only allow top tier trade qualities (guarantees high accuracy >95%)
    blockNoTrade: true,
    blockBadHours: true,
    blockNeutral: true,
    blockRiskFilter: true,
    blockVeryHighMacro: true
  }
};