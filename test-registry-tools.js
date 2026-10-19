// Smoke-тест инструментов контура Стадии 0 (identify_track / register_track /
// get_track_manifest) + ресурсов ndp://registry/*.
// Запуск (нужен поднятый npm start и стенд registry-api/oracle):
//   node --env-file=.env test-registry-tools.js [tool] ['{"json":"args"}']
// Пример: node --env-file=.env test-registry-tools.js identify_track '{"isrc":"RU-NDP-26-00001"}'

const BASE = process.env.MCP_URL || "http://localhost:3000";
const KEY = process.env.MCP_API_KEY || "";
const TOOL = process.argv[2] || process.env.TOOL_NAME || "identify_track";
const ARGS = JSON.parse(
  process.argv[3] || process.env.TOOL_ARGS ||
  JSON.stringify({ isrc: process.env.DEMO_ISRC || "RU-NDP-26-00001" }));
const TIMEOUT_MS = 15_000;

const authHeaders = KEY ? { Authorization: `Bearer ${KEY}` } : {};

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const timeout = setTimeout(
  () => fail("Таймаут 15 с. Сервер поднят? (npm start; стенд registry-api/oracle?)"),
  TIMEOUT_MS
);

async function waitForFrame(sse, pred) {
  while (true) {
    const { done, value } = await sse.reader.read();
    if (done) fail("SSE-стрим закрылся до получения ответа");
    sse.buffer += sse.decoder.decode(value, { stream: true });
    const frames = sse.buffer.split("\n\n");
    sse.buffer = frames.pop();
    for (const frame of frames) {
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.slice(5).trim();
      if (pred(data)) return data;
    }
  }
}

async function call(method, params) {
  const endpoint = globalThis.__endpoint;
  const post = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++globalThis.__id, method, params }),
  });
  if (!post.ok) fail(`POST ${method} → HTTP ${post.status}`);
  const bodyText = await post.text().catch(() => "");
  const isReply = (d) => { try { return JSON.parse(d).id === globalThis.__id; } catch { return false; } };
  const raw = isReply(bodyText) ? bodyText : await waitForFrame(globalThis.__sse, isReply);
  return JSON.parse(raw);
}

async function main() {
  console.log(`▶ Подключение к ${BASE}/http …`);
  const res = await fetch(`${BASE}/http`, {
    headers: { Accept: "text/event-stream", ...authHeaders },
  });
  if (!res.ok) fail(`GET /http → HTTP ${res.status}`);
  globalThis.__sse = { reader: res.body.getReader(), decoder: new TextDecoder(), buffer: "" };
  globalThis.__id = 0;
  globalThis.__endpoint = await waitForFrame(globalThis.__sse, (d) => d.includes("sessionId"));
  console.log(`✔ SSE-сессия: ${globalThis.__endpoint}`);

  // tools/list: все 12 на месте?
  const list = await call("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  for (const must of ["identify_track", "register_track", "get_track_manifest"]) {
    if (!names.includes(must)) fail(`tools/list не содержит ${must} (есть: ${names.join(", ")})`);
  }
  console.log(`✔ tools/list: ${names.length} инструментов, контур Стадии 0 на месте`);

  const data = await call("tools/call", { name: TOOL, arguments: ARGS });
  clearTimeout(timeout);
  const text = data.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(data, null, 2);
  console.log(text);
  if (data.error) fail("tools/call вернул error");
  if (text.startsWith("❌")) fail(`${TOOL} вернул ошибку (см. текст выше)`);
  console.log(`✔ ${TOOL}: OK`);
  process.exit(0);
}

main().catch((e) => fail(e.message));
