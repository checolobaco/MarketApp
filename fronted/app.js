const DEFAULT_API_BASE = "/api";
const API_STORAGE_KEY = "marketapp.apiBase";

const analyticsEndpoints = {
  "by-session": "/xau/scalp/stats/by-session",
  "by-quality": "/xau/scalp/stats/by-quality",
  "by-adx": "/xau/scalp/stats/by-adx",
  "by-atr": "/xau/scalp/stats/by-atr",
  "by-hour": "/xau/scalp/stats/by-hour",
  tpsl: "/xau/scalp/stats/tpsl",
  "tpsl-by-hour": "/xau/scalp/stats/tpsl-by-hour",
  "tpsl-by-quality": "/xau/scalp/stats/tpsl-by-quality",
  "tpsl-by-session": "/xau/scalp/stats/tpsl-by-session",
  "tpsl-by-adx": "/xau/scalp/stats/tpsl-by-adx",
  "tpsl-by-atr": "/xau/scalp/stats/tpsl-by-atr",
  "by-smart-filter": "/xau/scalp/stats/by-smart-filter"
};

const state = {
  apiBase: localStorage.getItem(API_STORAGE_KEY) || DEFAULT_API_BASE,
  automation: null
};

document.addEventListener("DOMContentLoaded", () => {
  byId("api-base").value = state.apiBase;
  setSuggestedXauSignal();
  bindNavigation();
  bindControls();
  initChartToggle();
  setClock();
  loadAutomation();
  checkHealth();
  refreshOverview();
  setInterval(setClock, 30_000);
});

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      document.querySelectorAll(".view").forEach((section) => {
        section.classList.toggle("is-active", section.id === `view-${view}`);
      });
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.view === view);
      });
    });
  });
}

function bindControls() {
  byId("api-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.apiBase = normalizeApiBase(byId("api-base").value);
    localStorage.setItem(API_STORAGE_KEY, state.apiBase);
    byId("api-base").value = state.apiBase;
    toast("API guardada. Verificando conexión.");
    checkHealth();
    loadAutomation();
    refreshOverview();
  });

  byId("automation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    withButton(event.submitter, saveAutomation);
  });

  byId("refresh-all").addEventListener("click", (event) => withButton(event.currentTarget, refreshOverview));

  byId("xau-predict-now").addEventListener("click", (event) => {
    const signal = byId("xau-auto-signal").value;
    withButton(event.currentTarget, () => createXauSignal(signal));
  });

  document.querySelectorAll("[data-signal]").forEach((button) => {
    button.addEventListener("click", (event) => {
      withButton(event.currentTarget, () => createXauSignal(event.currentTarget.dataset.signal));
    });
  });

  byId("xau-refresh-session").addEventListener("click", (event) => withButton(event.currentTarget, loadXauSession));
  byId("xau-refresh-decision").addEventListener("click", (event) => withButton(event.currentTarget, loadXauDecision));

  byId("market-predict-form").addEventListener("submit", (event) => {
    event.preventDefault();
    withButton(event.submitter, createMarketPrediction);
  });
  byId("market-load-predictions").addEventListener("click", (event) => withButton(event.currentTarget, loadPredictions));
  byId("market-load-stats").addEventListener("click", (event) => withButton(event.currentTarget, loadMarketStats));
  byId("market-load-results").addEventListener("click", (event) => withButton(event.currentTarget, loadMarketResults));
  byId("market-run-backtest").addEventListener("click", (event) => withButton(event.currentTarget, runMarketBacktest));

  document.querySelectorAll("[data-opening-signal]").forEach((button) => {
    button.addEventListener("click", (event) => {
      withButton(event.currentTarget, () => createOpeningSignal(event.currentTarget.dataset.openingSignal));
    });
  });
  byId("opening-load-session").addEventListener("click", (event) => withButton(event.currentTarget, loadOpeningSession));
  byId("opening-load-decision").addEventListener("click", (event) => withButton(event.currentTarget, loadOpeningDecision));

  byId("analytics-load").addEventListener("click", (event) => withButton(event.currentTarget, loadAnalytics));

  byId("backfill-stocks-form").addEventListener("submit", (event) => {
    event.preventDefault();
    withButton(event.submitter, runStocksBackfill);
  });
  byId("backfill-xau-form").addEventListener("submit", (event) => {
    event.preventDefault();
    withButton(event.submitter, runXauBackfill);
  });
  byId("xau-run-backtest").addEventListener("click", (event) => withButton(event.currentTarget, runXauBacktest));
}

