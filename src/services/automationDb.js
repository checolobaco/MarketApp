// src/services/automationDb.js
// Servicio de persistencia para las configuraciones de automatización en PostgreSQL.
// Garantiza que los estados de Auto-operar, Auto-predecir y Auto-evaluar
// sobrevivan reinicios del servidor.

import { pool } from "../db.js";
import { getMinVolumeForSymbol } from "./tradingConfig.js";

const SETTINGS_KEY = "global_automation_config";

/**
 * Estado por defecto en caso de que no haya registros en base de datos.
 */
const DEFAULT_STATE = {
  auto_evaluate: false,
  auto_predict_xau: false,
  auto_predict_stocks: false,
  stock_symbols: ["AAPL"],
  xau_horizon_minutes: 30,
  xpro_auto_evaluate: false,
  xpro_auto_predict: false,
  xpro_auto_trade: false,
  xpro_selected_symbol: "XAUUSD",
  xpro_automation_list: [],
  forex_auto_evaluate: false,
  forex_auto_predict: false,
  forex_auto_trade: false,
  forex_force_smart_allowed: false,
  forex_selected_symbol: "XAUUSD",
  forex_automation_list: [
    {
      symbol: "402044083",
      name: "XAUUSD-402044083",
      auto_predict: false,
      auto_evaluate: false,
      auto_trade: true,
      volume: getMinVolumeForSymbol("402044083")
    }
  ]
};

/**
 * Carga la configuración de automatización desde la base de datos.
 * Si no existe, devuelve los valores por defecto.
 */
export async function loadAutomationConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM automation_settings WHERE key = $1 LIMIT 1",
      [SETTINGS_KEY]
    );

    if (rows.length) {
      const saved = rows[0].value;
      // Mezclar con DEFAULT_STATE para asegurar que nuevas keys futuras siempre existan
      return { ...DEFAULT_STATE, ...saved };
    }

    // Primera ejecución: insertar el estado por defecto
    await saveAutomationConfig(DEFAULT_STATE);
    console.log("[AutomationDB] Configuración inicial de automatizaciones creada en base de datos.");
    return { ...DEFAULT_STATE };
  } catch (error) {
    console.error("[AutomationDB] Error al cargar configuración:", error.message);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Guarda (UPSERT) la configuración completa de automatización en la base de datos.
 */
export async function saveAutomationConfig(state) {
  try {
    // Sólo persistimos las propiedades de configuración (no los timestamps en memoria)
    const toPersist = {
      auto_evaluate: state.auto_evaluate,
      auto_predict_xau: state.auto_predict_xau,
      auto_predict_stocks: state.auto_predict_stocks,
      stock_symbols: state.stock_symbols,
      xau_horizon_minutes: state.xau_horizon_minutes,
      xpro_auto_evaluate: state.xpro_auto_evaluate,
      xpro_auto_predict: state.xpro_auto_predict,
      xpro_auto_trade: state.xpro_auto_trade,
      xpro_selected_symbol: state.xpro_selected_symbol,
      xpro_automation_list: state.xpro_automation_list,
      forex_auto_evaluate: state.forex_auto_evaluate,
      forex_auto_predict: state.forex_auto_predict,
      forex_auto_trade: state.forex_auto_trade,
      forex_force_smart_allowed: state.forex_force_smart_allowed,
      forex_selected_symbol: state.forex_selected_symbol,
      forex_automation_list: state.forex_automation_list
    };

    await pool.query(
      `INSERT INTO automation_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [SETTINGS_KEY, JSON.stringify(toPersist)]
    );
  } catch (error) {
    console.error("[AutomationDB] Error al guardar configuración:", error.message);
  }
}

/**
 * Devuelve la configuración actual de automatización directamente desde la base de datos.
 * Útil para endpoints de diagnóstico.
 */
export async function getStoredAutomationConfig() {
  try {
    const { rows } = await pool.query(
      "SELECT value, updated_at FROM automation_settings WHERE key = $1 LIMIT 1",
      [SETTINGS_KEY]
    );
    if (rows.length) {
      return { ...rows[0].value, saved_at: rows[0].updated_at };
    }
    return DEFAULT_STATE;
  } catch (error) {
    console.error("[AutomationDB] Error al leer configuración:", error.message);
    return DEFAULT_STATE;
  }
}
