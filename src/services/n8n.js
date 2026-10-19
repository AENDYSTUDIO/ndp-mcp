import { config } from "../config/index.js";

export async function triggerN8nWorkflow(action, payload) {
  if (!config.n8n.webhookUrl) {
    throw new Error("n8n webhook URL not configured");
  }
  
  const response = await fetch(config.n8n.webhookUrl, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": config.n8n.authToken ? `Bearer ${config.n8n.authToken}` : ""
    },
    body: JSON.stringify({ 
      action, 
      payload: payload || {}, 
      timestamp: new Date().toISOString() 
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`n8n error (HTTP ${response.status}): ${errorText}`);
  }
  
  return await response.json().catch(() => ({ status: "success", text: "no json response" }));
}
