export class XproClient {
  constructor({ token } = {}) {
    this.token = token || process.env.XPRO_API_KEY;
    this.baseUrl = "https://interface.xbtfx.com/v1";
  }

  async request(method, path, body = null) {
    if (!this.token) {
      throw new Error("Falta la Clave API (Token) de XPRO");
    }

    const url = `${this.baseUrl}${path}`;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${this.token}`,
    };

    const config = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      config.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, config);
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { message: text };
      }

      if (!response.ok) {
        throw new Error(data.message || `XPRO API Error: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`Error en XproClient [${method} ${path}]:`, error.message);
      throw error;
    }
  }

  async getAuthStatus() {
    return this.request("GET", "/auth/status");
  }

  async getAccount() {
    return this.request("GET", "/account");
  }

  async listSymbols() {
    return this.request("GET", "/symbols");
  }

  async getSymbolSpecification(symbol) {
    return this.request("GET", `/symbol?symbol=${encodeURIComponent(symbol)}`);
  }

  async getQuote(symbol) {
    const data = await this.request("GET", `/symbols/${encodeURIComponent(symbol.toUpperCase().trim())}`);
    return data?.symbol || data;
  }

  async getOpenPositions() {
    return this.request("GET", "/positions");
  }

  async getPendingOrders() {
    return this.request("GET", "/orders");
  }

  async getDealHistory(period = "last_week") {
    return this.request("GET", `/history?period=${period}`);
  }

  async placeOrder({ symbol, action, volume, type = "MARKET", price = null, sl = null, tp = null }) {
    const payload = {
      symbol: symbol.toUpperCase().trim(),
      action: action.toUpperCase(), // BUY / SELL
      volume: Number(volume),
      type: type.toUpperCase(), // MARKET, LIMIT, STOP
    };

    if (price !== null) payload.price = Number(price);
    if (sl !== null) payload.sl = Number(sl);
    if (tp !== null) payload.tp = Number(tp);

    return this.request("POST", "/trade", payload);
  }

  async closePosition({ positionId, volume }) {
    const payload = {
      positionId: String(positionId),
      volume: Number(volume),
    };
    return this.request("POST", "/close_position", payload);
  }

  async modifyPosition({ positionId, sl = null, tp = null }) {
    const payload = {
      positionId: String(positionId),
    };
    if (sl !== null) payload.sl = Number(sl);
    if (tp !== null) payload.tp = Number(tp);

    return this.request("POST", "/modify_position", payload);
  }
}
