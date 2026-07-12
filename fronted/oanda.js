// Terminal frontend client for OANDA API
let oandaToken = localStorage.getItem("oanda_token") || null;
let oandaAccountId = localStorage.getItem("oanda_account_id") || null;
let oandaIsDemo = localStorage.getItem("oanda_isdemo") !== "false";
let selectedInstrument = null;

// DOM Elements
const authForm = document.getElementById("oanda-login-form");
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const envSelect = document.getElementById("oanda-env");
const tokenInput = document.getElementById("oanda-token");
const accountIdInput = document.getElementById("oanda-accountid");

const sessionStatusText = document.getElementById("session-status-text");
const sessionStatusDot = document.getElementById("session-status-dot");
const btnRefreshData = document.getElementById("btn-refresh-data");

const accountPanel = document.getElementById("account-panel");
const accIdLabel = document.getElementById("acc-id");
const accBalance = document.getElementById("acc-balance");
const accEquity = document.getElementById("acc-equity");
const accMargin = document.getElementById("acc-margin");
const accUnrealizedPnl = document.getElementById("acc-unrealized-pnl");

const marketSearchQuery = document.getElementById("market-search-query");
const btnSearchMarkets = document.getElementById("btn-search-markets");
const marketsTableBody = document.getElementById("markets-table-body");

const selectedMarketArea = document.getElementById("selected-market-area");
const selectedMarketName = document.getElementById("selected-market-name");

const candlesTableBody = document.getElementById("candles-table-body");
const orderQty = document.getElementById("order-qty");
const orderSL = document.getElementById("order-sl");
const orderTP = document.getElementById("order-tp");

const btnOrderBuy = document.getElementById("btn-order-buy");
const btnOrderSell = document.getElementById("btn-order-sell");

const positionsSection = document.getElementById("positions-section");
const positionsTableBody = document.getElementById("positions-table-body");

// Backend API URL Helper
function getApiUrl(path) {
  const apiBase = localStorage.getItem("api-base") || window.location.origin;
  return `${apiBase}${path}`;
}

// Request Headers Helper
function getHeaders() {
  return {
    "Content-Type": "application/json",
    "x-oanda-token": oandaToken,
    "x-oanda-accountid": oandaAccountId,
    "x-oanda-isdemo": String(oandaIsDemo)
  };
}

// Initial Load
document.addEventListener("DOMContentLoaded", () => {
  // Restore saved credentials
  tokenInput.value = localStorage.getItem("oanda_token_saved") || "";
  accountIdInput.value = localStorage.getItem("oanda_accountid_saved") || "";
  envSelect.value = localStorage.getItem("oanda_env_saved") || "demo";

  updateSessionUI();
  if (oandaToken && oandaAccountId) {
    loadAccountDetails();
    loadOpenTrades();
    searchInstrument();
  }
});

// Update UI state based on session
function updateSessionUI() {
  if (oandaToken && oandaAccountId) {
    sessionStatusText.innerText = `Conectado (${oandaIsDemo ? 'Practice' : 'Real'})`;
    sessionStatusDot.className = "status-dot connected";
    btnConnect.style.display = "none";
    btnDisconnect.style.display = "block";
    btnRefreshData.style.display = "inline-block";
    accountPanel.style.display = "block";
    positionsSection.style.display = "block";
    
    // Disable inputs
    tokenInput.disabled = true;
    accountIdInput.disabled = true;
    envSelect.disabled = true;
  } else {
    sessionStatusText.innerText = "Desconectado";
    sessionStatusDot.className = "status-dot disconnected";
    btnConnect.style.display = "block";
    btnDisconnect.style.display = "none";
    btnRefreshData.style.display = "none";
    accountPanel.style.display = "none";
    positionsSection.style.display = "none";
    selectedMarketArea.style.display = "none";

    // Enable inputs
    tokenInput.disabled = false;
    accountIdInput.disabled = false;
    envSelect.disabled = false;
  }
}

// Connect Account Form Submit
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const token = tokenInput.value.trim();
  const accountId = accountIdInput.value.trim();
  const env = envSelect.value;
  const isDemo = env === "demo";

  if (!token || !accountId) {
    alert("Por favor ingresa tu Token de OANDA y el ID de Cuenta");
    return;
  }

  // Temporary assign to try verification
  oandaToken = token;
  oandaAccountId = accountId;
  oandaIsDemo = isDemo;

  btnConnect.disabled = true;
  btnConnect.innerText = "Verificando...";

  try {
    const res = await fetch(getApiUrl("/api/oanda/account/summary"), {
      method: "GET",
      headers: getHeaders()
    });
    const result = await res.json();

    if (!result.ok) {
      throw new Error(result.error || "Falla al obtener resumen de cuenta");
    }

    // Persist active session
    localStorage.setItem("oanda_token", oandaToken);
    localStorage.setItem("oanda_account_id", oandaAccountId);
    localStorage.setItem("oanda_isdemo", String(oandaIsDemo));

    // Save credentials fields for future auto-fill
    localStorage.setItem("oanda_token_saved", token);
    localStorage.setItem("oanda_accountid_saved", accountId);
    localStorage.setItem("oanda_env_saved", env);

    updateSessionUI();
    loadAccountDetails();
    loadOpenTrades();
    searchInstrument();

    alert("Cuenta OANDA conectada exitosamente");
  } catch (error) {
    console.error(error);
    alert(`Error al conectar con OANDA: ${error.message}`);
    // Clear temp variables
    oandaToken = localStorage.getItem("oanda_token");
    oandaAccountId = localStorage.getItem("oanda_account_id");
    updateSessionUI();
  } finally {
    btnConnect.disabled = false;
    btnConnect.innerText = "Conectar Cuenta";
  }
});

