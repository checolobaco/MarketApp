import YahooFinance from "yahoo-finance2";
import { logApiCall } from "../services/apiLogger.js";

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: {
    logErrors: false
  }
});

const resolveCache = new Map();
const quoteCache = new Map();
const candleCache = new Map();

function mapYahooSymbol(symbol) {
  const clean = symbol.toUpperCase().replace("/", "").trim();
  // Forex: EURUSD -> EURUSD=X
  if (/^[A-Z]{6}$/.test(clean)) {
    if (clean === "XAUUSD") return "GC=F";
    if (clean === "XAGUSD") return "SI=F";
    return `${clean}=X`;
  }
  return clean;
}

function mapTwelveDataSymbol(symbol) {
  const clean = symbol.toUpperCase().trim();
  if (clean.includes("/")) return clean;
  // Forex: EURUSD -> EUR/USD
  if (/^[A-Z]{6}$/.test(clean)) {
    if (clean === "XAUUSD") return "XAU/USD";
    if (clean === "XAGUSD") return "XAG/USD";
    return `${clean.substring(0, 3)}/${clean.substring(3)}`;
  }
  return clean;
}

function mapAlphaVantageSymbol(symbol) {
  const clean = symbol.toUpperCase().trim();
  if (clean.includes("/")) return clean;
  // Forex: EURUSD -> EUR/USD
  if (/^[A-Z]{6}$/.test(clean)) {
    return `${clean.substring(0, 3)}/${clean.substring(3)}`;
  }
  return clean;
}

function getProviderOrder(preferredProvider, type = "CANDLES", symbol = "") {
  const cleanSymbol = String(symbol || "").toUpperCase().trim();

  // Si el símbolo es un ID numérico de Forex.com (ej. 402044083 o 401203116)
  if (cleanSymbol && !isNaN(cleanSymbol)) {
    return ["FOREX_COM"];
  }

  // Orden base: 1 yahoo finance, 2 xpro, 3 forex.com, 4 TWELVE_DATA, 5 ALPHA_VANTAGE
  let order = ["YAHOO_FINANCE", "XPRO", "FOREX_COM", "TWELVE_DATA", "ALPHA_VANTAGE"];

  if (preferredProvider === "XPRO") {
    order = ["XPRO", "YAHOO_FINANCE", "FOREX_COM", "TWELVE_DATA", "ALPHA_VANTAGE"];
  } else if (preferredProvider === "FOREX_COM") {
    order = ["FOREX_COM", "YAHOO_FINANCE", "XPRO", "TWELVE_DATA", "ALPHA_VANTAGE"];
  }

  // Filtrar XPRO para velas históricas dado que no ofrece endpoint de histórico de velas
  if (type === "CANDLES") {
    order = order.filter(p => p !== "XPRO");
  }

  return order;
}

async function resolveSymbolForexCom(client, symbol) {
  const cleanSymbol = symbol.toUpperCase().trim();
  if (!isNaN(cleanSymbol)) {
    return { MarketId: Number(cleanSymbol), Bid: null, Offer: null, Name: `CFD ${cleanSymbol}` };
  }

  // 1. Verificar cache en memoria (5 minutos de expiración)
  const cached = resolveCache.get(cleanSymbol);
  if (cached && (Date.now() - cached.timestamp < 300_000)) {
    return cached.market;
  }

  // Intentar diferentes consultas para maximizar compatibilidad de búsqueda
  const queriesToTry = [];
  if (cleanSymbol === "XAUUSD" || cleanSymbol === "XAU/USD") {
    queriesToTry.push("Gold");
  } else if (cleanSymbol === "EURUSD" || cleanSymbol === "EUR/USD") {
    queriesToTry.push("EUR/USD", "EURUSD", "EUR");
  } else if (cleanSymbol === "GBPUSD" || cleanSymbol === "GBP/USD") {
    queriesToTry.push("GBP/USD", "GBPUSD", "GBP");
  } else if (cleanSymbol === "USDJPY" || cleanSymbol === "USD/JPY") {
    queriesToTry.push("USD/JPY", "USDJPY", "USD");
  } else {
    queriesToTry.push(cleanSymbol);
    if (cleanSymbol.includes("/")) {
      queriesToTry.push(cleanSymbol.replace("/", ""));
    }
  }

  for (const query of queriesToTry) {
    try {
      const searchResult = await client.listMarkets(query, 10);
      if (searchResult && searchResult.Markets && searchResult.Markets.length > 0) {
        // Encontrar la mejor coincidencia o retornar la primera
        const market = searchResult.Markets.find(m => 
          m.Name.toUpperCase().includes(cleanSymbol) || 
          m.Name.toUpperCase().includes(query.toUpperCase())
        ) || searchResult.Markets[0];
        
        // Guardar en cache
        resolveCache.set(cleanSymbol, { market, timestamp: Date.now() });
        return market;
      }
    } catch (e) {
      // Intentar siguiente consulta
    }
  }

  throw new Error(`Símbolo ${symbol} no pudo ser resuelto en Forex.com`);
}

