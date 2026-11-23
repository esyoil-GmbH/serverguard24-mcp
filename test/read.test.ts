import { describe, expect, it, vi } from "vitest";
import { Sg24ApiError, type Sg24Client, type Sg24Result } from "../src/client.js";
import type { Config } from "../src/config.js";
import { getCheck, listChecks, listHosts, listProblems, listResource } from "../src/tools/read.js";

function stub(opts: { batch?: Sg24Result[] | Error; call?: unknown | Error } = {}) {
  const batch = vi.fn(async () => {
    if (opts.batch instanceof Error) throw opts.batch;
    return opts.batch ?? [];
  });
  const call = vi.fn(async () => {
    if (opts.call instanceof Error) throw opts.call;
    return opts.call;
  });
  return { client: { batch, call } as unknown as Sg24Client, batch, call };
}

const cfg = (checkIds: number[] = [111, 222]): Config => ({ token: "t", checkIds });
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

const status = (id: number, state: string) => ({
  ok: true as const,
  data: {
    id,
    shortname: `check-${id}`,
    name: "HTTP",
    ts_next_check: 1,
    ts_last_check: 0,
    gmt_next_check: "2026-11-23 08:01:30",
    gmt_last_check: "2026-11-23 07:56:30",
    last_state: state,
    last_output: "HTTP/2 200",
  },
});

describe("listHosts", () => {
  const hosts = [
    { id: "1", address: "a.example.com", alias: "Shop", groups: [] },
    { id: "2", address: "b.example.com", alias: "Blog", groups: [] },
  ];

  it("returns all hosts without filter", async () => {
    const s = stub({ call: hosts });
    const r = await listHosts(s.client, cfg(), {});
    expect(s.call).toHaveBeenCalledWith({ command: "get_hosts" });
    expect(parse(r)).toHaveLength(2);
  });

  it("filters case-insensitively on alias", async () => {
    const r = await listHosts(stub({ call: hosts }).client, cfg(), { filter: "shop" });
    expect(parse(r).map((h: { id: string }) => h.id)).toEqual(["1"]);
  });

  it("filters on address", async () => {
    const r = await listHosts(stub({ call: hosts }).client, cfg(), { filter: "B.EXAMPLE" });
    expect(parse(r).map((h: { id: string }) => h.id)).toEqual(["2"]);
  });
});

describe("listResource", () => {
  it("sends get_<resource>", async () => {
    const s = stub({ call: [{ id: "5" }] });
    const r = await listResource(s.client, cfg(), { resource: "downtimes" });
    expect(s.call).toHaveBeenCalledWith({ command: "get_downtimes" });
    expect(parse(r)).toEqual([{ id: "5" }]);
  });
});

describe("getCheck", () => {
  it("sends service_show with the id", async () => {
    const s = stub({ call: { id: 111, state: "OK" } });
    const r = await getCheck(s.client, cfg(), { id: 111 });
    expect(s.call).toHaveBeenCalledWith({ command: "service_show", id: 111 });
    expect(parse(r)).toEqual({ id: 111, state: "OK" });
  });

  it("returns an error result on API error", async () => {
    const s = stub({ call: new Sg24ApiError("210", "Invalid API parameter") });
    const r = await getCheck(s.client, cfg(), { id: 1 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("API error 210: Invalid API parameter");
  });
});

describe("listChecks", () => {
  it("batches service_status and maps fields", async () => {
    const s = stub({ batch: [status(111, "OK"), status(222, "OK")] });
    const r = await listChecks(s.client, cfg(), {});
    expect(s.batch).toHaveBeenCalledTimes(1);
    expect(s.batch).toHaveBeenCalledWith([
      { command: "service_status", id: 111 },
      { command: "service_status", id: 222 },
    ]);
    expect(parse(r)[0]).toEqual({
      id: 111,
      shortname: "check-111",
      name: "HTTP",
      state: "OK",
      output: "HTTP/2 200",
      last_check: "2026-11-23 07:56:30",
      next_check: "2026-11-23 08:01:30",
    });
  });

  it("keeps going when one id fails", async () => {
    const s = stub({ batch: [status(111, "OK"), { ok: false, code: "300", message: "None" }] });
    const r = await listChecks(s.client, cfg(), {});
    expect(r.isError).toBeUndefined();
    expect(parse(r)[1]).toEqual({ id: 222, error: "API error 300: None" });
  });

  it("fails clearly without configured ids", async () => {
    const s = stub();
    const r = await listChecks(s.client, cfg([]), {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("No check IDs configured. Set SG24_CHECK_IDS.");
    expect(s.batch).not.toHaveBeenCalled();
  });

  it("returns an error result when the request fails", async () => {
    const r = await listChecks(stub({ batch: new Error("HTTP status 503") }).client, cfg(), {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("HTTP status 503");
  });
});

describe("listProblems", () => {
  it("returns checks that are not OK and failed lookups", async () => {
    const s = stub({
      batch: [
        status(111, "OK"),
        status(222, "CRITICAL"),
        status(333, "WARNING"),
        { ok: false, code: "300", message: "None" },
      ],
    });
    const r = await listProblems(s.client, cfg([111, 222, 333, 444]), {});
    const out = parse(r);
    expect(out.checked).toBe(4);
    expect(out.problems.map((p: { id: number }) => p.id)).toEqual([222, 333, 444]);
  });

  it("returns an empty list when all are OK", async () => {
    const r = await listProblems(stub({ batch: [status(111, "OK")] }).client, cfg([111]), {});
    expect(parse(r)).toEqual({ problems: [], checked: 1 });
  });

  it("fails clearly without configured ids", async () => {
    const r = await listProblems(stub().client, cfg([]), {});
    expect(r.isError).toBe(true);
  });
});
