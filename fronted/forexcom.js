// Terminal frontend client for Forex.com / StoneX API
let sessionToken = localStorage.getItem("forex_session_token") || null;
let sessionUsername = localStorage.getItem("forex_session_username") || null;
let sessionIsDemo = localStorage.getItem("forex_session_isdemo") !== "false";
let selectedSymbol = null;
let selectedMarket = null;
let cachedSymbols = [];

let localAutomationList = [];

// DOM Elements
const forexAutoPredict = document.getElementById("forex-auto-predict");
const forexAutoEvaluate = document.getElementById("forex-auto-evaluate");
const btnSaveAutomation = document.getElementById("btn-save-automation");
const activeAutomationsList = document.getElementById("active-automations-list");
const forexAutoTrade = document.getElementById("forex-auto-trade");

const authForm = document.getElementById("forex-login-form");
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const envSelect = document.getElementById("forex-env");
const usernameInput = document.getElementById("forex-username");
const passwordInput = document.getElementById("forex-password");
const appkeyInput = document.getElementById("forex-appkey");

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
const automationVolume = document.getElementById("automation-volume");
const automationAutoTrade = document.getElementById("automation-auto-trade");
const forexForceSmartAllowed = document.getElementById("forex-force-smart-allowed");

const btnOrderBuy = document.getElementById("btn-order-buy");
const btnOrderSell = document.getElementById("btn-order-sell");

const positionsSection = document.getElementById("positions-section");
const positionsTableBody = document.getElementById("positions-table-body");

const ordersSection = document.getElementById("orders-section");
const ordersTableBody = document.getElementById("orders-table-body");

// Prediction Elements
const btnRunPrediction = document.getElementById("btn-run-prediction");
const btnRunScalpPrediction = document.getElementById("btn-run-scalp-prediction");
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
    "x-forex-session": sessionToken,
    "x-forex-username": sessionUsername,
    "x-forex-isdemo": String(sessionIsDemo)
  };
}

