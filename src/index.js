import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { TOOLS } from "./tools/definitions.js";
import * as handlers from "./tools/handlers.js";
import { registryGet } from "./services/registry.js";

// ==========================================
// ИНИЦИАЛИЗАЦИЯ MCP СЕРВЕРА
// ==========================================

// Фабрика: свой Server-инстанс на каждое SSE-соединение. SDK не позволяет
// подключать один Server к нескольким транспортам, а один глобальный
// transport затирался каждым новым GET /http (второй клиент молча убивал
// первого) — см. ниже Map по sessionId.
const createServer = () => {
  const server = new Server(
    { name: "ndp", version: "1.2.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  const toolHandlers = {
    verify_artist: handlers.handleVerifyArtist,
    get_artist_passport: handlers.handleGetArtistPassport,
    check_track_ownership: handlers.handleCheckTrackOwnership,
    get_royalty_balance: handlers.handleGetRoyaltyBalance,
    get_label_info: handlers.handleGetLabelInfo,
    get_system_stats: handlers.handleGetSystemStats,
    check_artist_tracks: handlers.handleCheckArtistTracks,
    trigger_n8n_workflow: handlers.handleTriggerN8n,
    start_ucp_checkout: handlers.handleStartUcpCheckout,
    identify_track: handlers.handleIdentifyTrack,
    register_track: handlers.handleRegisterTrack,
    get_track_manifest: handlers.handleGetTrackManifest,
    audience_superfans: handlers.handleAudienceSuperfans,
    audience_summary: handlers.handleAudienceSummary,
    listener_tier: handlers.handleListenerTier,
    subject_mint: handlers.handleSubjectMint,
    subject_status: handlers.handleSubjectStatus,
    subject_keys: handlers.handleSubjectKeys,
    receipt_batch: handlers.handleReceiptBatch,
    stats_journal: handlers.handleStatsJournal,
    opt_in: handlers.handleOptIn,
    snapshot_epoch: handlers.handleSnapshotEpoch,
    get_epoch_anchor: handlers.handleGetEpochAnchor,
    verify_track_proof: handlers.handleVerifyTrackProof
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return handler(args);
  });

  // Ресурсы реестра Стадии 0 (ndp://…). Динамические URI
  // (ndp://registry/tracks/{isrc}, ndp://registry/artists/{id}) читаются
  // тем же обработчиком — в list заявлены корневые. A7 (§7.27): якорный
  // статус эпохи, NDT-манифест трека и сплиты артиста.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: "ndp://registry/tracks", name: "Реестр треков (листинг)", mimeType: "application/json" },
      { uri: "ndp://registry/artists", name: "Артисты реестра", mimeType: "application/json" },
      { uri: "ndp://subjects", name: "Субъекты §1 (PoH-паспорта)", mimeType: "application/json" },
      { uri: "ndp://epochs/latest", name: "Epoch-снапшот (последний)", mimeType: "application/json" },
      { uri: "ndp://epochs/latest/anchor", name: "Якорь эпохи в HLF (A7 §7.27): tx_id, Merkle-корень", mimeType: "application/json" },
      { uri: "ndp://epochs/latest/revocations", name: "Отозванные ключи", mimeType: "application/json" }
    ]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    let data;
    if (uri === "ndp://registry/tracks") {
      data = await registryGet("/tracks?limit=200");
    } else if (uri.startsWith("ndp://registry/tracks/") && uri.endsWith("/manifest")) {
      // NDT-манифест трека: {isrc, title, ndt} без остального тела /tracks
      const isrc = uri.slice("ndp://registry/tracks/".length, -"/manifest".length);
      const track = await registryGet(`/tracks/${encodeURIComponent(isrc)}`);
      let ndt = track.ndt || null;
      if (ndt) { try { ndt = JSON.parse(ndt); } catch { /* уже объект/строка */ } }
      data = { isrc: track.isrc, title: track.title, artist: track.artist?.name, ndt };
    } else if (uri.startsWith("ndp://registry/tracks/")) {
      data = await registryGet(`/tracks/${encodeURIComponent(uri.slice("ndp://registry/tracks/".length))}`);
    } else if (uri === "ndp://subjects") {
      data = await registryGet("/stats");
    } else if (uri === "ndp://epochs/latest") {
      data = await registryGet("/subjects/snapshot");
    } else if (uri === "ndp://epochs/latest/anchor") {
      data = await registryGet("/subjects/snapshot/anchor");
    } else if (uri === "ndp://epochs/latest/revocations") {
      const snap = await registryGet("/subjects/snapshot");
      const revoked = (snap.entries || [])
        .flatMap(e => (e.keys || []).filter(k => !k.is_active).map(k => ({ ndp_id: e.ndp_id, ...k })));
      data = { epoch: snap.epoch, revoked_keys: revoked };
    } else if (uri.startsWith("ndp://subjects/")) {
      data = await registryGet(`/subjects/${encodeURIComponent(uri.slice("ndp://subjects/".length))}`);
    } else if (uri.startsWith("ndp://registry/artists/") && uri.endsWith("/splits")) {
      // Публичный профиль прав артиста: сплиты всех его треков
      const id = uri.slice("ndp://registry/artists/".length, -"/splits".length);
      const artist = await registryGet(`/artists/${encodeURIComponent(id)}`);
      const tracks = await registryGet(`/tracks?artist=${encodeURIComponent(artist.name)}`);
      data = {
        artist: { id: artist.id, name: artist.name, isni: artist.isni, passport_addr: artist.passport_addr },
        tracks: (tracks.items || []).map(t => ({
          isrc: t.isrc, title: t.title,
          parent_isrc: t.parent_isrc || null,
          splits: t.splits || [],
        })),
      };
    } else if (uri.startsWith("ndp://registry/artists/")) {
      data = await registryGet(`/artists/${uri.slice("ndp://registry/artists/".length)}`);
    } else {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  });

  // MCP Prompts: §7.18 аудит сцены; A7 — лицензионный аудит (криптодоказательства
  // якоря) и генерация сплит-листа NDT.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "audit_scene",
        description: "§7.18: Расследование «Парадокса Сцены» — разделить органическую корреляцию от скоординированной атаки",
        arguments: [{ name: "scene_id", description: "ID сцены или жанра", required: false }]
      },
      {
        name: "audit_license",
        description: "Аудит чистоты прав на трек перед использованием (видео/подкаст/сборник): манифест, сплиты, криптографический якорь HLF, производные",
        arguments: [{ name: "isrc", description: "ISRC проверяемого трека", required: true }]
      },
      {
        name: "generate_split_sheet",
        description: "Помощь артисту в составлении корректного сплит-листа NDT (Σ=100) с ролями и каскадными долями для сэмплов/ремиксов",
        arguments: [{ name: "track_description", description: "Кто участвовал в создании трека и в каких ролях", required: false }]
      }
    ]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const isrc = request.params.arguments?.isrc || "{ISRC}";
    if (request.params.name === "audit_scene") {
      return {
        description: "Аудит сцены §7.18",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: "Ты — аудитор сцены NDP. Проанализируй события по журналам (stats_journal) и квитанциям (receipt_batch). Раздели органическую корреляцию (плотная сцена §7.18) от скоординированной атаки. Аномалия — повод для аудита, не приговор. Для сжигания стейка нужно доказательство переноса капитала, не паттерн."
          }
        }]
      };
    }
    if (request.params.name === "audit_license") {
      return {
        description: `Лицензионный аудит ${isrc}`,
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Ты — лицензионный аудитор NDP. Проверь трек ${isrc} перед использованием в видео/подкасте/сборнике:\n` +
              `1) get_track_manifest(isrc="${isrc}") — права, сплиты (Σ=100), условия лицензии;\n` +
              `2) verify_track_proof(isrc="${isrc}") — криптографическое закрепление в HLF (A7 §7.27): Merkle-доказательство + TxID якоря;\n` +
              `3) при производном треке (parent_isrc) — рекурсивно проверь исходный трек и каскадные доли.\n` +
              `Вердикт: можно ли использовать, на каких условиях, чьё согласие нужно. Если трек не в реестре или доказательство не сходится — прямо скажи об этом и предложи путь депонирования.`
          }
        }]
      };
    }
    if (request.params.name === "generate_split_sheet") {
      return {
        description: "Сплит-лист NDT (Σ=100)",
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Ты — ассистент NDP. Помоги составить корректный сплит-лист для манифеста NDT:\n` +
              `1) собери всех соавторов с ролями (author/composer/lyricist/performer/producer/publisher…), доля каждого в процентах, Σ строго = 100;\n` +
              `2) если использован сэмпл/ремикс — добавь каскадную строку {role:'parent', wallet:'isrc:<ISRC-исходника>', share:N}, проверь исходник через get_track_manifest;\n` +
              `3) сверься со схемой schemas/ndt-manifest.schema.json (wallet — адрес или isrc:<ISRC>);\n` +
              `4) предложи готовый массив splits для register_track и предупреди о типых ошибках (сумма ≠ 100, доля исходника без его согласия, пропущенный автор текста).`
          }
        }]
      };
    }
    throw new Error(`Unknown prompt: ${request.params.name}`);
  });

  return server;
};