async function refreshOverview() {
  await checkHealth();
  drawLocalChart().catch(() => {});

  const [decision, xauStats, predictions] = await Promise.allSettled([
    request("/xau/scalp/decision"),
    request("/xau/scalp/stats"),
    request("/predictions")
  ]);

  if (decision.status === "fulfilled") {
    renderDecision(byId("xau-decision-card"), decision.value, "xau");
    byId("overview-xau-decision").textContent = decision.value.decision || "NEUTRAL";
    byId("overview-xau-detail").textContent =
      `${decision.value.total_signals || 0} señales · confianza ${decision.value.confidence || "N/A"} · entrada ${
        decision.value.should_enter ? "permitida" : "bloqueada"
      }`;
  } else {
    byId("overview-xau-decision").textContent = "Sin sesión";
    byId("overview-xau-detail").textContent = readableError(decision.reason);
  }

  if (xauStats.status === "fulfilled") {
    renderStatsSummary(byId("overview-xau-stats"), xauStats.value.stats || []);
  } else {
    renderEmpty(byId("overview-xau-stats"), readableError(xauStats.reason));
  }

  if (predictions.status === "fulfilled") {
    renderTable(byId("overview-predictions"), predictions.value.predictions || [], [
      "id",
      "symbol",
      "predicted_direction",
      "confidence",
      "entry_price",
      "status",
      "prediction_time"
    ]);
  } else {
    renderEmpty(byId("overview-predictions"), readableError(predictions.reason));
  }
}

async function checkHealth() {
  const status = byId("api-status");
  const title = byId("overview-health-title");
  const copy = byId("overview-health-copy");

  try {
    let healthUrl = apiRoot();
    if (healthUrl === "/") {
      healthUrl = "/health";
    } else if (healthUrl.endsWith("/")) {
      healthUrl = healthUrl + "health";
    } else {
      healthUrl = healthUrl + "/health";
    }
    const response = await fetch(healthUrl);
    const data = await parseResponse(response);
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Backend no disponible");
    }
    status.textContent = "API conectada";
    status.className = "status-pill ok";
    title.textContent = "Backend activo";
    copy.textContent = data.message || "Market API respondiendo correctamente.";
  } catch (error) {
    status.textContent = "API sin conexión";
    status.className = "status-pill error";
    title.textContent = "Sin conexión";
    copy.textContent = readableError(error);
  }
}

async function loadAutomation() {
  try {
    const data = await request("/automation");
    state.automation = data.automation;
    renderAutomationState(data.automation);
  } catch (error) {
    byId("automation-status").textContent = "N/A";
    byId("automation-status").className = "badge error";
  }
}

async function saveAutomation() {
  const payload = {
    auto_evaluate: byId("auto-evaluate").checked,
    auto_predict_xau: byId("auto-predict-xau").checked,
    auto_predict_stocks: byId("auto-predict-stocks").checked,
    xau_horizon_minutes: numberValue("auto-xau-horizon", 30),
    stock_symbols: byId("auto-stock-symbols")
      .value.split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
  };

  const data = await request("/automation", {
    method: "PATCH",
    body: payload
  });

  state.automation = data.automation;
  renderAutomationState(data.automation);
  toast("Automatización guardada.");
}

function renderAutomationState(automation) {
  byId("auto-evaluate").checked = Boolean(automation.auto_evaluate);
  byId("auto-predict-xau").checked = Boolean(automation.auto_predict_xau);
  byId("auto-predict-stocks").checked = Boolean(automation.auto_predict_stocks);
  byId("auto-xau-horizon").value = automation.xau_horizon_minutes || 30;
  byId("auto-stock-symbols").value = (automation.stock_symbols || []).join(",");

  const enabled =
    automation.auto_evaluate ||
    automation.auto_predict_xau ||
    automation.auto_predict_stocks;

  byId("automation-status").textContent = enabled ? "ON" : "OFF";
  byId("automation-status").className = `badge ${enabled ? "ok" : "pending"}`;
}

