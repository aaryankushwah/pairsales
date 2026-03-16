/**
 * gateway-client.test.ts
 *
 * Simple integration smoke-test for GatewayClient.
 * Requires a running OpenClaw Gateway at ws://127.0.0.1:18789
 * (or set OPENCLAW_GATEWAY_URL / OPENCLAW_GATEWAY_TOKEN env vars).
 *
 * Run with:
 *   node --loader ts-node/esm src/gateway-client.test.ts
 * or after build:
 *   node dist/gateway-client.test.js
 */

import { GatewayClient } from "./gateway-client.js";

async function main(): Promise<void> {
  console.log("[test] Creating GatewayClient pointed at ws://127.0.0.1:18789");

  const client = new GatewayClient({
    url: process.env["OPENCLAW_GATEWAY_URL"] ?? "ws://127.0.0.1:18789",
    token: process.env["OPENCLAW_GATEWAY_TOKEN"],
  });

  console.log("[test] Connecting...");
  await client.connect();
  console.log("[test] Connected. isConnected =", client.isConnected());

  console.log("[test] Calling listAgents()...");
  const agents = await client.listAgents();
  console.log("[test] agents:", JSON.stringify(agents, null, 2));

  client.disconnect();
  console.log("[test] Disconnected. Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[test] Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
