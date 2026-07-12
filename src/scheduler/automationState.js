// src/scheduler/automationState.js
// Gestor en-memoria del estado de automatización con persistencia en PostgreSQL.
// Al arrancar, el estado se precarga desde la tabla `automation_settings`.
// Cada cambio de configuración se persiste asincrónicamente para sobrevivir reinicios.

import { loadAutomationConfig, saveAutomationConfig } from "../services/automationDb.js";

const automationState = {
  // — Control de automatizaciones globales —
  auto_evaluate: false,
  auto_predict_xau: false,
  auto_predict_stocks: false,
  stock_symbols: ["AAPL"],
  xau_horizon_minutes: 30,

  // — Control XPRO Terminal —
  xpro_auto_evaluate: false,
  xpro_auto_predict: false,
  xpro_auto_trade: false,           // Auto-operar señales en XPRO
  xpro_selected_symbol: "XAUUSD",
  xpro_automation_list: [],

  // — Control Forex.com —
  forex_auto_evaluate: false,
  forex_auto_predict: false,
  forex_auto_trade: false,          // Auto-operar señales en Forex.com
  forex_force_smart_allowed: false, // Forzar smart_allowed para Forex.com temporalmente
  forex_selected_symbol: "XAUUSD",
  forex_automation_list: [],

  // — Timestamps en memoria (no persistidos) —
  last_auto_evaluate_at: null,
  last_xau_predict_at: null,
  last_stock_predict_at: null,
  last_xpro_predict_at: null,
  last_forex_predict_at: null,
  last_xau_signal: null,
  last_error: null,
  db_loaded: false
};