let sharedForexComClient = null;
let loginPromise = null;

async function getSharedForexComClient() {
  const username = process.env.FOREX_USERNAME;
  const password = process.env.FOREX_PASSWORD;
  const appKey = process.env.FOREX_APPKEY;
  if (!username || !password || !appKey) {
    throw new Error("Credenciales de Forex.com no configuradas en variables de entorno");
  }

  if (sharedForexComClient && sharedForexComClient.sessionToken) {
    return sharedForexComClient;
  }

  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = (async () => {
    const { ForexComClient } = await import("../forexcom/client.js");
    const client = new ForexComClient({ username, password, appKey, isDemo: false });
    console.log("[ForexComClient] Iniciando sesión persistente compartida en background...");
    await client.login(username, password, appKey, false);
    sharedForexComClient = client;
    loginPromise = null;
    return client;
  })();

  try {
    return await loginPromise;
  } catch (err) {
    loginPromise = null;
    throw err;
  }
}

async function executeWithSharedClient(action) {
  let client;
  try {
    client = await getSharedForexComClient();
    return await action(client);
  } catch (error) {
    const errMsg = String(error.message || "");
    if (errMsg.includes("401") || errMsg.includes("session") || errMsg.includes("Session") || errMsg.includes("429")) {
      console.warn("[ForexComClient] Sesión compartida inválida o con rate limit. Limpiando y reintentando login...");
      sharedForexComClient = null;
      client = await getSharedForexComClient();
      return await action(client);
    }
    throw error;
  }
}

async function fetchFromForexCom(symbol, interval, days) {
  const cleanSymbol = symbol.toUpperCase().trim();
  const cacheKey = `${cleanSymbol}_${interval}_${days}`;
  
  // Cache de velas históricas (15 segundos)
  const cached = candleCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 15_000)) {
    return cached.candles;
  }

  const candles = await executeWithSharedClient(async (client) => {
    const market = await resolveSymbolForexCom(client, symbol);
    const limit = Math.ceil((days * 24 * 60) / (interval === "5m" ? 5 : 15));
    const rawBars = await client.getPriceBars(market.MarketId, interval, limit);

    if (!rawBars || !Array.isArray(rawBars.PriceBars)) {
      throw new Error(`No se obtuvieron velas de Forex.com para ${symbol}`);
    }

    return rawBars.PriceBars.map(b => ({
      date: new Date(b.BarDate),
      open: Number(b.Open),
      high: Number(b.High),
      low: Number(b.Low),
      close: Number(b.Close),
      volume: 0
    }));
  });

  candleCache.set(cacheKey, { candles, timestamp: Date.now() });
  return candles;
}

async function fetchQuoteFromForexCom(symbol) {
  const cleanSymbol = symbol.toUpperCase().trim();
  
  // Cache de precio actual (10 segundos)
  const cached = quoteCache.get(cleanSymbol);
  if (cached && (Date.now() - cached.timestamp < 10_000)) {
    return cached.price;
  }

  const price = await executeWithSharedClient(async (client) => {
    const market = await resolveSymbolForexCom(client, symbol);

    if (market.Bid || market.Offer) {
      return market.Bid ? Number(market.Bid) : Number(market.Offer);
    }

    const rawBars = await client.getPriceBars(market.MarketId, "1m", 1);
    if (rawBars && rawBars.PriceBars && rawBars.PriceBars.length > 0) {
      return Number(rawBars.PriceBars[0].Close);
    }

    throw new Error("No hay precios Bid/Offer ni barras de precio disponibles en Forex.com");
  });

  quoteCache.set(cleanSymbol, { price, timestamp: Date.now() });
  return price;
}

