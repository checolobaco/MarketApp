// Terminal frontend client for XPRO API (XBTFX)
let xproToken = localStorage.getItem("xpro_token") || null;
let selectedSymbol = null;
let cachedSymbols = [];

// DOM Elements
const authForm = document.getElementById("xpro-login-form");
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const tokenInput = document.getElementById("xpro-token");

const sessionStatusText = document.getElementById("session-status-text");
const sessionStatusDot = document.getElementById("session-status-dot");
const btnRefreshData = document.getElementById("btn-refresh-data");

const accountPanel = document.getElementById("account-panel");
const accBalance = document.getElementById("acc-balance");
const accEquity = document.getElementById("acc-equity");
const accMargin = document.getElementById("acc-margin");
const accUnrealizedPnl = document.getElementById("acc-unrealized-pnl");
const accLeverage = document.getElementById("acc-leverage");

const marketSelect = document.getElementById("market-select");
const marketSearchQuery = document.getElementById("market-search-query");
const btnSearchMarkets = document.getElementById("btn-search-markets");
const marketsTableBody = document.getElementById("markets-table-body");

const selectedMarketArea = document.getElementById("selected-market-area");
const selectedMarketName = document.getElementById("selected-market-name");
const selectedMarketSpecs = document.getElementById("selected-market-specs");

const quoteBid = document.getElementById("quote-bid");
const quoteAsk = document.getElementById("quote-ask");
const symbolVolume = document.getElementById("symbol-volume");

const orderVolume = document.getElementById("order-volume");
const orderSL = document.getElementById("order-sl");
const orderTP = document.getElementById("order-tp");

const btnOrderBuy = document.getElementById("btn-order-buy");
const btnOrderSell = document.getElementById("btn-order-sell");

const positionsSection = document.getElementById("positions-section");
const positionsTableBody = document.getElementById("positions-table-body");

const ordersSection = document.getElementById("orders-section");
const ordersTableBody = document.getElementById("orders-table-body");

const historySection = document.getElementById("history-section");
const historyTableBody = document.getElementById("history-table-body");

// Prediction Elements
const btnRunPrediction = document.getElementById("btn-run-prediction");
const btnRunScalpPrediction = document.getElementById("btn-run-scalp-prediction");
const autoTradeSignals = document.getElementById("auto-trade-signals");
const xproAutoPredict = document.getElementById("xpro-auto-predict");
const xproAutoEvaluate = document.getElementById("xpro-auto-evaluate");
const btnSaveAutomation = document.getElementById("btn-save-automation");
const activeAutomationsList = document.getElementById("active-automations-list");
const predictionResultPanel = document.getElementById("prediction-result-panel");
const predDirectionCard = document.getElementById("pred-direction-card");
const predConfidenceTag = document.getElementById("pred-confidence-tag");
const predDirection = document.getElementById("pred-direction");
const predProbabilities = document.getElementById("pred-probabilities");
const predSuggestedPrices = document.getElementById("pred-suggested-prices");
const predSummary = document.getElementById("pred-summary");
const predReasons = document.getElementById("pred-reasons");
const predRisks = document.getElementById("pred-risks");

// Modification Modal Elements
const modifyModal = document.getElementById("modify-modal");
const modifyDesc = document.getElementById("modify-desc");
const modifyPositionId = document.getElementById("modify-position-id");
const modifySLInput = document.getElementById("modify-sl");
const modifyTPInput = document.getElementById("modify-tp");
const btnModifyCancel = document.getElementById("btn-modify-cancel");
const modifyForm = document.getElementById("modify-form");

// Backend API URL Helper
function getApiUrl(path) {
  const apiBase = localStorage.getItem("api-base") || window.location.origin;
  return `${apiBase}${path}`;
}

// Request Headers Helper
function getHeaders() {
  return {
    "Content-Type": "application/json",
    "x-xpro-token": xproToken
  };
}