// ─────────────────────────────────────────────────────────────
// Inicialización: carga persistida desde Postgres al arrancar
// ─────────────────────────────────────────────────────────────
export async function initAutomationState() {
  try {
    const saved = await loadAutomationConfig();
    // Aplicar sólo los campos de configuración (no timestamps)
    const configKeys = [
      "auto_evaluate", "auto_predict_xau", "auto_predict_stocks",
      "stock_symbols", "xau_horizon_minutes",
      "xpro_auto_evaluate", "xpro_auto_predict", "xpro_auto_trade",
      "xpro_selected_symbol", "xpro_automation_list",
      "forex_auto_evaluate", "forex_auto_predict", "forex_auto_trade", "forex_force_smart_allowed",
      "forex_selected_symbol", "forex_automation_list"
    ];
    for (const key of configKeys) {
      if (saved[key] !== undefined) {
        automationState[key] = saved[key];
      }
    }
      // Asegurar que la lista de automatizaciones de Forex contenga el item solicitado
      try {
        const requiredSymbol = "402044083";
        const exists = automationState.forex_automation_list.some(
          i => String(i.symbol || "").toUpperCase() === requiredSymbol
        );
        if (!exists) {
          // Asignar volumen mínimo conocido para el instrumento
          const { getMinVolumeForSymbolAsync, getMinVolumeForSymbol } = await import("../services/tradingConfig.js");
          const minVol = await getMinVolumeForSymbolAsync(requiredSymbol).catch(() => getMinVolumeForSymbol(requiredSymbol));
          automationState.forex_automation_list.push({
            symbol: requiredSymbol,
            name: "XAUUSD-402044083",
            auto_predict: false,
            auto_evaluate: false,
            auto_trade: true,
            volume: minVol
          });
          // Persistir inmediatamente la nueva configuración
          saveAutomationConfig(automationState).catch(err =>
            console.error("[AutomationState] Error al persistir configuración tras añadir item por defecto:", err.message)
          );
        }
      } catch (e) {
        console.error("[AutomationState] Error al asegurar item por defecto:", e.message);
      }

      automationState.db_loaded = true;
      console.log("[AutomationState] Estado de automatizaciones cargado desde base de datos.");
  } catch (error) {
    console.error("[AutomationState] No se pudo cargar el estado desde BD:", error.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Lectura del estado completo
// ─────────────────────────────────────────────────────────────
export function getAutomationState() {
  return {
    ...automationState,
    stock_symbols: [...automationState.stock_symbols],
    xpro_automation_list: automationState.xpro_automation_list
      ? [...automationState.xpro_automation_list]
      : [],
    forex_automation_list: automationState.forex_automation_list
      ? [...automationState.forex_automation_list]
      : []
  };
}

// ─────────────────────────────────────────────────────────────
// Actualizar estado + persistir configuración
// ─────────────────────────────────────────────────────────────
export function updateAutomationState(patch = {}) {
  let needsPersist = false;

  if (typeof patch.auto_evaluate === "boolean") {
    automationState.auto_evaluate = patch.auto_evaluate;
    needsPersist = true;
  }
  if (typeof patch.auto_predict_xau === "boolean") {
    automationState.auto_predict_xau = patch.auto_predict_xau;
    needsPersist = true;
  }
  if (typeof patch.auto_predict_stocks === "boolean") {
    automationState.auto_predict_stocks = patch.auto_predict_stocks;
    needsPersist = true;
  }

  // — XPRO —
  if (typeof patch.xpro_auto_evaluate === "boolean") {
    automationState.xpro_auto_evaluate = patch.xpro_auto_evaluate;
    needsPersist = true;
  }
  if (typeof patch.xpro_auto_predict === "boolean") {
    automationState.xpro_auto_predict = patch.xpro_auto_predict;
    needsPersist = true;
  }
  if (typeof patch.xpro_auto_trade === "boolean") {
    automationState.xpro_auto_trade = patch.xpro_auto_trade;
    needsPersist = true;
  }
  if (typeof patch.xpro_selected_symbol === "string") {
    automationState.xpro_selected_symbol = patch.xpro_selected_symbol.toUpperCase().trim();
    needsPersist = true;
  }
  if (Array.isArray(patch.xpro_automation_list)) {
    automationState.xpro_automation_list = patch.xpro_automation_list
      .map(item => ({
        symbol: String(item.symbol || "").toUpperCase().trim(),
        auto_predict: !!item.auto_predict,
        auto_evaluate: !!item.auto_evaluate,
        auto_trade: !!item.auto_trade,
        volume: item.volume !== undefined ? Number(item.volume) : undefined
      }))
      .filter(item => item.symbol !== "");
    needsPersist = true;
  }

  // — Forex.com —
  if (typeof patch.forex_auto_evaluate === "boolean") {
    automationState.forex_auto_evaluate = patch.forex_auto_evaluate;
    needsPersist = true;
  }
  if (typeof patch.forex_auto_predict === "boolean") {
    automationState.forex_auto_predict = patch.forex_auto_predict;
    needsPersist = true;
  }
  if (typeof patch.forex_auto_trade === "boolean") {
    automationState.forex_auto_trade = patch.forex_auto_trade;
    needsPersist = true;
  }
  if (typeof patch.forex_force_smart_allowed === "boolean") {
    automationState.forex_force_smart_allowed = patch.forex_force_smart_allowed;
    needsPersist = true;
  }
  if (typeof patch.forex_selected_symbol === "string") {
    automationState.forex_selected_symbol = patch.forex_selected_symbol.toUpperCase().trim();
    needsPersist = true;
  }
  if (Array.isArray(patch.forex_automation_list)) {
    automationState.forex_automation_list = patch.forex_automation_list
      .map(item => ({
        symbol: String(item.symbol || "").toUpperCase().trim(),
        name: String(item.name || "").trim(),
        auto_predict: !!item.auto_predict,
        auto_evaluate: !!item.auto_evaluate,
        auto_trade: !!item.auto_trade,
        volume: item.volume !== undefined ? Number(item.volume) : undefined
      }))
      .filter(item => item.symbol !== "");
    needsPersist = true;
  }

  // — Stocks / General —
  if (Array.isArray(patch.stock_symbols)) {
    automationState.stock_symbols = normalizeSymbols(patch.stock_symbols);
    needsPersist = true;
  }
  if (patch.xau_horizon_minutes !== undefined) {
    automationState.xau_horizon_minutes = normalizePositiveNumber(
      patch.xau_horizon_minutes,
      automationState.xau_horizon_minutes
    );
    needsPersist = true;
  }

  // Persistir asincrónicamente sólo si hubo cambios de configuración
  if (needsPersist) {
    saveAutomationConfig(automationState).catch(err =>
      console.error("[AutomationState] Error al persistir configuración:", err.message)
    );
  }

  return getAutomationState();
}

// ─────────────────────────────────────────────────────────────
// Marcar ejecuciones del scheduler (timestamps en memoria, NO persisten)
// ─────────────────────────────────────────────────────────────
export function markAutomationRun(patch = {}) {
  Object.assign(automationState, patch);
  return getAutomationState();
}

// ─────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────
function normalizeSymbols(symbols) {
  const cleanSymbols = symbols
    .map(symbol => String(symbol || "").toUpperCase().trim())
    .filter(Boolean);
  return [...new Set(cleanSymbols)].slice(0, 20);
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
