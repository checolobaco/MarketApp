import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

async function run() {
  try {
    console.log("Fetching real-time market data for GC=F (last 2 hours)...");
    const result = await yahooFinance.chart("GC=F", {
      period1: new Date(Date.now() - 3 * 60 * 60 * 1000), // last 3 hours
      interval: "5m"
    });
    
    console.log("Quotes found:", result.quotes.length);
    result.quotes.slice(-15).forEach(q => {
      console.log(`[${new Date(q.date).toISOString()}] Open: ${q.open} - High: ${q.high} - Low: ${q.low} - Close: ${q.close}`);
    });
  } catch (err) {
    console.error(err);
  }
}

run();
