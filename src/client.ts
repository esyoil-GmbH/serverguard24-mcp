export const DEFAULT_ENDPOINT = "https://www.serverguard24.de/de/api/json.html";

export type Sg24Command = { command: string; [key: string]: unknown };

export type Sg24Result =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

export class Sg24ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`API error ${code}: ${message}`);
    this.name = "Sg24ApiError";
    this.code = code;
  }
}

class RetryableError extends Error {}

export interface Sg24ClientOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  /** Timeout of one HTTP attempt. */
  timeoutMs?: number;
  /** Time budget for one call including all retries. Stays below the 60 s MCP client timeout. */
  totalMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface CallOptions {
  /** false: send once. Use it for commands that must not run twice (e.g. downtime_add). */
  retry?: boolean;
}

const AUTH_CODES = new Set(["220", "270"]);

type RawResult = { code?: unknown; message?: unknown; errmessage?: unknown; data?: unknown };

export class Sg24Client {
  readonly #token: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly totalMs: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;

  constructor(token: string, opts: Sg24ClientOptions = {}) {
    this.#token = token;
    this.#endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = opts.fetch ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.totalMs = opts.totalMs ?? 45_000;
    this.#retries = opts.retries ?? 3;
    this.#retryDelayMs = opts.retryDelayMs ?? 500;
  }

  /** Sends all commands in one HTTP request. Results keep the request order. */
  async batch(cmds: Sg24Command[], opts: CallOptions = {}): Promise<Sg24Result[]> {
    if (cmds.length === 0) return [];
    let raw: unknown;
    try {
      raw = await this.#post(cmds, opts.retry ?? true);
    } catch (err) {
      throw new Error(this.#redact(err instanceof Error ? err.message : String(err)));
    }
    if (!Array.isArray(raw) && raw !== null && typeof raw === "object" && "code" in raw) {
      // Top-level error, e.g. a wrong token: {"code":220,"message":"Authentication failed"}
      const r = this.#toResult(raw as RawResult);
      if (!r.ok) {
        const hint = AUTH_CODES.has(r.code) ? " Check SG24_API_TOKEN." : "";
        throw new Sg24ApiError(r.code, r.message + hint);
      }
    }
    if (!Array.isArray(raw) || raw.length < cmds.length) {
      throw new Error("Unexpected API response: expected one result per request");
    }
    return cmds.map((_, i) => this.#toResult(raw[i] as RawResult));
  }

  /** Sends one command. Returns its data, or throws Sg24ApiError. */
  async call(cmd: Sg24Command, opts: CallOptions = {}): Promise<unknown> {
    const [res] = await this.batch([cmd], opts);
    if (!res.ok) throw new Sg24ApiError(res.code, res.message);
    return res.data;
  }

  async #post(cmds: Sg24Command[], retry: boolean): Promise<unknown> {
    const body = JSON.stringify({ token: this.#token, requests: cmds });
    const deadline = Date.now() + this.totalMs;
    let delay = this.#retryDelayMs;
    for (let attempt = 0; ; attempt++) {
      const timeout = Math.min(this.#timeoutMs, deadline - Date.now());
      try {
        return await this.#once(body, timeout);
      } catch (err) {
        const retryable = err instanceof RetryableError;
        const outOfTime = Date.now() + delay + 1_000 > deadline;
        if (!retry || !retryable || attempt >= this.#retries || outOfTime) throw err;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  async #once(body: string, timeoutMs: number): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "serverguard24-mcp" },
        body,
        signal: AbortSignal.timeout(Math.max(timeoutMs, 1)),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new RetryableError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      }
      throw new RetryableError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status >= 500) throw new RetryableError(`HTTP status ${res.status}`);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Unexpected API response: not JSON");
    }
  }

  #toResult(r: RawResult): Sg24Result {
    const code = String(r?.code ?? "");
    if (code === "100") return { ok: true, data: r.data };
    const msg = [r?.message, r?.errmessage].find((m) => typeof m === "string" && m !== "") as
      | string
      | undefined;
    return { ok: false, code, message: this.#redact(msg ?? "no message") };
  }

  #redact(text: string): string {
    return this.#token ? text.split(this.#token).join("***") : text;
  }
}
