import { describe, expect, it, vi } from "vitest";
import { Sg24ApiError, Sg24Client } from "../src/client.js";

type Reply = { status?: number; body: unknown } | Error;

function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls, mock: fn };
}

const client = (f: typeof fetch, token = "tok") =>
  new Sg24Client(token, { fetch: f, retryDelayMs: 0 });

describe("Sg24Client", () => {
  it("sends token and requests", async () => {
    const f = fakeFetch({ body: [{ code: 100, data: [] }] });
    await client(f.fn).batch([{ command: "get_nodes" }]);
    expect(f.calls[0].url).toBe("https://www.serverguard24.de/de/api/json.html");
    expect(f.calls[0].init.method).toBe("POST");
    expect(new Headers(f.calls[0].init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      token: "tok",
      requests: [{ command: "get_nodes" }],
    });
  });

  it("accepts code as number or string", async () => {
    const f = fakeFetch({ body: [{ code: 100, data: [1] }, { code: "100", data: [2] }] });
    const res = await client(f.fn).batch([{ command: "a" }, { command: "b" }]);
    expect(res).toEqual([
      { ok: true, data: [1] },
      { ok: true, data: [2] },
    ]);
  });

  it("maps error results with message or errmessage", async () => {
    const f = fakeFetch({
      body: [
        { code: 210, message: "Invalid API parameter", data: [] },
        { code: "300", errmessage: "x", data: [] },
        { code: 300, message: null, data: [] },
      ],
    });
    const res = await client(f.fn).batch([{ command: "a" }, { command: "b" }, { command: "c" }]);
    expect(res).toEqual([
      { ok: false, code: "210", message: "Invalid API parameter" },
      { ok: false, code: "300", message: "x" },
      { ok: false, code: "300", message: "no message" },
    ]);
  });

  it("call returns data on success", async () => {
    const f = fakeFetch({ body: [{ code: 100, data: { id: 1 } }] });
    await expect(client(f.fn).call({ command: "service_show", id: 1 })).resolves.toEqual({ id: 1 });
  });

  it("call throws Sg24ApiError on error code", async () => {
    const f = fakeFetch({ body: [{ code: 210, message: "Invalid API parameter", data: [] }] });
    const err = await client(f.fn).call({ command: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(Sg24ApiError);
    expect(err.code).toBe("210");
    expect(err.message).toBe("API error 210: Invalid API parameter");
  });

  it("retries 5xx then succeeds", async () => {
    const f = fakeFetch({ status: 500, body: "" }, { status: 502, body: "" }, { body: [{ code: 100, data: 1 }] });
    await expect(client(f.fn).call({ command: "x" })).resolves.toBe(1);
    expect(f.mock).toHaveBeenCalledTimes(3);
  });

  it("gives up after retries on 5xx", async () => {
    const f = fakeFetch({ status: 503, body: "" });
    await expect(client(f.fn).call({ command: "x" })).rejects.toThrow("HTTP status 503");
    expect(f.mock).toHaveBeenCalledTimes(4);
  });

  it("retries network errors", async () => {
    const f = fakeFetch(new Error("ECONNRESET"), { body: [{ code: 100, data: 1 }] });
    await expect(client(f.fn).call({ command: "x" })).resolves.toBe(1);
    expect(f.mock).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx", async () => {
    const f = fakeFetch({ status: 403, body: "" });
    await expect(client(f.fn).call({ command: "x" })).rejects.toThrow("HTTP status 403");
    expect(f.mock).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML response", async () => {
    const f = fakeFetch({ body: "<html>oops</html>" });
    await expect(client(f.fn).batch([{ command: "x" }])).rejects.toThrow(/Unexpected API response/);
  });

  it("rejects a response shorter than the request list", async () => {
    const f = fakeFetch({ body: [{ code: 100, data: 1 }] });
    await expect(client(f.fn).batch([{ command: "a" }, { command: "b" }])).rejects.toThrow(
      /Unexpected API response/,
    );
  });

  it("rejects a non-array response without a code", async () => {
    const f = fakeFetch({ body: { foo: 1 } });
    await expect(client(f.fn).batch([{ command: "a" }])).rejects.toThrow(/Unexpected API response/);
  });

  it("surfaces a top-level auth error with a token hint", async () => {
    const f = fakeFetch({ body: { code: 220, message: "Authentication failed" } });
    const err = await client(f.fn).batch([{ command: "a" }]).catch((e) => e);
    expect(err).toBeInstanceOf(Sg24ApiError);
    expect(err.code).toBe("220");
    expect(err.message).toMatch(/Authentication failed/);
    expect(err.message).toMatch(/SG24_API_TOKEN/);
  });

  it("does not retry when retry is false", async () => {
    const f = fakeFetch({ status: 503, body: "" });
    await expect(client(f.fn).call({ command: "x" }, { retry: false })).rejects.toThrow("HTTP status 503");
    expect(f.mock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying at the total deadline", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const c = new Sg24Client("tok", {
      fetch: hang as unknown as typeof fetch,
      timeoutMs: 40,
      totalMs: 100,
      retries: 10,
      retryDelayMs: 0,
    });
    const t0 = Date.now();
    await expect(c.call({ command: "x" })).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(hang.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("defaults keep the worst case under the 60 s MCP client timeout", () => {
    expect(new Sg24Client("tok").totalMs).toBeLessThanOrEqual(50_000);
  });

  it("redacts token in network errors", async () => {
    const f = fakeFetch(new Error("boom secret-token-123"));
    const err = await client(f.fn, "secret-token-123").call({ command: "x" }).catch((e) => e);
    expect(err.message).toContain("***");
    expect(err.message).not.toContain("secret-token-123");
  });

  it("redacts token in API error messages", async () => {
    const f = fakeFetch({ body: [{ code: 220, message: "bad token secret-token-123", data: [] }] });
    const err = await client(f.fn, "secret-token-123").call({ command: "x" }).catch((e) => e);
    expect(err.message).toBe("API error 220: bad token ***");
  });

  it("returns empty array for empty batch without calling fetch", async () => {
    const f = fakeFetch({ body: [] });
    await expect(client(f.fn).batch([])).resolves.toEqual([]);
    expect(f.mock).not.toHaveBeenCalled();
  });
});