async function createXauSignal(signal) {
  const horizon = numberValue("xau-horizon", 30);
  const data = await request("/xau/scalp/predict", {
    method: "POST",
    body: { signal, horizon_minutes: horizon }
  });
  renderJson(byId("xau-last-prediction"), data);
  toast(`Señal ${signal} creada.`);
  await Promise.allSettled([loadXauSession(), loadXauDecision()]);
}

async function loadXauSession() {
  const sessionId = byId("xau-session-id").value.trim();
  const data = await request("/xau/scalp/session", {
    query: sessionId ? { session_id: sessionId } : {}
  });
  renderTable(byId("xau-session-table"), data.signals || [], [
    "id",
    "signal_time_label",
    "predicted_direction",
    "probability_buy",
    "probability_sell",
    "trade_quality",
    "trade_score",
    "should_enter",
    "smart_allowed",
    "status"
  ]);
}

async function loadXauDecision() {
  const sessionId = byId("xau-session-id").value.trim();
  const data = await request("/xau/scalp/decision", {
    query: sessionId ? { session_id: sessionId } : {}
  });
  renderDecision(byId("xau-decision-card"), data, "xau");
}

async function createMarketPrediction() {
  const symbol = byId("market-symbol").value.trim();
  if (!symbol) throw new Error("El símbolo es obligatorio.");

  const data = await request("/predict", {
    method: "POST",
    body: { symbol }
  });
  renderJson(byId("market-current"), data);
  toast(`Predicción creada para ${data.symbol || symbol}.`);
}

async function loadPredictions() {
  const symbol = byId("market-symbol").value.trim();
  const data = await request("/predictions", {
    query: symbol ? { symbol } : {}
  });
  renderTable(byId("market-data"), data.predictions || [], [
    "id",
    "symbol",
    "predicted_direction",
    "probability_up",
    "probability_down",
    "confidence",
    "entry_price",
    "status",
    "prediction_time"
  ]);
}

async function loadMarketStats() {
  const symbol = byId("market-symbol").value.trim();
  const data = await request("/stats", {
    query: symbol ? { symbol } : {}
  });
  renderTable(byId("market-data"), data.stats || []);
}

async function loadMarketResults() {
  const symbol = byId("market-symbol").value.trim();
  const data = await request("/results", {
    query: symbol ? { symbol } : {}
  });
  renderTable(byId("market-data"), data.results || []);
}

async function runMarketBacktest() {
  const data = await request("/backtest/run", { method: "POST" });
  renderJson(byId("market-data"), data);
  toast("Backtest general finalizado.");
}

async function createOpeningSignal(signal) {
  const symbol = byId("opening-symbol").value.trim();
  if (!symbol) throw new Error("El símbolo es obligatorio.");

  const data = await request("/opening/predict", {
    method: "POST",
    body: { symbol, signal }
  });
  renderJson(byId("opening-decision"), data);
  toast(`Señal ${signal} creada para ${data.symbol || symbol}.`);
  await Promise.allSettled([loadOpeningSession(), loadOpeningDecision()]);
}

async function loadOpeningSession() {
  const query = openingQuery();
  const data = await request("/opening/session", { query });
  renderTable(byId("opening-session"), data.signals || [], [
    "id",
    "symbol",
    "signal_time_label",
    "predicted_direction",
    "probability_up",
    "probability_down",
    "confidence",
    "entry_price",
    "status"
  ]);
}

async function loadOpeningDecision() {
  const query = openingQuery();
  const data = await request("/opening/decision", { query });
  renderDecision(byId("opening-decision"), data, "opening");
}

async function loadAnalytics() {
  const group = byId("analytics-group").value;
  const endpoint = analyticsEndpoints[group];
  const data = await request(endpoint);
  byId("analytics-title").textContent = labelForGroup(group);
  renderTable(byId("analytics-table"), data.stats || [], analyticsColumns(group));
}

async function runStocksBackfill() {
  const symbols = byId("backfill-symbols")
    .value.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const data = await request("/backfill/stocks", {
    method: "POST",
    body: {
      symbols: symbols.length ? symbols : ["AAPL"],
      days: numberValue("backfill-days", 7),
      stepCandles: numberValue("backfill-step", 4),
      horizonCandles: numberValue("backfill-horizon", 16)
    }
  });
  renderJson(byId("backfill-output"), data);
  toast("Backfill de stocks finalizado.");
}

