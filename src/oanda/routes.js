import express from "express";
import { OandaClient } from "./client.js";

import { logOrderOpen } from "../services/tradingJournalService.js";

const router = express.Router();

// Helper to get client from request headers or process.env fallback
function getClient(req) {
  const token = req.headers["x-oanda-token"] || process.env.OANDA_TOKEN;
  const accountId = req.headers["x-oanda-accountid"] || process.env.OANDA_ACCOUNT_ID;
  const isDemo = req.headers["x-oanda-isdemo"] !== "false";

  return new OandaClient({ token, accountId, isDemo });
}

// 1. Verify Connection / Get Summary
router.get("/account/summary", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getAccountSummary();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 2. Get Account Details
router.get("/account/details", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getAccountDetails();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 3. List Instruments
router.get("/instruments", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.listInstruments();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 4. Get Price Candles
router.get("/candles/:instrument", async (req, res) => {
  const { instrument } = req.params;
  const { interval, count } = req.query;
  try {
    const client = getClient(req);
    const result = await client.getCandles(
      instrument,
      interval || "15m",
      count ? Number(count) : 20
    );
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 5. Get Open Positions
router.get("/positions", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getOpenPositions();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 6. Get Open Trades
router.get("/trades", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getOpenTrades();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 7. Get Active Orders
router.get("/orders", async (req, res) => {
  try {
    const client = getClient(req);
    const result = await client.getActiveOrders();
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 8. Place Order
router.post("/order", async (req, res) => {
  const { instrument, direction, quantity, stopLoss, takeProfit } = req.body;
  try {
    const client = getClient(req);
    const result = await client.createOrder({
      instrument,
      direction,
      quantity,
      stopLoss,
      takeProfit
    });

    logOrderOpen({
      symbol: instrument,
      action: direction === "BUY" || direction === "LONG" ? "BUY" : "SELL",
      volume: Number(quantity) / 100000.0,
      entryPrice: result.price || (result.orderFillTransaction && result.orderFillTransaction.price) || 0,
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      source: "OANDA",
      brokerPositionId: result.id || (result.orderFillTransaction && result.orderFillTransaction.id) || null,
      notes: `Unidades Oanda: ${quantity}`
    }).catch(err => console.error("Error al registrar diario en OANDA trade:", err.message));

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
