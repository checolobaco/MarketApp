import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import predictRoutes from "./routes/predict.routes.js";
dotenv.config();
import openingRoutes from "./routes/opening.routes.js";
import xauScalpRoutes from "./routes/xauScalp.routes.js";
import backfillRoutes from "./routes/backfill.routes.js";
import xauAnalyticsRoutes from "./routes/xauAnalytics.routes.js";
import automationRoutes from "./routes/automation.routes.js";
import forexcomRoutes from "./forexcom/routes.js";
import oandaRoutes from "./oanda/routes.js";
import xproRoutes from "./xpro/routes.js";
import { startAutomationScheduler } from "./scheduler/automationScheduler.js";
import { startPredictionScheduler } from "./scheduler/scheduler.js";
import { initAutomationState } from "./scheduler/automationState.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// Servir frontend de forma estática
app.use(express.static(path.join(__dirname, "../fronted")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Market API funcionando"
  });
});

app.use("/api", predictRoutes);
app.use("/api", openingRoutes);
app.use("/api", xauScalpRoutes);
app.use("/api", backfillRoutes);
app.use("/api", xauAnalyticsRoutes);
app.use("/api", automationRoutes);
app.use("/api/forexcom", forexcomRoutes);
app.use("/api/oanda", oandaRoutes);
app.use("/api/xpro", xproRoutes);

// Endpoint de prueba de Telegram
app.get("/api/test-telegram", async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(400).json({
      ok: false,
      error: "Variables TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configuradas en Railway."
    });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🔔 *¡Prueba de Telegram desde Railway exitosa!*\n\nTu bot de MarketApp está conectado correctamente y listo para enviar señales.",
        parse_mode: "Markdown"
      })
    });

    const data = await response.json();
    if (data.ok) {
      return res.json({
        ok: true,
        message: "Mensaje de prueba enviado con éxito a Telegram.",
        telegram_response: data
      });
    } else {
      return res.status(400).json({
        ok: false,
        error: "Error devuelto por la API de Telegram.",
        details: data.description
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Error interno al conectar con la API de Telegram.",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 4000;

// Iniciar el servidor inmediatamente para que la plataforma detecte que está "up".
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

// Inicializar estado y schedulers en segundo plano. No bloqueamos el arranque
// principal para evitar que fallos/exceso de latencia al conectar a BD provoquen
// que la plataforma envíe SIGTERM por timeout de arranque.
initAutomationState()
  .then(() => console.log("[Server] initAutomationState completado."))
  .catch(err => console.error("[Server] initAutomationState falló:", err.message || err));

// Arrancar schedulers (no requieren bloquear el arranque HTTP)
try {
  startAutomationScheduler();
  startPredictionScheduler();
} catch (err) {
  console.error("Error al arrancar schedulers:", err.message || err);
}
