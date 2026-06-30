const MOEX_ISS_BASE = "https://iss.moex.com/iss";
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_BOARD = 8;

const SECURITY_COLUMNS = [
  "SECID",
  "SHORTNAME",
  "SECNAME",
  "MATDATE",
  "COUPONPERCENT",
  "COUPONVALUE",
  "ACCRUEDINT",
  "FACEVALUE",
  "CURRENCYID",
  "LISTLEVEL",
  "PREVPRICE",
  "PREVWAPRICE",
  "DURATION"
];

const MARKETDATA_COLUMNS = [
  "SECID",
  "LAST",
  "MARKETPRICE2",
  "YIELD",
  "YIELDATWAPRICE",
  "YIELDATPREVWAPRICE",
  "NUMTRADES",
  "VALTODAY_RUR",
  "BID",
  "OFFER",
  "SPREAD"
];

const QUALITY_ISSUER_KEYWORDS = [
  "РЖД",
  "РОСЖЕЛДОР",
  "СБЕР",
  "SBER",
  "МТС",
  "МТС-БАНК",
  "МАГНИТ",
  "НОРНИКЕЛ",
  "ГМК",
  "ФОСАГРО",
  "АТОМЭНЕРГОПРОМ",
  "ГАЗПРОМ",
  "ГАЗПРОМ КАПИТАЛ",
  "ГАЗПРОМ НЕФТЬ",
  "КАМАЗ",
  "ОДК"
];

const RISK_KEYWORDS = [
  "САМОЛЕТ",
  "САМОЛЁТ",
  "БРУСНИКА",
  "ГЛОРАКС",
  "СЭТЛ",
  "SETL",
  "ВИС",
  "ФЕРРОНИ",
  "ДЕВЕЛОП",
  "СТРОЙ",
  "ЗАСТРОЙ",
  "ВЫСОКОДОХ",
  "ВДО",
  "МФК",
  "МКК",
  "ЛОМБАРД"
];

const RISK_YIELD_LIMITS = {
  cautious: 24,
  balanced: 30,
  income: 38
};

export async function getBondsByKind(kind, options = {}) {
  const board = kind === "ofz" ? "TQOB" : "TQCB";
  const raw = await fetchBoardBonds(board);
  const bonds = raw.map((bond) => enrichBond(bond, kind)).filter(isUsableRubBond);
  return filterAndRankBonds(bonds, normalizePrefs(options), kind);
}

