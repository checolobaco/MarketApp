import dotenv from "dotenv";
import { ForexComClient } from "../src/forexcom/client.js";

dotenv.config();

async function run() {
  const username = process.env.FOREX_USERNAME;
  const password = process.env.FOREX_PASSWORD;
  const appKey = process.env.FOREX_APPKEY;
  const isDemo = false;

  const client = new ForexComClient({ username, password, appKey, isDemo });
  try {
    await client.login();
    const positionsResult = await client.getOpenPositions();
    const openPositions = positionsResult.OpenPositions || [];
    console.log("Found positions:", openPositions.length);

    for (const pos of openPositions) {
      console.log(`Position ID: ${pos.OrderId || pos.PositionId} | Symbol: ${pos.MarketName} | Price: ${pos.Price} | Qty: ${pos.Quantity} | Dir: ${pos.Direction}`);
      try {
        const marketInfo = await client.getMarketInformation(pos.MarketId);
        const infoDetails = marketInfo?.MarketInformation || {};
        const bid = infoDetails.Bid ? Number(infoDetails.Bid) : null;
        const offer = infoDetails.Offer ? Number(infoDetails.Offer) : null;
        
        console.log(`  Market Bid: ${bid} | Offer: ${offer}`);
        if (bid && offer) {
          const currentPrice = pos.Direction === "buy" ? bid : offer;
          const diff = currentPrice - Number(pos.Price);
          const factor = pos.Direction === "buy" ? 1 : -1;
          
          let pnl = diff * Number(pos.Quantity) * factor;
          console.log(`  Diff: ${diff} | Factor: ${factor} | Raw PNL: ${pnl}`);
        } else {
          console.log("  No live Bid/Offer available from broker!");
        }
      } catch (err) {
        console.error("  Error calculating PNL:", err.message);
      }
    }
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    await client.logout();
  }
}

run();
