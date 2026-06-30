const state = {
  accounts: [],
  accountId: "",
  portfolio: null,
  positions: [],
  selectedInstrumentId: "",
  lastPrices: new Map(),
  incomeEvents: [],
  bondBasket: null,
  bondReminders: [],
  bondsLoading: false
};

const BOND_REMINDERS_KEY = "t_invest_bond_reminders_v1";

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  passwordInput: document.querySelector("#passwordInput"),
  loginHint: document.querySelector("#loginHint"),
  status: document.querySelector("#status"),
  accountSelect: document.querySelector("#accountSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  incomeButton: document.querySelector("#incomeButton"),
  bondsScrollButton: document.querySelector("#bondsScrollButton"),
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
  incomeNextAmount: document.querySelector("#incomeNextAmount"),
  incomeNextDate: document.querySelector("#incomeNextDate"),
  incomeMonthAmount: document.querySelector("#incomeMonthAmount"),
  incomeMonthCount: document.querySelector("#incomeMonthCount"),
  incomeYearAmount: document.querySelector("#incomeYearAmount"),
  incomeYearCount: document.querySelector("#incomeYearCount"),
  advisorContext: document.querySelector("#advisorContext"),
  copyContextButton: document.querySelector("#copyContextButton"),
  bondsSection: document.querySelector("#bondsSection"),
  bondForm: document.querySelector("#bondForm"),
  loadBondsButton: document.querySelector("#loadBondsButton"),
  bondAmount: document.querySelector("#bondAmount"),
  bondRisk: document.querySelector("#bondRisk"),
  bondOfzShare: document.querySelector("#bondOfzShare"),
  bondCorporateShare: document.querySelector("#bondCorporateShare"),
  bondIssuerShare: document.querySelector("#bondIssuerShare"),
  bondMaturityYear: document.querySelector("#bondMaturityYear"),
  bondQualityOnly: document.querySelector("#bondQualityOnly"),
  bondExcludeRisky: document.querySelector("#bondExcludeRisky"),
  bondBasketScore: document.querySelector("#bondBasketScore"),
  bondInvested: document.querySelector("#bondInvested"),
  bondReserve: document.querySelector("#bondReserve"),
  bondAverageYield: document.querySelector("#bondAverageYield"),
  bondBasketMeta: document.querySelector("#bondBasketMeta"),
  bondBestWindow: document.querySelector("#bondBestWindow"),
  bondBestWindowDetail: document.querySelector("#bondBestWindowDetail"),
  bondItemsCount: document.querySelector("#bondItemsCount"),
  bondCouponFlow: document.querySelector("#bondCouponFlow"),
  bondBasketCards: document.querySelector("#bondBasketCards"),
  bondRemindersList: document.querySelector("#bondRemindersList"),
  ofzList: document.querySelector("#ofzList"),
  corporateList: document.querySelector("#corporateList"),
  excludedBondList: document.querySelector("#excludedBondList"),
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
  state.bondReminders = loadBondReminders();
  bindEvents();
  renderBondReminders();
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
    loadBondBasket().catch((error) => showBondError(error));
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
  els.bondsScrollButton.addEventListener("click", () => {
    els.bondsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.positionFilter.addEventListener("input", renderPositions);
  els.chartDays.addEventListener("change", loadSelectedCandles);
  els.loadBondsButton.addEventListener("click", loadBondBasket);
  els.bondBasketCards.addEventListener("click", handleBondBasketAction);
  els.bondRemindersList.addEventListener("click", handleBondReminderAction);
  els.bondForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadBondBasket();
  });
  els.bondOfzShare.addEventListener("input", syncBondShares);

  els.copyContextButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.advisorContext.value);
    toast("Контекст скопирован");
  });
}

