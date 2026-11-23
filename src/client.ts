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
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

type RawResult = { code?: unknown; message?: unknown; errmessage?: unknown; data?: unknown };

export class Sg24Client {
  readonly #token: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #retryDelayMs: number;

  constructor(token: string, opts: Sg24ClientOptions = {}) {
    this.#token = token;
    this.#endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = opts.fetch ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
    this.#retries = opts.retries ?? 3;
    this.#retryDelayMs = opts.retryDelayMs ?? 500;
  }

  /** Sends all commands in one HTTP request. Results keep the request order. */
  async batch(cmds: Sg24Command[]): Promise<Sg24Result[]> {
    if (cmds.length === 0) return [];
    let raw: unknown;
    try {
      raw = await this.#post(cmds);
    } catch (err) {
      throw new Error(this.#redact(err instanceof Error ? err.message : String(err)));
    }
    if (!Array.isArray(raw) || raw.length < cmds.length) {
      throw new Error("Unexpected API response: expected one result per request");
    }
    return cmds.map((_, i) => this.#toResult(raw[i] as RawResult));
  }

  /** Sends one command. Returns its data, or throws Sg24ApiError. */
  async call(cmd: Sg24Command): Promise<unknown> {
    const [res] = await this.batch([cmd]);
    if (!res.ok) throw new Sg24ApiError(res.code, res.message);
    return res.data;
  }

  async #post(cmds: Sg24Command[]): Promise<unknown> {
    const body = JSON.stringify({ token: this.#token, requests: cmds });
    let delay = this.#retryDelayMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#once(body);
      } catch (err) {
        if (!(err instanceof RetryableError) || attempt >= this.#retries) throw err;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  async #once(body: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "serverguard24-mcp" },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
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
