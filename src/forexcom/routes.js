import express from "express";
import { pool } from "../db.js";
import { ForexComClient } from "./client.js";
import { getMarketData } from "../data_provider/marketData.js";
import { calculateIndicators } from "../indicators/indicators.js";
import { analyzeWithGemini } from "../ai/geminiAnalysis.js";
import { logOrderOpen, logOrderClose } from "../services/tradingJournalService.js";

const router = express.Router();

// Helper to get client from request headers or process.env fallback
function getClient(req) {
  const isDemo = req.headers["x-forex-isdemo"] === "true"; // Defaults to false (Live) if missing or "false"
  const sessionToken = req.headers["x-forex-session"];
  const username = req.headers["x-forex-username"] || process.env.FOREX_USERNAME;

  const clientConfig = {
    username,
    isDemo
  };

  // Si es el usuario configurado en .env, pasamos la contraseña y appKey para permitir auto-relogin en 401
  if (username === process.env.FOREX_USERNAME) {
    clientConfig.password = process.env.FOREX_PASSWORD;
    clientConfig.appKey = process.env.FOREX_APPKEY;
  }

  const client = new ForexComClient(clientConfig);

  if (sessionToken && sessionToken !== "undefined" && sessionToken !== "null") {
    client.setSession(sessionToken, username);
  }

  return client;
}

// Validar respuesta del broker para detectar rechezo interno (Status === 2 o OrderId === 0)
function validateBrokerOrderResponse(result) {
  if (result && (result.Status === 2 || result.OrderId === 0 || (result.Orders && result.Orders[0] && result.Orders[0].Status === 10))) {
    const mainReason = result.StatusReason;
    const orderObj = result.Orders?.[0];
    const subReason = orderObj?.StatusReason || mainReason;
    const subStatus = orderObj?.Status;

    let reasonText = `Código ${subReason}`;
    if (subReason === 75) {
      reasonText = "Mercado Cerrado (Fuera de horario comercial)";
    } else if (subReason === 158) {
      reasonText = "Volumen Inválido (El broker requiere un tamaño mínimo de operación, ej: 1000 unidades)";
    } else if (subReason === 8) {
      reasonText = "Precio Inválido o Fuera de Tolerancia";
    } else if (subReason === 10) {
      reasonText = "Margen o Fondos Insuficientes en la Cuenta";
    }

    const errMsg = result.ErrorMessage || orderObj?.ErrorMessage || "";
    throw new Error(`Orden Rechazada por Forex.com: ${reasonText} (Status=${result.Status || subStatus}, Reason=${subReason})${errMsg ? ' | Info: ' + errMsg : ''}`);
  }
}