async function runXauBackfill() {
  const data = await request("/backfill/xau-scalp", {
    method: "POST",
    body: {
      days: numberValue("backfill-xau-days", 7),
      stepCandles: numberValue("backfill-xau-step", 3),
      horizonCandles: numberValue("backfill-xau-horizon", 6)
    }
  });
  renderJson(byId("backfill-output"), data);
  toast("Backfill XAU finalizado.");
}

async function runXauBacktest() {
  const data = await request("/xau/scalp/backtest/run", { method: "POST" });
  renderJson(byId("backfill-output"), data);
  toast("Backtest XAU finalizado.");
}

async function request(path, options = {}) {
  state.apiBase = normalizeApiBase(state.apiBase);
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await parseResponse(response);

  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || response.statusText || "Error de API");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, message: text };
  }
}

function buildUrl(path, query = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams();

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });

  const queryText = params.toString();
  return `${state.apiBase}${cleanPath}${queryText ? `?${queryText}` : ""}`;
}

function normalizeApiBase(value) {
  let base = (value || DEFAULT_API_BASE).trim();

  if (base.startsWith("/")) {
    base = base.replace(/\/+$/, "");
    return base.endsWith("/api") ? base : `${base}/api`;
  }

  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }

  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");

  if (!url.pathname.endsWith("/api")) {
    url.pathname = `${url.pathname}/api`.replace(/\/{2,}/g, "/");
  }

  return url.toString().replace(/\/+$/, "");
}

function apiRoot() {
  const base = normalizeApiBase(state.apiBase);
  if (base.startsWith("/")) return base.replace(/\/api$/, "") || "/";
  return base.replace(/\/api$/, "");
}

function renderDecision(target, data, type) {
  const direction = data.decision || data.predicted_direction || "NEUTRAL";
  const shouldEnter = Boolean(data.should_enter);
  const buyLabel = type === "xau" ? "Compra" : "Sube";
  const sellLabel = type === "xau" ? "Venta" : "Baja";
  const buyValue = type === "xau" ? data.avg_probability_buy : data.avg_probability_up;
  const sellValue = type === "xau" ? data.avg_probability_sell : data.avg_probability_down;

  target.className = "decision-card";
  target.innerHTML = `
    <div class="decision-title">
      <div>
        <p class="eyebrow">${data.symbol || "Símbolo"}</p>
        <h4>${escapeHtml(direction)}</h4>
      </div>
      <span class="badge ${badgeClass(direction)}">${shouldEnter ? "Entrada permitida" : "Sin entrada"}</span>
    </div>
    <div class="metric-grid">
      ${metric("Confianza", data.confidence || "N/A")}
      ${metric("Señales", data.total_signals ?? 0)}
      ${metric("Score", data.avg_trade_score ?? "N/A")}
    </div>
    <div class="bars">
      ${bar(buyLabel, buyValue || 0)}
      ${bar(sellLabel, sellValue || 0)}
    </div>
  `;
}

function renderStatsSummary(target, rows) {
  if (!rows.length) {
    renderEmpty(target, "No hay estadísticas disponibles.");
    return;
  }

  const first = rows[0];
  target.className = "metric-grid";
  target.innerHTML = `
    ${metric("Predicciones", first.total_predictions ?? first.total ?? rows.length)}
    ${metric("Win rate", percent(first.win_rate ?? first.real_win_rate))}
    ${metric("Pips reales", first.total_real_pips ?? first.total_pips ?? "N/A")}
  `;
}

