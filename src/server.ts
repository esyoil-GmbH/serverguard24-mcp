import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Sg24Client } from "./client.js";
import type { Config } from "./config.js";
import { getCheck, LIST_RESOURCES, listChecks, listHosts, listProblems, listResource } from "./tools/read.js";
import { createDowntime, setCheckMonitoring, setCheckNotifications } from "./tools/write.js";

export const SERVER_VERSION = "0.1.0";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const REVERSIBLE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const checkId = z.number().int().positive().describe("ServerGuard24 check (service) ID");

export function buildServer(client: Sg24Client, config: Config): McpServer {
  const server = new McpServer({ name: "serverguard24", version: SERVER_VERSION });

  server.registerTool(
    "sg24_list_hosts",
    {
      title: "List hosts",
      description:
        "List the hosts in the ServerGuard24 account (id, address, alias, groups). The API does not return the checks of a host.",
      inputSchema: {
        filter: z.string().optional().describe("Case-insensitive text to match in the address or alias"),
      },
      annotations: READ_ONLY,
    },
    (args) => listHosts(client, config, args),
  );

  server.registerTool(
    "sg24_list",
    {
      title: "List account resources",
      description:
        "List contacts, groups, monitoring nodes, maintenance windows (downtimes), distributors or integrations.",
      inputSchema: { resource: z.enum(LIST_RESOURCES) },
      annotations: READ_ONLY,
    },
    (args) => listResource(client, config, args),
  );

  server.registerTool(
    "sg24_get_check",
    {
      title: "Get check details",
      description:
        "Show the full configuration and current state of one check: state, output, interval, parameters, notification settings, contacts and downtimes.",
      inputSchema: { id: checkId },
      annotations: READ_ONLY,
    },
    (args) => getCheck(client, config, args),
  );

  server.registerTool(
    "sg24_list_checks",
    {
      title: "List check status",
      description:
        "Show the current state, last output and last/next check time of every configured check (SG24_CHECK_IDS). The API cannot list checks, so only configured checks appear.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => listChecks(client, config, {}),
  );

  server.registerTool(
    "sg24_problems",
    {
      title: "What is down?",
      description:
        "Show the configured checks that are not OK right now (WARNING, CRITICAL, UNKNOWN, or the lookup failed). Use this to answer 'what is down?'.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => listProblems(client, config, {}),
  );

  server.registerTool(
    "sg24_set_check_monitoring",
    {
      title: "Pause or resume a check",
      description: "Pause (enabled=false) or resume (enabled=true) the monitoring of one check.",
      inputSchema: { id: checkId, enabled: z.boolean() },
      annotations: REVERSIBLE_WRITE,
    },
    (args) => setCheckMonitoring(client, config, args),
  );

  server.registerTool(
    "sg24_set_check_notifications",
    {
      title: "Turn check alerts on or off",
      description: "Turn the alert notifications of one check on (enabled=true) or off (enabled=false).",
      inputSchema: { id: checkId, enabled: z.boolean() },
      annotations: REVERSIBLE_WRITE,
    },
    (args) => setCheckNotifications(client, config, args),
  );

  server.registerTool(
    "sg24_create_downtime",
    {
      title: "Create a maintenance window",
      description:
        "Create a maintenance window (downtime) and link it to checks and/or hosts. " +
        "WARNING: the window cannot be edited or deleted through the API; only the ServerGuard24 dashboard can remove it. " +
        "Confirm hostname, times, description and linked IDs with the user before you call this tool. " +
        "start and end must be ISO 8601 with a timezone, e.g. 2026-11-24T02:00:00+01:00. Maximum length 23:59:59.",
      inputSchema: {
        hostname: z.string().describe("Name of the host the window applies to"),
        start: z.string().describe("Start, ISO 8601 with timezone"),
        end: z.string().describe("End, ISO 8601 with timezone"),
        description: z.string().describe("Reason for the window, e.g. 'Deploy v2.3'"),
        check_ids: z.array(checkId).optional().describe("Check IDs to silence"),
        host_ids: z.array(z.number().int().positive()).optional().describe("Host IDs to silence"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (args) => createDowntime(client, config, args),
  );

  return server;
}
