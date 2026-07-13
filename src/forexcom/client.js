// Using native global.fetch available in Node 18+
import { logApiCall } from "../services/apiLogger.js";

export class ForexComClient {
  constructor({ username, password, appKey, isDemo = true } = {}) {
    this.username = username || process.env.FOREX_USERNAME;
    this.password = password || process.env.FOREX_PASSWORD;
    this.appKey = appKey || process.env.FOREX_APPKEY;
    this.isDemo = isDemo;
    this.sessionToken = null;
    this.baseUrl = isDemo
      ? "https://ciapipreprod.cityindextest9.co.uk/TradingApi"
      : "https://ciapi.cityindex.com/TradingApi";
  }

  setSession(sessionToken, username) {
    this.sessionToken = sessionToken;
    if (username) this.username = username;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (this.sessionToken) {
      headers["Session"] = this.sessionToken;
    }
    if (this.username) {
      headers["UserName"] = this.username;
    }

    const config = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      config.body = JSON.stringify(body);
    }

    let resolvedSymbol = "SESSION";
    if (path.includes("/market/")) {
      const parts = path.split("/");
      resolvedSymbol = parts[2] || "MARKET";
    } else if (body && body.MarketId) {
      resolvedSymbol = String(body.MarketId);
    } else if (path.includes("MarketName=")) {
      const match = path.match(/MarketName=([^&]+)/);
      if (match) resolvedSymbol = decodeURIComponent(match[1]);
    }

    const cleanPath = path.split("?")[0];
    const requestType = `${method} ${cleanPath}`;

