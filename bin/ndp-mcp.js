#!/usr/bin/env node
// CLI-обёртка: npx ndp-mcp — stdio-транспорт для локальных MCP-клиентов.
process.env.MCP_TRANSPORT = "stdio";
await import("../src/index.js");
