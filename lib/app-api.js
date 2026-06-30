import { createHmac, timingSafeEqual } from "node:crypto";
import { buildBondBasket, getBondCandidates, getBondsByKind } from "./moex-bonds.js";

const SESSION_COOKIE = "ti_companion_session";

const servicePaths = {
  accounts: "/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts",
  portfolio: "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio",
  positions: "/tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions",
  lastPrices: "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
  candles: "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles",
  dividends: "/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetDividends",
  coupons: "/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetBondCoupons"
};

export async function handleApiRequest(req, res, url) {
  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      authRequired: Boolean(appPassword()),
      authenticated: isAuthenticated(req),
      tokenConfigured: Boolean(tInvestToken()) && isAuthenticated(req),
      apiBase: apiBase()
    });
    return;
  }

  if (url.pathname === "/api/login") {
    await handleLogin(req, res);
    return;
  }

  if (url.pathname === "/api/logout") {
    setCookie(res, `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!isAuthenticated(req)) {
    sendJson(res, 401, {
      error: "Authentication required",
      hint: "Enter the app password configured in APP_PASSWORD."
    });
    return;
  }

  if (url.pathname === "/api/bonds/ofz") {
    sendJson(res, 200, limitBondResponse(await getBondsByKind("ofz", Object.fromEntries(url.searchParams))));
    return;
  }

  if (url.pathname === "/api/bonds/corporate") {
    sendJson(
      res,
      200,
      limitBondResponse(await getBondsByKind("corporate", Object.fromEntries(url.searchParams)))
    );
    return;
  }

  if (url.pathname === "/api/bonds/candidates") {
    sendJson(res, 200, await getBondCandidates(Object.fromEntries(url.searchParams)));
    return;
  }

  if (url.pathname === "/api/bonds/basket") {
    const body = req.method === "POST" ? await readJson(req) : Object.fromEntries(url.searchParams);
    sendJson(res, 200, await buildBondBasket(body));
    return;
  }

  if (!tInvestToken()) {
    sendJson(res, 401, {
      error: "T_INVEST_TOKEN is not configured",
      hint: "Copy .env.example to .env and paste a read-only T-Invest API token."
    });
    return;
  }

  if (url.pathname === "/api/accounts") {
    sendJson(res, 200, await tInvest(servicePaths.accounts, {}));
    return;
  }

  if (url.pathname === "/api/portfolio") {
    const accountId = requireQuery(url, "accountId");
    sendJson(res, 200, await tInvest(servicePaths.portfolio, { accountId, currency: "RUB" }));
    return;
  }

  if (url.pathname === "/api/positions") {
    const accountId = requireQuery(url, "accountId");
    sendJson(res, 200, await tInvest(servicePaths.positions, { accountId }));
    return;
  }

  if (url.pathname === "/api/last-prices") {
    const body = await readJson(req);
    const ids = Array.isArray(body.instrumentIds) ? body.instrumentIds.filter(Boolean) : [];
    sendJson(res, 200, await fetchLastPrices(ids));
    return;
  }

  if (url.pathname === "/api/candles") {
    const instrumentId = requireQuery(url, "instrumentId");
    const days = clamp(Number(url.searchParams.get("days") || 90), 1, 365);
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    sendJson(
      res,
      200,
      await tInvest(servicePaths.candles, {
        instrumentId,
        from: from.toISOString(),
        to: to.toISOString(),
        interval: "CANDLE_INTERVAL_DAY"
      })
    );
    return;
  }

  if (url.pathname === "/api/income-calendar") {
    const accountId = requireQuery(url, "accountId");
    sendJson(res, 200, await buildIncomeCalendar(accountId));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleLogin(req, res) {
  if (!appPassword()) {
    sendJson(res, 200, { ok: true, authRequired: false });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const password = String(body.password || "");

  if (!secureEqual(password, appPassword())) {
    sendJson(res, 401, { error: "Wrong password" });
    return;
  }

  const secure = process.env.VERCEL ? "; Secure" : "";
  setCookie(
    res,
    `${SESSION_COOKIE}=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`
  );
  sendJson(res, 200, { ok: true });
}

async function fetchLastPrices(instrumentIds) {
  if (!instrumentIds.length) return { lastPrices: [] };

  try {
    return await tInvest(servicePaths.lastPrices, { instrumentId: instrumentIds });
  } catch {
    return await tInvest(servicePaths.lastPrices, { figi: instrumentIds });
  }
}

async function buildIncomeCalendar(accountId) {
  const portfolio = await tInvest(servicePaths.portfolio, { accountId, currency: "RUB" });
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const from = new Date();
  const to = new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);

  const events = [];
  const errors = [];

  for (const position of positions) {
    const instrumentId = position.instrumentUid || position.uid || position.figi;
    if (!instrumentId) continue;

    const label = position.name || position.ticker || position.figi || instrumentId;
    const type = String(position.instrumentType || "").toLowerCase();

    if (type.includes("share") || type.includes("stock")) {
      await appendCorporateEvents({
        events,
        errors,
        path: servicePaths.dividends,
        request: { instrumentId, from: from.toISOString(), to: to.toISOString() },
        rootKeys: ["dividends"],
        label,
        kind: "dividend"
      });
    }

    if (type.includes("bond")) {
      await appendCorporateEvents({
        events,
        errors,
        path: servicePaths.coupons,
        request: { instrumentId, from: from.toISOString(), to: to.toISOString() },
        rootKeys: ["events", "coupons"],
        label,
        kind: "coupon"
      });
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { events, errors: errors.slice(0, 8) };
}

async function appendCorporateEvents({ events, errors, path, request, rootKeys, label, kind }) {
  try {
    const response = await tInvest(path, request);
    const items = rootKeys.flatMap((key) => (Array.isArray(response[key]) ? response[key] : []));

    for (const item of items) {
      events.push({
        kind,
        instrument: label,
        date: item.paymentDate || item.couponDate || item.recordDate || item.fixDate || item.date,
        amount: item.dividendNet || item.payOneBond || item.couponValue || item.value,
        source: item
      });
    }
  } catch (error) {
    errors.push({ instrument: label, kind, error: error.message });
  }
}

async function tInvest(path, body) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tInvestToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? safeJson(text) : {};

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return data;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return safeJson(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function setCookie(res, cookie) {
  res.setHeader("Set-Cookie", cookie);
}

function isAuthenticated(req) {
  if (!appPassword()) return true;
  const cookies = parseCookies(req.headers.cookie || "");
  return secureEqual(cookies[SESSION_COOKIE] || "", sessionToken());
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function sessionToken() {
  return createHmac("sha256", sessionSecret()).update(appPassword()).digest("hex");
}

function apiBase() {
  return process.env.T_INVEST_API_BASE || "https://invest-public-api.tinkoff.ru/rest";
}

function tInvestToken() {
  return process.env.T_INVEST_TOKEN || "";
}

function appPassword() {
  return process.env.APP_PASSWORD || "";
}

function sessionSecret() {
  return process.env.APP_SESSION_SECRET || tInvestToken() || appPassword() || "local-dev";
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function requireQuery(url, key) {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing query parameter: ${key}`);
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function limitBondResponse(response) {
  return {
    ...response,
    accepted: response.accepted.slice(0, 120),
    excluded: response.excluded.slice(0, 200),
    truncated: response.accepted.length > 120 || response.excluded.length > 200
  };
}