// Helper to resolve symbol name to Market ID, Bid, and Offer price
async function resolveSymbolToMarket(client, symbol) {
  const cleanSymbol = symbol.toUpperCase().trim();

  // If symbol is already a numeric ID
  if (!isNaN(cleanSymbol)) {
    const marketId = Number(cleanSymbol);
    const marketInfo = await client.getMarketInformation(marketId);
    const infoDetails = marketInfo?.MarketInformation || {};
    let bid = infoDetails.Bid ? Number(infoDetails.Bid) : null;
    let offer = infoDetails.Offer ? Number(infoDetails.Offer) : null;
    if (!bid || !offer) {
      const bars = await client.getPriceBars(marketId, "1m", 1);
      const lastClose = bars?.PriceBars?.[0]?.Close ? Number(bars.PriceBars[0].Close) : null;
      if (lastClose) {
        // Calcular spread dinámico para no enviar precios idénticos
        let spread = 0.0002;
        const spreadObj = infoDetails.MarketSpreads?.[0];
        if (spreadObj && spreadObj.Spread) {
          spread = Number(spreadObj.Spread);
        } else if (lastClose > 100) {
          spread = 0.02; // Oro o JPY
        }
        bid = lastClose - (spread / 2);
        offer = lastClose + (spread / 2);
      }
    }
    return {
      marketId,
      bidPrice: bid,
      offerPrice: offer,
      name: infoDetails.Name || `CFD ${cleanSymbol}`
    };
  }

  // Common mapping for known assets to help search
  let searchQuery = cleanSymbol;
  if (cleanSymbol === "XAUUSD" || cleanSymbol === "XAU/USD") searchQuery = "Gold";
  else if (cleanSymbol === "EURUSD" || cleanSymbol === "EUR/USD") searchQuery = "EURUSD";
  else if (cleanSymbol === "GBPUSD" || cleanSymbol === "GBP/USD") searchQuery = "GBPUSD";
  else if (cleanSymbol === "USDJPY" || cleanSymbol === "USD/JPY") searchQuery = "USDJPY";

  const searchResult = await client.listMarkets(searchQuery, 10);
  if (searchResult && searchResult.Markets && searchResult.Markets.length > 0) {
    const market = searchResult.Markets.find(m =>
      m.Name.toUpperCase().includes(cleanSymbol) ||
      m.Name.toUpperCase().includes(searchQuery.toUpperCase())
    ) || searchResult.Markets[0];

    let bid = market.Bid ? Number(market.Bid) : null;
    let offer = market.Offer ? Number(market.Offer) : null;

    // Si los precios en tiempo real vienen vacíos, consultar la última barra de 1m
    if (!bid || !offer) {
      console.log(`[resolveSymbolToMarket] Bid/Offer nulos para ${symbol} (ID ${market.MarketId}), consultando última barra...`);
      try {
        const bars = await client.getPriceBars(market.MarketId, "1m", 1);
        const lastClose = bars?.PriceBars?.[0]?.Close ? Number(bars.PriceBars[0].Close) : null;
        if (lastClose) {
          // Obtener spread del market
          const info = await client.getMarketInformation(market.MarketId);
          const infoDetails = info?.MarketInformation || {};
          let spread = 0.0002;
          const spreadObj = infoDetails.MarketSpreads?.[0];
          if (spreadObj && spreadObj.Spread) {
            spread = Number(spreadObj.Spread);
          } else if (lastClose > 100) {
            spread = 0.02;
          }
          bid = lastClose - (spread / 2);
          offer = lastClose + (spread / 2);
          console.log(`[resolveSymbolToMarket] Precio fallback para ${symbol}: Bid=${bid}, Offer=${offer} (Spread=${spread})`);
        }
      } catch (priceErr) {
        console.warn(`[resolveSymbolToMarket] No se pudo obtener precio fallback para ${symbol}:`, priceErr.message);
      }
    }

    if (!bid || !offer) {
      throw new Error(`No se pudieron obtener precios en vivo para ${symbol}. Intente de nuevo.`);
    }

    return {
      marketId: market.MarketId,
      bidPrice: bid,
      offerPrice: offer,
      name: market.Name
    };
  }

  throw new Error(`No se pudo resolver el símbolo ${symbol} a un mercado de Forex.com`);
}

// 0. Get Default Configuration
router.get("/config", (req, res) => {
  res.json({
    ok: true,
    username: process.env.FOREX_USERNAME || "",
    appKey: process.env.FOREX_APPKEY || "",
    password: process.env.FOREX_PASSWORD || ""
  });
});

// 1. Log In
router.post("/login", async (req, res) => {
  const { username, password, appKey, isDemo } = req.body;
  const resolvedPassword = password || process.env.FOREX_PASSWORD;
  try {
    const client = new ForexComClient({ username, password: resolvedPassword, appKey, isDemo });
    const sessionInfo = await client.login();
    res.json({
      ok: true,
      ...sessionInfo,
      isDemo: client.isDemo
    });
  } catch (error) {
    res.status(401).json({
      ok: false,
      error: error.message
    });
  }
});

