import { Sg24ApiError, type Sg24Client } from "../client.js";
import type { Config } from "../config.js";
import { errorText, fail, guard, ok, type ToolResult } from "./result.js";

/** Downtime type 1 = maintenance, the only type the API supports. */
const DOWNTIME_TYPE_MAINTENANCE = 1;
const MAX_DOWNTIME_SECONDS = 86_399; // 23:59:59
const MAX_PAST_SECONDS = 3_600;
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function setCheckMonitoring(
  client: Sg24Client,
  _config: Config,
  args: { id: number; enabled: boolean },
): Promise<ToolResult> {
  return guard(async () => {
    await client.call({ command: "service_monitoring", id: args.id, monitoring: args.enabled ? 1 : 0 });
    return ok({ id: args.id, monitoring: args.enabled ? "enabled" : "paused" });
  });
}

export function setCheckNotifications(
  client: Sg24Client,
  _config: Config,
  args: { id: number; enabled: boolean },
): Promise<ToolResult> {
  return guard(async () => {
    await client.call({
      command: "service_notification",
      id: args.id,
      notification: args.enabled ? 1 : 0,
    });
    return ok({ id: args.id, notifications: args.enabled ? "enabled" : "disabled" });
  });
}

export type CreateDowntimeArgs = {
  hostname: string;
  start: string;
  end: string;
  description: string;
  check_ids?: number[];
  host_ids?: number[];
};

function toUnix(value: string): number | string {
  const m = ISO_WITH_ZONE.exec(value);
  if (!m) {
    return `"${value}" needs a timezone. Use ISO 8601 with an offset, e.g. 2026-11-24T02:00:00+01:00.`;
  }
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((v) => Number(v ?? 0));
  // Date.parse rolls impossible dates over (2026-11-31 -> 1 December). Reject them instead.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const realDate =
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  const ms = Date.parse(value);
  if (!realDate || hour > 23 || minute > 59 || second > 59 || Number.isNaN(ms)) {
    return `"${value}" is not a valid date.`;
  }
  return Math.floor(ms / 1000);
}

export function createDowntime(
  client: Sg24Client,
  _config: Config,
  args: CreateDowntimeArgs,
  now: () => Date = () => new Date(),
): Promise<ToolResult> {
  return guard(async () => {
    const hostname = args.hostname.trim();
    const description = args.description.trim();
    if (!hostname) return fail("hostname must not be empty.");
    if (!description) return fail("description must not be empty.");

    const start = toUnix(args.start);
    if (typeof start === "string") return fail(`start: ${start}`);
    const end = toUnix(args.end);
    if (typeof end === "string") return fail(`end: ${end}`);
    if (end <= start) return fail("The end must be after the start.");
    if (end - start > MAX_DOWNTIME_SECONDS) {
      return fail("A maintenance window can last at most 23:59:59.");
    }
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (start < nowSeconds - MAX_PAST_SECONDS) {
      return fail("The start is more than one hour in the past.");
    }
    if (end <= nowSeconds) return fail("The end is in the past. The window would have no effect.");

    let data: { dt_id?: unknown } | null;
    try {
      // Never retry: a retried downtime_add can create duplicates that the API cannot delete.
      data = (await client.call(
        {
          command: "downtime_add",
          hostname,
          starttime: start,
          endtime: end,
          description,
          type: DOWNTIME_TYPE_MAINTENANCE,
        },
        { retry: false },
      )) as { dt_id?: unknown } | null;
    } catch (err) {
      if (err instanceof Sg24ApiError) return fail(err.message);
      return fail(
        `The result is unknown (${errorText(err)}). The window may exist. ` +
          "Run sg24_list with resource=downtimes before you try again.",
      );
    }
    const rawId = data?.dt_id;
    if (rawId === undefined || rawId === null || rawId === "") {
      return fail(
        "downtime_add succeeded but returned no ID. Check the maintenance window in the ServerGuard24 dashboard.",
      );
    }
    const id = String(rawId);

    const checkIds = args.check_ids ?? [];
    const hostIds = args.host_ids ?? [];
    try {
      if (checkIds.length > 0) await client.call({ command: "downtime_link", id, services: checkIds });
      if (hostIds.length > 0) await client.call({ command: "downtime_link", id, hosts: hostIds });
    } catch (err) {
      return fail(
        `Maintenance window ${id} was created, but linking failed: ${errorText(err)}. ` +
          "The API cannot delete it. Fix or remove it in the ServerGuard24 dashboard.",
      );
    }

    return ok({
      id,
      hostname,
      start: args.start,
      end: args.end,
      linked_checks: checkIds,
      linked_hosts: hostIds,
      note: "Cannot be edited or deleted through the API.",
    });
  });
}
