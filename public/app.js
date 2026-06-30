const state = {
  accounts: [],
  accountId: "",
  portfolio: null,
  positions: [],
  selectedInstrumentId: "",
  lastPrices: new Map(),
  incomeEvents: []
};

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  passwordInput: document.querySelector("#passwordInput"),
  loginHint: document.querySelector("#loginHint"),
  status: document.querySelector("#status"),
  accountSelect: document.querySelector("#accountSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  incomeButton: document.querySelector("#incomeButton"),
  positionFilter: document.querySelector("#positionFilter"),
  totalAmount: document.querySelector("#totalAmount"),
  yieldAmount: document.querySelector("#yieldAmount"),
  positionsCount: document.querySelector("#positionsCount"),
  cashAmount: document.querySelector("#cashAmount"),
  positionsMeta: document.querySelector("#positionsMeta"),
  positionsBody: document.querySelector("#positionsBody"),
  allocationCanvas: document.querySelector("#allocationCanvas"),
  priceCanvas: document.querySelector("#priceCanvas"),
  chartTitle: document.querySelector("#chartTitle"),
  chartDays: document.querySelector("#chartDays"),
  incomeList: document.querySelector("#incomeList"),
  incomeMeta: document.querySelector("#incomeMeta"),
  advisorContext: document.querySelector("#advisorContext"),
  copyContextButton: document.querySelector("#copyContextButton"),
  toast: document.querySelector("#toast")
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 4
});

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

init();

async function init() {
  bindEvents();
  drawEmptyCharts();
  await boot();
}

async function boot() {
  try {
    const health = await api("/api/health");

    if (health.authRequired && !health.authenticated) {
      showLogin();
      setStatus("Нужен пароль", "bad");
      renderEmptyPortfolio("Войди в приложение, чтобы загрузить портфель.");
      return;
    }

    hideLogin();
    setStatus(
      health.tokenConfigured ? "Токен настроен" : "Нужен токен в .env",
      health.tokenConfigured ? "ok" : "bad"
    );

    if (!health.tokenConfigured) {
      renderEmptyPortfolio("Добавь read-only токен в .env и перезапусти сервер.");
      return;
    }

    await loadAccounts();
  } catch (error) {
    setStatus("Сервер недоступен", "bad");
    renderEmptyPortfolio(error.message);
  }
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.loginHint.textContent = "Проверяю пароль...";

    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: els.passwordInput.value })
      });
      els.passwordInput.value = "";
      els.loginHint.textContent = "Пароль задается переменной APP_PASSWORD.";
      hideLogin();
      await boot();
    } catch (error) {
      els.loginHint.textContent = "Пароль не подошел.";
      toast(error.message);
    }
  });

  els.accountSelect.addEventListener("change", async () => {
    state.accountId = els.accountSelect.value;
    await loadPortfolio();
  });

  els.refreshButton.addEventListener("click", loadPortfolio);
  els.incomeButton.addEventListener("click", loadIncomeCalendar);
  els.positionFilter.addEventListener("input", renderPositions);
  els.chartDays.addEventListener("change", loadSelectedCandles);

  els.copyContextButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.advisorContext.value);
    toast("Контекст скопирован");
  });
}

