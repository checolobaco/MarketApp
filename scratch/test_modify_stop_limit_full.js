import dotenv from "dotenv";
import { ForexComClient } from "../src/forexcom/client.js";
import fetch from "node-fetch";

dotenv.config();

async function run() {
  const username = process.env.FOREX_USERNAME;
  const password = process.env.FOREX_PASSWORD;
  const appKey = process.env.FOREX_APPKEY;
  const isDemo = false;

  const client = new ForexComClient({ username, password, appKey, isDemo });
  try {
    await client.login();
    const tradingAccountId = await client.getTradingAccountId();
    
    // Obtener órdenes activas para encontrar el ID del Stop
    const ordersResult = await client.getActiveOrders();
    const activeOrders = ordersResult.ActiveOrders || [];

    // Buscar una posición con Stop Loss
    let stopOrderObj = null;
    let parentMarketId = null;
    for (const item of activeOrders) {
      if (item.TradeOrder && item.TradeOrder.IfDone && item.TradeOrder.IfDone.length > 0) {
        const stop = item.TradeOrder.IfDone[0].Stop;
        if (stop && stop.OrderId) {
          stopOrderObj = stop;
          parentMarketId = item.TradeOrder.MarketId;
          break;
        }
      }
    }

    if (!stopOrderObj) {
      console.log("No se encontró ninguna orden de Stop Loss activa dentro de las posiciones.");
      return;
    }

    console.log(`Encontrado Stop Loss ID: ${stopOrderObj.OrderId} | MarketId: ${parentMarketId} | Qty: ${stopOrderObj.Quantity} | Dir: ${stopOrderObj.Direction}`);
    
    const session = client.sessionToken;
    const baseUrl = "https://ciapi.cityindex.com/TradingApi";

    const targetPrice = stopOrderObj.Direction === "buy" ? Number(stopOrderObj.TriggerPrice) + 10 : Number(stopOrderObj.TriggerPrice) - 10;
    const roundedPrice = Number(targetPrice.toFixed(2));

    // PRUEBA A: updatestoplimitorder con payload completo
    console.log("\n--- Prueba A: updatestoplimitorder ---");
    const payloadA = {
      OrderId: Number(stopOrderObj.OrderId),
      MarketId: Number(parentMarketId),
      Direction: stopOrderObj.Direction,
      Quantity: Number(stopOrderObj.Quantity),
      TriggerPrice: roundedPrice,
      TradingAccountId: Number(tradingAccountId)
    };
    console.log("Payload:", JSON.stringify(payloadA));
    try {
      const response = await fetch(`${baseUrl}/order/updatestoplimitorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Session": session,
          "UserName": username
        },
        body: JSON.stringify(payloadA)
      });
      console.log("Status:", response.status);
      const text = await response.text();
      console.log("Response:", text);
    } catch (err) {
      console.log("Error:", err.message);
    }

    // PRUEBA B: updatetradeorder con payload completo
    console.log("\n--- Prueba B: updatetradeorder ---");
    const payloadB = {
      OrderId: Number(stopOrderObj.OrderId),
      MarketId: Number(parentMarketId),
      Direction: stopOrderObj.Direction,
      Quantity: Number(stopOrderObj.Quantity),
      TriggerPrice: roundedPrice,
      TradingAccountId: Number(tradingAccountId)
    };
    console.log("Payload:", JSON.stringify(payloadB));
    try {
      const response = await fetch(`${baseUrl}/order/updatetradeorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Session": session,
          "UserName": username
        },
        body: JSON.stringify(payloadB)
      });
      console.log("Status:", response.status);
      const text = await response.text();
      console.log("Response:", text);
    } catch (err) {
      console.log("Error:", err.message);
    }

  } catch (e) {
    console.error("Error general:", e.message);
  } finally {
    await client.logout();
  }
}

run();