// Toast Notification helper
function showToast(message, type = "success") {
  const toast = document.createElement("div");
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
document.addEventListener("DOMContentLoaded", async () => {
  // Restore saved credentials
  usernameInput.value = localStorage.getItem("forex_saved_username") || "";
  appkeyInput.value = localStorage.getItem("forex_saved_appkey") || "";
  envSelect.value = localStorage.getItem("forex_saved_env") || "live";

  await loadDefaultConfig();

  updateSessionUI();
  if (sessionToken && sessionUsername) {
    loadAllData();
    loadAutomationSettings();
  }
});

// Load defaults from server config if empty
async function loadDefaultConfig() {
  try {
    const res = await fetch(getApiUrl("/api/forexcom/config"));
    const config = await res.json();
    if (config.ok) {
      if (config.username) {
        usernameInput.value = config.username;
      }
      if (config.appKey) {
        appkeyInput.value = config.appKey;
      }
      if (config.password) {
        passwordInput.value = config.password;
      }

      // Si el servidor provee credenciales configuradas y no tenemos sesión, auto-conectar
      if (config.username && config.password && !sessionToken) {
        console.log("[ForexCom] Autoconectando con credenciales por defecto de .env...");
        setTimeout(() => {
          authForm.dispatchEvent(new Event("submit"));
        }, 100);
      }
    }
  } catch (e) {
    console.warn("Falla al cargar config por defecto:", e.message);
  }
}

// Load Automation Settings
async function loadAutomationSettings() {
  try {
    const response = await fetch(getApiUrl("/api/automation"));
    const result = await response.json();
    if (result.ok && result.automation) {
      localAutomationList = result.automation.forex_automation_list || [];
      renderAutomationList();
      // Inicializar checkbox global de auto-trade si existe
      if (forexAutoTrade) {
        try {
          forexAutoTrade.checked = !!result.automation.forex_auto_trade;
        } catch (e) {
          // ignore
        }
      }
      if (forexForceSmartAllowed) {
        try {
          forexForceSmartAllowed.checked = !!result.automation.forex_force_smart_allowed;
        } catch (e) {
          // ignore
        }
      }
      updateCheckboxesForSelectedSymbol();
    }
  } catch (error) {
    console.error("Error al cargar configuración de automatización:", error);
  }
}

function updateCheckboxesForSelectedSymbol() {
  if (!selectedSymbol) return;
  const entry = localAutomationList.find(item => String(item.symbol).toUpperCase() === String(selectedSymbol).toUpperCase());
  if (entry) {
    forexAutoPredict.checked = entry.auto_predict;
    forexAutoEvaluate.checked = entry.auto_evaluate;
    if (automationVolume) automationVolume.value = entry.volume !== undefined ? Number(entry.volume) : (Number(orderVolume.value) || 1.0);
    if (automationAutoTrade) automationAutoTrade.checked = !!entry.auto_trade;
  } else {
    forexAutoPredict.checked = false;
    forexAutoEvaluate.checked = false;
    if (automationVolume) automationVolume.value = Number(orderVolume.value) || 1.0;
  }
}

function renderAutomationList() {
  if (!activeAutomationsList) return;
  if (localAutomationList.length === 0) {
    activeAutomationsList.innerHTML = `
      <tr>
        <td colspan="6" class="muted" style="padding: 12px; text-align: center;">No hay instrumentos automatizados activos</td>
      </tr>
    `;
    return;
  }

  const nameMap = {
    "402044083": "XAU/USD",
    "402044081": "XAU/USD",
    "401449254": "EUR/USD"
  };

  activeAutomationsList.innerHTML = localAutomationList.map(item => {
    const displayName = item.name || nameMap[item.symbol] || item.symbol;
    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: bold; color: #fff;">${displayName}</td>
        <td style="padding: 8px 12px;">${item.auto_predict ? '<span class="badge-buy" style="font-size:10px; padding: 2px 6px;">ACTIVO</span>' : '<span class="muted" style="font-size:10px;">INACTIVO</span>'}</td>
        <td style="padding: 8px 12px;">${item.auto_evaluate ? '<span class="badge-buy" style="font-size:10px; padding: 2px 6px;">ACTIVO</span>' : '<span class="muted" style="font-size:10px;">INACTIVO</span>'}</td>
        <td style="padding: 8px 12px; text-align: center;">
          <input type="checkbox" ${item.auto_trade ? 'checked' : ''} onchange="window.updateAutomationAutoTrade('${item.symbol}', this.checked)" />
        </td>
        <td style="padding: 8px 12px;">
          <input type="number" min="0.01" step="0.01" value="${item.volume !== undefined ? item.volume : 1.0}" style="width:90px; padding:4px; background:transparent; border:1px solid var(--border); color:#fff;" onchange="window.updateAutomationVolume('${item.symbol}', this.value)" />
        </td>
        <td style="padding: 8px 12px; text-align: right;">
          <button class="button danger" style="padding: 2px 8px; font-size: 11px; height: 22px; line-height: 1;" onclick="deactivateAutomation('${item.symbol}')">Desactivar</button>
        </td>
      </tr>
    `;
  }).join("");
}

window.updateAutomationVolume = async function(symbol, value) {
  const vol = Number(value);
  if (!Number.isFinite(vol) || vol <= 0) return;
  const idx = localAutomationList.findIndex(it => String(it.symbol).toUpperCase() === String(symbol).toUpperCase());
  if (idx === -1) return;
  localAutomationList[idx].volume = vol;
  // Save silently
  await saveAutomationSettings(localAutomationList, true);
  renderAutomationList();
};

window.updateAutomationAutoTrade = async function(symbol, checked) {
  const idx = localAutomationList.findIndex(it => String(it.symbol).toUpperCase() === String(symbol).toUpperCase());
  if (idx === -1) return;
  localAutomationList[idx].auto_trade = !!checked;
  // Save silently
  await saveAutomationSettings(localAutomationList, true);
  renderAutomationList();
};

window.deactivateAutomation = async function(symbol) {
  if (!confirm(`¿Desea desactivar la automatización para ${symbol}?`)) return;
  localAutomationList = localAutomationList.filter(item => String(item.symbol).toUpperCase() !== String(symbol).toUpperCase());
  await saveAutomationSettings(localAutomationList, false);
};

async function saveAutomationSettings(customList = null, silent = false) {
  try {
    const listToSave = customList || getUpdatedListFromUI();
    const response = await fetch(getApiUrl("/api/automation"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        forex_automation_list: listToSave,
        forex_auto_predict: listToSave.some(item => item.auto_predict),
        forex_auto_evaluate: listToSave.some(item => item.auto_evaluate),
        forex_auto_trade: typeof forexAutoTrade !== 'undefined' && forexAutoTrade !== null ? !!forexAutoTrade.checked : listToSave.some(item => item.auto_trade),
        forex_force_smart_allowed: typeof forexForceSmartAllowed !== 'undefined' && forexForceSmartAllowed !== null ? !!forexForceSmartAllowed.checked : false
      })
    });
    const result = await response.json();
    if (result.ok) {
      localAutomationList = result.automation.forex_automation_list || [];
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
  const symbol = String(selectedSymbol).toUpperCase();
  const name = selectedMarket ? selectedMarket.name : symbol;
  const auto_predict = forexAutoPredict.checked;
  const auto_evaluate = forexAutoEvaluate.checked;
  const vol = automationVolume ? Number(automationVolume.value) : undefined;
  const symbolAutoTrade = automationAutoTrade ? !!automationAutoTrade.checked : undefined;

  if (!auto_predict && !auto_evaluate) {
    return localAutomationList.filter(item => String(item.symbol).toUpperCase() !== symbol);
  }

  const updatedList = [...localAutomationList];
  const idx = updatedList.findIndex(item => String(item.symbol).toUpperCase() === symbol);
  if (idx > -1) {
    updatedList[idx] = {
      symbol,
      name,
      auto_predict,
      auto_evaluate,
      auto_trade: symbolAutoTrade !== undefined ? symbolAutoTrade : (updatedList[idx].auto_trade !== undefined ? updatedList[idx].auto_trade : false),
      volume: vol !== undefined ? vol : (updatedList[idx].volume !== undefined ? updatedList[idx].volume : undefined)
    };
  } else {
    updatedList.push({ symbol, name, auto_predict, auto_evaluate, auto_trade: symbolAutoTrade !== undefined ? symbolAutoTrade : undefined, volume: vol !== undefined ? vol : undefined });
  }
  return updatedList;
}

// Bind button save
btnSaveAutomation.addEventListener("click", () => saveAutomationSettings(null, false));
// Persistir cambio inmediato del toggle global de auto-trade y override de smart_allowed
if (forexAutoTrade) {
  forexAutoTrade.addEventListener("change", () => saveAutomationSettings(null, true));
}
if (forexForceSmartAllowed) {
  forexForceSmartAllowed.addEventListener("change", () => saveAutomationSettings(null, true));
}

// Update UI state based on session status
function updateSessionUI() {
  if (sessionToken && sessionUsername) {
    sessionStatusText.innerText = `Conectado (${sessionIsDemo ? 'Demo' : 'Real'})`;
    sessionStatusDot.className = "status-dot connected";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "block";
    btnRefreshData.style.display = "inline-block";
    accountPanel.style.display = "block";
    positionsSection.style.display = "block";
    ordersSection.style.display = "block";
    marketSelect.style.display = "block";
    
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    appkeyInput.disabled = true;
    envSelect.disabled = true;
  } else {
    sessionStatusText.innerText = "Desconectado";
    sessionStatusDot.className = "status-dot disconnected";
    btnConnect.style.display = "block";
    btnDisconnect.style.display = "none";
    btnRefreshData.style.display = "none";
    accountPanel.style.display = "none";
    positionsSection.style.display = "none";
    ordersSection.style.display = "none";
    selectedMarketArea.style.display = "none";
    marketSelect.style.display = "none";

    usernameInput.disabled = false;
    passwordInput.disabled = false;
    appkeyInput.disabled = false;
    envSelect.disabled = false;
  }
}

// Login
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  btnConnect.disabled = true;
  btnConnect.innerText = "Conectando...";

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const appKey = appkeyInput.value.trim();
  const isDemo = envSelect.value === "demo";

  try {
    const response = await fetch(getApiUrl("/api/forexcom/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, appKey, isDemo })
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Fallo en la conexión");

    sessionToken = result.sessionToken;
    sessionUsername = result.username;
    sessionIsDemo = result.isDemo;

    localStorage.setItem("forex_session_token", sessionToken);
    localStorage.setItem("forex_session_username", sessionUsername);
    localStorage.setItem("forex_session_isdemo", String(sessionIsDemo));

    localStorage.setItem("forex_saved_username", username);
    localStorage.setItem("forex_saved_appkey", appKey);
    localStorage.setItem("forex_saved_env", envSelect.value);

    passwordInput.value = "";
    showToast("Conexión con Forex.com establecida con éxito!");
    updateSessionUI();
    loadAllData();
  } catch (error) {
    showToast(`Error de Conexión: ${error.message}`, "error");
  } finally {
    btnConnect.disabled = false;
    btnConnect.innerText = "Conectar Sesión";
  }
});

// Disconnect
btnDisconnect.addEventListener("click", async () => {
  try {
    await fetch(getApiUrl("/api/forexcom/logout"), {
      method: "POST",
      headers: getHeaders()
    });
  } catch (e) {
    // Ignore
  }

  sessionToken = null;
  sessionUsername = null;
  localStorage.removeItem("forex_session_token");
  localStorage.removeItem("forex_session_username");

  showToast("Cuenta desconectada");
  updateSessionUI();
});

// Refresh Data Button
btnRefreshData.addEventListener("click", loadAllData);

function loadAllData() {
  loadAccountDetails();
  loadPositions();
  loadOrders();
  loadAutomationSettings();
  if (selectedSymbol) {
    selectSymbol(selectedSymbol);
  } else {
    searchMarkets();
  }
}

// Load Account info
async function loadAccountDetails() {
  try {
    const response = await fetch(getApiUrl("/api/forexcom/account"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && result.data) {
      const data = result.data;
      accBalance.innerText = `$${Number(data.Balance || 0).toFixed(2)}`;
      accEquity.innerText = `$${Number(data.Equity || 0).toFixed(2)}`;
      accMargin.innerText = `$${Number(data.Margin || 0).toFixed(2)} / $${Number(data.FreeMargin || 0).toFixed(2)}`;
      
      const unrealized = Number(data.UnrealizedPnl || 0);
      accUnrealizedPnl.innerText = `$${unrealized.toFixed(2)}`;
      accUnrealizedPnl.style.color = unrealized >= 0 ? "#2ecc71" : "#e74c3c";
      accLeverage.innerText = `1:${data.Leverage}`;
    }
  } catch (error) {
    console.error("Error al cargar detalles de la cuenta:", error);
  }
}

window.quickSearch = function(symbol) {
  marketSearchQuery.value = symbol;
  searchMarkets();
};

// Search Markets
async function searchMarkets() {
  const query = marketSearchQuery.value.trim();
  marketsTableBody.innerHTML = `<tr><td colspan="3" class="muted" style="padding: 16px; text-align: center;">Buscando mercados...</td></tr>`;

  try {
    const response = await fetch(getApiUrl(`/api/forexcom/symbols?query=${encodeURIComponent(query)}`), {
      headers: getHeaders()
    });
    const result = await response.json();
    
    if (!result.ok) throw new Error(result.error);

    cachedSymbols = result.data || [];
    
    // Populate dropdown selector
    marketSelect.innerHTML = `<option value="">-- Selecciona un Mercado --</option>`;
    cachedSymbols.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.symbol;
      opt.innerText = `${s.name} (${s.symbol})`;
      marketSelect.appendChild(opt);
    });

    if (!cachedSymbols.length) {
      marketsTableBody.innerHTML = `<tr><td colspan="3" class="muted" style="padding: 16px; text-align: center;">No se encontraron mercados.</td></tr>`;
      return;
    }

    marketsTableBody.innerHTML = "";
    cachedSymbols.forEach(m => {
      const row = document.createElement("tr");
      row.className = "clickable-row";
      row.innerHTML = `
        <td style="padding: 12px; font-weight: bold; color: var(--accent);">${m.symbol}</td>
        <td style="padding: 12px;"><strong>${m.name}</strong></td>
        <td style="padding: 12px;">
          <span style="color: var(--danger);">${m.bid || '--'}</span> / <span style="color: var(--success);">${m.ask || '--'}</span>
        </td>
      `;
      row.addEventListener("click", () => selectSymbol(m.symbol));
      marketsTableBody.appendChild(row);
    });
  } catch (error) {
    marketsTableBody.innerHTML = `<tr><td colspan="3" class="muted" style="padding: 16px; text-align: center; color: var(--danger);">Error: ${error.message}</td></tr>`;
  }
}
btnSearchMarkets.addEventListener("click", searchMarkets);

// Select Market for detailed view / trading
async function selectSymbol(symbolName) {
  try {
    let symbolData = cachedSymbols.find(s => String(s.symbol) === String(symbolName) || s.name.toUpperCase() === symbolName.toUpperCase());
    
    if (!symbolData) {
      symbolData = { symbol: symbolName, name: symbolName, bid: null, ask: null };
    }

    selectedSymbol = symbolData.symbol;
    selectedMarket = symbolData;

    updateCheckboxesForSelectedSymbol();

    selectedMarketName.innerText = symbolData.name;
    selectedMarketSpecs.innerText = `Cargando cotización en vivo de Forex.com...`;
    quoteBid.innerText = "...";
    quoteAsk.innerText = "...";

    // Mostramos la zona de mercado antes de que termine de cargar
    selectedMarketArea.style.display = "block";

    // 1. Obtener la cotización real del backend
    try {
      const qRes = await fetch(getApiUrl(`/api/forexcom/quote?symbol=${encodeURIComponent(symbolName)}`), {
        headers: getHeaders()
      });
      const qData = await qRes.json();
      if (qData.ok && qData.data) {
        symbolData.bid = qData.data.bid;
        symbolData.ask = qData.data.ask;
        symbolData.name = qData.data.name;
        selectedSymbol = qData.data.symbol;

        selectedMarketName.innerText = symbolData.name;
        selectedMarketSpecs.innerText = `Market ID: ${selectedSymbol} | Bid: ${symbolData.bid || 'N/A'} | Ask: ${symbolData.ask || 'N/A'}`;
        
        const isGoldOrCommodity = symbolData.bid > 100;
        const formatPrice = (p) => p ? Number(p).toFixed(isGoldOrCommodity ? 2 : 5) : "--";

        quoteBid.innerText = formatPrice(symbolData.bid);
        quoteAsk.innerText = formatPrice(symbolData.ask);

        const spread = ((symbolData.ask - symbolData.bid) || 0);
        symbolVolume.innerText = `Forex.com CFD Standard Specs | Spread: ${spread.toFixed(isGoldOrCommodity ? 2 : 5)}`;

        // Predeterminar el volumen mínimo según el instrumento
        if (qData.data.minSize) {
          orderVolume.value = qData.data.minSize;
        } else {
          orderVolume.value = 1000; // Fallback divisas
        }
      }
    } catch (quoteErr) {
      console.warn("Falla al cargar cotización en vivo:", quoteErr.message);
      selectedMarketSpecs.innerText = `Market ID: ${symbolData.symbol} | Bid: N/A | Ask: N/A`;
      quoteBid.innerText = "--";
      quoteAsk.innerText = "--";
    }

    // 2. Actualizar el widget de TradingView
    const tvIframe = document.getElementById("tv-chart-iframe");
    if (tvIframe) {
      let tvSym = "FOREXCOM:XAUUSD";
      const cleanUpper = symbolData.name.toUpperCase().replace(/[^A-Z]/g, ""); // "GBP/AUD" -> "GBPAUD", "GOLD" -> "GOLD"

      if (cleanUpper.includes("GOLD") || cleanUpper.includes("XAU")) {
        tvSym = "FOREXCOM:XAUUSD";
      } else if (cleanUpper.includes("SILVER") || cleanUpper.includes("XAG")) {
        tvSym = "FOREXCOM:XAGUSD";
      } else if (cleanUpper.length === 6) { // Par FX limpio de 6 letras (ej: GBPAUD, CADJPY, EURUSD)
        tvSym = `FOREXCOM:${cleanUpper}`;
      } else if (cleanUpper.includes("AAPL")) {
        tvSym = "NASDAQ:AAPL";
      } else {
        // Fallback o recortar a las primeras 6 letras si contiene texto adicional
        tvSym = `FOREXCOM:${cleanUpper.substring(0, 6)}`;
      }

      console.log(`[TradingView] Cargando gráfico para: ${tvSym}`);
      tvIframe.src = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSym)}&interval=15&theme=dark&style=1&timezone=Etc%2FUTC&locale=es&enablepublishing=false&allowsymbolchange=true&hidesidetoolbar=false`;
    }

    // 3. Cargar gráfico local de velas
    loadLocalCandleChart(symbolData.name);

  } catch (error) {
    showToast("Error al seleccionar mercado: " + error.message, "error");
  }
}

marketSelect.addEventListener("change", (e) => {
  if (e.target.value) selectSymbol(e.target.value);
});

// Execute Orders
btnOrderBuy.addEventListener("click", () => executeOrder("BUY"));
btnOrderSell.addEventListener("click", () => executeOrder("SELL"));

async function executeOrder(direction) {
  if (!selectedSymbol) return;

  const volume = Number(orderVolume.value) || 1.0;
  const sl = orderSL.value ? Number(orderSL.value) : null;
  const tp = orderTP.value ? Number(orderTP.value) : null;

  try {
    const response = await fetch(getApiUrl("/api/forexcom/trade"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedSymbol,
        action: direction,
        volume,
        price: direction === "BUY" ? selectedMarket.ask : selectedMarket.bid,
        sl,
        tp
      })
    });
    const result = await response.json();

    if (result.ok) {
      showToast(`Orden de ${direction} enviada exitosamente a Forex.com`);
      orderSL.value = "";
      orderTP.value = "";
      loadAllData();
    } else {
      throw new Error(result.error || "Fallo al enviar la orden");
    }
  } catch (error) {
    showToast("Error al ejecutar orden: " + error.message, "error");
  }
}