async function loadAccounts() {
  setBusy(true);
  try {
    const data = await api("/api/accounts");
    state.accounts = data.accounts || [];

    els.accountSelect.innerHTML = state.accounts
      .map((account) => {
        const name = account.name || account.id;
        return `<option value="${escapeHtml(account.id)}">${escapeHtml(name)} · ${escapeHtml(account.type || "account")}</option>`;
      })
      .join("");

    if (!state.accounts.length) {
      renderEmptyPortfolio("API не вернул ни одного счета.");
      return;
    }

    state.accountId = state.accounts[0].id;
    els.accountSelect.value = state.accountId;
    await loadPortfolio();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function loadPortfolio() {
  if (!state.accountId) return;

  setBusy(true);
  setStatus("Загружаю портфель", "ok");

  try {
    const portfolio = await api(`/api/portfolio?accountId=${encodeURIComponent(state.accountId)}`);
    state.portfolio = portfolio;
    state.positions = portfolio.positions || [];
    state.selectedInstrumentId = getInstrumentId(state.positions[0]) || "";

    renderSummary();
    renderPositions();
    drawAllocation();
    updateAdvisorContext();
    await loadLastPrices();
    await loadSelectedCandles();
    setStatus("Портфель обновлен", "ok");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function loadLastPrices() {
  const instrumentIds = state.positions.map(getInstrumentId).filter(Boolean);
  if (!instrumentIds.length) return;

  try {
    const data = await api("/api/last-prices", {
      method: "POST",
      body: JSON.stringify({ instrumentIds })
    });
    state.lastPrices = new Map(
      (data.lastPrices || []).map((price) => [price.instrumentUid || price.figi, moneyValue(price.price)])
    );
    renderPositions();
  } catch (error) {
    toast(`Не удалось загрузить последние цены: ${error.message}`);
  }
}

async function loadSelectedCandles() {
  if (!state.selectedInstrumentId) {
    drawEmptyPriceChart("Нет выбранной позиции");
    return;
  }

  const selected = state.positions.find((position) => getInstrumentId(position) === state.selectedInstrumentId);
  els.chartTitle.textContent = selected?.name || selected?.figi || "График";

  try {
    const data = await api(
      `/api/candles?instrumentId=${encodeURIComponent(state.selectedInstrumentId)}&days=${els.chartDays.value}`
    );
    drawPriceChart(data.candles || []);
  } catch (error) {
    drawEmptyPriceChart("Свечи недоступны");
    toast(error.message);
  }
}

async function loadIncomeCalendar() {
  if (!state.accountId) return;

  setBusy(true);
  els.incomeMeta.textContent = "Собираю календарь выплат...";

  try {
    const data = await api(`/api/income-calendar?accountId=${encodeURIComponent(state.accountId)}`);
    state.incomeEvents = (data.events || []).filter((event) => event.date);
    renderIncomeCalendar();
    updateAdvisorContext();
    if (data.errors?.length) {
      toast(`Часть выплат не загрузилась: ${data.errors.length}`);
    }
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

function renderSummary() {
  const portfolio = state.portfolio || {};
  const total = moneyValue(portfolio.totalAmountPortfolio);
  const expectedYield = moneyValue(portfolio.expectedYield);
  const cash = moneyValue(portfolio.totalAmountCurrencies);

  els.totalAmount.textContent = formatMoney(total);
  els.yieldAmount.textContent = formatMoney(expectedYield);
  els.yieldAmount.className = expectedYield >= 0 ? "positive" : "negative";
  els.positionsCount.textContent = String(state.positions.length);
  els.cashAmount.textContent = formatMoney(cash);
  els.positionsMeta.textContent = `${state.positions.length} позиций в портфеле`;
}

function renderPositions() {
  const filter = els.positionFilter.value.trim().toLowerCase();
  const rows = state.positions.filter((position) => {
    const haystack = [position.name, position.ticker, position.figi, position.instrumentType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(filter);
  });

  if (!rows.length) {
    els.positionsBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Позиции не найдены</div></td></tr>`;
    return;
  }

  els.positionsBody.innerHTML = rows
    .map((position) => {
      const id = getInstrumentId(position);
      const currentPrice = state.lastPrices.get(id) ?? moneyValue(position.currentPrice);
      const value = moneyValue(position.currentNkd) + moneyValue(position.quantity) * currentPrice;
      const expectedYield = moneyValue(position.expectedYield);
      const selected = id === state.selectedInstrumentId ? "selected" : "";

      return `
        <tr class="${selected}" data-id="${escapeHtml(id)}">
          <td>
            <div class="instrument">
              <strong>${escapeHtml(position.name || position.ticker || position.figi || "Без названия")}</strong>
              <span>${escapeHtml(position.ticker || position.figi || id || "")}</span>
            </div>
          </td>
          <td>${escapeHtml(readableType(position.instrumentType))}</td>
          <td class="num">${formatNumber(moneyValue(position.quantity))}</td>
          <td class="num">${formatMoney(currentPrice)}</td>
          <td class="num">${formatMoney(value || moneyValue(position.currentPrice) * moneyValue(position.quantity))}</td>
          <td class="num ${expectedYield >= 0 ? "positive" : "negative"}">${formatMoney(expectedYield)}</td>
        </tr>
      `;
    })
    .join("");

  els.positionsBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      state.selectedInstrumentId = row.dataset.id;
      renderPositions();
      await loadSelectedCandles();
    });
  });
}

function renderIncomeCalendar() {
  if (!state.incomeEvents.length) {
    els.incomeMeta.textContent = "Выплаты на ближайший год не найдены";
    els.incomeList.innerHTML = `<div class="empty-state">Пока пусто</div>`;
    return;
  }

  els.incomeMeta.textContent = `${state.incomeEvents.length} событий на ближайший год`;
  els.incomeList.innerHTML = state.incomeEvents
    .slice(0, 80)
    .map((event) => {
      const amount = moneyValue(event.amount);
      return `
        <div class="income-item">
          <div class="income-kind">${event.kind === "coupon" ? "Купон" : "Дивиденд"}</div>
          <div>
            <strong>${escapeHtml(event.instrument)}</strong>
            <p>${formatDate(event.date)}</p>
          </div>
          <div class="num">${amount ? formatMoney(amount) : "—"}</div>
        </div>
      `;
    })
    .join("");
}

function renderEmptyPortfolio(message) {
  els.accountSelect.innerHTML = `<option>${escapeHtml(message)}</option>`;
  els.totalAmount.textContent = "—";
  els.yieldAmount.textContent = "—";
  els.positionsCount.textContent = "—";
  els.cashAmount.textContent = "—";
  els.positionsMeta.textContent = message;
  els.positionsBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  els.incomeList.innerHTML = `<div class="empty-state">Календарь выплат появится после загрузки портфеля</div>`;
  els.advisorContext.value = message;
}

function drawAllocation() {
  const canvas = els.allocationCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const buckets = new Map();
  for (const position of state.positions) {
    const type = readableType(position.instrumentType);
    const value = moneyValue(position.currentPrice) * moneyValue(position.quantity);
    buckets.set(type, (buckets.get(type) || 0) + Math.max(0, value));
  }

  const entries = [...buckets.entries()].filter((entry) => entry[1] > 0);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);

  if (!total) {
    drawCanvasMessage(ctx, width, height, "Структура появится после загрузки портфеля");
    return;
  }

  const colors = ["#0d7b67", "#d9a21b", "#4169a8", "#b9544f", "#6c7a3d", "#7559a6"];
  const centerX = 120;
  const centerY = height / 2;
  const radius = 76;
  let start = -Math.PI / 2;

  entries.forEach(([label, value], index) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    start += angle;

    const y = 58 + index * 32;
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(245, y - 10, 14, 14);
    ctx.fillStyle = "#17211d";
    ctx.font = "14px system-ui";
    ctx.fillText(label, 270, y + 2);
    ctx.fillStyle = "#66726d";
    ctx.fillText(`${Math.round((value / total) * 100)}%`, 380, y + 2);
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, 42, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

function drawPriceChart(candles) {
  const canvas = els.priceCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const points = candles
    .map((candle) => ({ time: candle.time, value: moneyValue(candle.close) }))
    .filter((point) => point.value > 0);

  if (points.length < 2) {
    drawEmptyPriceChart("Недостаточно данных");
    return;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 22;
  const range = max - min || 1;

  ctx.strokeStyle = "#dce5e1";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + (i * (height - pad * 2)) / 3;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad + (index * (width - pad * 2)) / (points.length - 1);
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = values.at(-1) >= values[0] ? "#177245" : "#ba3b46";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#66726d";
  ctx.font = "12px system-ui";
  ctx.fillText(formatMoney(max), pad, 18);
  ctx.fillText(formatMoney(min), pad, height - 8);
}

function drawEmptyCharts() {
  drawCanvasMessage(
    els.allocationCanvas.getContext("2d"),
    els.allocationCanvas.width,
    els.allocationCanvas.height,
    "Нет данных"
  );
  drawEmptyPriceChart("Нет данных");
}

function drawEmptyPriceChart(message) {
  const ctx = els.priceCanvas.getContext("2d");
  drawCanvasMessage(ctx, els.priceCanvas.width, els.priceCanvas.height, message);
}

function drawCanvasMessage(ctx, width, height, message) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#edf4f1";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#66726d";
  ctx.font = "15px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
  ctx.textAlign = "start";
}

function updateAdvisorContext() {
  const portfolio = state.portfolio || {};
  const lines = [
    "Контекст портфеля T-Invest для разбора. Не является индивидуальной инвестиционной рекомендацией.",
    "",
    `Счет: ${state.accountId}`,
    `Стоимость портфеля: ${formatMoney(moneyValue(portfolio.totalAmountPortfolio))}`,
    `Ожидаемая доходность: ${formatMoney(moneyValue(portfolio.expectedYield))}`,
    "",
    "Позиции:"
  ];

  for (const position of state.positions.slice(0, 60)) {
    lines.push(
      `- ${position.name || position.ticker || position.figi}: ${readableType(position.instrumentType)}, количество ${formatNumber(moneyValue(position.quantity))}, стоимость ${formatMoney(moneyValue(position.currentPrice) * moneyValue(position.quantity))}, доходность ${formatMoney(moneyValue(position.expectedYield))}`
    );
  }

  if (state.incomeEvents.length) {
    lines.push("", "Ближайшие выплаты:");
    for (const event of state.incomeEvents.slice(0, 30)) {
      lines.push(
        `- ${formatDate(event.date)} ${event.kind === "coupon" ? "купон" : "дивиденд"} ${event.instrument}: ${formatMoney(moneyValue(event.amount))}`
      );
    }
  }

  lines.push("", "Вопрос: проанализируй структуру, риски концентрации, валютную/секторную экспозицию и важные даты.");
  els.advisorContext.value = lines.join("\n");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.hint || data.error || data.details || response.statusText);
  }

  return data;
}

function moneyValue(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;

  const units = Number(value.units || 0);
  const nano = Number(value.nano || 0);
  return units + nano / 1_000_000_000;
}

function getInstrumentId(position) {
  return position?.instrumentUid || position?.uid || position?.figi || "";
}

function readableType(type = "") {
  const clean = String(type).toLowerCase();
  if (clean.includes("bond")) return "Облигация";
  if (clean.includes("share") || clean.includes("stock")) return "Акция";
  if (clean.includes("etf") || clean.includes("fund")) return "Фонд";
  if (clean.includes("currency")) return "Валюта";
  if (clean.includes("future")) return "Фьючерс";
  return type || "Инструмент";
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "—";
  return moneyFormatter.format(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return numberFormatter.format(value);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter.format(date);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, mode) {
  els.status.className = `status ${mode || ""}`;
  els.status.querySelector("span:last-child").textContent = message;
}

function showLogin() {
  els.loginScreen.classList.remove("hidden");
  window.setTimeout(() => els.passwordInput.focus(), 0);
}

function hideLogin() {
  els.loginScreen.classList.add("hidden");
}

function setBusy(isBusy) {
  els.refreshButton.disabled = isBusy;
  els.incomeButton.disabled = isBusy;
}

function showError(error) {
  setStatus("Ошибка", "bad");
  toast(error.message);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => els.toast.classList.remove("show"), 3600);
}
