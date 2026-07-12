# MarketApp Fronted

Frontend estático, moderno y minimalista para el backend de MarketApp.

## Ejecutar

```bash
cd fronted
npm run dev
```

Abre `http://localhost:5173`.

## Configuración

El frontend usa por defecto `http://localhost:4000/api`. Puedes cambiarlo desde el campo `Backend API` en la barra lateral.

La tarjeta `Automatización` controla tareas del backend:

- `Evaluar auto al vencimiento`: evalúa predicciones stocks y XAU cuando `target_check_time <= NOW()`.
- `Predecir auto XAU`: ejecuta automáticamente señales `SCALP_000`, `SCALP_005`, `SCALP_010` y `SCALP_015`.
- `Predecir auto stocks`: crea predicciones para los símbolos configurados cuando no exista una predicción pendiente.

## Pantallas

- `Resumen`: estado de API, decisión XAU y predicciones recientes.
- `XAU Scalp`: botón principal para predecir XAU/USD, señales manuales, sesión, decisión y detalle de respuesta.
- `Predicciones`: predicción 4h, histórico, estadísticas, resultados y backtest.
- `Opening`: confirmación de apertura por símbolo.
- `Analítica`: métricas agrupadas de XAU y TP/SL segmentado por hora, calidad, sesión, ADX y ATR.
- `Backfill`: procesos históricos para stocks y XAU.
