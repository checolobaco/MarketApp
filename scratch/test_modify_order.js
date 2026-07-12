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
    
    // Buscar una posición abierta real para probar
    const positionsResult = await client.getOpenPositions();
    const openPositions = positionsResult.OpenPositions || [];
    if (openPositions.length === 0) {
      console.log("No hay posiciones abiertas para probar.");
      return;
    }

    const pos = openPositions[0];
    const parentOrderId = pos.OrderId || pos.PositionId;
    console.log(`Probando con Posición Abierta Real ID: ${parentOrderId} (${pos.MarketName})`);

    const session = client.sessionToken;
    const baseUrl = "https://ciapi.cityindex.com/TradingApi";

    // Prueba 1: updatetradeorder con AssociatedOrders (Stop/Limit)
    console.log("\n--- Prueba 1: updatetradeorder con AssociatedOrders ---");
    const payload1 = {
      OrderId: parentOrderId,
      TradingAccountId: Number(tradingAccountId),
      AssociatedOrders: {
        Stop: { TriggerPrice: pos.Direction === "buy" ? Number(pos.Price) - 100 : Number(pos.Price) + 100 },
        Limit: { TriggerPrice: pos.Direction === "buy" ? Number(pos.Price) + 100 : Number(pos.Price) - 100 }
      }
    };
    try {
      const response = await fetch(`${baseUrl}/order/updatetradeorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Session": session,
          "UserName": username
        },
        body: JSON.stringify(payload1)
      });
      console.log("Status 1:", response.status);
      const text1 = await response.text();
      console.log("Response 1:", text1);
    } catch (err) {
      console.log("Error 1:", err.message);
    }

    // Prueba 2: updatetradeorder con IfDone
    console.log("\n--- Prueba 2: updatetradeorder con IfDone ---");
    const childDirection = pos.Direction === "buy" ? "sell" : "buy";
    const payload2 = {
      OrderId: parentOrderId,
      TradingAccountId: Number(tradingAccountId),
      IfDone: [{
        Stop: {
          TriggerPrice: pos.Direction === "buy" ? Number(pos.Price) - 100 : Number(pos.Price) + 100,
          Quantity: Number(pos.Quantity),
          Direction: childDirection
        },
        Limit: {
          TriggerPrice: pos.Direction === "buy" ? Number(pos.Price) + 100 : Number(pos.Price) - 100,
          Quantity: Number(pos.Quantity),
          Direction: childDirection
        }
      }]
    };
    try {
      const response = await fetch(`${baseUrl}/order/updatetradeorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Session": session,
          "UserName": username
        },
        body: JSON.stringify(payload2)
      });
      console.log("Status 2:", response.status);
      const text2 = await response.text();
      console.log("Response 2:", text2);
    } catch (err) {
      console.log("Error 2:", err.message);
    }

    // Prueba 3: updatetradeorder con StopLoss / TakeProfit simples
    console.log("\n--- Prueba 3: updatetradeorder con StopLoss/TakeProfit simples ---");
    const payload3 = {
      OrderId: parentOrderId,
      TradingAccountId: Number(tradingAccountId),
      StopLoss: pos.Direction === "buy" ? Number(pos.Price) - 100 : Number(pos.Price) + 100,
      TakeProfit: pos.Direction === "buy" ? Number(pos.Price) + 100 : Number(pos.Price) - 100
    };
    try {
      const response = await fetch(`${baseUrl}/order/updatetradeorder`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Session": session,
          "UserName": username
        },
        body: JSON.stringify(payload3)
      });
      console.log("Status 3:", response.status);
      const text3 = await response.text();
      console.log("Response 3:", text3);
    } catch (err) {
      console.log("Error 3:", err.message);
    }

  } catch (e) {
    console.error("Error general:", e.message);
  } finally {
    await client.logout();
  }
}

run();
