# API Endpoints - MarketApp

Base URL: `http://localhost:4000/api` (ajustar `PORT` según configuración)

## Resumen rápido
- **GET /**: salud del API (no requiere prefijo `/api`).
- Endpoints principales montados bajo `/api`: `predict`, `opening`, `xau/scalp`, `backfill`, `xau/scalp/stats`.

---

**GET /**
- Ruta: `/`
- Descripción: Verifica que la API esté funcionando.
- Ejemplo (curl):

```
curl http://localhost:4000/
```

- Ejemplo de respuesta:

```
{ "ok": true, "message": "Market API funcionando" }
```

---

## Endpoints: `predict` (general)

**POST /api/predict**
- Descripción: Crea una predicción para un `symbol` usando datos, indicadores y AI.
- Body (JSON): `{ "symbol": "AAPL" }` (requerido)
- Respuestas clave:
  - 400: `{ ok: false, error: "El campo symbol es obligatorio" }`
  - 409: si ya existe predicción pendiente: `{ ok: false, error: "Ya existe una predicción pendiente para este símbolo", pending_prediction: {...} }`
  - 200: predicción creada con campos: `prediction_id`, `symbol`, `horizon`, `prediction_time`, `target_check_time`, `entry_price`, `indicators`, `analysis`.
- Ejemplo (curl):

```
curl -X POST http://localhost:4000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL"}'
```

---

**POST /api/backtest/run**
- Descripción: Ejecuta backtesting general (sin parámetros en la ruta).
- Respuesta 200: `{ ok: true, result: <objeto resultado del backtest> }`.

---

**GET /api/predictions**
- Descripción: Lista predicciones. Query params opcionales: `symbol`, `status`.
- Ejemplo: `/api/predictions?symbol=AAPL&status=PENDING`
- Respuesta: `{ ok: true, total: <n>, predictions: [ ... ] }`.

---

**GET /api/stats**
- Descripción: Estadísticas agregadas de `prediction_results`. Query opcional: `symbol`.
- Respuesta: `{ ok: true, stats: [ { symbol, total_predictions, wins, losses, accuracy_percent, ... } ] }`.

---

**GET /api/results**
- Descripción: Lista de resultados de predicciones (tabla `prediction_results`). Query opcional: `symbol`.
- Respuesta: `{ ok: true, total: <n>, results: [ ... ] }`.

---

## Endpoints: `opening` (apertura)

**POST /api/opening/predict**
- Descripción: Inserta una señal de apertura para un `symbol` y `signal` específico.
- Body (JSON): `{ "symbol": "AAPL", "signal": "OPENING_0800" }`
- `signal` válido: `OPENING_0800`, `OPENING_0815`, `OPENING_0830`.
- Errores:
  - 400 si falta `symbol` o `signal` inválido.
  - 409 si ya existe la señal para la sesión.
- Respuesta 200: `{ ok: true, prediction_id, symbol, session_id, strategy, signal, horizon, prediction_time, target_check_time, entry_price, indicators, analysis }`.
- Caso de uso: programar confirmaciones al inicio de jornada y reunir señales por sesión.

---

**GET /api/opening/session**
- Query required: `symbol`. Opcional: `date`.
- Ejemplo: `/api/opening/session?symbol=AAPL` o `/api/opening/session?symbol=AAPL&date=2026-06-17`
- Respuesta: `{ ok: true, symbol, session_id, total_signals, signals: [ ... ] }`.

---

**GET /api/opening/decision**
- Query required: `symbol`. Opcional: `date`.
- Descripción: Construye una decisión de trading agregando votos y probabilidades ponderadas.
- Respuesta 200: `{ ok: true, symbol, session_id, total_signals, decision, should_enter, confidence, avg_probability_up, avg_probability_down, votes, signals }`.
- 404 si no hay señales para la sesión.

---

## Endpoints: `xau/scalp` (XAU scalp trading)

**POST /api/xau/scalp/predict**
- Descripción: Inserta una señal scalp para XAUUSD. Usa indicadores, AI y filtros de riesgo.
- Body (JSON) opcional: `{ "signal": "SCALP_000", "horizon_minutes": 30 }`.
- `signal` permitido: `SCALP_000`, `SCALP_005`, `SCALP_010`, `SCALP_015`.
- Errores: 400 si `signal` inválido; 409 si duplicado.
- Respuesta 200: objeto con muchos campos, entre los más relevantes:
  - `scalp_prediction_id`, `symbol` (XAUUSD), `session_id`, `strategy`, `signal`, `horizon_minutes`, `prediction_time`, `target_check_time`, `entry_price`, `trade_plan`, `risk_filter`, `macro_risk`, `trade_quality`, `smart_filter`, `gemini_gate`, `ai_cache_key`, `should_enter`, `indicators`, `analysis`.
- Ejemplo (curl):

```
curl -X POST http://localhost:4000/api/xau/scalp/predict \
  -H "Content-Type: application/json" \
  -d '{"signal":"SCALP_005","horizon_minutes":20}'
```

Uso: generar señales automáticas para XAU con evaluación de riesgo y calidad.

---

**GET /api/xau/scalp/session**
- Query opcional: `session_id` (si no viene se construye la sesión actual).
- Respuesta: `{ ok: true, session_id, total_signals, signals: [ ... ] }`.

---

**GET /api/xau/scalp/decision**
- Query opcional: `session_id` (si no viene se usa la actual).
- Descripción: agrega señales scalp (filtra por `should_enter` y `smart_allowed`) y calcula decisión, `avg_trade_score`, `confidence`.
- 404 si no hay señales.
- Respuesta: `{ ok: true, symbol, session_id, total_signals, decision, should_enter, confidence, avg_probability_buy, avg_probability_sell, votes, valid_signals, avg_trade_score, signals }`.

---

**POST /api/xau/scalp/backtest/run**
- Ejecuta backtesting para la estrategia scalp.
- Respuesta: `{ ok: true, result: <objeto resultado> }`.

---

**GET /api/xau/scalp/results**
- Lista resultados históricos (tabla `scalp_results`). Respuesta: `{ ok: true, total, results: [ ... ] }`.

---

**GET /api/xau/scalp/stats**
- Estadísticas agregadas por `symbol` para scalp results. Respuesta: `{ ok: true, stats: [ ... ] }`.

---

## Endpoints: `backfill` (población histórica)

**POST /api/backfill/stocks**
- Descripción: Corre backfill para acciones.
- Body (JSON opcional): `{ "symbols": ["AAPL"], "days": 7, "stepCandles": 4, "horizonCandles": 16 }`.
- Respuesta: `{ ok: true, type: "stocks", result: <objeto> }`.

**POST /api/backfill/xau-scalp**
- Body (JSON opcional): `{ "days":7, "stepCandles":3, "horizonCandles":6 }`.
- Respuesta: `{ ok: true, type: "xau-scalp", result: <objeto> }`.

Uso: reconstruir datos históricos para pruebas y métricas.

---

## Endpoints: `xau/scalp/stats` (agrupaciones y TPSL)

- GET `/api/xau/scalp/stats/by-session`
- GET `/api/xau/scalp/stats/by-quality`
- GET `/api/xau/scalp/stats/by-adx`
- GET `/api/xau/scalp/stats/by-atr`
- GET `/api/xau/scalp/stats/by-hour`
- GET `/api/xau/scalp/stats/by-smart-filter`

- GET `/api/xau/scalp/stats/tpsl`
- GET `/api/xau/scalp/stats/tpsl-by-hour`
- GET `/api/xau/scalp/stats/tpsl-by-quality`
- GET `/api/xau/scalp/stats/tpsl-by-session`
- GET `/api/xau/scalp/stats/tpsl-by-adx`
- GET `/api/xau/scalp/stats/tpsl-by-atr`

Descripción: consultas agrupadas sobre `scalp_results` para análisis (por sesión, calidad, adx, atr, hora y combinaciones TPSL).

Ejemplo (curl):

```
curl http://localhost:4000/api/xau/scalp/stats/by-session
```

Respuesta típica: `{ ok: true, group_by: "session_name", stats: [ { group_value, total, wins, losses, win_rate, avg_pips, total_pips, ... } ] }`.

---

## Notas operativas y casos de uso (resumido)

- Integración rápida (consumo desde un cliente): usar `POST /api/predict` para predicciones ad-hoc por símbolo.
- Automatización de señales de apertura: `POST /api/opening/predict` por cada `signal` y luego consultar `/api/opening/decision` para la decisión agregada.
- Operaciones XAU scalp: `POST /api/xau/scalp/predict` para generar señales; `/api/xau/scalp/decision` para decisión final; `/api/xau/scalp/stats/*` para análisis histórico y performance.
- Backfill y pruebas: usar `/api/backfill/*` y `/api/xau/scalp/backtest/run` para generar datos históricos y validar estrategias.

---

Si quieres, produzco: ejemplos concretos con respuestas reales tomadas de una ejecución local (si ejecutas el servidor y me pides correr pruebas), o un archivo OpenAPI/Swagger generado automáticamente. ¿Cuál prefieres?
