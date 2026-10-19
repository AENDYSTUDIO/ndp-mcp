import dotenv from "dotenv";

dotenv.config();

export const config = {
  transport: process.env.MCP_TRANSPORT || "http",
  port: process.env.PORT || 3000,
  // Ключи доступа: MCP_API_KEYS="ключ1,ключ2" (перманентный список) или
  // одиночный MCP_API_KEY. Пусто — авторизация выключена.
  mcpApiKeys: (process.env.MCP_API_KEYS || process.env.MCP_API_KEY || "")
    .split(",").map(s => s.trim()).filter(Boolean),
  polygonRpcUrl: process.env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology",
  contracts: {
    sbt: process.env.NDP_SBT_CONTRACT || "",
    registry: process.env.NDP_REGISTRY_CONTRACT || "",
    splits: process.env.NDP_SPLITS_CONTRACT || "",
    label: process.env.NDP_LABEL_CONTRACT || ""
  },
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || "",
    authToken: process.env.N8N_AUTH_TOKEN || ""
  },
  registry: {
    url: process.env.REGISTRY_URL || "",
    token: process.env.REGISTRY_TOKEN || ""
  },
  oracle: {
    url: process.env.ORACLE_URL || ""
  }
};
