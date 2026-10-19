// Smoke-тест subject-контура MCP (спринт 12): все 7 инструментов + ресурс
// ndp://subjects против локального стенда registry-api (sqlite + dev-auth).
// Стенд поднимает запускающий, скрипт проверяет только связку MCP↔registry:
//   registry: cd services/registry-api && rm -f _smoke.db
//     DATABASE_URL=sqlite:///./_smoke.db REGISTRY_JWT_SECRET=… DEV_AUTH_SECRET=…
//     SNAPSHOT_SIGNING_KEY=… .venv/bin/python -c "import main; main.Base.metadata.create_all(main.engine); from stats_views import ensure_views; ensure_views(main.engine)"
//     … те же env … .venv/bin/uvicorn main:app --port 8010
//     (create_all + ensure_views обязательны: вьюхи статы сами не создаются)
//   mcp:      cd mcp-server && PORT=3100 MCP_API_KEY= \
//             REGISTRY_URL=http://127.0.0.1:8010 REGISTRY_TOKEN=smoke npm start
//   прогон:   MCP_URL=http://127.0.0.1:3100 DEV_AUTH_SECRET=… node test-subjects-tools.js

const MCP_BASE = process.env.MCP_URL || "http://127.0.0.1:3100";
const MCP_KEY = process.env.MCP_API_KEY || "";
const REG_URL = (process.env.REGISTRY_URL || "http://127.0.0.1:8010").replace(/\/$/, "");
const DEV_SECRET = process.env.DEV_AUTH_SECRET || "";

const COMMITMENT = "11".repeat(32);      // 64 hex
const PKEY = "04" + "ab".repeat(64);     // 65 байт, secp256k1
const SUBJECT_TOOLS = ["subject_mint", "subject_status", "subject_keys",
                       "receipt_batch", "stats_journal", "opt_in", "snapshot_epoch"];

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}
if (!DEV_SECRET) fail("DEV_AUTH_SECRET не задан — не с кем авторизоваться на стенде");

const timeout = setTimeout(() => fail("глобальный таймаут 60 с"), 60_000);

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
  const post = await fetch(`${MCP_BASE}${globalThis.__endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
               ...(MCP_KEY ? { Authorization: `Bearer ${MCP_KEY}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++globalThis.__id, method, params }),
  });
  if (!post.ok) fail(`POST ${method} → HTTP ${post.status}`);
  const bodyText = await post.text().catch(() => "");
  const isReply = (d) => { try { return JSON.parse(d).id === globalThis.__id; } catch { return false; } };
  const raw = isReply(bodyText) ? bodyText : await waitForFrame(globalThis.__sse, isReply);
  return JSON.parse(raw);
}

async function tool(name, args) {
  const r = await call("tools/call", { name, arguments: args });
  if (r.error) fail(`${name}: jsonrpc error ${JSON.stringify(r.error)}`);
  const text = (r.result?.content || []).map((c) => c.text).join("\n");
  if (text.startsWith("❌")) fail(`${name}: ${text}`);
  return text;
}

