// Live smoke test. Read-only: it never calls a write tool.
// Prints counts and states only, no host names or contact data.
import { Sg24Client } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { listChecks, listHosts, listProblems, listResource } from "../src/tools/read.js";

const config = loadConfig(process.env);
const client = new Sg24Client(config.token);
let failed = false;

async function step(name: string, run: () => Promise<{ content: { text: string }[]; isError?: boolean }>, show: (v: any) => string) {
  const r = await run();
  if (r.isError) {
    failed = true;
    console.log(`FAIL ${name}: ${r.content[0].text}`);
  } else {
    console.log(`ok   ${name}: ${show(JSON.parse(r.content[0].text))}`);
  }
}

await step("nodes", () => listResource(client, config, { resource: "nodes" }), (v) => `${v.length} nodes`);
await step("hosts", () => listHosts(client, config, {}), (v) => `${v.length} hosts`);
await step("downtimes", () => listResource(client, config, { resource: "downtimes" }), (v) => `${v.length} downtimes`);
await step("checks", () => listChecks(client, config, {}), (v) =>
  v.map((c: any) => `${c.id}=${c.error ?? c.state}`).join(", "));
await step("problems", () => listProblems(client, config, {}), (v) => `${v.problems.length} of ${v.checked}`);

process.exit(failed ? 1 : 0);