export async function getMarketData(symbol, preferredProvider = null) {
  const cleanSymbol = symbol.toUpperCase().trim();

  try {
    // Obtener velas históricas y capturar qué proveedor resolvió
    const { candles, resolvedProvider } = await getHistoricalCandles(cleanSymbol, 10, "15m", preferredProvider);
    if (candles.length < 60) {
      throw new Error(`No hay suficientes velas válidas para ${cleanSymbol}`);
    }
    
    let lastPrice = candles[candles.length - 1].close;

    try {
      // Pasar el proveedor ganador para evitar reiniciar el waterfall desde Yahoo Finance
      const price = await getCurrentPrice(cleanSymbol, resolvedProvider || preferredProvider);
      if (price) lastPrice = price;
    } catch (e) {
      // Ignorar e ir al fallback (precio de la última vela)
    }

    return {
      symbol: cleanSymbol,
      price: lastPrice,
      candles
    };
  } catch (error) {
    throw new Error(`No se pudieron obtener datos de mercado para ${cleanSymbol}: ${error.message}`);
  }
}

export async function getCurrentPrice(symbol, preferredProvider = null) {
  const cleanSymbol = symbol.toUpperCase().trim();
  const providerOrder = getProviderOrder(preferredProvider, "QUOTE", cleanSymbol);

  for (const provider of providerOrder) {
    try {
      let price = null;

      if (provider === "XPRO") {
        const xproToken = process.env.XPRO_API_KEY;
        if (xproToken) {
          const { XproClient } = await import("../xpro/client.js");
          const client = new XproClient({ token: xproToken });
          const quote = await logApiCall({
            provider: "XPRO",
            symbol: cleanSymbol,
            requestType: "QUOTE",
            action: () => client.getQuote(cleanSymbol)
          });
          if (quote && (quote.bid || quote.ask)) {
            price = quote.bid ? Number(quote.bid) : Number(quote.ask);
          }
        }
      } else if (provider === "YAHOO_FINANCE") {
        const yahooSymbol = mapYahooSymbol(cleanSymbol);
        const quote = await logApiCall({
          provider: "YAHOO_FINANCE",
          symbol: yahooSymbol,
          requestType: "QUOTE",
          action: () => yahooFinance.quote(yahooSymbol, {}, {
            validateResult: false,
            fetchOptions: {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
              }
            }
          })
        });
        if (quote?.regularMarketPrice) {
          price = Number(quote.regularMarketPrice);
        }
      } else if (provider === "FOREX_COM") {
        const fetched = await fetchQuoteFromForexCom(cleanSymbol);
        if (fetched) price = fetched;
      } else if (provider === "TWELVE_DATA") {
        const apiKey = process.env.TWELVE_DATA_API_KEY;
        if (apiKey) {
          const tdSymbol = mapTwelveDataSymbol(cleanSymbol);
          const url = `https://api.twelvedata.com/price?symbol=${tdSymbol}&apikey=${apiKey}`;
          const data = await logApiCall({
            provider: "TWELVE_DATA",
            symbol: tdSymbol,
            requestType: "PRICE",
            action: async () => {
              const response = await fetch(url);
              return response.json();
            }
          });
          if (data?.price) {
            price = Number(data.price);
          }
        }
      } else if (provider === "ALPHA_VANTAGE") {
        const avCandles = await fetchFromAlphaVantage(cleanSymbol, "15m");
        if (avCandles && avCandles.length) price = avCandles[avCandles.length - 1].close;
      }

      // ✅ Corto-circuito: primer proveedor exitoso corta el loop
      if (price !== null && price > 0) {
        console.log(`[MarketData] ✅ Precio resuelto por ${provider} para ${cleanSymbol}: ${price}`);
        return price;
      }
    } catch (error) {
      console.warn(`[MarketData] ⚠️ Falla proveedor ${provider} para ${cleanSymbol} (QUOTE): ${error.message}`);
    }
  }

  throw new Error(`No se pudo obtener precio actual para ${cleanSymbol} de ningún proveedor.`);
}

