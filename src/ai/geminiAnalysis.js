import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { getAiCache, setAiCache } from "./aiCache.js";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export async function analyzeWithGemini(marketData) {
  const symbol = marketData.symbol.toUpperCase().trim();
  const cacheKey = `gen_pred_${symbol}_${marketData.rsi || '0'}_${marketData.lastPrice || '0'}`;

  try {
    const cached = await getAiCache(cacheKey);
    if (cached) {
      console.log(`[Cache Hit] Utilizando predicción guardada para ${symbol}`);
      return {
        ...cached,
        cache_used: true
      };
    }
  } catch (err) {
    console.warn("Error leyendo caché:", err.message);
  }

  const prompt = `
Eres un analista financiero cuantitativo.

Analiza el activo ${marketData.symbol} para las próximas 4 horas.

Usa:
- Indicadores técnicos reales
- Score técnico bull/bear
- Noticias recientes usando Google Search

Reglas:
- No des recomendación de compra o venta.
- No prometas resultados.
- No uses markdown.
- Responde UNICAMENTE con un objeto JSON plano, sin formato adicional.
- Devuelve las probabilidades como enteros (0-100).
- direction debe ser SUBE, BAJA o NEUTRAL.

Datos técnicos calculados:
${JSON.stringify(marketData, null, 2)}

Formato de respuesta exacto:
{
  "direction": "SUBE | BAJA | NEUTRAL",
  "probability_up": 0,
  "probability_down": 0,
  "confidence": "BAJA | MEDIA | ALTA",
  "technical_summary": "",
  "news_summary": "",
  "main_reasons": [],
  "risks": [],
  "warning": "No es recomendación financiera."
}
`;

  const modelsToTry = ["gemini-2.5-flash", "gemini-1.5-flash"];
  
  for (const modelName of modelsToTry) {
    let retries = 2;
    while (retries >= 0) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            tools: [
              {
                googleSearch: {}
              }
            ]
          }
        });

        const text = response.text
          .replace("```json", "")
          .replace("```", "")
          .trim();

        const normalized = normalizeResult(JSON.parse(text), marketData);
        
        try {
          await setAiCache(cacheKey, normalized, 10); // Cache for 10 minutes
        } catch (err) {
          console.warn("Error guardando en caché:", err.message);
        }
        
        return normalized;
      } catch (error) {
        const errStr = error.message || "";
        const isTemporary = errStr.includes("503") || errStr.includes("429") || errStr.includes("demand") || errStr.includes("UNAVAILABLE");
        
        if (isTemporary && retries > 0) {
          console.warn(`Gemini (${modelName}) temporalmente no disponible, reintentando en 1s... (Reintentos restantes: ${retries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          retries--;
        } else {
          console.warn(`Falla para modelo ${modelName}: ${errStr}`);
          break; // Break the retry loop and try the next model
        }
      }
    }
  }

  console.error("Todos los modelos de Gemini fallaron o están saturados.");
  
  if (process.env.GROQ_API_KEY) {
    console.warn("⚠️ Intentando fallback general con Groq...");
    try {
      const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: "Eres un analista financiero cuantitativo. Responde UNICAMENTE con un formato JSON plano, sin markdown." },
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" },
          temperature: 0.1
        })
      });

      if (groqResponse.ok) {
        const groqData = await groqResponse.json();
        const text = groqData.choices[0].message.content
          .replace("```json", "")
          .replace("```", "")
          .trim();
        
        const normalized = normalizeResult(JSON.parse(text), marketData);
        try {
          await setAiCache(cacheKey, normalized, 10);
        } catch (err) {}
        return normalized;
      }
    } catch (groqErr) {
      console.error("❌ Fallback general de Groq falló:", groqErr.message);
    }
  }

  return fallbackAnalysis(marketData, "Todos los modelos de Gemini fallaron debido a alta demanda.");
}

function normalizeResult(result, data) {

  let up = Number(result.probability_up);
  let down = Number(result.probability_down);

  if (up <= 1) up *= 100;
  if (down <= 1) down *= 100;

  if (!up || !down) {
	up = data.bull_score;
	down = data.bear_score;
  }

  // Peso del análisis técnico y de Gemini
  const technicalWeight = 0.7;
  const aiWeight = 0.3;

  const finalUp =
	data.bull_score * technicalWeight +
	up * aiWeight;

  const finalDown =
	data.bear_score * technicalWeight +
	down * aiWeight;

  let finalDirection = "NEUTRAL";

  if (finalUp >= 58) {
	finalDirection = "SUBE";
  }

  if (finalDown >= 58) {
	finalDirection = "BAJA";
  }

  return {
	direction: finalDirection,
	probability_up: Number(finalUp.toFixed(2)),
	probability_down: Number(finalDown.toFixed(2)),
	confidence: data.confidence_score,

	technical_summary:
	  result.technical_summary || "",

	news_summary:
	  result.news_summary || "",

	main_reasons:
	  result.main_reasons || [],

	risks:
	  result.risks || [],

	warning:
	  "No es recomendación financiera."
  };
}

function fallbackAnalysis(data, errorMessage) {
  return {
    direction: data.direction_score,
    probability_up: data.bull_score,
    probability_down: data.bear_score,
    confidence: data.confidence_score,
    technical_summary: "Análisis local calculado con indicadores técnicos reales.",
    news_summary: "Gemini no respondió. No se consultaron noticias en este intento.",
    main_reasons: [
      `Bull score: ${data.bull_score}`,
      `Bear score: ${data.bear_score}`,
      `RSI: ${data.rsi} (${data.signals.rsi})`,
      `MACD: ${data.signals.macd}`,
      `EMA20: ${data.signals.ema20}`,
      `EMA50: ${data.signals.ema50}`,
      `ADX: ${data.adx} (${data.signals.adx})`,
      `Bollinger: ${data.signals.bollinger}`,
      `Stochastic RSI: ${data.signals.stochastic_rsi}`,
      `Volumen: ${data.signals.volume}`,
      `Trend 1h: ${data.signals.trend1h}`,
      `Trend 4h: ${data.signals.trend4h}`
    ],
    risks: [
      "Sin análisis de noticias en tiempo real.",
      "El análisis se basa solo en indicadores técnicos.",
      `Error Gemini: ${errorMessage}`
    ],
    warning: "No es recomendación financiera. Modo fallback sin IA generativa."
  };
}