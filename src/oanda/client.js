export class OandaClient {
  constructor({ token, accountId, isDemo = true } = {}) {
    this.token = token || process.env.OANDA_TOKEN;
    this.accountId = accountId || process.env.OANDA_ACCOUNT_ID;
    this.isDemo = isDemo;
    this.baseUrl = isDemo
      ? "https://api-fxpractice.oanda.com/v3"
      : "https://api-fxtrade.oanda.com/v3";
  }

  async request(method, path, body = null) {
    if (!this.token) {
      throw new Error("Falta el Token de Acceso de OANDA");
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
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.errorMessage || data.message || `OANDA API Error: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`Error en OandaClient [${method} ${path}]:`, error.message);
      throw error;
    }
  }

  async getAccountSummary() {
    return this.request("GET", `/accounts/${this.accountId}/summary`);
  }

  async getAccountDetails() {
    return this.request("GET", `/accounts/${this.accountId}`);
  }

  async listInstruments() {
    const data = await this.request("GET", `/accounts/${this.accountId}/instruments`);
    return data.instruments || [];
  }

  async getCandles(instrument, interval = "15m", count = 20) {
    // Map intervals to OANDA granularities
    let granularity = "M15";
    if (interval === "1m") granularity = "M1";
    else if (interval === "5m") granularity = "M5";
    else if (interval === "1h") granularity = "H1";
    else if (interval === "1d") granularity = "D";

    const path = `/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`;
    const data = await this.request("GET", path);
    return data.candles || [];
  }

  async getOpenPositions() {
    const data = await this.request("GET", `/accounts/${this.accountId}/openPositions`);
    return data.positions || [];
  }

  async getOpenTrades() {
    const data = await this.request("GET", `/accounts/${this.accountId}/openTrades`);
    return data.trades || [];
  }

  async getActiveOrders() {
    const data = await this.request("GET", `/accounts/${this.accountId}/pendingOrders`);
    return data.orders || [];
  }

  async createOrder({ instrument, direction, quantity, stopLoss = null, takeProfit = null }) {
    // signed units: positive for Buy, negative for Sell
    const units = direction.toLowerCase() === "buy" ? Math.abs(Number(quantity)) : -Math.abs(Number(quantity));

    const payload = {
      order: {
        units: String(units),
        instrument: instrument.toUpperCase().trim(),
        timeInForce: "FOK",
        type: "MARKET",
        positionFill: "DEFAULT"
      }
    };

    if (stopLoss) {
      payload.order.stopLossOnFill = {
        price: String(stopLoss)
      };
    }

    if (takeProfit) {
      payload.order.takeProfitOnFill = {
        price: String(takeProfit)
      };
    }

    return this.request("POST", `/accounts/${this.accountId}/orders`, payload);
  }
}