// Disconnect Session
btnDisconnect.addEventListener("click", () => {
  localStorage.removeItem("oanda_token");
  localStorage.removeItem("oanda_account_id");
  localStorage.removeItem("oanda_isdemo");

  oandaToken = null;
  oandaAccountId = null;
  oandaIsDemo = true;

  updateSessionUI();
  alert("Sesión OANDA desconectada localmente.");
});

// Refresh all active data
btnRefreshData.addEventListener("click", () => {
  loadAccountDetails();
  loadOpenTrades();
  if (selectedInstrument) {
    loadCandles(selectedInstrument);
  }
});

// Load Account Details (Summary)
async function loadAccountDetails() {
  try {
    const res = await fetch(getApiUrl("/api/oanda/account/summary"), {
      method: "GET",
      headers: getHeaders()
    });
    const result = await res.json();

    if (result.ok && result.data && result.data.account) {
      const acc = result.data.account;
      accIdLabel.innerText = acc.id;
      accBalance.innerText = `${Number(acc.balance).toFixed(2)} ${acc.currency}`;
      accEquity.innerText = `${Number(acc.NAV).toFixed(2)} ${acc.currency}`;
      accMargin.innerText = `${Number(acc.marginUsed).toFixed(2)} / ${Number(acc.marginAvailable).toFixed(2)} ${acc.currency}`;
      
      const pnl = Number(acc.unrealizedPL);
      accUnrealizedPnl.innerText = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ${acc.currency}`;
      accUnrealizedPnl.style.color = pnl >= 0 ? "var(--success)" : "var(--danger)";
    }
  } catch (err) {
    console.error("Error cargando detalles de cuenta:", err);
  }
}

// Search Instrument
async function searchInstrument() {
  const query = marketSearchQuery.value.trim().toUpperCase().replace('/', '_').replace('-', '_');
  if (!query) return;

  marketsTableBody.innerHTML = `
    <tr>
      <td colspan="3" class="muted" style="padding: 16px; text-align: center;">
        Buscando instrument en cuenta...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(getApiUrl("/api/oanda/instruments"), {
      method: "GET",
      headers: getHeaders()
    });
    const result = await res.json();

    if (result.ok && Array.isArray(result.data)) {
      const match = result.data.find(inst => inst.name === query || inst.displayName.toUpperCase().includes(query));

      if (match) {
        marketsTableBody.innerHTML = `
          <tr class="clickable-row" id="row-market-${match.name}">
            <td style="padding: 12px; font-weight: bold; color: var(--accent);">${match.name}</td>
            <td style="padding: 12px;">${match.displayName}</td>
            <td style="padding: 12px;">Precisión: ${match.displayPrecision} / Pip: ${match.pipLocation}</td>
          </tr>
        `;

        document.getElementById(`row-market-${match.name}`).addEventListener("click", () => {
          selectMarket(match.name);
        });

        // Auto-select match
        selectMarket(match.name);
      } else {
        marketsTableBody.innerHTML = `
          <tr>
            <td colspan="3" class="muted" style="padding: 16px; text-align: center;">
              No se encontró ningún instrumento que coincida con "${query}". Asegúrate de usar formato OANDA (ej. EUR_USD, XAU_USD).
            </td>
          </tr>
        `;
      }
    } else {
      throw new Error(result.error || "Error al obtener instrumentos");
    }
  } catch (error) {
    console.error("Error buscando instrumento:", error);
    marketsTableBody.innerHTML = `
      <tr>
        <td colspan="3" class="muted" style="padding: 16px; text-align: center; color: var(--danger);">
          Error: ${error.message}
        </td>
      </tr>
    `;
  }
}

btnSearchMarkets.addEventListener("click", searchInstrument);

// Select Market for trading & charts
function selectMarket(instrument) {
  selectedInstrument = instrument;
  selectedMarketName.innerText = instrument;
  selectedMarketArea.style.display = "block";
  loadCandles(instrument);
}

// Load price candles
async function loadCandles(instrument) {
  candlesTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="muted" style="padding: 12px; text-align: center;">
        Cargando velas...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(getApiUrl(`/api/oanda/candles/${instrument}?interval=15m&count=10`), {
      method: "GET",
      headers: getHeaders()
    });
    const result = await res.json();

    if (result.ok && Array.isArray(result.data)) {
      candlesTableBody.innerHTML = "";
      if (result.data.length === 0) {
        candlesTableBody.innerHTML = `
          <tr>
            <td colspan="5" class="muted" style="padding: 12px; text-align: center;">
              No hay velas de precio disponibles.
            </td>
          </tr>
        `;
        return;
      }

      result.data.reverse().forEach(candle => {
        const date = new Date(candle.time).toLocaleString();
        const o = Number(candle.mid.o).toFixed(4);
        const h = Number(candle.mid.h).toFixed(4);
        const l = Number(candle.mid.l).toFixed(4);
        const c = Number(candle.mid.c).toFixed(4);

        candlesTableBody.innerHTML += `
          <tr style="border-bottom: 1px solid var(--border-soft);">
            <td style="padding: 8px; font-size: 0.85em;">${date}</td>
            <td style="padding: 8px;">${o}</td>
            <td style="padding: 8px; color: var(--success);">${h}</td>
            <td style="padding: 8px; color: var(--danger);">${l}</td>
            <td style="padding: 8px; font-weight: bold;">${c}</td>
          </tr>
        `;
      });
    } else {
      throw new Error(result.error || "Error al cargar velas");
    }
  } catch (error) {
    console.error("Error al cargar velas:", error);
    candlesTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted" style="padding: 12px; text-align: center; color: var(--danger);">
          Error: ${error.message}
        </td>
      </tr>
    `;
  }
}

// Load Open Trades
async function loadOpenTrades() {
  positionsTableBody.innerHTML = `
    <tr>
      <td colspan="5" class="muted" style="padding: 16px; text-align: center;">
        Cargando operaciones abiertas...
      </td>
    </tr>
  `;

  try {
    const res = await fetch(getApiUrl("/api/oanda/trades"), {
      method: "GET",
      headers: getHeaders()
    });
    const result = await res.json();

    if (result.ok && Array.isArray(result.data)) {
      positionsTableBody.innerHTML = "";
      if (result.data.length === 0) {
        positionsTableBody.innerHTML = `
          <tr>
            <td colspan="5" class="muted" style="padding: 16px; text-align: center;">
              No hay operaciones (trades) activas
            </td>
          </tr>
        `;
        return;
      }

      result.data.forEach(trade => {
        const units = Number(trade.currentUnits);
        const direction = units > 0 ? "BUY" : "SELL";
        const entryPrice = Number(trade.price).toFixed(4);
        const pnl = Number(trade.unrealizedPL);
        const color = pnl >= 0 ? "var(--success)" : "var(--danger)";

        positionsTableBody.innerHTML += `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 12px;">${trade.id}</td>
            <td style="padding: 12px; font-weight: bold;">${trade.instrument}</td>
            <td style="padding: 12px; color: ${direction === "BUY" ? "var(--success)" : "var(--danger)"}; font-weight: bold;">${direction}</td>
            <td style="padding: 12px;">${Math.abs(units)}</td>
            <td style="padding: 12px;">${entryPrice}</td>
            <td style="padding: 12px; color: ${color}; font-weight: bold;">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
          </tr>
        `;
      });
    } else {
      throw new Error(result.error || "Error al obtener trades");
    }
  } catch (error) {
    console.error("Error al obtener trades:", error);
    positionsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="muted" style="padding: 16px; text-align: center; color: var(--danger);">
          Error: ${error.message}
        </td>
      </tr>
    `;
  }
}