// ==========================================
// EXPRESS SERVER ДЛЯ HTTP/SSE ТРАНСПОРТА
// ==========================================

const app = express();
app.use(cors());
// ВНИМАНИЕ: без express.json() — SSEServerTransport читает сырой поток тела
// через raw-body; JSON-middleware вычитывает поток раньше и POST падает с 400.

// Middleware для проверки токена (MCP_API_KEY).
// Два канала: Authorization: Bearer <key> (прямые клиенты) и
// X-NDP-Token: <key> — для гейтвеев маркетплейсов (Smithery резервирует
// заголовок Authorization за собственной авторизацией клиента).
const authMiddleware = (req, res, next) => {
  if (config.mcpApiKeys.length === 0) return next();
  const authHeader = req.headers.authorization;
  const altHeader = req.headers["x-ndp-token"];
  const ok = config.mcpApiKeys.includes(altHeader)
    || config.mcpApiKeys.some(k => authHeader === `Bearer ${k}`);
  if (!ok) {
    console.warn("🚫 Unauthorized access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Активные SSE-сессии: sessionId → { transport, server }.
// Клиент узнаёт sessionId из endpoint-события и шлёт его в POST ?sessionId=.
const transports = new Map();

// Маршрут для инициализации SSE (каждому клиенту — своя сессия)
app.get("/http", authMiddleware, async (req, res) => {
  console.log(`📡 New SSE connection (активных после: ${transports.size + 1})...`);
  const server = createServer();
  const transport = new SSEServerTransport("/http/messages", res);
  transports.set(transport.sessionId, { transport, server });
  // разрыв соединения (клиент ушёл) — сессию убрать
  res.on("close", () => {
    if (transports.get(transport.sessionId)?.transport === transport) {
      transports.delete(transport.sessionId);
      server.close().catch(() => {});
      console.log(`📡 SSE connection closed, session ${transport.sessionId} (активных: ${transports.size})`);
    }
  });
  await server.connect(transport);
});

// Маршрут для приема сообщений (по sessionId из query — SDK шлёт его сам)
app.post("/http/messages", authMiddleware, async (req, res) => {
  const sessionId = req.query.sessionId ? String(req.query.sessionId) : null;
  const entry = sessionId ? transports.get(sessionId) : null;
  if (!entry) {
    console.warn(`🚫 Message for unknown session: ${sessionId}`);
    return res.status(400).json({ error: "Unknown session — reconnect via GET /http" });
  }
  console.log(`📥 Received message, session ${sessionId}`);
  await entry.transport.handlePostMessage(req, res);
});

async function main() {
  // stdio-режим (npm-пакет: npx ndp-mcp / MCP_TRANSPORT=stdio):
  // stdout занят протоколом — все логи уводим в stderr.
  if (config.transport === "stdio") {
    console.log = console.error;
    console.warn = console.error;
    const server = createServer();
    await server.connect(new StdioServerTransport());
    console.error(`🚀 NDP MCP Server (stdio) · tools: ${TOOLS.length}`);
    return;
  }
  app.listen(config.port, () => {
    console.log(`🚀 NDP MCP Server listening on port ${config.port}`);
    console.log(`🔗 Endpoint: http://localhost:${config.port}/http`);
    console.log(`📋 Available tools: ${TOOLS.map(t => t.name).join(", ")}`);
  });
}

main().catch(console.error);