export async function getCandlesBetween(symbol, startDate, endDate) {
  const cleanSymbol = symbol.toUpperCase().trim();
  const yahooSymbol = mapYahooSymbol(cleanSymbol);

  try {
    const result = await logApiCall({
      provider: "YAHOO_FINANCE",
      symbol: yahooSymbol,
      requestType: "CHART_RANGE",
      action: () => yahooFinance.chart(yahooSymbol, {
        period1: new Date(startDate),
        period2: new Date(endDate),
        interval: "15m"
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
    console.warn(`Falla getCandlesBetween YahooFinance para ${cleanSymbol}. Probando Twelve Data...`);
  }

  try {
    const candles = await fetchFromTwelveData(cleanSymbol, "15m", 10);
    return candles.filter(c => c.date >= new Date(startDate) && c.date <= new Date(endDate));
  } catch (error) {
    console.warn(`Falla getCandlesBetween Twelve Data para ${cleanSymbol}: ${error.message}`);
  }

  return [];
}

function normalizeCandles(quotes) {
  return quotes
    .filter(q => q.close !== null && q.close !== undefined && q.open !== null && q.open !== undefined)
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

export async function getHistoricalCandles(symbol, days = 7, interval = "15m", preferredProvider = null) {
  const cleanSymbol = symbol.toUpperCase().trim();
  const providerOrder = getProviderOrder(preferredProvider, "CANDLES", cleanSymbol);

  for (const provider of providerOrder) {
    try {
      let candles = null;

      if (provider === "YAHOO_FINANCE") {
        const yahooSymbol = mapYahooSymbol(cleanSymbol);
        const result = await logApiCall({
          provider: "YAHOO_FINANCE",
          symbol: yahooSymbol,
          requestType: "CHART",
          action: () => yahooFinance.chart(yahooSymbol, {
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
          candles = normalizeCandles(result.quotes);
        }
      } else if (provider === "FOREX_COM") {
        const fetched = await fetchFromForexCom(cleanSymbol, interval, days);
        if (fetched && fetched.length) candles = fetched;
      } else if (provider === "TWELVE_DATA") {
        const fetched = await fetchFromTwelveData(cleanSymbol, interval, days);
        if (fetched && fetched.length) candles = fetched;
      } else if (provider === "ALPHA_VANTAGE") {
        const fetched = await fetchFromAlphaVantage(cleanSymbol, interval);
        if (fetched && fetched.length) candles = fetched;
      }

      // ✅ Corto-circuito: devuelve inmediatamente sin seguir con los demás proveedores
      if (candles && candles.length > 0) {
        console.log(`[MarketData] ✅ Velas resueltas por ${provider} para ${cleanSymbol}: ${candles.length} barras`);
        return { candles, resolvedProvider: provider };
      }
    } catch (error) {
      console.warn(`[MarketData] ⚠️ Falla proveedor ${provider} para ${cleanSymbol} (CANDLES): ${error.message}`);
    }
  }

  throw new Error(`Todos los proveedores fallaron para obtener velas históricas de ${cleanSymbol}`);
}

async function fetchFromTwelveData(symbol, interval, days) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("Twelve Data API key no configurada");

  const mappedSymbol = mapTwelveDataSymbol(symbol);
  const tdInterval = interval === "5m" ? "5min" : "15min";
  const limit = Math.ceil((days * 24 * 60) / (interval === "5m" ? 5 : 15));
  const url = `https://api.twelvedata.com/time_series?symbol=${mappedSymbol}&interval=${tdInterval}&outputsize=${limit}&apikey=${apiKey}`;

  return logApiCall({
    provider: "TWELVE_DATA",
    symbol: mappedSymbol,
    requestType: "CANDLES",
    action: async () => {
      const response = await fetch(url);
      const data = await response.json();

      if (!data?.values?.length) {
        throw new Error(data?.message || `No se encontraron datos en Twelve Data para ${mappedSymbol}`);
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

  const mappedSymbol = mapAlphaVantageSymbol(symbol);
  const avInterval = interval === "5m" ? "5min" : "15min";
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${mappedSymbol}&interval=${avInterval}&outputsize=full&apikey=${apiKey}`;

  return logApiCall({
    provider: "ALPHA_VANTAGE",
    symbol: mappedSymbol,
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