// Place Order Helper
async function placeOrder(direction) {
  if (!selectedInstrument) {
    alert("Primero selecciona un instrumento");
    return;
  }

  const qty = Number(orderQty.value);
  if (!qty || qty <= 0) {
    alert("Ingresa una cantidad válida mayor a 0");
    return;
  }

  const stopLoss = orderSL.value ? Number(orderSL.value) : null;
  const takeProfit = orderTP.value ? Number(orderTP.value) : null;

  const btn = direction === "buy" ? btnOrderBuy : btnOrderSell;
  const originalText = btn.innerText;

  btn.disabled = true;
  btn.innerText = "Procesando...";

  try {
    const res = await fetch(getApiUrl("/api/oanda/order"), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        instrument: selectedInstrument,
        direction,
        quantity: qty,
        stopLoss,
        takeProfit
      })
    });
    const result = await res.json();

    if (result.ok) {
      alert(`Orden de mercado ${direction.toUpperCase()} creada con éxito.`);
      orderQty.value = "1";
      orderSL.value = "";
      orderTP.value = "";
      
      // Refresh UI data
      loadAccountDetails();
      loadOpenTrades();
    } else {
      throw new Error(result.error || "Falla al ejecutar orden");
    }
  } catch (error) {
    console.error("Error enviando orden:", error);
    alert(`Error al colocar orden: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

btnOrderBuy.addEventListener("click", () => placeOrder("buy"));
btnOrderSell.addEventListener("click", () => placeOrder("sell"));