async function main() {
  console.log(`▶ MCP: ${MCP_BASE}, registry: ${REG_URL}`);
  const res = await fetch(`${MCP_BASE}/http`, {
    headers: { Accept: "text/event-stream",
               ...(MCP_KEY ? { Authorization: `Bearer ${MCP_KEY}` } : {}) },
  });
  if (!res.ok) fail(`GET /http → HTTP ${res.status} (mcp-server поднят?)`);
  globalThis.__sse = { reader: res.body.getReader(), decoder: new TextDecoder(), buffer: "" };
  globalThis.__id = 0;
  globalThis.__endpoint = await waitForFrame(globalThis.__sse, (d) => d.includes("sessionId"));

  // 1. tools/list: весь subject-контур на месте
  const list = await call("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  for (const must of SUBJECT_TOOLS) {
    if (!names.includes(must)) fail(`tools/list не содержит ${must}`);
  }
  console.log(`✔ tools/list: ${names.length} инструментов, subject-контур на месте`);

  // 2. dev-токен артиста прямо со стенда
  const auth = await fetch(`${REG_URL}/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dev-Secret": DEV_SECRET },
    body: JSON.stringify({ tg_id: "smoke1", name: "Смоук Артист" }),
  });
  if (!auth.ok) fail(`/auth/dev → HTTP ${auth.status} (DEV_AUTH_SECRET стенда совпадает?)`);
  const token = (await auth.json()).access_token;

  // 3. subject_mint — per-user authorization доезжает только с fix registryPost
  const mintText = await tool("subject_mint", {
    verification_path: "label", identity_commitment: COMMITMENT,
    initial_device_key: PKEY, authorization: token });
  const m = mintText.match(/ndp_id:\s*([0-9a-f-]{36})/i);
  if (!m) fail(`subject_mint: не нашли ndp_id в ответе:\n${mintText}`);
  const ndpId = m[1];
  console.log(`✔ subject_mint → ${ndpId}`);

  // 4. subject_status (публичный, без токена)
  const st = await tool("subject_status", { ndp_id: ndpId });
  if (!st.includes("статус:")) fail(`subject_status: неожиданный ответ:\n${st}`);
  console.log(`✔ subject_status: ${st.split("\n").find((l) => l.includes("статус")).trim()}`);

  // 5. subject_keys — раньше 405: GET-роута не существовало
  const keys = await tool("subject_keys", { ndp_id: ndpId, authorization: token });
  if (!/КЛЮЧИ УСТРОЙСТВ \(1\)/.test(keys)) fail(`subject_keys: ожидали 1 ключ:\n${keys}`);
  console.log("✔ subject_keys: 1 ключ (раньше — 405)");

  // 6. opt_in вкл/выкл — раньше /subjects/undefined + потеря токена
  const on = await tool("opt_in", { enabled: true, authorization: token });
  if (!on.includes("Оптин включён")) fail(`opt_in on: ${on}`);
  const off = await tool("opt_in", { enabled: false, authorization: token });
  if (!off.includes("Оптин выключен")) fail(`opt_in off: ${off}`);
  console.log("✔ opt_in: вкл/выкл через /subjects/me с токеном");

  // 7. stats_journal — раньше 404: /registry/stats/journal вместо /stats/journal
  const j = await tool("stats_journal", { days: 30 });
  if (!j.includes("ЖУРНАЛ (30 дн.)")) fail(`stats_journal: ${j}`);
  console.log("✔ stats_journal: журнал читается (раньше — 404)");

  // 8. snapshot_epoch (нужен SNAPSHOT_SIGNING_KEY на стенде)
  const snap = await tool("snapshot_epoch", {});
  if (!snap.includes("EPOCH-СНАПШОТ")) fail(`snapshot_epoch: ${snap}`);
  console.log(`✔ snapshot_epoch: ${snap.split("\n").find((l) => l.includes("epoch"))?.trim()}`);

  // 9. receipt_batch: мусорная подпись → поэлементный rejected, роут жив
  const rb = await tool("receipt_batch", { receipts: [{
    receipt_id: "PR-" + "ab".repeat(6), seq: 1, ndp_id: ndpId,
    device_key: PKEY, isrc: "RU-NDP-26-00001", action: "play",
    occurred_at: new Date().toISOString(), signature: "00".repeat(64) }] });
  if (!rb.includes("отклонено 1 из 1")) {
    fail(`receipt_batch: ожидали поэлементный rejected:\n${rb}`);
  }
  console.log("✔ receipt_batch: батч-роут жив (плохая подпись отвергнута поэлементно)");

  // 10. ресурс ndp://subjects — раньше 404: /registry/stats вместо /stats
  const rr = await call("resources/read", { uri: "ndp://subjects" });
  if (rr.error) fail(`resources/read ndp://subjects: ${JSON.stringify(rr.error)}`);
  const body = JSON.parse(rr.result.contents[0].text);
  if (typeof body.subjects !== "number") {
    fail(`ndp://subjects: в ответе нет subjects:\n${rr.result.contents[0].text}`);
  }
  console.log(`✔ ресурс ndp://subjects → /stats (subjects: ${body.subjects})`);

  clearTimeout(timeout);
  console.log("\nСМОУК ПРОЙДЕН: 7 инструментов + ресурс ndp://subjects");
  process.exit(0);
}

main().catch((e) => fail(e.message));
