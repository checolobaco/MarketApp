import YahooFinance from "yahoo-finance2";
import { logApiCall } from "../services/apiLogger.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: {
    logErrors: false
  }
});

const DEFAULT_SYMBOL = "GC=F";

export async function getXauMarketData(symbol = DEFAULT_SYMBOL) {
  const cleanSymbol = symbol || DEFAULT_SYMBOL;

  try {
    const candles = await getXauHistoricalCandles(5, "5m", cleanSymbol);
    if (candles.length < 80) {
      throw new Error("No hay suficientes velas para XAU scalping");
    }
    const lastCandle = candles[candles.length - 1];

    return {
      symbol: "XAUUSD",
      providerSymbol: cleanSymbol,
      price: lastCandle.close,
      candles
    };
  } catch (error) {
    throw new Error(`No se pudieron obtener datos para ${cleanSymbol}: ${error.message}`);
  }
}

export async function getXauCurrentPrice(symbol = DEFAULT_SYMBOL) {
  const cleanSymbol = symbol || DEFAULT_SYMBOL;

  try {
    const quote = await logApiCall({
      provider: "YAHOO_FINANCE",
      symbol: cleanSymbol,
      requestType: "QUOTE",
      action: () => yahooFinance.quote(cleanSymbol, {}, {
        validateResult: false,
        fetchOptions: {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          }
        }
      })
    });
    if (quote?.regularMarketPrice) {
      return Number(quote.regularMarketPrice);
    }
  } catch (error) {
    console.warn(`Falla quote YahooFinance para ${cleanSymbol}. Probando Twelve Data...`);
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (apiKey) {
    try {
      const altSymbol = cleanSymbol === "GC=F" ? "XAU/USD" : cleanSymbol;
      const url = `https://api.twelvedata.com/price?symbol=${altSymbol}&apikey=${apiKey}`;
      const data = await logApiCall({
        provider: "TWELVE_DATA",
        symbol: altSymbol,
        requestType: "PRICE",
        action: async () => {
          const response = await fetch(url);
          return response.json();
        }
      });
      if (data?.price) {
        return Number(data.price);
      }
    } catch (e) {
      console.warn(`Falla Twelve Data price para XAU: ${e.message}`);
    }
  }

  try {
    const candles = await getXauHistoricalCandles(1, "5m", cleanSymbol);
    if (candles.length > 0) {
      return candles[candles.length - 1].close;
    }
  } catch (e) {
    // Ignore
  }

  throw new Error(`No se pudo obtener precio actual de XAU/USD de ningún proveedor.`);
}

export async function getXauCandlesBetween(startDate, endDate, symbol = DEFAULT_SYMBOL) {
  const cleanSymbol = symbol || DEFAULT_SYMBOL;

  try {
    const result = await logApiCall({
      provider: "YAHOO_FINANCE",
      symbol: cleanSymbol,
      requestType: "CHART_RANGE",
      action: () => yahooFinance.chart(cleanSymbol, {
        period1: new Date(startDate),
        period2: new Date(endDate),
        interval: "5m"
      }, {
        validateResult: false,
        fetchOptions: {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          }
        }
      })
    });

    if (result?.quotes?.length) {
      return normalizeCandles(result.quotes);
    }
  } catch (error) {
    console.warn(`Falla getXauCandlesBetween YahooFinance para ${cleanSymbol}. Probando Twelve Data...`);
  }

  // Fallback to Twelve Data
  try {
    const altSymbol = cleanSymbol === "GC=F" ? "XAU/USD" : cleanSymbol;
    const candles = await fetchFromTwelveData(altSymbol, "5m", 5);
    return candles.filter(c => c.date >= new Date(startDate) && c.date <= new Date(endDate));
  } catch (error) {
    console.warn(`Falla getXauCandlesBetween Twelve Data para ${cleanSymbol}: ${error.message}`);
  }

  return [];
}

function normalizeCandles(quotes) {
  return quotes
    .filter(q => q.close)
    .map(q => ({
      date: q.date,
      open: Number(q.open),
      high: Number(q.high),
      low: Number(q.low),
      close: Number(q.close),
      volume: Number(q.volume || 0)
    }));
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export async function getXauHistoricalCandles(days = 7, interval = "5m", symbol = DEFAULT_SYMBOL) {
  const cleanSymbol = symbol || DEFAULT_SYMBOL;

  // 1. Try Yahoo Finance
  try {
    const result = await logApiCall({
      provider: "YAHOO_FINANCE",
      symbol: cleanSymbol,
      requestType: "CHART",
      action: () => yahooFinance.chart(cleanSymbol, {
        period1: getDateDaysAgo(days),
        interval
      }, {
        validateResult: false,
        fetchOptions: {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          }
        }
      })
    });

    if (result?.quotes?.length) {
      return normalizeCandles(result.quotes);
    }
  } catch (error) {
    console.warn(`Falla Yahoo Finance para XAU/USD: ${error.message}. Pasando a Twelve Data...`);
  }

  const altSymbol = cleanSymbol === "GC=F" ? "XAU/USD" : cleanSymbol;

  // 2. Try Twelve Data
  try {
    return await fetchFromTwelveData(altSymbol, interval, days);
  } catch (error) {
    console.warn(`Falla Twelve Data para XAU/USD: ${error.message}. Pasando a Alpha Vantage...`);
  }

  // 3. Try Alpha Vantage
  try {
    return await fetchFromAlphaVantage(altSymbol, interval);
  } catch (error) {
    console.error(`Todos los proveedores reales fallaron para XAU/USD.`);
    throw new Error(`Todos los proveedores fallaron para XAU/USD: ${error.message}`);
  }
}

async function fetchFromTwelveData(symbol, interval, days) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("Twelve Data API key no configurada");

  const tdInterval = interval === "5m" ? "5min" : "15min";
  const limit = Math.ceil((days * 24 * 60) / (interval === "5m" ? 5 : 15));
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${tdInterval}&outputsize=${limit}&apikey=${apiKey}`;

  return logApiCall({
    provider: "TWELVE_DATA",
    symbol,
    requestType: "CANDLES",
    action: async () => {
      const response = await fetch(url);
      const data = await response.json();

      if (!data?.values?.length) {
        throw new Error(data?.message || `No se encontraron datos en Twelve Data para ${symbol}`);
      }

      return data.values
        .map(v => ({
          date: new Date(v.datetime),
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: Number(v.volume || 0)
        }))
        .reverse();
    }
  });
}

async function fetchFromAlphaVantage(symbol, interval) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error("Alpha Vantage API key no configurada");

  const avInterval = interval === "5m" ? "5min" : "15min";
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${avInterval}&outputsize=full&apikey=${apiKey}`;

  return logApiCall({
    provider: "ALPHA_VANTAGE",
    symbol,
    requestType: "CANDLES",
    action: async () => {
      const response = await fetch(url);
      const data = await response.json();

      const seriesKey = `Time Series (${avInterval})`;
      const series = data[seriesKey];

      if (!series) {
        throw new Error(data["Note"] || data["Error Message"] || `No se encontraron datos en Alpha Vantage para ${symbol}`);
      }

      return Object.keys(series)
        .map(dateTimeStr => {
          const v = series[dateTimeStr];
          return {
            date: new Date(dateTimeStr),
            open: Number(v["1. open"]),
            high: Number(v["2. high"]),
            low: Number(v["3. low"]),
            close: Number(v["4. close"]),
            volume: Number(v["5. volume"] || 0)
          };
        })
        .sort((a, b) => a.date - b.date);
    }
  });
}