    try {
      const response = await logApiCall({
        provider: "FOREX_COM",
        symbol: resolvedSymbol,
        requestType,
        action: () => fetch(url, config)
      });

      const text = await response.text();
      let data = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { message: text };
        }
      }

      if (!response.ok) {
        const errMsg = data.ErrorMessage || data.message || `API Error: ${response.status}`;
        if (response.status === 401 && this.password && this.appKey && path !== "/session") {
          console.warn(`[ForexComClient] Sesión 401 detectada para ${path}. Intentando auto-login para recuperar...`);
          try {
            await this.login();
            
            // Update session header for retry
            headers["Session"] = this.sessionToken;
            if (this.username) {
              headers["UserName"] = this.username;
            }
            
            // Retry the original request
            const retryResponse = await logApiCall({
              provider: "FOREX_COM",
              symbol: resolvedSymbol,
              requestType: `${requestType} (RETRY)`,
              action: () => fetch(url, config)
            });
            const retryText = await retryResponse.text();
            let retryData = {};
            if (retryText.trim()) {
              try {
                retryData = JSON.parse(retryText);
              } catch (e) {
                retryData = { message: retryText };
              }
            }
            if (retryResponse.ok) {
              console.log(`[ForexComClient] Auto-login de recuperación exitoso para ${path}`);
              return retryData;
            }
            throw new Error(retryData.ErrorMessage || retryData.message || `API Error: ${retryResponse.status}`);
          } catch (loginErr) {
            console.error("[ForexComClient] Falla en auto-login durante recuperación:", loginErr.message);
          }
        }
        throw new Error(errMsg);
      }

      return data;
    } catch (error) {
      console.error(`Error en ForexComClient [${method} ${path}]:`, error.message);
      throw error;
    }
  }

  async login() {
    if (!this.username || !this.password || !this.appKey) {
      throw new Error("Credenciales incompletas (Falta UserName, Password o AppKey)");
    }

    const payload = {
      UserName: this.username,
      Password: this.password,
      AppKey: this.appKey,
    };

    const response = await this.request("POST", "/session", payload);
    if (response && response.Session) {
      this.sessionToken = response.Session;
      return {
        sessionToken: this.sessionToken,
        username: this.username,
      };
    }

    throw new Error("Respuesta inválida durante la autenticación de Forex.com");
  }

  async logout() {
    if (!this.sessionToken) return { ok: true };
    try {
      await this.request("POST", "/session/deleteSession", {
        UserName: this.username,
        Session: this.sessionToken,
      });
    } catch (e) {
      // Ignorar
    } finally {
      this.sessionToken = null;
    }
    return { ok: true };
  }

  async listMarkets(marketName = "Gold", maxResults = 10) {
    return this.request("GET", `/cfd/markets?MarketName=${encodeURIComponent(marketName)}&MaxResults=${maxResults}`);
  }

  async getMarketInformation(marketId) {
    return this.request("GET", `/market/${marketId}/information`);
  }

  async getPriceBars(marketId, interval = "15m", count = 20) {
    let ciapiInterval = "MINUTE";
    let span = 15;

    const lower = String(interval).toLowerCase().trim();
    if (lower === "1m" || lower === "1minute") {
      ciapiInterval = "MINUTE";
      span = 1;
    } else if (lower === "5m" || lower === "5minute") {
      ciapiInterval = "MINUTE";
      span = 5;
    } else if (lower === "15m" || lower === "15minute") {
      ciapiInterval = "MINUTE";
      span = 15;
    } else if (lower === "1h" || lower === "hour") {
      ciapiInterval = "HOUR";
      span = 1;
    } else if (lower === "1d" || lower === "day" || lower === "d") {
      ciapiInterval = "DAY";
      span = 1;
    }

    return this.request("GET", `/market/${marketId}/barhistory?interval=${ciapiInterval}&span=${span}&pricebars=${count}`);
  }

  async getAccountMarginInfo() {
    return this.request("GET", "/margin/clientaccountmargin");
  }

  async getClientAccountDetails() {
    return this.request("GET", "/useraccount/ClientAndTradingAccount");
  }

  async getTradeHistory(tradingAccountId, maxResults = 100, offset = 0) {
    return this.request("GET", `/order/tradehistory?TradingAccountId=${tradingAccountId}&maxResults=${maxResults}&offset=${offset}`);
  }

  async getClientAccountId() {
    if (this.clientAccountId) return this.clientAccountId;
    const details = await this.getClientAccountDetails();
    if (details && details.ClientAccountId) {
      this.clientAccountId = details.ClientAccountId;
      return this.clientAccountId;
    }
    throw new Error("No se pudo obtener el ClientAccountId de la cuenta");
  }

  async getTradingAccountId() {
    if (this.tradingAccountId) return this.tradingAccountId;
    const details = await this.getClientAccountDetails();
    if (details && details.TradingAccounts && details.TradingAccounts.length > 0) {
      this.tradingAccountId = details.TradingAccounts[0].TradingAccountId;
      return this.tradingAccountId;
    }
    throw new Error("No se pudo obtener el TradingAccountId de la cuenta");
  }

  async getOpenPositions() {
    try {
      const clientAccountId = await this.getClientAccountId();
      return await this.request("GET", `/order/openpositions?ClientAccountId=${clientAccountId}`);
    } catch (e) {
      // Fallback
      return this.request("GET", "/order/openpositions");
    }
  }

  async getActiveOrders() {
    try {
      const clientAccountId = await this.getClientAccountId();
      // CIAPI requiere POST para /order/activeorders
      return await this.request("POST", "/order/activeorders", {
        ClientAccountId: Number(clientAccountId)
      });
    } catch (e) {
      console.warn("Falla POST a activeorders, intentando GET fallback:", e.message);
      try {
        const clientAccountId = await this.getClientAccountId();
        return await this.request("GET", `/order/activeorders?ClientAccountId=${clientAccountId}`);
      } catch (getErr) {
        return this.request("GET", "/order/activeorders");
      }
    }
  }

  async createOrder({ marketId, direction, quantity, price, bidPrice, offerPrice, stopLoss = null, takeProfit = null }) {
    const dir = direction.toLowerCase() === "buy" ? "buy" : "sell";
    
    // Obtener decimales de precio para el instrumento
    let decimals = 5;
    try {
      const marketInfo = await this.getMarketInformation(marketId);
      const infoDetails = marketInfo?.MarketInformation || {};
      if (infoDetails.PriceDecimalPlaces !== undefined && infoDetails.PriceDecimalPlaces !== null) {
        decimals = Number(infoDetails.PriceDecimalPlaces);
      }
    } catch (e) {
      // Ignorar fallo de carga y usar default
    }

    const roundToDecimals = (val, dec) => {
      if (val === null || val === undefined || isNaN(val)) return val;
      return Number(Number(val).toFixed(dec));
    };

    const resolvedBid = roundToDecimals(Number(bidPrice || price), decimals);
    const resolvedOffer = roundToDecimals(Number(offerPrice || price), decimals);

    if (!resolvedBid || !resolvedOffer || isNaN(resolvedBid) || isNaN(resolvedOffer)) {
      throw new Error(`Precios inválidos para la orden: Bid=${resolvedBid}, Offer=${resolvedOffer}. No se puede crear la orden.`);
    }

    const tradingAccountId = await this.getTradingAccountId();

    const payload = {
      MarketId: Number(marketId),
      Direction: dir,
      Quantity: Number(quantity),
      BidPrice: resolvedBid,
      OfferPrice: resolvedOffer,
      AuditId: `MA_${Date.now()}`,
      AutoRollover: false,
      TradingAccountId: Number(tradingAccountId)
    };

    // Adjuntar SL/TP como AssociatedOrders e IfDone (formato estándar de la CIAPI de City Index)
    if (stopLoss !== null && stopLoss !== undefined || takeProfit !== null && takeProfit !== undefined) {
      payload.AssociatedOrders = {};
      const ifDoneItem = {};
      const childDirection = dir === "buy" ? "sell" : "buy";

      if (stopLoss !== null && stopLoss !== undefined) {
        const roundedSL = roundToDecimals(stopLoss, decimals);
        payload.AssociatedOrders.Stop = { TriggerPrice: roundedSL };
        payload.StopLoss = roundedSL;
        ifDoneItem.Stop = { 
          TriggerPrice: roundedSL,
          Quantity: Number(quantity),
          Direction: childDirection
        };
      }
      if (takeProfit !== null && takeProfit !== undefined) {
        const roundedTP = roundToDecimals(takeProfit, decimals);
        payload.AssociatedOrders.Limit = { TriggerPrice: roundedTP };
        payload.TakeProfit = roundedTP;
        ifDoneItem.Limit = { 
          TriggerPrice: roundedTP,
          Quantity: Number(quantity),
          Direction: childDirection
        };
      }

      payload.IfDone = [ifDoneItem];
    }

    console.log(`[createOrder] Enviando orden: ${dir.toUpperCase()} ${quantity} de MarketId=${marketId} | Bid=${resolvedBid} Offer=${resolvedOffer} | TradingAccountId=${tradingAccountId} | StopLoss=${payload.StopLoss || null} TakeProfit=${payload.TakeProfit || null}`);
    return this.request("POST", "/order/newtradeorder", payload);
  }

  async closePosition({ positionId, quantity, marketId, direction }) {
    // Para cerrar, ejecutamos una orden en sentido opuesto
    const oppositeDirection = direction.toLowerCase() === "buy" ? "sell" : "buy";
    
    // Obtenemos los precios actuales y válidos del mercado
    const marketInfo = await this.getMarketInformation(marketId);
    const infoDetails = marketInfo?.MarketInformation || {};
    let bid = infoDetails.Bid ? Number(infoDetails.Bid) : null;
    let offer = infoDetails.Offer ? Number(infoDetails.Offer) : null;
    let decimals = infoDetails.PriceDecimalPlaces !== undefined ? Number(infoDetails.PriceDecimalPlaces) : 5;
    
    const roundToDecimals = (val, dec) => {
      if (val === null || val === undefined || isNaN(val)) return val;
      return Number(Number(val).toFixed(dec));
    };

    if (!bid || !offer) {
      try {
        const bars = await this.getPriceBars(Number(marketId), "1m", 1);
        const lastClose = bars?.PriceBars?.[0]?.Close ? Number(bars.PriceBars[0].Close) : null;
        if (lastClose) {
          let spread = 0.0002;
          const spreadObj = infoDetails.MarketSpreads?.[0];
          if (spreadObj && spreadObj.Spread) {
            spread = Number(spreadObj.Spread);
          } else if (lastClose > 100) {
            spread = 0.02;
          }
          bid = lastClose - (spread / 2);
          offer = lastClose + (spread / 2);
        }
      } catch (priceErr) {
        console.warn(`[closePosition] No se pudo obtener precio fallback para market ${marketId}:`, priceErr.message);
      }
    }

    const tradingAccountId = await this.getTradingAccountId();
    
    const payload = {
      MarketId: Number(marketId),
      Direction: oppositeDirection,
      Quantity: Number(quantity),
      BidPrice: roundToDecimals(bid || 0, decimals),
      OfferPrice: roundToDecimals(offer || 0, decimals),
      AuditId: `MA_CLOSE_${Date.now()}`,
      AutoRollover: false,
      TradingAccountId: Number(tradingAccountId),
      Close: [Number(positionId)] // Muchos sistemas de CIAPI requieren el array de IDs a cerrar
    };

    console.log(`[closePosition] Cerrando posición ${positionId}: ${oppositeDirection} ${quantity} de MarketId=${marketId} | Bid=${payload.BidPrice} Offer=${payload.OfferPrice}`);
    return this.request("POST", "/order/newtradeorder", payload);
  }

  async modifyPosition({ positionId, sl = null, tp = null }) {
    const tradingAccountId = await this.getTradingAccountId();
    
    // 1. Obtener las órdenes activas para encontrar los IDs físicos de SL y TP vinculados
    let activeOrders = [];
    try {
      const ordersResult = await this.getActiveOrders();
      activeOrders = ordersResult.ActiveOrders || [];
    } catch (e) {
      console.warn("[modifyPosition] No se pudieron obtener las órdenes activas:", e.message);
    }

    // Encontrar el TradeOrder correspondiente a nuestro positionId
    const matchingOrder = activeOrders.find(item => {
      const order = item.TradeOrder;
      return order && Number(order.OrderId) === Number(positionId);
    });

    let stopOrderId = null;
    let limitOrderId = null;
    let quantity = 1.0;

    if (matchingOrder) {
      const tradeOrder = matchingOrder.TradeOrder;
      quantity = Number(tradeOrder.Quantity) || 1.0;
      if (tradeOrder.IfDone && tradeOrder.IfDone.length > 0) {
        const ifDone = tradeOrder.IfDone[0];
        if (ifDone.Stop) {
          stopOrderId = ifDone.Stop.OrderId;
          if (ifDone.Stop.OcoOrder) {
            limitOrderId = ifDone.Stop.OcoOrder.OrderId;
          }
        }
        if (ifDone.Limit) {
          limitOrderId = ifDone.Limit.OrderId;
          if (ifDone.Limit.OcoOrder) {
            stopOrderId = ifDone.Limit.OcoOrder.OrderId;
          }
        }
      }
    }

    // Obtener decimales de precio para el redondeo exacto
    let decimals = 5;
    if (matchingOrder) {
      try {
        const marketInfo = await this.getMarketInformation(matchingOrder.TradeOrder.MarketId);
        const infoDetails = marketInfo?.MarketInformation || {};
        if (infoDetails.PriceDecimalPlaces !== undefined && infoDetails.PriceDecimalPlaces !== null) {
          decimals = Number(infoDetails.PriceDecimalPlaces);
        }
      } catch (decErr) {}
    }

    const roundToDecimals = (val, dec) => {
      if (val === null || val === undefined || isNaN(val)) return val;
      return Number(Number(val).toFixed(dec));
    };

    const results = [];

    // Modificar o Cancelar Stop Loss
    if (sl !== null && sl !== undefined) {
      const numSL = Number(sl);
      if (numSL > 0) {
        const roundedSL = roundToDecimals(numSL, decimals);
        if (stopOrderId && matchingOrder) {
          const tradeOrder = matchingOrder.TradeOrder;
          const stopOrder = tradeOrder.IfDone[0].Stop;
          console.log(`[modifyPosition] Modificando Stop Loss existente ID=${stopOrderId} a precio=${roundedSL}`);
          const res = await this.request("POST", "/order/updatestoplimitorder", {
            OrderId: Number(stopOrderId),
            MarketId: Number(tradeOrder.MarketId),
            Direction: stopOrder.Direction || (tradeOrder.Direction === "buy" ? "sell" : "buy"),
            Quantity: Number(stopOrder.Quantity || tradeOrder.Quantity),
            TriggerPrice: roundedSL,
            TradingAccountId: Number(tradingAccountId)
          });
          results.push(res);
        }
      } else if (numSL === 0 && stopOrderId) {
        // Si se establece a 0 o se vacía, cancelamos la orden de Stop Loss existente
        console.log(`[modifyPosition] Cancelando Stop Loss existente ID=${stopOrderId}`);
        const res = await this.request("POST", "/order/cancel", {
          OrderId: Number(stopOrderId),
          TradingAccountId: Number(tradingAccountId)
        });
        results.push(res);
      }
    }

    // Modificar o Cancelar Take Profit
    if (tp !== null && tp !== undefined) {
      const numTP = Number(tp);
      if (numTP > 0) {
        const roundedTP = roundToDecimals(numTP, decimals);
        if (limitOrderId && matchingOrder) {
          const tradeOrder = matchingOrder.TradeOrder;
          const limitOrder = tradeOrder.IfDone[0].Limit || tradeOrder.IfDone[0].Stop?.OcoOrder;
          console.log(`[modifyPosition] Modificando Take Profit existente ID=${limitOrderId} a precio=${roundedTP}`);
          const res = await this.request("POST", "/order/updatestoplimitorder", {
            OrderId: Number(limitOrderId),
            MarketId: Number(tradeOrder.MarketId),
            Direction: limitOrder.Direction || (tradeOrder.Direction === "buy" ? "sell" : "buy"),
            Quantity: Number(limitOrder.Quantity || tradeOrder.Quantity),
            TriggerPrice: roundedTP,
            TradingAccountId: Number(tradingAccountId)
          });
          results.push(res);
        }
      } else if (numTP === 0 && limitOrderId) {
        // Si se establece a 0 o se vacía, cancelamos la orden de Take Profit existente
        console.log(`[modifyPosition] Cancelando Take Profit existente ID=${limitOrderId}`);
        const res = await this.request("POST", "/order/cancel", {
          OrderId: Number(limitOrderId),
          TradingAccountId: Number(tradingAccountId)
        });
        results.push(res);
      }
    }

    return { ok: true, results, StopLoss: sl, TakeProfit: tp };
  }
}