export async function getBondCandidates(options = {}) {
  const prefs = normalizePrefs(options);
  const [ofz, corporate] = await Promise.all([
    getBondsByKind("ofz", prefs),
    getBondsByKind("corporate", prefs)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    params: prefs,
    ofz: ofz.accepted.slice(0, 40),
    corporate: corporate.accepted.slice(0, 40),
    excluded: [...ofz.excluded.slice(0, 30), ...corporate.excluded.slice(0, 30)],
    warnings: [...ofz.warnings, ...corporate.warnings]
  };
}

export async function buildBondBasket(options = {}) {
  const prefs = normalizePrefs(options);
  const targetAmount = Math.max(1000, toNumber(prefs.amount, 15000));
  const investableAmount = Math.floor(targetAmount * 0.97);
  const ofzBudget = Math.floor(investableAmount * (prefs.ofzShare / 100));
  const corporateBudget = investableAmount - ofzBudget;

  const candidates = await getBondCandidates(prefs);
  const warnings = [...candidates.warnings];
  const selected = [];

  const ofzPick = pickBasketItems(candidates.ofz, ofzBudget, prefs, selected);
  selected.push(...ofzPick.items);
  warnings.push(...ofzPick.warnings.map((item) => `ОФЗ: ${item}`));

  const corporatePick = pickBasketItems(candidates.corporate, corporateBudget, prefs, selected);
  selected.push(...corporatePick.items);
  warnings.push(...corporatePick.warnings.map((item) => `Корпоративные: ${item}`));

  const invested = selected.reduce((sum, item) => sum + item.estimatedTotal, 0);
  const couponFlow = selected.reduce((sum, item) => sum + item.estimatedAnnualCoupon, 0);
  const avgYield = weightedAverage(selected, "yield", "estimatedTotal");
  const avgScore = selected.length
    ? selected.reduce((sum, item) => sum + item.score * item.quantity, 0) /
      selected.reduce((sum, item) => sum + item.quantity, 0)
    : 0;

  if (!selected.length) {
    warnings.push("Не удалось собрать корзину по заданным фильтрам и бюджету.");
  }

  const missingYield = selected.filter((item) => !item.yield).map((item) => item.secid);
  if (missingYield.length) {
    warnings.push(
      `Для части бумаг MOEX не вернул расчетную доходность: ${missingYield.slice(0, 5).join(", ")}. Средняя доходность посчитана только по доступным значениям.`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    params: prefs,
    basketScore: clamp(Math.round(avgScore * 10) / 10, 0, 10),
    suitability: describeSuitability(avgScore),
    targetAmount,
    reserve: Math.max(0, targetAmount - invested),
    invested,
    estimatedAnnualCoupon: couponFlow,
    averageYield: avgYield,
    items: selected,
    warnings: unique(warnings).slice(0, 18),
    candidates: {
      ofz: candidates.ofz.slice(0, 20),
      corporate: candidates.corporate.slice(0, 20),
      excluded: candidates.excluded.slice(0, 35)
    },
    disclaimer:
      "Это аналитический инструмент и не является индивидуальной инвестиционной рекомендацией. Данные могут устаревать. Перед покупкой проверьте цену, НКД, доходность, дату погашения, оферты, ликвидность, комиссии, налоги и ограничения брокера. Финальное решение принимает инвестор."
  };
}

async function fetchBoardBonds(board) {
  const all = new Map();

  for (let page = 0; page < MAX_PAGES_PER_BOARD; page += 1) {
    const start = page * PAGE_LIMIT;
    const url = new URL(
      `${MOEX_ISS_BASE}/engines/stock/markets/bonds/boards/${board}/securities.json`
    );
    url.searchParams.set("iss.meta", "off");
    url.searchParams.set("iss.only", "securities,marketdata");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("start", String(start));
    url.searchParams.set("securities.columns", SECURITY_COLUMNS.join(","));
    url.searchParams.set("marketdata.columns", MARKETDATA_COLUMNS.join(","));

    const data = await fetchJson(url);
    const securities = parseMoexTable(data.securities);
    const marketdata = new Map(parseMoexTable(data.marketdata).map((row) => [row.SECID, row]));

    let newRows = 0;
    for (const security of securities) {
      if (all.has(security.SECID)) continue;
      all.set(security.SECID, { ...security, ...(marketdata.get(security.SECID) || {}), board });
      newRows += 1;
    }

    if (newRows === 0 || securities.length < PAGE_LIMIT || securities.length > PAGE_LIMIT * 3) break;
  }

  return [...all.values()];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`MOEX ISS ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

function parseMoexTable(table) {
  if (!table?.columns || !Array.isArray(table.data)) return [];
  return table.data.map((row) =>
    Object.fromEntries(table.columns.map((column, index) => [column, row[index]]))
  );
}

function enrichBond(row, kind) {
  const name = String(row.SECNAME || row.SHORTNAME || row.SECID || "");
  const shortName = String(row.SHORTNAME || row.SECID || "");
  const pricePercent = firstNumber(
    row.LAST,
    row.MARKETPRICE2,
    row.PREVWAPRICE,
    row.PREVPRICE,
    row.BID,
    row.OFFER
  );
  const faceValue = firstNumber(row.FACEVALUE, 1000);
  const accruedInt = firstNumber(row.ACCRUEDINT, 0);
  const unitCost = pricePercent > 0 ? (pricePercent * faceValue) / 100 + accruedInt : 0;
  const yieldValue = firstNumber(row.YIELD, row.YIELDATWAPRICE, row.YIELDATPREVWAPRICE, 0);
  const couponPercent = firstNumber(row.COUPONPERCENT, 0);
  const couponValue = firstNumber(row.COUPONVALUE, 0);
  const listLevel = toNumber(row.LISTLEVEL, 0);
  const numTrades = toNumber(row.NUMTRADES, 0);
  const turnover = toNumber(row.VALTODAY_RUR, 0);
  const spread = Math.max(0, firstNumber(row.SPREAD, 0));
  const maturityDate = row.MATDATE || "";
  const maturityYear = maturityDate ? Number(String(maturityDate).slice(0, 4)) : 0;
  const durationDays = normalizeDuration(row.DURATION);
  const isFloater = isFloatingBond(name, shortName);
  const issuer = detectIssuer(name, shortName);
  const riskFlags = detectRiskFlags(name, shortName, yieldValue, kind);
  const score = scoreBond({
    kind,
    yieldValue,
    turnover,
    numTrades,
    spread,
    maturityYear,
    durationDays,
    listLevel,
    riskFlags,
    issuer,
    isFloater
  });

  return {
    secid: row.SECID,
    shortName,
    name,
    kind,
    type: kind === "ofz" ? (isFloater ? "ОФЗ-ПК / флоатер" : "ОФЗ-ПД / фиксированный") : "Корпоративная",
    board: row.board,
    maturityDate,
    maturityYear,
    couponPercent,
    couponValue,
    accruedInt,
    faceValue,
    currency: row.CURRENCYID || "",
    listLevel,
    pricePercent,
    unitCost,
    yield: yieldValue,
    durationDays,
    durationYears: durationDays ? Math.round((durationDays / 365) * 10) / 10 : 0,
    numTrades,
    turnover,
    bid: toNumber(row.BID, 0),
    offer: toNumber(row.OFFER, 0),
    spread,
    issuer,
    isQualityIssuer: kind === "ofz" || isQualityIssuer(name, shortName),
    isFloater,
    riskFlags,
    score
  };
}

function filterAndRankBonds(bonds, prefs, kind) {
  const accepted = [];
  const excluded = [];
  const warnings = [];

  for (const bond of bonds) {
    const reasons = exclusionReasons(bond, prefs, kind);
    if (reasons.length) {
      excluded.push({ ...summaryBond(bond), reasons });
    } else {
      accepted.push(summaryBond(bond));
    }
  }

  accepted.sort((a, b) => b.score - a.score || b.turnover - a.turnover || b.yield - a.yield);

  if (!accepted.length) {
    warnings.push(`${kind === "ofz" ? "ОФЗ" : "Корпоративные облигации"} не найдены по текущим фильтрам.`);
  }

  return { accepted, excluded, warnings };
}

function exclusionReasons(bond, prefs, kind) {
  const reasons = [];

  if (!["RUB", "SUR"].includes(String(bond.currency).toUpperCase())) {
    reasons.push("валюта не RUB/SUR");
  }

  if (bond.faceValue < 900 || bond.faceValue > 1200) {
    reasons.push("номинал заметно отличается от 1000 ₽");
  }

  if (!bond.unitCost || bond.pricePercent <= 0) {
    reasons.push("нет актуальной цены");
  }

  if (bond.maturityYear && bond.maturityYear > prefs.maxMaturityYear) {
    reasons.push(`погашение позже ${prefs.maxMaturityYear}`);
  }

  if (kind === "corporate") {
    if (![1, 2].includes(bond.listLevel)) reasons.push("листинг не 1/2 уровня");
    if (bond.numTrades <= 0 || bond.turnover <= 0) reasons.push("нет сделок или оборота");
    if (prefs.qualityOnly && !bond.isQualityIssuer) reasons.push("эмитент не в whitelist качества");
    if (prefs.excludeDevelopers && bond.riskFlags.length) reasons.push(bond.riskFlags.join(", "));
    if (bond.yield > RISK_YIELD_LIMITS[prefs.riskProfile]) {
      reasons.push("доходность сильно выше выбранного риск-профиля");
    }
  }

  if (kind === "ofz" && bond.turnover <= 0 && bond.numTrades <= 0) {
    reasons.push("низкая ликвидность");
  }

  return reasons;
}

function pickBasketItems(candidates, budget, prefs, alreadySelected) {
  const items = [];
  const warnings = [];
  let remaining = budget;
  const issuerCounts = countByIssuer(alreadySelected);

  for (const bond of candidates) {
    if (remaining <= 0) break;
    if (!bond.unitCost || bond.unitCost > remaining) continue;

    const maxByIssuer = Math.max(1, Math.floor((prefs.maxIssuerShare / 100) * prefs.amount / bond.unitCost));
    const currentIssuerCount = issuerCounts.get(bond.issuer) || 0;
    if (bond.kind === "corporate" && currentIssuerCount >= Math.min(2, maxByIssuer)) continue;

    const quantity = Math.min(
      Math.floor(remaining / bond.unitCost),
      bond.kind === "corporate" ? Math.max(1, Math.min(2, maxByIssuer - currentIssuerCount)) : 10
    );

    if (quantity <= 0) continue;

    const estimatedTotal = roundMoney(quantity * bond.unitCost);
    items.push({
      ...bond,
      quantity,
      estimatedTotal,
      estimatedAnnualCoupon: roundMoney(quantity * bond.couponValue)
    });
    remaining -= estimatedTotal;
    issuerCounts.set(bond.issuer, currentIssuerCount + quantity);
  }

  if (!items.length && budget >= 1000) {
    warnings.push("по бюджету и фильтрам не найдено подходящих выпусков");
  }

  return { items, warnings };
}

function summaryBond(bond) {
  return {
    secid: bond.secid,
    shortName: bond.shortName,
    name: bond.name,
    kind: bond.kind,
    type: bond.type,
    maturityDate: bond.maturityDate,
    maturityYear: bond.maturityYear,
    couponPercent: roundNumber(bond.couponPercent),
    couponValue: roundMoney(bond.couponValue),
    accruedInt: roundMoney(bond.accruedInt),
    faceValue: roundMoney(bond.faceValue),
    currency: bond.currency,
    listLevel: bond.listLevel,
    pricePercent: roundNumber(bond.pricePercent),
    unitCost: roundMoney(bond.unitCost),
    yield: roundNumber(bond.yield),
    durationYears: bond.durationYears,
    numTrades: bond.numTrades,
    turnover: roundMoney(bond.turnover),
    spread: roundNumber(bond.spread),
    issuer: bond.issuer,
    isQualityIssuer: bond.isQualityIssuer,
    isFloater: bond.isFloater,
    riskFlags: bond.riskFlags,
    score: bond.score
  };
}

function scoreBond({
  kind,
  yieldValue,
  turnover,
  numTrades,
  spread,
  maturityYear,
  durationDays,
  listLevel,
  riskFlags,
  issuer,
  isFloater
}) {
  let score = kind === "ofz" ? 6.5 : 4.8;

  score += clamp(yieldValue / 10, 0, 1.6);
  score += clamp(Math.log10(Math.max(turnover, 1)) - 4, 0, 1.2);
  score += clamp(numTrades / 120, 0, 0.8);

  if (spread > 0) score -= clamp(spread / 1.5, 0, 1.5);
  if (maturityYear >= 2027 && maturityYear <= 2031) score += 0.55;
  if (maturityYear > 2033) score -= 1.2;
  if (durationDays > 0 && durationDays < 1200) score += 0.45;
  if (durationDays > 2200) score -= 1.1;
  if (listLevel === 1) score += 0.6;
  if (listLevel === 2) score += 0.25;
  if (kind === "corporate" && isQualityIssuer(issuer)) score += 0.8;
  if (isFloater) score += 0.25;
  score -= riskFlags.length * 1.6;

  return clamp(Math.round(score * 10) / 10, 1, 9.4);
}

function normalizePrefs(options) {
  const ofzShare = clamp(toNumber(options.ofzShare, 65), 0, 100);
  return {
    amount: Math.max(1000, toNumber(options.amount, 15000)),
    riskProfile: ["cautious", "balanced", "income"].includes(options.riskProfile)
      ? options.riskProfile
      : "balanced",
    ofzShare,
    corporateShare: 100 - ofzShare,
    maxIssuerShare: clamp(toNumber(options.maxIssuerShare, 7), 1, 50),
    maxMaturityYear: clamp(toNumber(options.maxMaturityYear, 2031), 2026, 2055),
    qualityOnly: options.qualityOnly !== false,
    excludeDevelopers: options.excludeDevelopers !== false
  };
}

function isUsableRubBond(bond) {
  return Boolean(bond.secid && bond.name && bond.faceValue > 0);
}

function isFloatingBond(...values) {
  const text = values.join(" ").toUpperCase();
  return text.includes("ОФЗ-ПК") || text.includes("ФЛОАТ") || text.includes("FLOAT");
}

function detectIssuer(...values) {
  const text = values.join(" ").toUpperCase();
  if (text.includes("ОФЗ")) return "Минфин РФ";
  const quality = QUALITY_ISSUER_KEYWORDS.find((keyword) => text.includes(keyword));
  if (quality) return quality;
  const compact = String(values.find(Boolean) || "").split(/[-\s,.;:()]+/).filter(Boolean);
  return compact.slice(0, 2).join(" ") || "Не определен";
}

function isQualityIssuer(...values) {
  const text = values.join(" ").toUpperCase();
  return QUALITY_ISSUER_KEYWORDS.some((keyword) => text.includes(keyword));
}

function detectRiskFlags(name, shortName, yieldValue, kind) {
  if (kind === "ofz") return [];
  const text = `${name} ${shortName}`.toUpperCase();
  const flags = RISK_KEYWORDS.filter((keyword) => text.includes(keyword)).map(
    (keyword) => `повышенный риск: ${keyword}`
  );
  if (yieldValue > 32) flags.push("очень высокая доходность");
  return unique(flags);
}

function countByIssuer(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.issuer, (counts.get(item.issuer) || 0) + item.quantity);
  return counts;
}

function weightedAverage(items, valueKey, weightKey) {
  const validItems = items.filter((item) => item[valueKey] > 0 && item[weightKey] > 0);
  const totalWeight = validItems.reduce((sum, item) => sum + item[weightKey], 0);
  if (!totalWeight) return 0;
  const value =
    validItems.reduce((sum, item) => sum + item[valueKey] * item[weightKey], 0) / totalWeight;
  return roundNumber(value);
}

function describeSuitability(score) {
  if (score >= 8) return "Сильная корзина к ручному разбору";
  if (score >= 6.5) return "Умеренно подходящая корзина к ручному разбору";
  if (score > 0) return "Требует осторожного ручного разбора";
  return "Не собрана";
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value, NaN);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function toNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDuration(value) {
  const duration = toNumber(value, 0);
  if (!duration) return 0;
  return duration < 40 ? duration * 365 : duration;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundNumber(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