async function loadBondBasket() {
  if (state.bondsLoading) return;

  state.bondsLoading = true;
  els.loadBondsButton.disabled = true;
  els.bondBasketMeta.textContent = "Загружаю данные MOEX ISS...";
  renderBondLoading();

  try {
    const basket = await api("/api/bonds/basket", {
      method: "POST",
      body: JSON.stringify(getBondParams())
    });
    state.bondBasket = basket;
    renderBondBasket();
  } catch (error) {
    showBondError(error);
  } finally {
    state.bondsLoading = false;
    els.loadBondsButton.disabled = false;
  }
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
    renderIncomeSummary([]);
    return;
  }

  els.incomeMeta.textContent = `${state.incomeEvents.length} событий на ближайший год`;
  renderIncomeSummary(state.incomeEvents);
  els.incomeList.innerHTML = state.incomeEvents
    .slice(0, 80)
    .map((event) => {
      const amount = moneyValue(event.amount);
      return `
        <div class="income-item">
          <div class="income-kind">${event.kind === "coupon" ? "Купон" : "Дивиденд"}</div>
          <div>
            <strong>${escapeHtml(event.instrument)}</strong>
            <p>${formatDate(event.date)} · ${formatNumber(event.quantity || 0)} шт.</p>
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
  renderIncomeSummary([]);
  els.advisorContext.value = message;
}

function renderIncomeSummary(events) {
  const now = new Date();
  const monthEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const yearEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const futureEvents = events.filter((event) => new Date(event.date) >= startOfDay(now));
  const monthEvents = futureEvents.filter((event) => new Date(event.date) <= monthEnd);
  const yearEvents = futureEvents.filter((event) => new Date(event.date) <= yearEnd);
  const next = futureEvents[0];

  els.incomeNextAmount.textContent = next ? formatMoney(moneyValue(next.amount)) : "—";
  els.incomeNextDate.textContent = next ? `${formatDate(next.date)} · ${next.instrument}` : "нет данных";
  els.incomeMonthAmount.textContent = formatMoney(sumEventAmounts(monthEvents));
  els.incomeMonthCount.textContent = `${monthEvents.length} выплат`;
  els.incomeYearAmount.textContent = formatMoney(sumEventAmounts(yearEvents));
  els.incomeYearCount.textContent = `${yearEvents.length} выплат`;
}

function renderBondLoading() {
  els.bondBasketScore.textContent = "—";
  els.bondInvested.textContent = "—";
  els.bondReserve.textContent = "—";
  els.bondAverageYield.textContent = "—";
  els.bondBestWindow.textContent = "—";
  els.bondBestWindowDetail.textContent = "Загружаю календарь купонов";
  els.bondItemsCount.textContent = "—";
  els.bondCouponFlow.textContent = "—";
  els.bondBasketCards.innerHTML = `<div class="empty-state">Загружаю облигации с MOEX ISS...</div>`;
  els.ofzList.innerHTML = `<div class="empty-state">Загружаю ОФЗ</div>`;
  els.corporateList.innerHTML = `<div class="empty-state">Загружаю корпоративные выпуски</div>`;
  els.excludedBondList.innerHTML = `<div class="empty-state">Проверяю исключения</div>`;
}

function renderBondBasket() {
  const basket = state.bondBasket;
  if (!basket) return;

  els.bondBasketScore.textContent = basket.basketScore ? `${formatNumber(basket.basketScore)} / 10` : "—";
  els.bondInvested.textContent = formatMoney(basket.invested);
  els.bondReserve.textContent = formatMoney(basket.reserve);
  els.bondAverageYield.textContent = basket.averageYield ? `${formatNumber(basket.averageYield)}%` : "—";
  els.bondBasketMeta.textContent = `${basket.suitability}. Купонный поток: ${formatMoney(basket.estimatedAnnualCoupon)} в год, если данные купонов актуальны.`;
  renderBondActionSummary(basket);

  if (!basket.items?.length) {
    els.bondBasketCards.innerHTML = `<div class="empty-state">Корзина не собрана по текущим фильтрам</div>`;
  } else {
    els.bondBasketCards.innerHTML = basket.items.map(renderBondBasketCard).join("");
  }

  els.ofzList.innerHTML = renderBondCards(basket.candidates?.ofz || [], "ofz");
  els.corporateList.innerHTML = renderBondCards(basket.candidates?.corporate || [], "corporate");
  els.excludedBondList.innerHTML = renderExcludedBondCards(basket.candidates?.excluded || [], basket.warnings || []);
}

function renderBondActionSummary(basket) {
  const items = basket.items || [];
  const waitItems = items.filter((item) => item.buyWindow?.tone === "wait");
  const watchItems = items.filter((item) => item.buyWindow?.tone === "watch");
  const best = waitItems[0] || watchItems[0] || items[0];

  els.bondBestWindow.textContent = best?.buyWindow?.label || "Проверить вручную";
  els.bondBestWindowDetail.textContent =
    best?.buyWindow?.detail || "Сверь НКД, ближайший купон и оферты перед покупкой.";
  els.bondItemsCount.textContent = String(items.length || "—");
  els.bondCouponFlow.textContent = formatMoney(basket.estimatedAnnualCoupon || 0);
}

function renderBondBasketCard(bond) {
  const timingTone = bond.buyWindow?.tone || "warn";
  const timingLabel = bond.buyWindow?.label || "Проверить вручную";
  const timingDetail = bond.buyWindow?.detail || "Проверьте календарь купонов у брокера.";
  const nextCoupon = bond.nextCoupon?.date
    ? `${formatDate(bond.nextCoupon.date)} · ${formatMoney(bond.nextCoupon.value || bond.couponValue)}`
    : "нет данных";
  const reminderDate = bond.reminder?.date ? formatDate(bond.reminder.date) : "нет даты";
  const reminderDisabled = bond.reminder?.date ? "" : "disabled";

  return `
    <article class="basket-card">
      <div class="basket-card-main">
        <div>
          <div class="bond-card-title">
            <strong>${escapeHtml(bond.shortName || bond.name)}</strong>
            <span>${escapeHtml(bond.secid)}</span>
          </div>
          <p>${escapeHtml(bond.issuer)} · ${escapeHtml(bond.type)}</p>
        </div>
        <div class="basket-card-total">
          <strong>${formatMoney(bond.estimatedTotal)}</strong>
          <span>${formatNumber(bond.quantity)} шт. · ${formatMoney(bond.unitCost)} за шт.</span>
        </div>
      </div>
      <div class="basket-card-grid">
        <div>
          <span>Когда смотреть</span>
          <strong class="timing-${escapeHtml(timingTone)}">${escapeHtml(timingLabel)}</strong>
          <small>${escapeHtml(timingDetail)}</small>
        </div>
        <div>
          <span>Ближайший купон</span>
          <strong>${escapeHtml(nextCoupon)}</strong>
          <small>После выплаты НКД обычно становится ниже</small>
        </div>
        <div>
          <span>Доходность / оценка</span>
          <strong>${formatNumber(bond.yield)}% · ${formatNumber(bond.score)}/10</strong>
          <small>Не гарантия доходности</small>
        </div>
        <div>
          <span>Ликвидность</span>
          <strong>${formatLiquidityShort(bond)}</strong>
          <small>${formatDate(bond.maturityDate)} погашение</small>
        </div>
      </div>
      <div class="basket-actions">
        <div>
          <span>Напоминание</span>
          <strong>${escapeHtml(reminderDate)}</strong>
          <small>${escapeHtml(bond.reminder?.note || "Нет даты купона для автоматического напоминания.")}</small>
        </div>
        <button type="button" data-action="save-bond-reminder" data-secid="${escapeHtml(bond.secid)}" ${reminderDisabled}>
          Напомнить
        </button>
        <button type="button" class="secondary-button" data-action="download-bond-ics" data-secid="${escapeHtml(bond.secid)}" ${reminderDisabled}>
          Apple Calendar
        </button>
      </div>
      <details class="basket-details">
        <summary>Детали и риски</summary>
        <div class="basket-detail-body">
          <p>Купон: ${formatMoney(bond.couponValue)} / ${formatNumber(bond.couponPercent)}%. НКД: ${formatMoney(bond.accruedInt)}. Оборот: ${formatMoney(bond.turnover)}.</p>
          ${renderRiskTags(bond)}
        </div>
      </details>
    </article>
  `;
}

function handleBondBasketAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const bond = findBasketBond(button.dataset.secid);
  const reminder = buildBondReminder(bond);

  if (!reminder) {
    toast("Для этой облигации нет даты купона для напоминания.");
    return;
  }

  if (button.dataset.action === "save-bond-reminder") {
    upsertBondReminder(reminder);
    toast("Напоминание добавлено в список.");
  }

  if (button.dataset.action === "download-bond-ics") {
    downloadReminderIcs(reminder);
    toast("Файл календаря скачан. Открой его в Apple Calendar.");
  }
}

function handleBondReminderAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const reminder = state.bondReminders.find((item) => item.id === button.dataset.id);
  if (!reminder) return;

  if (button.dataset.action === "download-reminder-ics") {
    downloadReminderIcs(reminder);
    toast("Файл календаря скачан. Открой его в Apple Calendar.");
  }

  if (button.dataset.action === "delete-reminder") {
    state.bondReminders = state.bondReminders.filter((item) => item.id !== reminder.id);
    saveBondReminders();
    renderBondReminders();
    toast("Напоминание удалено.");
  }
}

function findBasketBond(secid) {
  return (state.bondBasket?.items || []).find((bond) => bond.secid === secid);
}

function buildBondReminder(bond) {
  if (!bond?.reminder?.date) return null;

  const title = bond.reminder.title || `Проверить облигацию ${bond.shortName || bond.name || bond.secid}`;
  const details = [
    bond.reminder.note,
    `SECID: ${bond.secid}`,
    `Количество в корзине: ${formatNumber(bond.quantity)} шт.`,
    `Цена с НКД на момент подбора: ${formatMoney(bond.unitCost)}`,
    `Окно ручного разбора: ${bond.reminder.date}${bond.reminder.windowEnd ? ` - ${bond.reminder.windowEnd}` : ""}`,
    bond.buyWindow?.detail,
    "Не является индивидуальной инвестиционной рекомендацией."
  ].filter(Boolean);

  return {
    id: `bond-${bond.secid}-${bond.reminder.date}`,
    secid: bond.secid,
    shortName: bond.shortName || bond.name || bond.secid,
    date: bond.reminder.date,
    windowEnd: bond.reminder.windowEnd,
    title,
    description: details.join("\n"),
    createdAt: new Date().toISOString()
  };
}

function upsertBondReminder(reminder) {
  state.bondReminders = [
    reminder,
    ...state.bondReminders.filter((item) => item.id !== reminder.id)
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  saveBondReminders();
  renderBondReminders();
}

function renderBondReminders() {
  if (!els.bondRemindersList) return;

  if (!state.bondReminders.length) {
    els.bondRemindersList.innerHTML = `<div class="empty-state">Сохрани напоминание из карточки облигации, затем экспортируй его в Apple Calendar.</div>`;
    return;
  }

  els.bondRemindersList.innerHTML = state.bondReminders
    .map(
      (reminder) => `
        <article class="reminder-item">
          <div>
            <span>${escapeHtml(reminder.secid)}</span>
            <strong>${escapeHtml(reminder.shortName)}</strong>
            <small>${formatDate(reminder.date)} · ${escapeHtml(reminder.title)}</small>
          </div>
          <button type="button" class="secondary-button" data-action="download-reminder-ics" data-id="${escapeHtml(reminder.id)}">
            Apple Calendar
          </button>
          <button type="button" class="ghost-button" data-action="delete-reminder" data-id="${escapeHtml(reminder.id)}">
            Удалить
          </button>
        </article>
      `
    )
    .join("");
}

function loadBondReminders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOND_REMINDERS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.date) : [];
  } catch {
    return [];
  }
}

function saveBondReminders() {
  try {
    localStorage.setItem(BOND_REMINDERS_KEY, JSON.stringify(state.bondReminders));
  } catch {
    toast("Браузер не дал сохранить напоминание локально.");
  }
}

function downloadReminderIcs(reminder) {
  const content = buildReminderIcs(reminder);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(reminder.secid)}-${reminder.date}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildReminderIcs(reminder) {
  const uid = `${reminder.id}@t-invest-companion`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//T-Invest Companion//Bond Reminder//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART:${formatIcsLocalDateTime(reminder.date, 9, 0)}`,
    `DTEND:${formatIcsLocalDateTime(reminder.date, 9, 30)}`,
    `SUMMARY:${escapeIcs(reminder.title)}`,
    `DESCRIPTION:${escapeIcs(reminder.description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(reminder.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function renderBondCards(bonds) {
  if (!bonds.length) return `<div class="empty-state">Нет бумаг по текущим фильтрам</div>`;

  return bonds
    .slice(0, 12)
    .map(
      (bond) => `
        <article class="bond-card">
          <strong>${escapeHtml(bond.secid)} · ${escapeHtml(bond.shortName || bond.name)}</strong>
          <span>${escapeHtml(bond.type)} · погашение ${formatDate(bond.maturityDate)}</span>
          <div class="bond-tags">
            <span class="bond-tag">${formatNumber(bond.yield)}%</span>
            <span class="bond-tag">${formatMoney(bond.unitCost)}</span>
            <span class="bond-tag">оценка ${formatNumber(bond.score)}/10</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderExcludedBondCards(bonds, warnings) {
  const warningHtml = warnings.length
    ? warnings
        .slice(0, 6)
        .map((warning) => `<article class="bond-card"><strong>Предупреждение</strong><p>${escapeHtml(warning)}</p></article>`)
        .join("")
    : "";

  const bondsHtml = bonds
    .slice(0, 12)
    .map(
      (bond) => `
        <article class="bond-card">
          <strong>${escapeHtml(bond.secid)} · ${escapeHtml(bond.shortName || bond.name)}</strong>
          <span>${escapeHtml(bond.issuer || "Эмитент не определен")}</span>
          <div class="bond-tags">
            ${(bond.reasons || []).slice(0, 3).map((reason) => `<span class="bond-tag warn">${escapeHtml(reason)}</span>`).join("")}
          </div>
        </article>
      `
    )
    .join("");

  return warningHtml || bondsHtml ? `${warningHtml}${bondsHtml}` : `<div class="empty-state">Исключений нет</div>`;
}

function showBondError(error) {
  els.bondBasketMeta.textContent = "Не удалось загрузить облигации";
  els.bondBasketCards.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  els.bondBestWindow.textContent = "Ошибка";
  els.bondBestWindowDetail.textContent = "MOEX ISS недоступен или вернул ошибку";
  els.ofzList.innerHTML = `<div class="empty-state">MOEX ISS недоступен или вернул ошибку</div>`;
  els.corporateList.innerHTML = `<div class="empty-state">Попробуй обновить подбор позже</div>`;
  els.excludedBondList.innerHTML = `<div class="empty-state">Нет данных</div>`;
  toast(error.message);
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

function getBondParams() {
  syncBondShares();
  return {
    amount: Number(els.bondAmount.value || 15000),
    riskProfile: els.bondRisk.value,
    ofzShare: Number(els.bondOfzShare.value || 65),
    corporateShare: Number(els.bondCorporateShare.value || 35),
    maxIssuerShare: Number(els.bondIssuerShare.value || 7),
    maxMaturityYear: Number(els.bondMaturityYear.value || 2031),
    qualityOnly: els.bondQualityOnly.checked,
    excludeDevelopers: els.bondExcludeRisky.checked
  };
}

function syncBondShares() {
  const ofzShare = Math.min(100, Math.max(0, Number(els.bondOfzShare.value || 0)));
  els.bondOfzShare.value = String(ofzShare);
  els.bondCorporateShare.value = String(100 - ofzShare);
}

function renderRiskTags(bond) {
  const tags = [];
  if (bond.kind === "ofz") tags.push("ОФЗ");
  if (bond.isQualityIssuer) tags.push("whitelist");
  if (bond.isFloater) tags.push("флоатер");
  for (const flag of bond.riskFlags || []) tags.push(flag);

  return `
    <div class="bond-tags">
      ${tags.slice(0, 4).map((tag) => `<span class="bond-tag ${(tag.includes("риск") || tag.includes("доходность")) ? "warn" : ""}">${escapeHtml(tag)}</span>`).join("") || `<span class="bond-tag">без флагов</span>`}
    </div>
  `;
}

function formatLiquidity(bond) {
  const turnover = bond.turnover ? formatMoney(bond.turnover) : "—";
  const trades = bond.numTrades ? `${formatNumber(bond.numTrades)} сделок` : "нет сделок";
  return `${turnover}, ${trades}`;
}

function formatLiquidityShort(bond) {
  if (bond.numTrades) return `${formatNumber(bond.numTrades)} сделок`;
  if (bond.turnover) return formatMoney(bond.turnover);
  return "нет данных";
}

function sumEventAmounts(events) {
  return events.reduce((sum, event) => sum + moneyValue(event.amount), 0);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
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

function escapeIcs(value = "") {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function formatIcsTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatIcsLocalDateTime(dateText, hour, minute) {
  const compactDate = String(dateText).slice(0, 10).replaceAll("-", "");
  return `${compactDate}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}00`;
}

function safeFileName(value = "reminder") {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "reminder";
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
