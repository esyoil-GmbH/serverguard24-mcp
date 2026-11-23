// End-to-end test over stdio against dist/index.js. Read-only tools only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    PATH: process.env.PATH ?? "",
    SG24_API_TOKEN: process.env.SG24_API_TOKEN ?? "",
    SG24_CHECK_IDS: process.env.SG24_CHECK_IDS ?? "",
  },
});
const client = new Client({ name: "e2e", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length} (${tools.map((t) => t.name).join(", ")})`);

let failed = false;
for (const [name, args] of [
  ["sg24_problems", {}],
  ["sg24_list_checks", {}],
  ["sg24_list", { resource: "nodes" }],
] as const) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content[0].text;
  if (r.isError) failed = true;
  console.log(`${r.isError ? "FAIL" : "ok  "} ${name}: ${text.length} chars${r.isError ? ` - ${text}` : ""}`);
}
const id = Number((process.env.SG24_CHECK_IDS ?? "").split(",")[0]);
if (id) {
  const r = (await client.callTool({ name: "sg24_get_check", arguments: { id } })) as { content: { text: string }[]; isError?: boolean };
  const d = r.isError ? null : JSON.parse(r.content[0].text);
  if (r.isError) failed = true;
  console.log(`${r.isError ? "FAIL" : "ok  "} sg24_get_check ${id}: state=${d?.state} active=${d?.active}`);
}
await client.close();
process.exit(failed ? 1 : 0);