// Show/Hide toast message
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "danger" : "success"}`;
  toast.innerText = message;
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.padding = "12px 24px";
  toast.style.borderRadius = "8px";
  toast.style.background = type === "error" ? "#e74c3c" : "#2ecc71";
  toast.style.color = "#fff";
  toast.style.fontWeight = "bold";
  toast.style.zIndex = "1000";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Initial Load
document.addEventListener("DOMContentLoaded", () => {
  // Restore saved API Key
  tokenInput.value = localStorage.getItem("xpro_token_saved") || "";

  updateSessionUI();
  if (xproToken) {
    loadAllData();
  }
});

// Update UI state based on session status
function updateSessionUI() {
  if (xproToken) {
    sessionStatusText.innerText = "Conectado";
    sessionStatusDot.className = "status-dot connected";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "block";
    btnRefreshData.style.display = "inline-block";
    accountPanel.style.display = "block";
    positionsSection.style.display = "block";
    ordersSection.style.display = "block";
    historySection.style.display = "block";
    tokenInput.disabled = true;
    marketSelect.style.display = "block";
  } else {
    sessionStatusText.innerText = "Desconectado";
    sessionStatusDot.className = "status-dot disconnected";
    btnConnect.style.display = "block";
    btnDisconnect.style.display = "none";
    btnRefreshData.style.display = "none";
    accountPanel.style.display = "none";
    positionsSection.style.display = "none";
    ordersSection.style.display = "none";
    historySection.style.display = "none";
    selectedMarketArea.style.display = "none";
    marketSelect.style.display = "none";
    tokenInput.disabled = false;
  }
}

// Connect Account Form Handler
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = tokenInput.value.trim();

  try {
    const response = await fetch(getApiUrl("/api/xpro/auth/status"), {
      headers: { "x-xpro-token": token }
    });
    const result = await response.json();

    if (result.ok && (result.data.status === "authorized" || result.data.status === "active")) {
      xproToken = token;
      localStorage.setItem("xpro_token", token);
      localStorage.setItem("xpro_token_saved", token);
      showToast("Conexión con XPRO establecida exitosamente");
      updateSessionUI();
      loadAllData();
    } else {
      throw new Error(result.error || "Fallo en la autenticación del token");
    }
  } catch (error) {
    console.error(error);
    showToast("Error al conectar: " + error.message, "error");
  }
});

// Disconnect Account Handler
btnDisconnect.addEventListener("click", () => {
  xproToken = null;
  localStorage.removeItem("xpro_token");
  showToast("Cuenta desconectada");
  updateSessionUI();
});

// Refresh All Data button
btnRefreshData.addEventListener("click", loadAllData);

// Load all account and operation info
function loadAllData() {
  loadAccountDetails();
  loadSymbols();
  loadPositions();
  loadOrders();
  loadHistory();
  loadAutomationSettings();
  if (selectedSymbol) {
    selectSymbol(selectedSymbol);
  }
}

let localAutomationList = [];

// Load Automation Settings
async function loadAutomationSettings() {
  try {
    const response = await fetch(getApiUrl("/api/automation"));
    const result = await response.json();
    if (result.ok && result.automation) {
      localAutomationList = result.automation.xpro_automation_list || [];
      renderAutomationList();
      updateCheckboxesForSelectedSymbol();
    }
  } catch (error) {
    console.error("Error al cargar configuración de automatización:", error);
  }
}

function updateCheckboxesForSelectedSymbol() {
  if (!selectedSymbol) return;
  const entry = localAutomationList.find(item => item.symbol.toUpperCase() === selectedSymbol.toUpperCase());
  if (entry) {
    xproAutoPredict.checked = entry.auto_predict;
    xproAutoEvaluate.checked = entry.auto_evaluate;
  } else {
    xproAutoPredict.checked = false;
    xproAutoEvaluate.checked = false;
  }
}

function renderAutomationList() {
  if (!activeAutomationsList) return;
  if (localAutomationList.length === 0) {
    activeAutomationsList.innerHTML = `
      <tr>
        <td colspan="4" class="muted" style="padding: 12px; text-align: center;">No hay instrumentos automatizados activos</td>
      </tr>
    `;
    return;
  }

  activeAutomationsList.innerHTML = localAutomationList.map(item => {
    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: bold; color: #fff;">${item.symbol}</td>
        <td style="padding: 8px 12px;">${item.auto_predict ? '<span class="badge-buy" style="font-size:10px; padding: 2px 6px;">ACTIVO</span>' : '<span class="muted" style="font-size:10px;">INACTIVO</span>'}</td>
        <td style="padding: 8px 12px;">${item.auto_evaluate ? '<span class="badge-buy" style="font-size:10px; padding: 2px 6px;">ACTIVO</span>' : '<span class="muted" style="font-size:10px;">INACTIVO</span>'}</td>
        <td style="padding: 8px 12px; text-align: right;">
          <button class="button danger" style="padding: 2px 8px; font-size: 11px; height: 22px; line-height: 1;" onclick="deactivateAutomation('${item.symbol}')">Desactivar</button>
        </td>
      </tr>
    `;
  }).join("");
}

// Function to deactivate automation for a symbol
window.deactivateAutomation = async function(symbol) {
  if (!confirm(`¿Desea desactivar la automatización para ${symbol}?`)) return;
  localAutomationList = localAutomationList.filter(item => item.symbol.toUpperCase() !== symbol.toUpperCase());
  await saveAutomationSettings(localAutomationList, false);
};

// Save Automation Settings
async function saveAutomationSettings(customList = null, silent = false) {
  try {
    const listToSave = customList || getUpdatedListFromUI();
    const response = await fetch(getApiUrl("/api/automation"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        xpro_automation_list: listToSave,
        xpro_auto_predict: listToSave.some(item => item.auto_predict),
        xpro_auto_evaluate: listToSave.some(item => item.auto_evaluate)
      })
    });
    const result = await response.json();
    if (result.ok) {
      localAutomationList = result.automation.xpro_automation_list || [];
      renderAutomationList();
      updateCheckboxesForSelectedSymbol();
      if (!silent) {
        showToast("Configuración de automatización guardada");
      }
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    if (!silent) {
      showToast("Error al guardar automatización: " + error.message, "error");
    }
  }
}

