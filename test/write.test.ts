import { describe, expect, it, vi } from "vitest";
import { Sg24ApiError, type Sg24Client } from "../src/client.js";
import type { Config } from "../src/config.js";
import { createDowntime, setCheckMonitoring, setCheckNotifications } from "../src/tools/write.js";

function stub(...replies: (unknown | Error)[]) {
  let i = 0;
  const call = vi.fn(async () => {
    const r = replies[i++];
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: { call, batch: vi.fn() } as unknown as Sg24Client, call };
}

const cfg: Config = { token: "t", checkIds: [] };
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const now = () => new Date("2026-11-23T10:00:00Z");

describe("setCheckMonitoring", () => {
  it("pauses a check", async () => {
    const s = stub([]);
    const r = await setCheckMonitoring(s.client, cfg, { id: 111, enabled: false });
    expect(s.call).toHaveBeenCalledWith({ command: "service_monitoring", id: 111, monitoring: 0 });
    expect(parse(r)).toEqual({ id: 111, monitoring: "paused" });
  });

  it("resumes a check", async () => {
    const s = stub([]);
    const r = await setCheckMonitoring(s.client, cfg, { id: 111, enabled: true });
    expect(s.call).toHaveBeenCalledWith({ command: "service_monitoring", id: 111, monitoring: 1 });
    expect(parse(r)).toEqual({ id: 111, monitoring: "enabled" });
  });

  it("returns an error result on API error", async () => {
    const r = await setCheckMonitoring(stub(new Sg24ApiError("270", "no rights")).client, cfg, {
      id: 1,
      enabled: true,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("API error 270: no rights");
  });
});

describe("setCheckNotifications", () => {
  it("turns alerts on", async () => {
    const s = stub([]);
    const r = await setCheckNotifications(s.client, cfg, { id: 111, enabled: true });
    expect(s.call).toHaveBeenCalledWith({ command: "service_notification", id: 111, notification: 1 });
    expect(parse(r)).toEqual({ id: 111, notifications: "enabled" });
  });

  it("turns alerts off", async () => {
    const s = stub([]);
    const r = await setCheckNotifications(s.client, cfg, { id: 111, enabled: false });
    expect(s.call).toHaveBeenCalledWith({ command: "service_notification", id: 111, notification: 0 });
    expect(parse(r)).toEqual({ id: 111, notifications: "disabled" });
  });
});

describe("createDowntime", () => {
  const base = {
    hostname: "web.example.com",
    start: "2026-11-24T02:00:00+01:00",
    end: "2026-11-24T03:00:00+01:00",
    description: "Deploy",
  };

  it("creates and links checks", async () => {
    const s = stub({ dt_id: "5" }, []);
    const r = await createDowntime(s.client, cfg, { ...base, check_ids: [111] }, now);
    expect(s.call).toHaveBeenNthCalledWith(1, {
      command: "downtime_add",
      hostname: "web.example.com",
      starttime: 1795482000,
      endtime: 1795485600,
      description: "Deploy",
      type: 1,
    });
    expect(s.call).toHaveBeenNthCalledWith(2, { command: "downtime_link", id: "5", services: [111] });
    expect(s.call).toHaveBeenCalledTimes(2);
    expect(r.isError).toBeUndefined();
    expect(parse(r)).toMatchObject({ id: "5", linked_checks: [111], linked_hosts: [] });
    expect(parse(r).note).toMatch(/cannot be edited or deleted/i);
  });

  it("links hosts too", async () => {
    const s = stub({ dt_id: 7 }, [], []);
    await createDowntime(s.client, cfg, { ...base, check_ids: [111], host_ids: [9] }, now);
    expect(s.call).toHaveBeenNthCalledWith(3, { command: "downtime_link", id: "7", hosts: [9] });
  });

  it("skips linking for empty lists", async () => {
    const s = stub({ dt_id: "5" });
    await createDowntime(s.client, cfg, { ...base, check_ids: [], host_ids: [] }, now);
    expect(s.call).toHaveBeenCalledTimes(1);
  });

  it("accepts Z times", async () => {
    const s = stub({ dt_id: "5" });
    const r = await createDowntime(
      s.client,
      cfg,
      { ...base, start: "2026-11-24T01:00:00Z", end: "2026-11-24T02:00:00Z" },
      now,
    );
    expect(r.isError).toBeUndefined();
    expect(s.call.mock.calls[0][0]).toMatchObject({ starttime: 1795482000 });
  });

  it.each([
    ["no timezone", { start: "2026-11-24 02:00", end: "2026-11-24 03:00" }, /timezone/],
    ["no timezone ISO", { start: "2026-11-24T02:00:00", end: "2026-11-24T03:00:00" }, /timezone/],
    ["garbage", { start: "tomorrow", end: "later" }, /timezone/],
    ["invalid date", { start: "2026-13-45T02:00:00Z", end: "2026-13-45T03:00:00Z" }, /valid/],
    ["end before start", { end: "2026-11-24T01:00:00+01:00" }, /after the start/],
    ["end equals start", { end: base.start }, /after the start/],
    ["too long", { end: "2026-11-25T02:00:00+01:00" }, /23:59:59/],
    ["in the past", { start: "2026-11-23T08:00:00Z", end: "2026-11-23T09:00:00Z" }, /past/],
    ["empty hostname", { hostname: " " }, /hostname/],
    ["empty description", { description: "" }, /description/],
  ])("rejects %s before any API call", async (_name, patch, msg) => {
    const s = stub({ dt_id: "5" });
    const r = await createDowntime(s.client, cfg, { ...base, ...patch }, now);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(msg);
    expect(s.call).not.toHaveBeenCalled();
  });

  it("allows a start up to one hour in the past", async () => {
    const s = stub({ dt_id: "5" });
    const r = await createDowntime(
      s.client,
      cfg,
      { ...base, start: "2026-11-23T09:30:00Z", end: "2026-11-23T11:00:00Z" },
      now,
    );
    expect(r.isError).toBeUndefined();
  });

  it("allows exactly 23:59:59", async () => {
    const s = stub({ dt_id: "5" });
    const r = await createDowntime(
      s.client,
      cfg,
      { ...base, start: "2026-11-24T00:00:00Z", end: "2026-11-24T23:59:59Z" },
      now,
    );
    expect(r.isError).toBeUndefined();
  });

  it("reports an unlinked downtime when linking fails", async () => {
    const s = stub({ dt_id: "5" }, new Sg24ApiError("210", "Invalid API parameter"));
    const r = await createDowntime(s.client, cfg, { ...base, check_ids: [111] }, now);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("5");
    expect(r.content[0].text).toMatch(/dashboard/);
    expect(r.content[0].text).toContain("API error 210");
  });

  it("returns an error result when downtime_add fails", async () => {
    const s = stub(new Sg24ApiError("310", "already exists"));
    const r = await createDowntime(s.client, cfg, base, now);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("API error 310: already exists");
  });

  it("fails when the response has no dt_id", async () => {
    const s = stub({});
    const r = await createDowntime(s.client, cfg, { ...base, check_ids: [111] }, now);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/no ID/);
    expect(s.call).toHaveBeenCalledTimes(1);
  });
});
