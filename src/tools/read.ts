import type { Sg24Client } from "../client.js";
import type { Config } from "../config.js";
import { fail, guard, ok, type ToolResult } from "./result.js";

export const LIST_RESOURCES = [
  "contacts",
  "groups",
  "nodes",
  "downtimes",
  "distributors",
  "integrations",
] as const;
export type ListResource = (typeof LIST_RESOURCES)[number];

export const NO_CHECK_IDS = "No check IDs configured. Set SG24_CHECK_IDS.";

type Host = { id?: unknown; address?: unknown; alias?: unknown };

export type CheckStatus =
  | {
      id: number;
      shortname: unknown;
      name: unknown;
      state: unknown;
      output: unknown;
      last_check: unknown;
      next_check: unknown;
    }
  | { id: number; error: string };

export function listHosts(
  client: Sg24Client,
  _config: Config,
  args: { filter?: string },
): Promise<ToolResult> {
  return guard(async () => {
    const data = await client.call({ command: "get_hosts" });
    const hosts = Array.isArray(data) ? (data as Host[]) : [];
    const needle = args.filter?.trim().toLowerCase();
    if (!needle) return ok(hosts);
    return ok(
      hosts.filter((h) =>
        [h.address, h.alias].some((v) => typeof v === "string" && v.toLowerCase().includes(needle)),
      ),
    );
  });
}

export function listResource(
  client: Sg24Client,
  _config: Config,
  args: { resource: ListResource },
): Promise<ToolResult> {
  return guard(async () => ok(await client.call({ command: `get_${args.resource}` })));
}

export function getCheck(
  client: Sg24Client,
  _config: Config,
  args: { id: number },
): Promise<ToolResult> {
  return guard(async () => ok(await client.call({ command: "service_show", id: args.id })));
}

async function fetchStatuses(client: Sg24Client, ids: number[]): Promise<CheckStatus[]> {
  const results = await client.batch(ids.map((id) => ({ command: "service_status", id })));
  return results.map((r, i): CheckStatus => {
    const id = ids[i];
    if (!r.ok) return { id, error: `API error ${r.code}: ${r.message}` };
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      id,
      shortname: d.shortname,
      name: d.name,
      state: d.last_state,
      output: d.last_output,
      last_check: d.gmt_last_check,
      next_check: d.gmt_next_check,
    };
  });
}

export function listChecks(
  client: Sg24Client,
  config: Config,
  _args: Record<string, never>,
): Promise<ToolResult> {
  return guard(async () => {
    if (config.checkIds.length === 0) return fail(NO_CHECK_IDS);
    return ok(await fetchStatuses(client, config.checkIds));
  });
}

export function listProblems(
  client: Sg24Client,
  config: Config,
  _args: Record<string, never>,
): Promise<ToolResult> {
  return guard(async () => {
    if (config.checkIds.length === 0) return fail(NO_CHECK_IDS);
    const statuses = await fetchStatuses(client, config.checkIds);
    const problems = statuses.filter((s) => "error" in s || s.state !== "OK");
    return ok({ problems, checked: statuses.length });
  });
}
