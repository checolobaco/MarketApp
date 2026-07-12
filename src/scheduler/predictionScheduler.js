import cron from "node-cron";
import { runBacktesting } from "../backtesting/backtestEngine.js";

export function startPredictionScheduler() {
  console.log("Scheduler de backtesting iniciado.");

  cron.schedule("*/15 * * * *", async () => {
    try {
      await runBacktesting();
    } catch (error) {
      console.error("Error en scheduler:", error.message);
    }
  });
}