function getUpdatedListFromUI() {
  if (!selectedSymbol) return localAutomationList;
  const symbol = selectedSymbol.toUpperCase();
  const auto_predict = xproAutoPredict.checked;
  const auto_evaluate = xproAutoEvaluate.checked;

  if (!auto_predict && !auto_evaluate) {
    return localAutomationList.filter(item => item.symbol.toUpperCase() !== symbol);
  }

  const updatedList = [...localAutomationList];
  const idx = updatedList.findIndex(item => item.symbol.toUpperCase() === symbol);
  if (idx > -1) {
    updatedList[idx] = { symbol, auto_predict, auto_evaluate };
  } else {
    updatedList.push({ symbol, auto_predict, auto_evaluate });
  }
  return updatedList;
}

btnSaveAutomation.addEventListener("click", () => saveAutomationSettings(null, false));

// Load List of Symbols
async function loadSymbols() {
  try {
    const response = await fetch(getApiUrl("/api/xpro/symbols"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && result.data && Array.isArray(result.data.symbols)) {
      cachedSymbols = result.data.symbols;
      // Sort symbols alphabetically
      cachedSymbols.sort((a, b) => a.name.localeCompare(b.name));

      // Populate dropdown
      marketSelect.innerHTML = `<option value="">-- Selecciona un Instrumento --</option>` + 
        cachedSymbols.map(s => `<option value="${s.name}">${s.name} (${s.bid ? s.bid + '/' + s.ask : 'Activo'})</option>`).join("");
    }
  } catch (error) {
    console.error("Error al cargar listado de símbolos:", error);
  }
}

// Bind dropdown selection
marketSelect.addEventListener("change", () => {
  const symbol = marketSelect.value;
  if (symbol) {
    marketSearchQuery.value = symbol;
    selectSymbol(symbol);
  }
});

// Load Account Summary
async function loadAccountDetails() {
  try {
    const response = await fetch(getApiUrl("/api/xpro/account"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && result.data) {
      const acc = result.data;
      accBalance.innerText = `$${Number(acc.balance).toFixed(2)}`;
      accEquity.innerText = `$${Number(acc.equity).toFixed(2)}`;
      accMargin.innerText = `$${Number(acc.margin).toFixed(2)} / $${Number(acc.freeMargin).toFixed(2)}`;
      
      const pnl = Number(acc.floatingPnl || 0);
      accUnrealizedPnl.innerText = `$${pnl.toFixed(2)}`;
      accUnrealizedPnl.style.color = pnl >= 0 ? "#2ecc71" : "#e74c3c";
      accLeverage.innerText = `1:${acc.leverage || 'N/A'}`;
    }
  } catch (error) {
    console.error("Error al cargar resumen de cuenta:", error);
  }
}

// Search & details of symbol
btnSearchMarkets.addEventListener("click", () => {
  const query = marketSearchQuery.value.trim().toUpperCase();
  if (query) {
    selectSymbol(query);
  }
});

function getTradingViewSymbol(symbol) {
  const s = symbol.toUpperCase().replace("/", "").trim();
  // Forex majors
  if (["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD"].includes(s)) {
    return `FX:${s}`;
  }
  // Commodities
  if (s === "XAUUSD" || s === "GOLD") return "FX:XAUUSD";
  if (s === "XAGUSD" || s === "SILVER") return "FX:XAGUSD";
  if (s === "USOIL" || s === "WTI") return "FX:USOIL";
  if (s === "UKOIL" || s === "BRENT") return "FX:UKOIL";
  
  // Crypto
  if (s.startsWith("BTC")) return "BINANCE:BTCUSDT";
  if (s.startsWith("ETH")) return "BINANCE:ETHUSDT";
  if (s.startsWith("SOL")) return "BINANCE:SOLUSDT";
  if (s.startsWith("ADA")) return "BINANCE:ADAUSDT";
  if (s.startsWith("XRP")) return "BINANCE:XRPUSDT";
  if (s.endsWith("USD") && s.length > 5) {
    const coin = s.replace("USD", "");
    return `BINANCE:${coin}USDT`;
  }

  // Stocks
  if (["AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA"].includes(s)) {
    return `NASDAQ:${s}`;
  }
  return s;
}

async function selectSymbol(symbolName) {
  try {
    const symbolData = cachedSymbols.find(s => s.name.toUpperCase() === symbolName.toUpperCase());

    if (symbolData) {
      selectedSymbol = symbolData.name;
      updateCheckboxesForSelectedSymbol();

      // Render Selected Market
      selectedMarketName.innerText = selectedSymbol;
      selectedMarketSpecs.innerText = `Tamaño contrato: ${symbolData.contract_size || 'N/A'} | Modo: ${symbolData.trade_mode || 'N/A'}`;
      
      const digits = symbolData.digits !== undefined ? symbolData.digits : 2;
      quoteBid.innerText = symbolData.bid ? Number(symbolData.bid).toFixed(digits) : "--";
      quoteAsk.innerText = symbolData.ask ? Number(symbolData.ask).toFixed(digits) : "--";
      symbolVolume.innerText = `Precisión dígitos: ${digits} | Spread: ${symbolData.spread !== undefined ? symbolData.spread : 'N/A'}`;
      
      // Update TradingView Chart Iframe
      const tvIframe = document.getElementById("tv-chart-iframe");
      if (tvIframe) {
        const tvSymbol = getTradingViewSymbol(selectedSymbol);
        tvIframe.src = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=15&theme=dark&style=1&timezone=Etc%2FUTC&locale=es&enablepublishing=false&allowsymbolchange=true&hidesidetoolbar=false`;
      }

      // Update Local Interactive Candlestick Chart
      loadLocalCandleChart(selectedSymbol);

      selectedMarketArea.style.display = "block";

      // Render search list row
      marketsTableBody.innerHTML = `
        <tr class="clickable-row">
          <td style="padding: 12px; font-weight: bold;">${selectedSymbol}</td>
          <td style="padding: 12px;">${symbolData.bid || '--'} / ${symbolData.ask || '--'}</td>
          <td style="padding: 12px;"><span class="badge-buy">Activo</span></td>
        </tr>
      `;
    } else {
      throw new Error("Instrumento no encontrado en el listado cargado.");
    }
  } catch (error) {
    showToast("Error al buscar instrumento: " + error.message, "error");
  }
}

// Place Trades
btnOrderBuy.addEventListener("click", () => executeOrder("BUY"));
btnOrderSell.addEventListener("click", () => executeOrder("SELL"));

async function executeOrder(direction) {
  if (!selectedSymbol) return;

  const volume = Number(orderVolume.value);
  const sl = orderSL.value ? Number(orderSL.value) : null;
  const tp = orderTP.value ? Number(orderTP.value) : null;

  try {
    const response = await fetch(getApiUrl("/api/xpro/trade"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedSymbol,
        action: direction,
        volume,
        type: "MARKET",
        sl,
        tp
      })
    });
    const result = await response.json();

    if (result.ok) {
      showToast(`Orden de ${direction} ejecutada exitosamente`);
      orderSL.value = "";
      orderTP.value = "";
      loadAllData();
    } else {
      throw new Error(result.error || "Fallo en la ejecución de la orden");
    }
  } catch (error) {
    showToast("Error al ejecutar orden: " + error.message, "error");
  }
}

// Load Open Positions
async function loadPositions() {
  try {
    const response = await fetch(getApiUrl("/api/xpro/positions"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && Array.isArray(result.data)) {
      if (result.data.length === 0) {
        positionsTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="muted" style="padding: 16px; text-align: center;">
              No hay posiciones abiertas
            </td>
          </tr>
        `;
        return;
      }

      positionsTableBody.innerHTML = result.data.map(pos => {
        const typeBadge = pos.action.toUpperCase() === "BUY" ? '<span class="badge-buy">COMPRA</span>' : '<span class="badge-sell">VENTA</span>';
        const pnl = Number(pos.pnl || 0);
        const pnlColor = pnl >= 0 ? "#2ecc71" : "#e74c3c";
        
        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px;">${pos.positionId || pos.id}</td>
            <td style="padding: 12px; font-weight: bold;">${pos.symbol}</td>
            <td style="padding: 12px;">${typeBadge}</td>
            <td style="padding: 12px;">${pos.volume}</td>
            <td style="padding: 12px;">${pos.entryPrice}</td>
            <td style="padding: 12px; font-size: 0.9em;">
              SL: ${pos.sl || 'Sin SL'}<br>
              TP: ${pos.tp || 'Sin TP'}
            </td>
            <td style="padding: 12px; font-weight: bold; color: ${pnlColor};">$${pnl.toFixed(2)}</td>
            <td style="padding: 12px; display: flex; gap: 8px;">
              <button class="button secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openModifyModal('${pos.positionId || pos.id}', '${pos.symbol}', ${pos.sl || 0}, ${pos.tp || 0})">Modificar</button>
              <button class="button danger" style="padding: 4px 8px; font-size: 11px;" onclick="closePosition('${pos.positionId || pos.id}', ${pos.volume})">Cerrar</button>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Error al cargar posiciones:", error);
  }
}

// Load Pending Orders
async function loadOrders() {
  try {
    const response = await fetch(getApiUrl("/api/xpro/orders"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && Array.isArray(result.data)) {
      if (result.data.length === 0) {
        ordersTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="muted" style="padding: 16px; text-align: center;">
              No hay órdenes pendientes
            </td>
          </tr>
        `;
        return;
      }

      ordersTableBody.innerHTML = result.data.map(ord => {
        const typeBadge = ord.action.toUpperCase() === "BUY" ? '<span class="badge-buy">COMPRA</span>' : '<span class="badge-sell">VENTA</span>';
        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px;">${ord.orderId || ord.id}</td>
            <td style="padding: 12px; font-weight: bold;">${ord.symbol}</td>
            <td style="padding: 12px;">${typeBadge} (${ord.type})</td>
            <td style="padding: 12px;">${ord.volume}</td>
            <td style="padding: 12px;">${ord.price || '--'}</td>
            <td style="padding: 12px; font-size: 0.9em;">
              SL: ${ord.sl || 'Sin SL'}<br>
              TP: ${ord.tp || 'Sin TP'}
            </td>
            <td style="padding: 12px;">
              <button class="button danger" style="padding: 4px 8px; font-size: 11px;" onclick="cancelPendingOrder('${ord.orderId || ord.id}')">Cancelar</button>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Error al cargar órdenes pendientes:", error);
  }
}

// Load Deal History
async function loadHistory() {
  try {
    const response = await fetch(getApiUrl("/api/xpro/history"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && Array.isArray(result.data)) {
      if (result.data.length === 0) {
        historyTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="muted" style="padding: 16px; text-align: center;">
              No hay historial de tratos
            </td>
          </tr>
        `;
        return;
      }

      historyTableBody.innerHTML = result.data.map(deal => {
        const dirBadge = deal.action.toUpperCase() === "BUY" ? '<span class="badge-buy">COMPRA</span>' : '<span class="badge-sell">VENTA</span>';
        const pnl = Number(deal.pnl || 0);
        const pnlColor = pnl >= 0 ? "#2ecc71" : "#e74c3c";
        
        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px;">${deal.dealId || deal.id}</td>
            <td style="padding: 12px; font-weight: bold;">${deal.symbol}</td>
            <td style="padding: 12px;">${dirBadge}</td>
            <td style="padding: 12px;">${deal.volume}</td>
            <td style="padding: 12px;">${deal.price}</td>
            <td style="padding: 12px; font-size: 0.85em;">${new Date(deal.timestamp).toLocaleString()}</td>
            <td style="padding: 12px; font-size: 0.85em;">C: ${deal.commission || 0} | S: ${deal.swap || 0}</td>
            <td style="padding: 12px; font-weight: bold; color: ${pnlColor};">$${pnl.toFixed(2)}</td>
          </tr>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Error al cargar historial de tratos:", error);
  }
}

// Close open position
window.closePosition = async function(positionId, volume) {
  if (!confirm(`¿Está seguro de que desea cerrar la posición #${positionId}?`)) return;

  try {
    const response = await fetch(getApiUrl("/api/xpro/close_position"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ positionId, volume })
    });
    const result = await response.json();

    if (result.ok) {
      showToast("Posición cerrada con éxito");
      loadAllData();
    } else {
      throw new Error(result.error || "Error al cerrar posición");
    }
  } catch (error) {
    showToast("Error al cerrar posición: " + error.message, "error");
  }
};

// Open SL/TP Modification Modal
window.openModifyModal = function(positionId, symbol, sl, tp) {
  modifyPositionId.value = positionId;
  modifySLInput.value = sl || "";
  modifyTPInput.value = tp || "";
  modifyDesc.innerText = `Modificar parámetros de posición #${positionId} para ${symbol}`;
  modifyModal.style.display = "flex";
};

// Close SL/TP Modification Modal
btnModifyCancel.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

// Modify position form submit
modifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const positionId = modifyPositionId.value;
  const sl = modifySLInput.value ? Number(modifySLInput.value) : null;
  const tp = modifyTPInput.value ? Number(modifyTPInput.value) : null;

  try {
    const response = await fetch(getApiUrl("/api/xpro/modify_position"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ positionId, sl, tp })
    });
    const result = await response.json();

    if (result.ok) {
      showToast("Posición modificada exitosamente");
      modifyModal.style.display = "none";
      loadAllData();
    } else {
      throw new Error(result.error || "Fallo al modificar posición");
    }
  } catch (error) {
    showToast("Error: " + error.message, "error");
  }
});

// Run AI prediction handler
btnRunPrediction.addEventListener("click", async () => {
  if (!selectedSymbol) {
    showToast("Por favor, selecciona un instrumento primero", "error");
    return;
  }

  btnRunPrediction.disabled = true;
  btnRunPrediction.innerText = "Ejecutando Análisis...";
  predictionResultPanel.style.display = "none";

  try {
    const autoTrade = autoTradeSignals.checked;
    const volume = Number(orderVolume.value) || 0.01;

    const response = await fetch(getApiUrl("/api/xpro/predict"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedSymbol,
        autoTrade,
        volume
      })
    });
    const result = await response.json();

    if (result.ok && result.analysis) {
      const analysis = result.analysis;
      const indicators = result.indicators;

      // Update direction card color and content
      predDirection.innerText = analysis.direction;
      if (analysis.direction === "SUBE") {
        predDirectionCard.style.border = "2px solid #2ecc71";
        predDirection.style.color = "#2ecc71";
      } else if (analysis.direction === "BAJA") {
        predDirectionCard.style.border = "2px solid #e74c3c";
        predDirection.style.color = "#e74c3c";
      } else {
        predDirectionCard.style.border = "1px solid var(--border)";
        predDirection.style.color = "#fff";
      }

      // Display probabilities and confidence
      predConfidenceTag.innerText = `Confianza: ${analysis.confidence || 'MEDIA'}`;
      predProbabilities.innerText = `Prob. SUBE: ${analysis.probability_up || 0}% | BAJA: ${analysis.probability_down || 0}%`;
      
      if (indicators.sl && indicators.tp) {
        predSuggestedPrices.innerHTML = `Sugerido -> SL: ${indicators.sl} | TP: ${indicators.tp}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
      } else {
        predSuggestedPrices.innerHTML = `Precio entrada: ${indicators.lastPrice || '--'}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
      }

      // Fill in textual analysis
      predSummary.innerText = analysis.technical_summary || "Sin resumen técnico disponible.";
      
      predReasons.innerHTML = Array.isArray(analysis.main_reasons) && analysis.main_reasons.length > 0
        ? analysis.main_reasons.map(r => `<li>${r}</li>`).join("")
        : "<li>No se especificaron razones.</li>";
        
      predRisks.innerHTML = Array.isArray(analysis.risks) && analysis.risks.length > 0
        ? analysis.risks.map(rk => `<li>${rk}</li>`).join("")
        : "<li>No se identificaron riesgos significativos.</li>";

      predictionResultPanel.style.display = "block";
      showToast("Análisis predictivo completado con éxito");

      // Auto-toggle to local predictive chart and render annotations
      if (btnShowLocalChart) {
        btnShowLocalChart.click();
        loadLocalCandleChart(selectedSymbol, {
          entryPrice: indicators.lastPrice,
          sl: indicators.sl,
          tp: indicators.tp,
          direction: analysis.direction,
          timestamp: result.prediction_time || new Date().toISOString()
        });
      }

      if (result.orderPlaced && result.orderResult) {
        showToast("¡Señal de alta confianza ejecutada automáticamente en XPRO!", "success");
        loadAllData();
      }
    } else {
      throw new Error(result.error || "La predicción no pudo ser procesada");
    }
  } catch (error) {
    showToast("Error en predicción: " + error.message, "error");
  } finally {
    btnRunPrediction.disabled = false;
    btnRunPrediction.innerText = "Análisis Cuantitativo IA";
  }
});

// Run XAU Scalp prediction handler
btnRunScalpPrediction.addEventListener("click", async () => {
  if (!selectedSymbol) {
    showToast("Por favor, selecciona un instrumento primero", "error");
    return;
  }

  btnRunScalpPrediction.disabled = true;
  btnRunScalpPrediction.innerText = "Ejecutando Scalp...";
  predictionResultPanel.style.display = "none";

  try {
    const autoTrade = autoTradeSignals.checked;
    const volume = Number(orderVolume.value) || 0.01;

    const response = await fetch(getApiUrl("/api/xpro/predict_scalp"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedSymbol,
        autoTrade,
        volume
      })
    });
    const result = await response.json();

    if (result.ok && result.analysis) {
      const analysis = result.analysis;
      const indicators = result.indicators;

      // Update direction card color and content
      predDirection.innerText = analysis.direction;
      if (analysis.direction === "SUBE" || analysis.direction === "BUY") {
        predDirectionCard.style.border = "2px solid #2ecc71";
        predDirection.style.color = "#2ecc71";
      } else if (analysis.direction === "BAJA" || analysis.direction === "SELL") {
        predDirectionCard.style.border = "2px solid #e74c3c";
        predDirection.style.color = "#e74c3c";
      } else {
        predDirectionCard.style.border = "1px solid var(--border)";
        predDirection.style.color = "#fff";
      }

      // Display probabilities and confidence
      predConfidenceTag.innerText = `Confianza: ${analysis.confidence || 'MEDIA'} (Estrategia Scalp)`;
      predProbabilities.innerText = `Prob. SUBE: ${analysis.probability_up || 0}% | BAJA: ${analysis.probability_down || 0}%`;
      
      if (indicators.sl && indicators.tp) {
        predSuggestedPrices.innerHTML = `Sugerido -> SL: ${indicators.sl} | TP: ${indicators.tp}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
      } else {
        predSuggestedPrices.innerHTML = `Precio entrada: ${indicators.lastPrice || '--'}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
      }

      // Fill in textual analysis
      predSummary.innerText = analysis.technical_summary || "Sin resumen técnico disponible.";
      
      predReasons.innerHTML = Array.isArray(analysis.main_reasons) && analysis.main_reasons.length > 0
        ? analysis.main_reasons.map(r => `<li>${r}</li>`).join("")
        : "<li>No se especificaron razones.</li>";
        
      predRisks.innerHTML = Array.isArray(analysis.risks) && analysis.risks.length > 0
        ? analysis.risks.map(rk => `<li>${rk}</li>`).join("")
        : "<li>No se identificaron riesgos significativos.</li>";

      predictionResultPanel.style.display = "block";
      showToast("Análisis Scalping IA completado con éxito");

      // Auto-toggle to local predictive chart and render annotations
      if (btnShowLocalChart) {
        btnShowLocalChart.click();
        loadLocalCandleChart(selectedSymbol, {
          entryPrice: indicators.lastPrice,
          sl: indicators.sl,
          tp: indicators.tp,
          direction: analysis.direction,
          timestamp: result.prediction_time || new Date().toISOString()
        });
      }

      if (result.orderPlaced && result.orderResult) {
        showToast("¡Señal Scalping ejecutada automáticamente en XPRO!", "success");
        loadAllData();
      }
    } else {
      throw new Error(result.error || "La predicción Scalp no pudo ser procesada");
    }
  } catch (error) {
    showToast("Error en predicción Scalp: " + error.message, "error");
  } finally {
    btnRunScalpPrediction.disabled = false;
    btnRunScalpPrediction.innerText = "Estrategia XAU Scalp IA";
  }
});

