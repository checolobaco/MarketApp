// src/services/tradingConfig.js
// Helper con configuraciones de trading por instrumento (volúmenes mínimos, multiplicadores, etc.)
import { ForexComClient } from "../forexcom/client.js";

const MIN_VOLUMES = {
  // Mappings basados en observaciones y uso común en MarketApp
  // MarketId -> cantidad mínima aceptada por Forex.com (en unidades/lotes según integración)
  "402044081": 1000,
  "402044083": 1,
  "401203130": 100,
  "401449254": 1000,
  "401203195": 100,
  "401449251": 1000,
  "401483119": 0.1,  // Ethereum
  "402044422": 0.01  // Bitcoin
};

export function getMinVolumeForSymbol(symbol) {
  const key = String(symbol || "").toUpperCase().trim();
  if (MIN_VOLUMES[key] !== undefined) return MIN_VOLUMES[key];

  // Fallback heuristics:
  // - Numeric MarketId: assume 1 for metals, 1000 for FX/CFD large-unit instruments
  if (!isNaN(key) && key.length >= 6) {
    // If id starts with 40 or 41 assume large-unit CFD -> 1000
    if (key.startsWith("40") || key.startsWith("41")) return 1000;
    return 1;
  }

  // Non-numeric symbols (e.g., XAUUSD) default to small lot
  if (key.includes("XAU") || key.includes("GOLD")) return 1;

  // Default conservative minimum
  return 1;
}

export default { getMinVolumeForSymbol };

// --------------------------------------------------
// Async provider lookup + cache
// --------------------------------------------------

const providerCache = new Map(); // symbol -> { min, max }

function extractMinMaxFromInfo(info) {
  const details = info?.MarketInformation || info || {};
  let minQty = null;
  
  const candidates = [
    "WebMinSize",
    "MinimumQuantity",
    "MinimumSize",
    "MinQuantity",
    "MinLotSize",
    "MinimumOrder",
    "MinimumDealSize",
    "MinimumTradeSize",
    "MinimumVolume",
    "MinTradeQty",
    "MinimumOrderQuantity",
    "MinSize"
  ];

  for (const key of candidates) {
    if (details[key] !== undefined && details[key] !== null) {
      const v = Number(details[key]);
      if (!Number.isNaN(v) && v > 0) {
        minQty = v;
        break;
      }
    }
  }

  if (minQty === null) {
    const spreads = details.MarketSpreads || details.marketSpreads || [];
    if (Array.isArray(spreads) && spreads.length) {
      const s0 = spreads[0];
      if (s0 && (s0.MinimumQuantity || s0.MinQuantity || s0.MinSize)) {
        const v = Number(s0.MinimumQuantity || s0.MinQuantity || s0.MinSize);
        if (!Number.isNaN(v) && v > 0) minQty = v;
      }
    }
  }

  if (minQty !== null) {
    const increment = Number(details.IncrementSize);
    if (!Number.isNaN(increment) && increment > 0) {
      minQty = Math.max(minQty, increment);
    }
    return { min: minQty, max: null };
  }

  return null;
}

export async function getMinMaxForSymbolFromProvider(symbol) {
  const key = String(symbol || "").toUpperCase().trim();
  if (providerCache.has(key)) return providerCache.get(key);

  try {
    const client = new ForexComClient({
      username: process.env.FOREX_USERNAME,
      password: process.env.FOREX_PASSWORD,
      appKey: process.env.FOREX_APPKEY,
      isDemo: process.env.FOREX_IS_DEMO === "true"
    });
    // Attempt to resolve numeric MarketId first
    if (!isNaN(key)) {
      const marketId = Number(key);
      const info = await client.getMarketInformation(marketId).catch(() => null);
      const extracted = extractMinMaxFromInfo(info);
      if (extracted) {
        providerCache.set(key, extracted);
        return extracted;
      }
    }

    // Otherwise search markets
    const search = key === "XAUUSD" || key.includes("XAU") ? "Gold" : key;
    const list = await client.listMarkets(search, 10).catch(() => ({ Markets: [] }));
    const markets = list.Markets || [];
    for (const m of markets) {
      const info = await client.getMarketInformation(m.MarketId).catch(() => null);
      const extracted = extractMinMaxFromInfo(info);
      if (extracted) {
        providerCache.set(key, extracted);
        return extracted;
      }
    }
  } catch (e) {
    // Ignore and fallback
  }

  const fallback = { min: getMinVolumeForSymbol(key), max: null };
  providerCache.set(key, fallback);
  return fallback;
}

export async function getMinVolumeForSymbolAsync(symbol) {
  const r = await getMinMaxForSymbolFromProvider(symbol);
  return r?.min || getMinVolumeForSymbol(symbol);
}