// Load Open Positions
async function loadPositions() {
  try {
    const response = await fetch(getApiUrl("/api/forexcom/positions"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && result.data && Array.isArray(result.data.OpenPositions)) {
      const positions = result.data.OpenPositions;
      if (positions.length === 0) {
        positionsTableBody.innerHTML = `<tr><td colspan="8" class="muted" style="padding: 16px; text-align: center;">No hay posiciones abiertas</td></tr>`;
        return;
      }

      positionsTableBody.innerHTML = positions.map(pos => {
        const isBuy = pos.Direction === "buy";
        const typeBadge = isBuy ? '<span class="badge-buy">COMPRA</span>' : '<span class="badge-sell">VENTA</span>';
        const pId = pos.OrderId || pos.PositionId;
        
        // Resolver SL/TP buscando en todas las posibles estructuras del DTO de CIAPI
        const slPrice = pos.StopLoss || pos.StopOrder?.TriggerPrice || pos.AssociatedOrders?.Stop?.TriggerPrice || null;
        const tpPrice = pos.TakeProfit || pos.LimitOrder?.TriggerPrice || pos.AssociatedOrders?.Limit?.TriggerPrice || null;
        
        // Calcular P&L en base al valor devuelto por el backend
        const pnl = pos.ProfitLoss || 0;
        const pnlColor = pnl > 0 ? "var(--success)" : pnl < 0 ? "var(--danger)" : "var(--muted)";
        const pnlSign = pnl > 0 ? "+" : "";
        const pnlText = `<span style="color: ${pnlColor}; font-weight: bold;">${pnlSign}${pnl.toFixed(2)} USD</span>`;

        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px;">${pId}</td>
            <td style="padding: 12px; font-weight: bold;">${pos.MarketName || pos.MarketId}</td>
            <td style="padding: 12px;">${typeBadge}</td>
            <td style="padding: 12px;">${pos.Quantity}</td>
            <td style="padding: 12px;">${pos.Price}</td>
            <td style="padding: 12px; font-size: 0.9em;">
              SL: ${slPrice ? Number(slPrice).toFixed(4) : '<span class="muted">Sin SL</span>'}<br>
              TP: ${tpPrice ? Number(tpPrice).toFixed(4) : '<span class="muted">Sin TP</span>'}
            </td>
            <td style="padding: 12px;">${pnlText}</td>
            <td style="padding: 12px;">
              <button class="button secondary" style="padding: 4px 8px; font-size: 11px;" onclick="openModifyModal('${pId}', '${pos.MarketId}', ${slPrice || 0}, ${tpPrice || 0})">Modificar</button>
              <button class="button danger" style="padding: 4px 8px; font-size: 11px;" onclick="closePosition('${pId}', ${pos.Quantity}, '${pos.MarketId}', '${pos.Direction}')">Cerrar</button>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Error al cargar posiciones:", error);
  }
}

// Load Active Orders
async function loadOrders() {
  try {
    const response = await fetch(getApiUrl("/api/forexcom/orders"), {
      headers: getHeaders()
    });
    const result = await response.json();

    if (result.ok && result.data && Array.isArray(result.data.ActiveOrders)) {
      const orders = result.data.ActiveOrders;
      if (orders.length === 0) {
        ordersTableBody.innerHTML = `<tr><td colspan="4" class="muted" style="padding: 16px; text-align: center;">No hay órdenes pendientes</td></tr>`;
        return;
      }

      ordersTableBody.innerHTML = orders.map(ord => {
        const isBuy = ord.Direction === "buy";
        const typeBadge = isBuy ? '<span class="badge-buy">COMPRA</span>' : '<span class="badge-sell">VENTA</span>';
        
        const nameMap = {
          "402044083": "XAU/USD",
          "402044081": "XAU/USD",
          "401449254": "EUR/USD",
          "401203119": "CHF/JPY",
          "401203116": "AUD/NZD"
        };
        const displayName = nameMap[ord.MarketId] || ord.MarketName || ord.MarketId;
        
        // Resolver SL/TP buscando en todas las posibles estructuras de la orden
        const slPrice = ord.StopLoss || ord.StopOrder?.TriggerPrice || ord.AssociatedOrders?.Stop?.TriggerPrice || null;
        const tpPrice = ord.TakeProfit || ord.LimitOrder?.TriggerPrice || ord.AssociatedOrders?.Limit?.TriggerPrice || null;
        
        const detailHtml = `
          <div style="font-weight: bold; margin-bottom: 2px;">${typeBadge} ${ord.Quantity} @ ${ord.TriggerPrice || '--'}</div>
          <div class="muted" style="font-size: 0.85em;">
            SL: ${slPrice ? Number(slPrice).toFixed(2) : 'Sin SL'} | TP: ${tpPrice ? Number(tpPrice).toFixed(2) : 'Sin TP'}
          </div>
        `;

        return `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px; font-size: 0.9em;">${ord.OrderId}</td>
            <td style="padding: 12px; font-weight: bold; font-size: 0.9em;">${displayName}</td>
            <td style="padding: 12px; font-size: 0.9em;">${detailHtml}</td>
            <td style="padding: 12px; text-align: right;">
              <button class="button danger" style="padding: 4px 8px; font-size: 11px;" onclick="cancelPendingOrder('${ord.OrderId}')">Cancelar</button>
            </td>
          </tr>
        `;
      }).join("");
    }
  } catch (error) {
    console.error("Error al cargar órdenes:", error);
  }
}

// Close Position
window.closePosition = async function(positionId, volume, marketId, direction) {
  if (!confirm(`¿Desea cerrar la posición de Forex.com #${positionId}?`)) return;

  try {
    const response = await fetch(getApiUrl("/api/forexcom/close_position"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ positionId, volume, marketId, direction })
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

// Cancel Order
window.cancelPendingOrder = async function(orderId) {
  if (!confirm(`¿Desea cancelar la orden pendiente #${orderId}?`)) return;
  try {
    const response = await fetch(getApiUrl("/api/forexcom/close_position"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ positionId: orderId })
    });
    const result = await response.json();

    if (result.ok) {
      showToast("Orden cancelada con éxito");
      loadAllData();
    } else {
      throw new Error(result.error || "Error al cancelar orden");
    }
  } catch (error) {
    showToast("Error al cancelar orden: " + error.message, "error");
  }
};

// Modify Modal
window.openModifyModal = function(positionId, symbol, sl, tp) {
  modifyPositionId.value = positionId;
  modifySLInput.value = sl || "";
  modifyTPInput.value = tp || "";
  modifyDesc.innerText = `Modificar límites de posición #${positionId}`;
  modifyModal.style.display = "flex";
};

btnModifyCancel.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

modifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const positionId = modifyPositionId.value;
  const sl = modifySLInput.value ? Number(modifySLInput.value) : null;
  const tp = modifyTPInput.value ? Number(modifyTPInput.value) : null;

  try {
    const response = await fetch(getApiUrl("/api/forexcom/modify_position"), {
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

// Run AI prediction standard
btnRunPrediction.addEventListener("click", async () => {
  if (!selectedSymbol) {
    showToast("Por favor, selecciona un mercado primero", "error");
    return;
  }

  btnRunPrediction.disabled = true;
  btnRunPrediction.innerText = "Calculando...";
  predictionResultPanel.style.display = "none";

  try {
    const autoTrade = typeof forexAutoTrade !== 'undefined' && forexAutoTrade !== null ? !!forexAutoTrade.checked : false;
    const volume = Number(orderVolume.value) || 1.0;

    const response = await fetch(getApiUrl("/api/forexcom/predict"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedMarket.name,
        autoTrade,
        volume
      })
    });
    const result = await response.json();

    if (result.ok && result.analysis) {
      renderPrediction(result);
      showToast("Análisis predictivo completado con éxito");
    } else {
      throw new Error(result.error || "Fallo en el procesamiento");
    }
  } catch (error) {
    showToast("Error en predicción: " + error.message, "error");
  } finally {
    btnRunPrediction.disabled = false;
    btnRunPrediction.innerText = "Análisis Cuantitativo IA";
  }
});

// Run XAU Scalp prediction
btnRunScalpPrediction.addEventListener("click", async () => {
  if (!selectedSymbol) {
    showToast("Por favor, selecciona un mercado primero", "error");
    return;
  }

  btnRunScalpPrediction.disabled = true;
  btnRunScalpPrediction.innerText = "Calculando Scalp...";
  predictionResultPanel.style.display = "none";

  try {
    const autoTrade = typeof forexAutoTrade !== 'undefined' && forexAutoTrade !== null ? !!forexAutoTrade.checked : false;
    const volume = Number(orderVolume.value) || 1.0;

    const response = await fetch(getApiUrl("/api/forexcom/predict_scalp"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        symbol: selectedMarket.name,
        autoTrade,
        volume
      })
    });
    const result = await response.json();

    if (result.ok && result.analysis) {
      renderPrediction(result);
      showToast("Análisis Scalping IA completado con éxito");
    } else {
      throw new Error(result.error || "Fallo en el procesamiento del Scalp");
    }
  } catch (error) {
    showToast("Error en predicción Scalp: " + error.message, "error");
  } finally {
    btnRunScalpPrediction.disabled = false;
    btnRunScalpPrediction.innerText = "Estrategia XAU Scalp IA";
  }
});

function renderPrediction(result) {
  const analysis = result.analysis;
  const indicators = result.indicators;

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

  predConfidenceTag.innerText = `Confianza: ${analysis.confidence || 'MEDIA'}`;
  predProbabilities.innerText = `Prob. SUBE: ${analysis.probability_up || 0}% | BAJA: ${analysis.probability_down || 0}%`;
  
  if (indicators.sl && indicators.tp) {
    predSuggestedPrices.innerHTML = `Sugerido -> SL: ${indicators.sl} | TP: ${indicators.tp}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
  } else {
    predSuggestedPrices.innerHTML = `Precio entrada: ${indicators.lastPrice || '--'}<br><br><small class="muted" style="display:block;margin-top:6px;">ID Predicción: #${result.prediction_id}<br>Auto-evaluación en: 15 min (${new Date(result.target_check_time).toLocaleTimeString()})</small>`;
  }

  predSummary.innerText = analysis.technical_summary || analysis.macro_summary || "Sin resumen técnico disponible.";
  
  predReasons.innerHTML = Array.isArray(analysis.main_reasons) && analysis.main_reasons.length > 0
    ? analysis.main_reasons.map(r => `<li>${r}</li>`).join("")
    : "<li>No se especificaron razones.</li>";
    
  predRisks.innerHTML = Array.isArray(analysis.risks) && analysis.risks.length > 0
    ? analysis.risks.map(rk => `<li>${rk}</li>`).join("")
    : "<li>No se identificaron riesgos significativos.</li>";

  predictionResultPanel.style.display = "block";

  // Load interactive annotations on chart
  btnShowLocalChart.click();
  loadLocalCandleChart(selectedMarket.name, {
    entryPrice: indicators.lastPrice,
    sl: indicators.sl,
    tp: indicators.tp,
    direction: analysis.direction,
    timestamp: result.prediction_time || new Date().toISOString()
  });

  if (result.orderPlaced && result.orderResult) {
    showToast("¡Señal ejecutada automáticamente en Forex.com!", "success");
    loadAllData();
  }
}

// Chart Elements
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
  if (selectedMarket) {
    loadLocalCandleChart(selectedMarket.name);
  }
});

// Initialize lightweight charts
async function loadLocalCandleChart(symbolName, predictionData = null) {
  if (!symbolName) return;
  
  try {
    const response = await fetch(getApiUrl(`/api/forexcom/candles?symbol=${encodeURIComponent(symbolName)}`));
    const result = await response.json();
    if (!result.ok || !result.data) {
      throw new Error(result.error || "No se obtuvieron velas de la API.");
    }
    
    const rawCandles = result.data;
    if (rawCandles.length === 0) return;
    
    const formattedData = rawCandles.map(c => ({
      time: Math.floor(new Date(c.date).getTime() / 1000),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    }));
    
    formattedData.sort((a, b) => a.time - b.time);
    
    const uniqueFormattedData = [];
    const seenTimes = new Set();
    for (const c of formattedData) {
      if (!seenTimes.has(c.time)) {
        uniqueFormattedData.push(c);
        seenTimes.add(c.time);
      }
    }

    if (!localChartInstance) {
      localChartContainer.innerHTML = "";
      localChartInstance = window.LightweightCharts.createChart(localChartContainer, {
        layout: {
          background: { color: "#111827" },
          textColor: "#95a3b9",
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.05)" },
          horzLines: { color: "rgba(255,255,255,0.05)" },
        },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
        }
      });
      candlestickSeries = localChartInstance.addCandlestickSeries({
        upColor: "#2ecc71",
        downColor: "#e74c3c",
        borderVisible: false,
        wickUpColor: "#2ecc71",
        wickDownColor: "#e74c3c",
      });
    }

    candlestickSeries.setData(uniqueFormattedData);
    localChartInstance.timeScale().fitContent();

    // Clear old lines
    currentPriceLines.forEach(l => {
      try { candlestickSeries.removePriceLine(l); } catch(e){}
    });
    currentPriceLines = [];

    if (profitZoneSeries) { localChartInstance.removeSeries(profitZoneSeries); profitZoneSeries = null; }
    if (lossZoneSeries) { localChartInstance.removeSeries(lossZoneSeries); lossZoneSeries = null; }

    // Plot prediction annotations
    if (predictionData && predictionData.entryPrice) {
      const entryLine = candlestickSeries.createPriceLine({
        price: Number(predictionData.entryPrice),
        color: "#29b6f6",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "ENTRADA",
      });
      currentPriceLines.push(entryLine);

      if (predictionData.sl) {
        const slLine = candlestickSeries.createPriceLine({
          price: Number(predictionData.sl),
          color: "#e74c3c",
          lineWidth: 2,
          lineStyle: 1,
          axisLabelVisible: true,
          title: "STOP LOSS",
        });
        currentPriceLines.push(slLine);
      }

      if (predictionData.tp) {
        const tpLine = candlestickSeries.createPriceLine({
          price: Number(predictionData.tp),
          color: "#2ecc71",
          lineWidth: 2,
          lineStyle: 1,
          axisLabelVisible: true,
          title: "TAKE PROFIT",
        });
        currentPriceLines.push(tpLine);
      }
    }
  } catch (error) {
    console.error("Error al cargar gráfico interactivo:", error);
  }
}
