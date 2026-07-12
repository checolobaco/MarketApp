import { getXauHistoricalCandles } from "./src/data_provider/xauData.js";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function run() {
  try {
    console.log("1. Fetching from Yahoo Finance directly (GC=F)...");
    const result = await yahooFinance.chart("GC=F", { period1: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), interval: "5m" });
    const yahooCandles = result.quotes.slice(-5);
    console.log("Yahoo Candles:", yahooCandles);

    console.log("\n2. Fetching through our getXauHistoricalCandles helper...");
    const helperCandles = await getXauHistoricalCandles(1, "5m");
    console.log("Helper Candles (last 5):", helperCandles.slice(-5));
  } catch (err) {
    console.error(err);
  }
}

run();
