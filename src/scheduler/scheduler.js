import cron from "node-cron";
import { runBacktesting } from "../backtesting/backtestEngine.js";

export function startPredictionScheduler() {
  console.log("Scheduler de backtesting de fondo iniciado (1m).");

  cron.schedule("* * * * *", async () => {
    try {
      await runBacktesting();
    } catch (error) {
      console.error("Error en scheduler:", error.message);
    }
  });
}