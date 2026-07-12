import express from "express";
import { runStockBackfill } from "../backfill/stockBackfill.js";
import { runXauScalpBackfill } from "../backfill/xauScalpBackfill.js";

const router = express.Router();

router.post("/backfill/stocks", async (req, res) => {
  try {
    const {
      symbols = ["AAPL"],
      days = 7,
      stepCandles = 4,
      horizonCandles = 16
    } = req.body;

    const result = await runStockBackfill({
      symbols,
      days,
      stepCandles,
      horizonCandles
    });

    res.json({
      ok: true,
      type: "stocks",
      result
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post("/backfill/xau-scalp", async (req, res) => {
  try {
    const {
      days = 7,
      stepCandles = 3,
      horizonCandles = 6
    } = req.body;

    const result = await runXauScalpBackfill({
      days,
      stepCandles,
      horizonCandles
    });

    res.json({
      ok: true,
      type: "xau-scalp",
      result
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;