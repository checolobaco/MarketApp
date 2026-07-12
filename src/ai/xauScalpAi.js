import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { getAiCache, setAiCache } from "./aiCache.js";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export async function analyzeXauScalpWithGemini(data, options = {}) {
  const {
    useGemini = true,
    cacheKey = null
  } = options;

  if (!useGemini) {
    return fallbackXauScalp(
      data,
      "Gemini omitido por filtro previo de calidad/riesgo."
    );
  }

  if (cacheKey) {
    const cached = await getAiCache(cacheKey);

    if (cached) {
      return {
        ...cached,
        cache_used: true
      };
    }
  }

  const symbol = (data.symbol || "XAUUSD").toUpperCase().trim();
  const prompt = `
Eres un economista cuantitativo de élite y analista estadístico experto en mercados financieros internacionales.

Realiza un análisis probabilístico y matemático riguroso para el activo ${symbol} para los próximos 15 a 30 minutos.

Evalúa utilizando:
- Distribución y momentum basado en los indicadores técnicos suministrados.
- Teoría de microestructura de mercado y volumen según la sesión activa.
- Volatilidad histórica e implícita implícita en la dispersión del ATR.
- Análisis cualitativo macroeconómico en tiempo real correlacionando eventos recientes y noticias de alto impacto obtenidas mediante Google Search.

Reglas de negocio:
- Sé objetivo, basándote estrictamente en estadísticas y probabilidad matemática.
- No garantices ningún resultado; el análisis debe reflejar la incertidumbre estadística inherente del mercado.
- No uses formato markdown.
- Responde estrictamente con un JSON plano y válido.
- Las variables probability_buy y probability_sell deben ser estimaciones numéricas probabilísticas de 0 a 100.

Datos técnicos analizados:
${JSON.stringify(data, null, 2)}

Formato de respuesta JSON requerido:
{
  "direction": "BUY | SELL | NEUTRAL",
  "probability_buy": 0,
  "probability_sell": 0,
  "confidence": "BAJA | MEDIA | ALTA",
  "technical_summary": "Análisis estadístico y matemático del momentum y estructura técnica.",
  "macro_summary": "Análisis econométrico del impacto de las noticias económicas actuales.",
  "main_reasons": ["Razón de peso cuantitativa 1", "Razón de peso cuantitativa 2"],
  "risks": ["Riesgo macro/técnico identificado 1", "Riesgo macro/técnico identificado 2"],
  "warning": "No constituye asesoramiento financiero ni recomendación de inversión. Basado en inferencia probabilística."
}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
	  /*
	  model: "gemini-2.5-flash-lite",
	  model: "gemini-2.0-flash",
	  model: "gemini-2.5-flash",
	  */
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

    const normalized = normalizeResult(JSON.parse(text), data);

    if (cacheKey) {
      await setAiCache(cacheKey, normalized, 30);
    }

    return normalized;

  } catch (error) {
    if (process.env.GROQ_API_KEY) {
      console.warn("⚠️ Gemini falló (exceso de cuota). Intentando fallback con Groq...");
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
              { role: "system", content: "Eres un analista profesional de scalping en XAU/USD. Responde UNICAMENTE con un formato JSON plano, sin markdown." },
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
          
          const normalized = normalizeResult(JSON.parse(text), data);
          if (cacheKey) {
            await setAiCache(cacheKey, normalized, 30);
          }
          return normalized;
        } else {
          const errText = await groqResponse.text();
          console.error("❌ Groq fallback falló:", errText);
        }
      } catch (groqErr) {
        console.error("❌ Excepción en fallback de Groq:", groqErr.message);
      }
    }
    return fallbackXauScalp(data, error.message);
  }
}

function normalizeResult(result, data) {
  let buy = Number(result.probability_buy);
  let sell = Number(result.probability_sell);

  if (buy <= 1) buy *= 100;
  if (sell <= 1) sell *= 100;

  if (!buy || !sell) {
    buy = data.buy_score;
    sell = data.sell_score;
  }

  const technicalWeight = 0.75;
  const aiWeight = 0.25;

  const finalBuy =
    data.buy_score * technicalWeight +
    buy * aiWeight;

  const finalSell =
    data.sell_score * technicalWeight +
    sell * aiWeight;

  let direction = "NEUTRAL";

  if (finalBuy >= 60) direction = "BUY";
  if (finalSell >= 60) direction = "SELL";

  return {
    direction,
    probability_buy: Number(finalBuy.toFixed(2)),
    probability_sell: Number(finalSell.toFixed(2)),
    confidence: data.confidence_score,
    technical_summary: result.technical_summary || "",
    macro_summary: result.macro_summary || "",
    main_reasons: result.main_reasons || [],
    risks: result.risks || [],
    warning: "No es recomendación financiera."
  };
}

function fallbackXauScalp(data, errorMessage) {
  return {
    direction: data.direction_score,
    probability_buy: data.buy_score,
    probability_sell: data.sell_score,
    confidence: data.confidence_score,
    technical_summary: "Análisis local para scalping XAU/USD con indicadores reales.",
    macro_summary: "Gemini no respondió. No se consultaron noticias macro en este intento.",
    main_reasons: [
      `Buy score: ${data.buy_score}`,
      `Sell score: ${data.sell_score}`,
      `RSI: ${data.rsi} (${data.signals.rsi})`,
      `MACD: ${data.signals.macd}`,
      `EMA9: ${data.signals.ema9}`,
      `EMA20: ${data.signals.ema20}`,
      `ADX: ${data.adx} (${data.signals.adx})`,
      `ATR: ${data.atr} (${data.signals.atr})`,
      `Stochastic RSI: ${data.signals.stochastic_rsi}`,
      `CCI: ${data.cci} (${data.signals.cci})`,
      `Williams %R: ${data.williams_r} (${data.signals.williams_r})`,
      `Trend 5m: ${data.signals.trend5m}`,
      `Trend 15m: ${data.signals.trend15m}`,
      `Sesión: ${data.signals.market_session}`
    ],
    risks: [
      "Sin análisis macro en tiempo real.",
      "XAU/USD puede moverse violentamente por noticias económicas.",
      `Error Gemini: ${errorMessage}`
    ],
    warning: "No es recomendación financiera. Modo fallback sin IA generativa."
  };
}