// 2. Log Out
router.post("/logout", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.logout();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 3. Verify Connection / Auth Status
router.get("/auth/status", async (req, res) => {
  try {
    const client = getClient(req);
    // Realizamos una consulta liviana para validar que la sesión sea válida
    await client.getAccountMarginInfo();
    res.json({ ok: true, data: { status: "authorized" } });
  } catch (error) {
    res.status(401).json({ ok: false, error: "Sesión inválida o expirada" });
  }
});

// 4. Get Account Information (Aligned with terminal dashboard fields)
router.get("/account", async (req, res) => {
  try {
    const client = getClient(req);
    const margin = await client.getAccountMarginInfo();
    
    // Mapeamos los datos de Forex.com a un formato común
    const responseData = {
      Balance: margin.Cash || 0,
      Equity: margin.NetEquity || 0,
      Margin: margin.MarginRequirement || 0,
      FreeMargin: margin.MarginIndicator || 0,
      UnrealizedPnl: margin.OpenTradeEquity || 0,
      Leverage: 100 // Forex.com leverage varía, ponemos 100 por defecto
    };

    res.json({ ok: true, data: responseData });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 5. Search / List Symbols
router.get("/symbols", async (req, res) => {
  const { query } = req.query;
  try {
    const client = getClient(req);
    const result = await client.listMarkets(query || "Gold", 20);
    
    // Mapeamos los mercados de Forex.com al formato de símbolos de la terminal
    const symbolsList = (result.Markets || []).map(m => ({
      symbol: String(m.MarketId),
      name: m.Name,
      bid: m.Bid,
      ask: m.Offer
    }));

    res.json({ ok: true, data: symbolsList });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 5b. Search / List Markets (Original Route)
router.get("/markets", async (req, res) => {
  const { query, maxResults } = req.query;
  try {
    const client = getClient(req);
    const result = await client.listMarkets(query || "Gold", maxResults ? Number(maxResults) : 10);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 6. Get Symbol Specs / Information
router.get("/symbol", async (req, res) => {
  const { symbol } = req.query;
  try {
    const client = getClient(req);
    const market = await resolveSymbolToMarket(client, symbol);
    const result = await client.getMarketInformation(market.marketId);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 7. Get Live Quote
router.get("/quote", async (req, res) => {
  const { symbol } = req.query;
  try {
    const client = getClient(req);
    const market = await resolveSymbolToMarket(client, symbol);
    
    // Obtener información del mercado para extraer el tamaño mínimo de trading (WebMinSize)
    let minSize = 1000; // Valor por defecto usual para divisas (micro lote)
    try {
      const marketInfo = await client.getMarketInformation(market.marketId);
      const infoDetails = marketInfo?.MarketInformation || {};
      if (infoDetails.WebMinSize !== undefined && infoDetails.WebMinSize !== null) {
        minSize = Number(infoDetails.WebMinSize);
      }
      if (infoDetails.IncrementSize !== undefined && infoDetails.IncrementSize !== null) {
        minSize = Math.max(minSize, Number(infoDetails.IncrementSize));
      }
    } catch (infoErr) {
      console.warn(`[quote] No se pudo obtener WebMinSize para el market ${market.marketId}:`, infoErr.message);
    }

    res.json({
      ok: true,
      data: {
        symbol: String(market.marketId),
        name: market.name,
        bid: market.bidPrice,
        ask: market.offerPrice,
        minSize: minSize
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 8. Get Open Positions
router.get("/positions", async (req, res) => {
  try {
    const client = getClient(req);
    const positionsResult = await client.getOpenPositions();
    const openPositions = positionsResult.OpenPositions || [];

    // Obtener órdenes activas para mapear el SL/TP de los TradeOrders
    let activeOrders = [];
    try {
      const ordersResult = await client.getActiveOrders();
      activeOrders = ordersResult.ActiveOrders || [];
    } catch (orderErr) {
      console.warn("[positions] No se pudieron obtener órdenes activas para enriquecer SL/TP:", orderErr.message);
    }

    const enrichedPositions = await Promise.all(openPositions.map(async (pos) => {
      const pId = pos.OrderId || pos.PositionId;
      
      // Buscar la orden de trade correspondiente
      const matchingOrder = activeOrders.find(item => {
        const order = item.TradeOrder;
        return order && order.OrderId === pId;
      });

      let stopLoss = null;
      let takeProfit = null;

      if (matchingOrder) {
        const tradeOrder = matchingOrder.TradeOrder;
        if (tradeOrder.IfDone && tradeOrder.IfDone.length > 0) {
          const ifDone = tradeOrder.IfDone[0];
          
          if (ifDone.Stop && ifDone.Stop.TriggerPrice) {
            stopLoss = ifDone.Stop.TriggerPrice;
          }
          if (ifDone.Limit && ifDone.Limit.TriggerPrice) {
            takeProfit = ifDone.Limit.TriggerPrice;
          }

          // Verificar OcoOrder adjunto en Stop o Limit
          if (ifDone.Stop?.OcoOrder?.TriggerPrice) {
            takeProfit = ifDone.Stop.OcoOrder.TriggerPrice;
          }
          if (ifDone.Limit?.OcoOrder?.TriggerPrice) {
            stopLoss = ifDone.Limit.OcoOrder.TriggerPrice;
          }
        }
      }

      // Obtener cotización actual para calcular P&L flotante en tiempo real
      let profitLoss = 0;
      let currentPrice = null;
      try {
        const marketInfo = await client.getMarketInformation(pos.MarketId);
        const infoDetails = marketInfo?.MarketInformation || {};
        let bid = infoDetails.Bid ? Number(infoDetails.Bid) : null;
        let offer = infoDetails.Offer ? Number(infoDetails.Offer) : null;
        
        if (!bid || !offer) {
          try {
            const bars = await client.getPriceBars(Number(pos.MarketId), "1m", 1);
            const lastClose = bars?.PriceBars?.[0]?.Close ? Number(bars.PriceBars[0].Close) : null;
            if (lastClose) {
              let spread = 0.0002;
              const spreadObj = infoDetails.MarketSpreads?.[0];
              if (spreadObj && spreadObj.Spread) {
                spread = Number(spreadObj.Spread);
              } else if (lastClose > 100) {
                spread = 2.0; // Spread típico para Bitcoin/Ethereum en fin de semana
              }
              bid = lastClose - (spread / 2);
              offer = lastClose + (spread / 2);
            }
          } catch (priceErr) {
            console.warn(`[positions] Fallback de precio falló para market ${pos.MarketId}:`, priceErr.message);
          }
        }

        if (bid && offer) {
          // Si compramos, cerramos vendiendo (bid). Si vendemos, cerramos comprando (offer).
          currentPrice = pos.Direction === "buy" ? bid : offer;
          const diff = currentPrice - pos.Price;
          const factor = pos.Direction === "buy" ? 1 : -1;
          profitLoss = diff * pos.Quantity * factor;
        }
      } catch (priceErr) {
        console.warn(`[positions] No se pudo obtener cotización para calcular P&L de ${pos.MarketId}:`, priceErr.message);
      }

      return {
        ...pos,
        StopLoss: stopLoss,
        TakeProfit: takeProfit,
        ProfitLoss: profitLoss,
        CurrentPrice: currentPrice
      };
    }));

    res.json({ ok: true, data: { OpenPositions: enrichedPositions } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 9. Get Active Orders (Pending Orders)
router.get("/orders", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getActiveOrders();
    
    // Solo mostrar las órdenes que realmente son límites o stops de entrada pendientes (StopLimitOrder)
    const activeOrders = (result.ActiveOrders || [])
      .filter(item => item.StopLimitOrder !== undefined && item.StopLimitOrder !== null)
      .map(item => {
        const order = item.StopLimitOrder;
        return {
          OrderId: order.OrderId,
          MarketId: order.MarketId,
          MarketName: order.MarketName || null,
          Direction: order.Direction,
          Quantity: order.Quantity,
          TriggerPrice: order.TriggerPrice || order.Price || null,
          OrderType: "Limit/Stop",
          StopLoss: order.AssociatedOrders?.Stop?.TriggerPrice || null,
          TakeProfit: order.AssociatedOrders?.Limit?.TriggerPrice || null
        };
      });

    res.json({ ok: true, data: { ActiveOrders: activeOrders } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 10. Get Historical Candles
router.get("/candles", async (req, res) => {
  const { symbol, interval, days } = req.query;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    const queryDays = days ? Number(days) : 3;
    const queryInterval = interval || "15m";
    
    // Usamos el data provider unificado
    const candles = await getMarketData(cleanSymbol, "FOREX_COM");
    res.json({ ok: true, data: candles.candles || [] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 10b. Get Price Bars (Original Route)
router.get("/candles/:marketId", async (req, res) => {
  const { marketId } = req.params;
  const { interval, span } = req.query;
  try {
    const client = getClient(req);
    const result = await client.getPriceBars(marketId, interval || "15m", span ? Number(span) : 20);
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 11. Place Order
router.post("/trade", async (req, res) => {
  const { symbol, action, volume, price, sl, tp } = req.body;
  try {
    const client = getClient(req);
    const market = await resolveSymbolToMarket(client, symbol);
    const result = await client.createOrder({
      marketId: market.marketId,
      direction: action.toLowerCase() === "buy" ? "buy" : "sell",
      quantity: volume,
      price: price || (action.toLowerCase() === "buy" ? market.offerPrice : market.bidPrice),
      bidPrice: market.bidPrice,
      offerPrice: market.offerPrice,
      stopLoss: sl,
      takeProfit: tp
    });

    validateBrokerOrderResponse(result);

    logOrderOpen({
      symbol: symbol,
      action: action,
      volume: volume,
      entryPrice: price || (action.toLowerCase() === "buy" ? market.offerPrice : market.bidPrice) || 0,
      stopLoss: sl,
      takeProfit: tp,
      source: "FOREX_COM",
      brokerPositionId: result.id || result.orderId || null,
      notes: `Market ID: ${market.marketId}`
    }).catch(err => console.error("Error al registrar diario en Forex.com trade:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 11b. Original Place Order Route
router.post("/order", async (req, res) => {
  const { marketId, direction, quantity, price, bidPrice, offerPrice, stopLoss, takeProfit } = req.body;
  try {
    const client = getClient(req);
    
    const resolvedBid = Number(bidPrice || price);
    const resolvedOffer = Number(offerPrice || price);

    if (!resolvedBid || !resolvedOffer || isNaN(resolvedBid) || isNaN(resolvedOffer)) {
      throw new Error(`Precios inválidos para la orden: Bid=${resolvedBid}, Offer=${resolvedOffer}. No se puede crear la orden.`);
    }

    const result = await client.createOrder({
      marketId,
      direction,
      quantity,
      price,
      bidPrice: resolvedBid,
      offerPrice: resolvedOffer,
      stopLoss,
      takeProfit
    });

    validateBrokerOrderResponse(result);

    logOrderOpen({
      symbol: String(marketId),
      action: direction.toUpperCase() === "BUY" ? "BUY" : "SELL",
      volume: quantity,
      entryPrice: price || 0,
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      source: "FOREX_COM",
      brokerPositionId: result.id || result.orderId || null,
      notes: `Direct Market ID Placement`
    }).catch(err => console.error("Error al registrar diario en Forex.com order:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 12. Close Position
router.post("/close_position", async (req, res) => {
  const { positionId, volume, marketId, direction } = req.body;
  try {
    const client = getClient(req);
    
    // Si no se proveen todos los campos de Forex.com, los buscamos de la lista
    let mId = marketId;
    let dir = direction;
    let qty = volume;
 
    if (!mId || !dir) {
      const openPositions = await client.getOpenPositions();
      const pos = (openPositions.OpenPositions || []).find(p => 
        String(p.OrderId || p.PositionId) === String(positionId)
      );
      if (!pos) throw new Error("No se encontró la posición abierta para cerrar");
      mId = pos.MarketId;
      dir = pos.Direction;
      qty = qty || pos.Quantity;
    }
 
    const result = await client.closePosition({
      positionId,
      quantity: qty,
      marketId: mId,
      direction: dir
    });

    logOrderClose({
      brokerPositionId: positionId,
      exitPrice: result.Price || (result.Orders && result.Orders[0] && result.Orders[0].Price) || 0,
      notes: `Cierre Forex.com. Market ID: ${mId}`
    }).catch(err => console.error("Error al registrar cierre diario en Forex.com:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 13. Modify Position SL/TP
router.post("/modify_position", async (req, res) => {
  const { positionId, sl, tp } = req.body;
  try {
    const client = getClient(req);
    const result = await client.modifyPosition({
      positionId,
      sl,
      tp
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 14. Predict and Auto-Trade (Standard Logic)
router.post("/predict", async (req, res) => {
  const { symbol, autoTrade, volume } = req.body;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    
    // 1. Fetch market data
    const marketData = await getMarketData(cleanSymbol, "FOREX_COM");
    
    // 2. Calculate Indicators
    const indicators = calculateIndicators(marketData);
    
    // 3. AI Analysis with Gemini
    const aiResult = await analyzeWithGemini(indicators);
    
    // Calculate Dynamic SL & TP based on ATR
    const lastPrice = indicators.lastPrice;
    const atr = indicators.atr_value || indicators.atr || 1.0;
    
    let sl = null;
    let tp = null;
    let orderPlaced = false;
    let orderResult = null;
    
    if (aiResult.direction === "SUBE") {
      sl = lastPrice - (atr * 1.5);
      tp = lastPrice + (atr * 2.5);
    } else if (aiResult.direction === "BAJA") {
      sl = lastPrice + (atr * 1.5);
      tp = lastPrice - (atr * 2.5);
    }
    
    const roundToDigits = (num, d = 2) => Number(num.toFixed(d));
    if (sl) sl = roundToDigits(sl, 2);
    if (tp) tp = roundToDigits(tp, 2);
    
    // 4. Auto trade if enabled
    if (autoTrade && (aiResult.direction === "SUBE" || aiResult.direction === "BAJA")) {
      const client = getClient(req);
      const market = await resolveSymbolToMarket(client, cleanSymbol);
      const action = aiResult.direction === "SUBE" ? "BUY" : "SELL";
      const tradeVolume = volume ? Number(volume) : 1.0; // Forex.com suele usar unidades enteras por defecto para CFDs
      
      orderResult = await client.createOrder({
        marketId: market.marketId,
        direction: action,
        quantity: tradeVolume,
        price: action === "BUY" ? market.offerPrice : market.bidPrice,
        bidPrice: market.bidPrice,
        offerPrice: market.offerPrice,
        stopLoss: sl,
        takeProfit: tp
      });
      validateBrokerOrderResponse(orderResult);
      orderPlaced = true;
    }

    // 5. Save prediction in database
    const dbResult = await pool.query(
      `
      INSERT INTO predictions
      (
        symbol,
        predicted_direction,
        probability_up,
        probability_down,
        confidence,
        entry_price,
        target_check_time,
        indicators,
        ai_response,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '15 minutes', $7, $8, 'PENDING')
      RETURNING id, prediction_time, target_check_time
      `,
      [
        cleanSymbol,
        aiResult.direction,
        aiResult.probability_up,
        aiResult.probability_down,
        aiResult.confidence,
        lastPrice,
        indicators,
        aiResult
      ]
    );
    
    // Send Telegram Notification
    try {
      const { sendTelegramSignal } = await import("../services/telegramService.js");
      sendTelegramSignal(
        {
          id: dbResult.rows[0].id,
          symbol: cleanSymbol,
          predicted_direction: aiResult.direction === "SUBE" ? "BUY" : "SELL",
          entry_price: lastPrice
        },
        {
          take_profit_1: tp,
          take_profit_2: tp,
          stop_loss: sl,
          risk_reward: 1.6
        },
        {
          trade_quality: aiResult.confidence || "MEDIA",
          trade_score: aiResult.probability_up || aiResult.probability_down || 50
        }
      ).catch(err => console.error("Error Telegram señal:", err));
    } catch (tgErr) {
      console.error("Error Telegram:", tgErr.message);
    }
    
    res.json({
      ok: true,
      prediction_id: dbResult.rows[0].id,
      prediction_time: dbResult.rows[0].prediction_time,
      target_check_time: dbResult.rows[0].target_check_time,
      analysis: aiResult,
      indicators: {
        lastPrice,
        atr,
        sl,
        tp
      },
      orderPlaced,
      orderResult
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 15. Predict with XAU Scalping Strategy
router.post("/predict_scalp", async (req, res) => {
  const { symbol, autoTrade, volume } = req.body;
  try {
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Símbolo requerido." });
    }
    const cleanSymbol = symbol.toUpperCase().trim();
    console.log(`[ForexCom Route] predict_scalp called for ${cleanSymbol} autoTrade=${!!autoTrade} volume=${volume}`);
    
    // 1. Fetch market data
    const marketData = await getMarketData(cleanSymbol, "FOREX_COM");
    
    // 2. Calculate XAU Scalp Indicators
    const { calculateXauScalpIndicators } = await import("../indicators/xauScalpIndicators.js");
    const indicators = calculateXauScalpIndicators(marketData);
    indicators.symbol = cleanSymbol;
    
    // 3. Risk and Gemini gate check
    const { shouldUseGeminiForXau } = await import("../risk/xauGeminiGate.js");
    const { getMacroRiskNow } = await import("../risk/macroRisk.js");
    const macroRisk = getMacroRiskNow();
    const preRiskFilter = { should_enter: true, risk_level: "PRE_CHECK", blocked_reason: null };
    const geminiGate = shouldUseGeminiForXau(indicators, preRiskFilter, macroRisk);
    
    // 4. AI analysis
    const { analyzeXauScalpWithGemini } = await import("../ai/xauScalpAi.js");
    const cacheKey = `scalp_pred_forex_${cleanSymbol}_${indicators.rsi || '0'}_${indicators.lastPrice || '0'}`;
    const aiResult = await analyzeXauScalpWithGemini(indicators, {
      useGemini: geminiGate.useGemini,
      cacheKey
    });
    
    // 5. Apply filters & Quality scoring
    const { applyXauScalpRiskFilter } = await import("../risk/xauScalpRiskFilter.js");
    const { calculateXauTradeQuality } = await import("../risk/xauTradeQuality.js");
    const { applyXauSmartFilter } = await import("../risk/xauSmartFilter.js");
    
    const riskFilter = applyXauScalpRiskFilter(indicators, aiResult);
    if (macroRisk.macro_risk === "VERY_HIGH") {
      riskFilter.should_enter = false;
      riskFilter.risk_level = "VERY_HIGH";
      riskFilter.blocked_reason = (riskFilter.blocked_reason || "") + " | Evento macro de riesgo muy alto";
    }
    
    const tradeQuality = calculateXauTradeQuality(indicators, aiResult, riskFilter, macroRisk, { date: new Date() });
    const smartFilter = applyXauSmartFilter({ indicators, aiResult, riskFilter, tradeQuality, macroRisk });
    
    const sl = indicators.stop_loss;
    const tp = indicators.take_profit_1;
    
    let orderPlaced = false;
    let orderResult = null;
    
    // 6. Place order if auto-trade is enabled and smart filter allows it
    const direction = aiResult.direction;
    if (autoTrade && (direction === "BUY" || direction === "SELL") && smartFilter.smart_allowed) {
      const client = getClient(req);
      const market = await resolveSymbolToMarket(client, cleanSymbol);
      const action = direction;
      const tradeVolume = volume ? Number(volume) : 1.0;
      
      orderResult = await client.createOrder({
        marketId: market.marketId,
        direction: action,
        quantity: tradeVolume,
        price: action === "BUY" ? market.offerPrice : market.bidPrice,
        bidPrice: market.bidPrice,
        offerPrice: market.offerPrice,
        stopLoss: sl,
        takeProfit: tp
      });
      validateBrokerOrderResponse(orderResult);
      orderPlaced = true;
    }
    
    // 7. Save prediction in scalp_predictions table
    const sessionId = "FOREX_SCALP_" + Date.now();
    const dbResult = await pool.query(
      `
      INSERT INTO scalp_predictions
      (
        symbol,
        predicted_direction,
        probability_buy,
        probability_sell,
        confidence,
        entry_price,
        target_check_time,
        stop_loss,
        take_profit_1,
        take_profit_2,
        risk_reward,
        indicators,
        ai_response,
        status,
        strategy,
        session_id,
        signal_time_label,
        should_enter,
        risk_filter,
        blocked_reason,
        macro_risk,
        trade_score,
        trade_quality,
        recommendation,
        quality_details,
        smart_filter,
        smart_allowed,
        smart_blocked_reason
      )
      VALUES
      (
        $1, $2, $3, $4, $5, $6, NOW() + INTERVAL '15 minutes', $7, $8, $9, $10,
        $11, $12, 'PENDING', 'XAU_SCALP', $13, 'SCALP_000', $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24
      )
      RETURNING id, prediction_time, target_check_time
      `,
      [
        cleanSymbol,
        direction,
        aiResult.probability_buy || 0,
        aiResult.probability_sell || 0,
        aiResult.confidence || 'MEDIA',
        indicators.lastPrice,
        sl,
        tp,
        indicators.take_profit_2,
        indicators.risk_reward,
        indicators,
        aiResult,
        sessionId,
        riskFilter.should_enter,
        riskFilter,
        riskFilter.blocked_reason,
        macroRisk.macro_risk,
        tradeQuality.trade_score,
        tradeQuality.trade_quality,
        tradeQuality.recommendation,
        tradeQuality.details,
        smartFilter,
        smartFilter.smart_allowed,
        smartFilter.smart_blocked_reason
      ]
    );
    
    // Send Telegram Notification
    try {
      const { sendTelegramSignal } = await import("../services/telegramService.js");
      sendTelegramSignal(
        {
          id: dbResult.rows[0].id,
          symbol: cleanSymbol,
          predicted_direction: direction,
          entry_price: indicators.lastPrice
        },
        {
          take_profit_1: tp,
          take_profit_2: indicators.take_profit_2 || tp,
          stop_loss: sl,
          risk_reward: indicators.risk_reward || 2.4
        },
        {
          trade_quality: tradeQuality.trade_quality,
          trade_score: tradeQuality.trade_score
        }
      ).catch(err => console.error("Error Telegram scalp señal:", err));
    } catch (tgErr) {
      console.error("Error Telegram scalp:", tgErr.message);
    }
    
    res.json({
      ok: true,
      prediction_id: dbResult.rows[0].id,
      prediction_time: dbResult.rows[0].prediction_time,
      target_check_time: dbResult.rows[0].target_check_time,
      analysis: {
        direction: direction === "BUY" ? "SUBE" : direction === "SELL" ? "BAJA" : "NEUTRAL",
        probability_up: aiResult.probability_buy || 0,
        probability_down: aiResult.probability_sell || 0,
        confidence: aiResult.confidence,
        technical_summary: aiResult.technical_summary || aiResult.macro_summary,
        main_reasons: aiResult.main_reasons,
        risks: aiResult.risks
      },
      indicators: {
        lastPrice: indicators.lastPrice,
        atr: indicators.atr,
        sl,
        tp
      },
      orderPlaced,
      orderResult,
      smartFilter
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
