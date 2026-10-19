// Smoke-тест NDP MCP-сервера: инициализация SSE-сессии + tools/call get_system_stats.
// Запуск (сервер должен быть поднят: npm start):
//   node --env-file=.env test-mcp.js
// Переменные: MCP_URL (по умолчанию http://localhost:3000), MCP_API_KEY
// (если на сервере ключ задан — передать тот же; пустой = авторизация отключена).

const BASE = process.env.MCP_URL || "http://localhost:3000";
const KEY = process.env.MCP_API_KEY || "";
const TIMEOUT_MS = 10_000;

const authHeaders = KEY ? { Authorization: `Bearer ${KEY}` } : {};

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const timeout = setTimeout(
  () => fail("Таймаут 10 с. Сервер поднят? (npm start)"),
  TIMEOUT_MS
);

// Читает SSE-стрим по кадрам (разделитель — пустая строка), ждёт data:-строку, удовлетворяющую pred
async function waitForFrame(sse, pred) {
  while (true) {
    const { done, value } = await sse.reader.read();
    if (done) fail("SSE-стрим закрылся до получения ответа");
    sse.buffer += sse.decoder.decode(value, { stream: true });
    const frames = sse.buffer.split("\n\n");
    sse.buffer = frames.pop(); // незавершённый хвост остаётся в буфере
    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (pred(data)) return data;
    }
  }
}

async function main() {
  // 1) Инициализация SSE-сессии: ждём событие endpoint с URI вида /http/messages?sessionId=…
  console.log(`▶ Подключение к ${BASE}/http …`);
  const res = await fetch(`${BASE}/http`, {
    headers: { Accept: "text/event-stream", ...authHeaders },
  });
  if (!res.ok) fail(`GET /http → HTTP ${res.status}`);
  if (!res.body) fail("Пустое тело SSE-ответа");

  const sse = { reader: res.body.getReader(), decoder: new TextDecoder(), buffer: "" };
  const endpoint = await waitForFrame(sse, (d) => d.includes("sessionId"));
  console.log(`✔ SSE-сессия открыта: ${endpoint}`);

  // 1b) tools/list: карта и определения не разошлись (детектор дрейфа)
  const listPost = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  if (!listPost.ok) fail(`POST tools/list → HTTP ${listPost.status}`);
  const listBody = await listPost.text().catch(() => "");
  const isList = (d) => {
    try { return JSON.parse(d).id === 2; } catch { return false; }
  };
  const listRaw = isList(listBody) ? listBody : await waitForFrame(sse, isList);
  const list = JSON.parse(listRaw);
  if (list.error) fail("tools/list вернул error");
  const names = (list.result?.tools || []).map((t) => t.name);
  for (const required of ["get_system_stats", "audience_superfans", "audience_summary"]) {
    if (!names.includes(required))
      fail(`tools/list: нет инструмента ${required} (карта/определения разошлись)`);
  }
  console.log(`✔ tools/list: ${names.length} инструментов, ключевые на месте`);

  // 2) Вызов инструмента через JSON-RPC
  const post = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_system_stats", arguments: {} },
    }),
  });
  if (!post.ok) fail(`POST tools/call → HTTP ${post.status}`);

  // Ответ приходит либо телом POST, либо кадром в открытом SSE-стриме — ждём оба
  const bodyText = await post.text().catch(() => "");
  const isReply = (d) => {
    try { return JSON.parse(d).id === 1; } catch { return false; }
  };
  const raw = isReply(bodyText) ? bodyText : await waitForFrame(sse, isReply);

  clearTimeout(timeout);
  const data = JSON.parse(raw);
  console.log(JSON.stringify(data, null, 2));
  if (data.error) fail("tools/call вернул error");
  if (!data.result) fail("tools/call вернулся без result");
  console.log("✔ get_system_stats: OK");
  process.exit(0); // открытый SSE-коннект держит event loop — выходим явно
}

main().catch((e) => fail(e.message));