// Local Chart state variables
const btnShowTvChart = document.getElementById("btn-show-tv-chart");
const btnShowLocalChart = document.getElementById("btn-show-local-chart");
const tvChartWrapper = document.getElementById("tv-chart-wrapper");
const localChartWrapper = document.getElementById("local-chart-wrapper");
const localChartContainer = document.getElementById("local-chart-container");

let localChartInstance = null;
let candlestickSeries = null;
let currentPriceLines = [];
let profitZoneSeries = null;
let lossZoneSeries = null;

// Toggle Chart View
btnShowTvChart.addEventListener("click", () => {
  btnShowTvChart.classList.add("primary");
  btnShowLocalChart.classList.remove("primary");
  tvChartWrapper.style.display = "block";
  localChartWrapper.style.display = "none";
});

btnShowLocalChart.addEventListener("click", () => {
  btnShowLocalChart.classList.add("primary");
  btnShowTvChart.classList.remove("primary");
  tvChartWrapper.style.display = "none";
  localChartWrapper.style.display = "block";
  if (selectedSymbol) {
    loadLocalCandleChart(selectedSymbol);
  }
});

// Initialize / Refresh Local Chart
async function loadLocalCandleChart(symbol, predictionData = null) {
  if (!symbol) return;
  
  try {
    const response = await fetch(getApiUrl(`/api/xpro/candles?symbol=${symbol}&days=3`));
    const result = await response.json();
    if (!result.ok || !result.data) {
      throw new Error(result.error || "No se obtuvieron velas de la API.");
    }
    
    const rawCandles = result.data;
    if (rawCandles.length === 0) {
      console.warn("No hay velas históricas devueltas.");
      return;
    }
    
    const formattedData = rawCandles.map(c => {
      return {
        time: Math.floor(new Date(c.date).getTime() / 1000),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      };
    });
    
    formattedData.sort((a, b) => a.time - b.time);
    
    const uniqueFormattedData = [];
    const seenTimes = new Set();
    for (const c of formattedData) {
      if (!seenTimes.has(c.time)) {
        seenTimes.add(c.time);
        uniqueFormattedData.push(c);
      }
    }

    if (!localChartInstance) {
      localChartInstance = LightweightCharts.createChart(localChartContainer, {
        layout: {
          background: { type: 'solid', color: '#121212' },
          textColor: '#d1d4dc',
        },
        grid: {
          vertLines: { color: 'rgba(42, 46, 57, 0.15)' },
          horzLines: { color: 'rgba(42, 46, 57, 0.15)' },
        },
        rightPriceScale: {
          borderVisible: false,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
        }
      });
      
      candlestickSeries = localChartInstance.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
      
      const resizeObserver = new ResizeObserver(entries => {
        if (entries.length === 0 || !localChartInstance) return;
        const { width, height } = entries[0].contentRect;
        localChartInstance.applyOptions({ width, height });
      });
      resizeObserver.observe(localChartWrapper);
    }
    
    candlestickSeries.setData(uniqueFormattedData);
    localChartInstance.timeScale().fitContent();
    
    // Clear old price lines, markers, and forecast bands
    currentPriceLines.forEach(l => candlestickSeries.removePriceLine(l));
    currentPriceLines = [];
    candlestickSeries.setMarkers([]);
    
    if (profitZoneSeries) {
      localChartInstance.removeSeries(profitZoneSeries);
      profitZoneSeries = null;
    }
    if (lossZoneSeries) {
      localChartInstance.removeSeries(lossZoneSeries);
      lossZoneSeries = null;
    }
    
    if (predictionData) {
      const { entryPrice, sl, tp, direction, timestamp } = predictionData;
      
      const markerTime = Math.floor(new Date(timestamp).getTime() / 1000);
      const limitTime = markerTime + 15 * 60; // 15 minutes checking horizon
      
      const entryPriceVal = Number(entryPrice);
      const slVal = Number(sl);
      const tpVal = Number(tp);
      
      if (direction === "SUBE" || direction === "BUY") {
        // Long Position: Profit is above entryPrice (green), Loss is below entryPrice (red)
        if (tp) {
          profitZoneSeries = localChartInstance.addBaselineSeries({
            baseValue: { type: 'price', price: entryPriceVal },
            topFillColor1: 'rgba(38, 166, 154, 0.25)',
            topFillColor2: 'rgba(38, 166, 154, 0.05)',
            topLineColor: 'rgba(38, 166, 154, 0.8)',
            bottomFillColor1: 'rgba(0, 0, 0, 0)',
            bottomFillColor2: 'rgba(0, 0, 0, 0)',
            bottomLineColor: 'rgba(0, 0, 0, 0)',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
          });
          profitZoneSeries.setData([
            { time: markerTime, value: tpVal },
            { time: limitTime, value: tpVal }
          ]);
        }
        if (sl) {
          lossZoneSeries = localChartInstance.addBaselineSeries({
            baseValue: { type: 'price', price: entryPriceVal },
            topFillColor1: 'rgba(0, 0, 0, 0)',
            topFillColor2: 'rgba(0, 0, 0, 0)',
            topLineColor: 'rgba(0, 0, 0, 0)',
            bottomFillColor1: 'rgba(239, 83, 80, 0.25)',
            bottomFillColor2: 'rgba(239, 83, 80, 0.05)',
            bottomLineColor: 'rgba(239, 83, 80, 0.8)',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
          });
          lossZoneSeries.setData([
            { time: markerTime, value: slVal },
            { time: limitTime, value: slVal }
          ]);
        }
      } else if (direction === "BAJA" || direction === "SELL") {
        // Short Position: Profit is below entryPrice (green), Loss is above entryPrice (red)
        if (tp) {
          profitZoneSeries = localChartInstance.addBaselineSeries({
            baseValue: { type: 'price', price: entryPriceVal },
            topFillColor1: 'rgba(0, 0, 0, 0)',
            topFillColor2: 'rgba(0, 0, 0, 0)',
            topLineColor: 'rgba(0, 0, 0, 0)',
            bottomFillColor1: 'rgba(38, 166, 154, 0.25)',
            bottomFillColor2: 'rgba(38, 166, 154, 0.05)',
            bottomLineColor: 'rgba(38, 166, 154, 0.8)',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
          });
          profitZoneSeries.setData([
            { time: markerTime, value: tpVal },
            { time: limitTime, value: tpVal }
          ]);
        }
        if (sl) {
          lossZoneSeries = localChartInstance.addBaselineSeries({
            baseValue: { type: 'price', price: entryPriceVal },
            topFillColor1: 'rgba(239, 83, 80, 0.25)',
            topFillColor2: 'rgba(239, 83, 80, 0.05)',
            topLineColor: 'rgba(239, 83, 80, 0.8)',
            bottomFillColor1: 'rgba(0, 0, 0, 0)',
            bottomFillColor2: 'rgba(0, 0, 0, 0)',
            bottomLineColor: 'rgba(0, 0, 0, 0)',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
          });
          lossZoneSeries.setData([
            { time: markerTime, value: slVal },
            { time: limitTime, value: slVal }
          ]);
        }
      }
      let nearestCandle = uniqueFormattedData[uniqueFormattedData.length - 1];
      let minDiff = Infinity;
      for (const candle of uniqueFormattedData) {
        const diff = Math.abs(candle.time - markerTime);
        if (diff < minDiff) {
          minDiff = diff;
          nearestCandle = candle;
        }
      }
      
      const markers = [
        {
          time: nearestCandle.time,
          position: direction === "SUBE" ? 'belowBar' : 'aboveBar',
          color: direction === "SUBE" ? '#26a69a' : '#ef5350',
          shape: direction === "SUBE" ? 'arrowUp' : 'arrowDown',
          text: `ENTRADA IA (${direction}) @ ${entryPrice}`,
        }
      ];
      candlestickSeries.setMarkers(markers);
      localChartInstance.timeScale().scrollToPosition(0, true);
    }
  } catch (error) {
    console.error("Error al cargar velas locales:", error);
    showToast("Error al cargar gráfico local: " + error.message, "error");
  }
}
