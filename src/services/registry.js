// HTTP-клиент контура Стадии 0: registry-api (FastAPI) + oracle (ADNA).
// Если URL не заданы — методы кидают понятную ошибку; блокчейн-инструменты
// продолжают работать независимо (реестр — опциональный слой).

import { config } from "../config/index.js";

const FETCH_TIMEOUT_MS = 20_000;   // реестр/оракул: выше — сеттлмент, ниже — читалка

async function request(method, baseUrl, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // таймаут: лежащий апстрим не должен подвешивать вызов инструмента MCP
  // бесконечно (undici без сигнала не таймаутится вовсе)
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === "object" ? JSON.stringify(data) : data;
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${detail}`);
  }
  return data;
}

export async function registryGet(path, token = config.registry.token) {
  if (!config.registry.url) throw new Error("REGISTRY_URL не задан — реестр недоступен");
  return request("GET", config.registry.url, path, undefined, token);
}

export async function registryPost(path, body, token = config.registry.token) {
  if (!config.registry.url) throw new Error("REGISTRY_URL не задан — реестр недоступен");
  if (!token) throw new Error("REGISTRY_TOKEN не задан — пишущие операции реестра недоступны");
  return request("POST", config.registry.url, path, body, token);
}

export async function oraclePost(path, body) {
  if (!config.oracle.url) throw new Error("ORACLE_URL не задан — оракул недоступен");
  return request("POST", config.oracle.url, path, body);
}