function renderTable(target, rows, preferredColumns) {
  if (!rows.length) {
    renderEmpty(target, "No hay registros para mostrar.");
    return;
  }

  const columns = preferredColumns?.length ? preferredColumns : Object.keys(rows[0]);
  const visibleColumns = columns.filter((column) => rows.some((row) => row[column] !== undefined));

  target.className = "table-wrap";
  target.innerHTML = `
    <table>
      <thead>
        <tr>${visibleColumns.map((column) => `<th>${escapeHtml(headerLabel(column))}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                ${visibleColumns.map((column) => `<td>${formatCell(row[column], column)}</td>`).join("")}
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderJson(target, data) {
  target.className = "";
  target.innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

function renderEmpty(target, message) {
  target.className = "empty-state";
  target.textContent = message;
}

function metric(label, value) {
  return `
    <div class="metric">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(String(value ?? "N/A"))}</strong>
    </div>
  `;
}

function bar(label, value) {
  const numeric = clamp(Number(value) || 0, 0, 100);
  return `
    <div class="bar-row">
      <div class="bar-label">
        <span>${escapeHtml(label)}</span>
        <span>${numeric.toFixed(2)}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width: ${numeric}%"></div></div>
    </div>
  `;
}

async function withButton(button, task) {
  if (!button) {
    try {
      await task();
    } catch (error) {
      toast(readableError(error), true);
    }
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Procesando...";

  try {
    await task();
  } catch (error) {
    toast(readableError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function openingQuery() {
  const symbol = byId("opening-symbol").value.trim();
  const date = byId("opening-date").value;
  if (!symbol) throw new Error("El símbolo es obligatorio.");
  return date ? { symbol, date } : { symbol };
}

function numberValue(id, fallback) {
  const value = Number(byId(id).value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function setSuggestedXauSignal() {
  const select = byId("xau-auto-signal");
  if (!select) return;

  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      minute: "2-digit"
    }).format(new Date())
  );

  const elapsed = minute % 15;
  if (elapsed < 5) select.value = "SCALP_000";
  else if (elapsed < 10) select.value = "SCALP_005";
  else select.value = "SCALP_010";
}

function analyticsColumns(group) {
  const tpSlColumns = [
    "first_hit",
    "total",
    "avg_real_pips",
    "total_real_pips",
    "positive_trades",
    "negative_trades",
    "real_win_rate",
    "avg_minutes_to_first_hit"
  ];

  if (group === "tpsl") return tpSlColumns;
  if (group.startsWith("tpsl-by-")) return ["group_value", ...tpSlColumns];
  return undefined;
}

function labelForGroup(group) {
  const labels = {
    "by-session": "Por sesión",
    "by-quality": "Por calidad",
    "by-adx": "Por ADX",
    "by-atr": "Por ATR",
    "by-hour": "Por hora",
    tpsl: "TP / SL",
    "tpsl-by-hour": "TP / SL por hora",
    "tpsl-by-quality": "TP / SL por calidad",
    "tpsl-by-session": "TP / SL por sesión",
    "tpsl-by-adx": "TP / SL por ADX",
    "tpsl-by-atr": "TP / SL por ATR",
    "by-smart-filter": "Smart filter"
  };
  return labels[group] || group;
}

function headerLabel(value) {
  return value.replaceAll("_", " ");
}

function formatCell(value, column) {
  if (value === null || value === undefined) return '<span class="subtle">—</span>';
  if (typeof value === "boolean") return `<span class="badge ${value ? "ok" : "error"}">${value ? "Sí" : "No"}</span>`;
  if (column?.includes("direction") || column === "status") {
    return `<strong>${escapeHtml(String(value))}</strong>`;
  }
  if (typeof value === "number") return escapeHtml(Number.isInteger(value) ? String(value) : value.toFixed(4));
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  if (String(value).match(/^\d{4}-\d{2}-\d{2}T/)) return escapeHtml(new Date(value).toLocaleString("es-CO"));
  return escapeHtml(String(value));
}

function badgeClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (["buy", "sube"].includes(normalized)) return normalized;
  if (["sell", "baja"].includes(normalized)) return normalized;
  return "neutral";
}

function percent(value) {
  if (value === null || value === undefined) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setClock() {
  byId("clock").textContent = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  }).format(new Date());
}

function toast(message, isError = false) {
  const element = byId("toast");
  element.textContent = message;
  element.className = `toast${isError ? " error" : ""}`;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.hidden = true;
  }, 4_200);
}

function readableError(error) {
  if (!error) return "Error desconocido.";
  if (error.data?.error) return error.data.error;
  return error.message || String(error);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function byId(id) {
  return document.getElementById(id);
}

const chartState = {
  allCandles: [],
  predictions: [],
  visibleCount: 120,
  scrollOffset: 0,
  isDragging: false,
  startX: 0,
  startOffset: 0
};

const defaultSymbols = [
  { value: "XAUUSD", label: "XAU/USD (Oro)" },
  { value: "AAPL", label: "AAPL (Apple)" },
  { value: "GOOGL", label: "GOOGL (Google)" },
  { value: "MSFT", label: "MSFT (Microsoft)" }
];

function getSavedSymbols() {
  const saved = localStorage.getItem("marketapp_symbols");
  if (saved) {
    try { return JSON.parse(saved); } catch (e) {}
  }
  return defaultSymbols;
}

function saveSymbols(symbols) {
  localStorage.setItem("marketapp_symbols", JSON.stringify(symbols));
}

function populateSymbolSelect(selectedValue) {
  const select = byId("chart-symbol-select");
  if (!select) return;
  const symbols = getSavedSymbols();
  select.innerHTML = symbols
    .map(s => `<option value="${s.value}">${s.label}</option>`)
    .join("");
  if (selectedValue) {
    select.value = selectedValue;
  }
}

let activeChartInstance = null;

function updateTradingViewIframe(symbol) {
  const container = byId("container-chart-tv");
  if (!container) return;
  let tvSymbol = "";
  if (symbol === "XAUUSD" || symbol === "GC=F") {
    tvSymbol = "FX:XAUUSD";
  } else {
    tvSymbol = `NASDAQ:${symbol}`;
  }
  const iframe = container.querySelector("iframe");
  if (iframe) {
    iframe.src = `https://www.tradingview.com/widgetembed/?symbol=${tvSymbol}&interval=5&theme=dark&style=1&timezone=Etc%2FUTC&locale=es&enablepublishing=false&allowsymbolchange=true&hidesidetoolbar=false`;
  }
}

function initChartToggle() {
  const btnLocal = byId("btn-chart-local");
  const btnTv = byId("btn-chart-tv");
  const containerLocal = byId("container-chart-local");
  const containerTv = byId("container-chart-tv");
  const symbolSelect = byId("chart-symbol-select");
  const btnAdd = byId("btn-add-symbol");
  const btnRemove = byId("btn-remove-symbol");

  if (!btnLocal || !btnTv) return;

  populateSymbolSelect();

  btnLocal.addEventListener("click", () => {
    btnLocal.classList.add("is-active");
    btnTv.classList.remove("is-active");
    containerLocal.style.display = "flex";
    containerTv.style.display = "none";
    drawLocalChart();
  });

  btnTv.addEventListener("click", () => {
    btnTv.classList.add("is-active");
    btnLocal.classList.remove("is-active");
    containerTv.style.display = "block";
    containerLocal.style.display = "none";
  });

  if (symbolSelect) {
    symbolSelect.addEventListener("change", (e) => {
      const symbol = e.target.value;
      updateTradingViewIframe(symbol);
      drawLocalChart();
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      const sym = window.prompt("Introduce el símbolo del instrumento (ej: TSLA, GC=F, EURUSD):");
      if (!sym) return;
      const cleanSym = sym.toUpperCase().trim();
      const label = window.prompt("Introduce el nombre visible (ej: Tesla, EUR/USD):", cleanSym);
      if (!label) return;

      const symbols = getSavedSymbols();
      if (symbols.some(s => s.value === cleanSym)) {
        alert("Este instrumento ya existe.");
        return;
      }

      symbols.push({ value: cleanSym, label });
      saveSymbols(symbols);
      populateSymbolSelect(cleanSym);

      updateTradingViewIframe(cleanSym);
      drawLocalChart();
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener("click", () => {
      if (!symbolSelect) return;
      const currentVal = symbolSelect.value;
      if (currentVal === "XAUUSD") {
        alert("No se puede eliminar el Oro (XAUUSD), es el activo base del sistema.");
        return;
      }

      const symbols = getSavedSymbols().filter(s => s.value !== currentVal);
      saveSymbols(symbols);
      populateSymbolSelect("XAUUSD");

      updateTradingViewIframe("XAUUSD");
      drawLocalChart();
    });
  }
}

async function drawLocalChart() {
  const container = byId("local-chart-svg-container");
  if (!container) return;

  const symbolSelect = byId("chart-symbol-select");
  const symbol = symbolSelect ? symbolSelect.value : "XAUUSD";

  try {
    if (typeof LightweightCharts === "undefined") {
      container.innerHTML = `<div class="empty-state" style="color: #ef5350;">La librería TradingView local no está cargada. Por favor refresca la página.</div>`;
      return;
    }

    const data = await request(`/xau/candles?days=7&symbol=${symbol}`);
    if (!data?.ok || !data?.candles?.length) {
      container.innerHTML = `<div class="empty-state">No hay suficientes datos históricos para renderizar.</div>`;
      return;
    }

    // Clean container and destroy previous instance if it exists
    if (activeChartInstance) {
      try {
        activeChartInstance.remove();
      } catch (e) {
        console.error("Error removing previous chart instance:", e);
      }
      activeChartInstance = null;
    }
    container.innerHTML = "";

    const candles = data.candles;
    const latestPrice = candles[candles.length - 1].close;
    const priceDisplay = byId("local-chart-price");
    if (priceDisplay) {
      priceDisplay.textContent = `$${latestPrice.toFixed(2)} USD`;
    }

    // Create TradingView Lightweight Chart
    const chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#121212' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e1e1e' },
        horzLines: { color: '#1e1e1e' },
      },
      rightPriceScale: {
        borderColor: '#2b2b43',
      },
      timeScale: {
        borderColor: '#2b2b43',
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight || 350
    });

    activeChartInstance = chart;

    const candlestickSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    const chartData = candles.map(c => ({
      time: Math.floor(new Date(c.date).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));

    candlestickSeries.setData(chartData);

    // Map predictions to series markers (deduplicating to prevent overlapping labels)
    const uniqueMarkers = new Map();
    const predictions = data.predictions || [];

    predictions.forEach(p => {
      const predTime = Math.floor(new Date(p.prediction_time).getTime() / 1000);
      let closestTime = null;
      let minDiff = Infinity;
      chartData.forEach(cd => {
        const diff = Math.abs(cd.time - predTime);
        if (diff < minDiff && diff <= 10 * 60) {
          minDiff = diff;
          closestTime = cd.time;
        }
      });

      if (closestTime !== null) {
        const key = `${closestTime}_entry`;
        if (p.smart_allowed) {
          // Allowed entry takes priority (priority: 2)
          uniqueMarkers.set(key, {
            time: closestTime,
            position: 'belowBar',
            color: '#26a69a',
            shape: 'arrowUp',
            text: `${p.predicted_direction} (Allowed)`,
            priority: 2
          });

          if (p.exit_time) {
            const exitTime = Math.floor(new Date(p.exit_time).getTime() / 1000);
            let closestExitTime = null;
            let minExitDiff = Infinity;
            chartData.forEach(cd => {
              const diff = Math.abs(cd.time - exitTime);
              if (diff < minExitDiff && diff <= 15 * 60) {
                minExitDiff = diff;
                closestExitTime = cd.time;
              }
            });

            if (closestExitTime !== null) {
              const exitKey = `${closestExitTime}_exit`;
              const pips = p.pips_result !== null ? Number(p.pips_result).toFixed(1) : "";
              const formattedPips = pips ? (p.pips_result >= 0 ? `+${pips}` : pips) : "";
              uniqueMarkers.set(exitKey, {
                time: closestExitTime,
                position: 'aboveBar',
                color: p.pips_result >= 0 ? '#26a69a' : '#ef5350',
                shape: 'arrowDown',
                text: `${formattedPips} p`,
                priority: 2
              });
            }
          }
        } else {
          // Blocked entry has lower priority (priority: 1), only set if not already set by an Allowed prediction
          const existing = uniqueMarkers.get(key);
          if (!existing || existing.priority < 2) {
            uniqueMarkers.set(key, {
              time: closestTime,
              position: 'belowBar',
              color: '#555555',
              shape: 'circle',
              text: 'Blocked',
              priority: 1
            });
          }
        }
      }
    });

    const markers = Array.from(uniqueMarkers.values());
    markers.sort((a, b) => a.time - b.time);
    LightweightCharts.createSeriesMarkers(candlestickSeries, markers);

    // Auto-fit content
    chart.timeScale().fitContent();

    // Re-adjust size on window resize
    window.addEventListener("resize", () => {
      if (activeChartInstance) {
        activeChartInstance.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight || 350
        });
      }
    });

  } catch (error) {
    container.innerHTML = `<div class="empty-state" style="color: #ef5350;">Error al cargar datos del gráfico: ${error.message}</div>`;
  }
}
