#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Sg24Client } from "./client.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = new Sg24Client(config.token);
  const server = buildServer(client, config);
  await server.connect(new StdioServerTransport());
  console.error(`serverguard24-mcp running (${config.checkIds.length} configured checks)`);
}

main().catch((err: unknown) => {
  console.error(`serverguard24-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
