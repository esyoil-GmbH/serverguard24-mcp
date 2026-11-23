import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { Sg24Client } from "../src/client.js";
import { buildServer } from "../src/server.js";

const READ_TOOLS = ["sg24_list_hosts", "sg24_list", "sg24_get_check", "sg24_list_checks", "sg24_problems"];
const WRITE_TOOLS = ["sg24_set_check_monitoring", "sg24_set_check_notifications", "sg24_create_downtime"];

async function connect(sg = { call: vi.fn(async () => [] as unknown), batch: vi.fn(async () => []) }) {
  const server = buildServer(sg as unknown as Sg24Client, { token: "t", checkIds: [111] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, sg };
}

describe("buildServer", () => {
  it("registers exactly the 8 tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });

  it("marks read tools read-only", async () => {
    const { tools } = await (await connect()).client.listTools();
    for (const name of READ_TOOLS) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("marks write tools as not read-only", async () => {
    const { tools } = await (await connect()).client.listTools();
    for (const name of WRITE_TOOLS) {
      expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(false);
    }
  });

  it("marks only create_downtime destructive and warns in its description", async () => {
    const { tools } = await (await connect()).client.listTools();
    const dt = tools.find((t) => t.name === "sg24_create_downtime")!;
    expect(dt.annotations?.destructiveHint).toBe(true);
    expect(dt.description).toMatch(/cannot be edited or deleted/i);
    expect(dt.description).toMatch(/timezone/i);
    expect(dt.description).toMatch(/confirm/i);
    expect(tools.find((t) => t.name === "sg24_set_check_monitoring")?.annotations?.destructiveHint).toBe(false);
  });

  it("routes a tool call to the handler", async () => {
    const { client, sg } = await connect();
    sg.call.mockResolvedValueOnce({ id: 111, state: "OK" });
    const res = await client.callTool({ name: "sg24_get_check", arguments: { id: 111 } });
    expect(sg.call).toHaveBeenCalledWith({ command: "service_show", id: 111 });
    expect(res.content).toEqual([{ type: "text", text: '{"id":111,"state":"OK"}' }]);
  });

  it("rejects invalid input via the schema", async () => {
    const { client, sg } = await connect();
    const res = await client.callTool({ name: "sg24_get_check", arguments: { id: "abc" } });
    expect(res.isError).toBe(true);
    expect(sg.call).not.toHaveBeenCalled();
  });

  it("rejects an unknown list resource", async () => {
    const { client, sg } = await connect();
    const res = await client.callTool({ name: "sg24_list", arguments: { resource: "users" } });
    expect(res.isError).toBe(true);
    expect(sg.call).not.toHaveBeenCalled();
  });

  it("calls list_checks with no arguments", async () => {
    const { client, sg } = await connect();
    await client.callTool({ name: "sg24_list_checks", arguments: {} });
    expect(sg.batch).toHaveBeenCalledWith([{ command: "service_status", id: 111 }]);
  });
});
