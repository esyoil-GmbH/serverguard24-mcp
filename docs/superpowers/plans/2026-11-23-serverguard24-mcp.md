# ServerGuard24 MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server that lets Claude read the ServerGuard24 account, report failing checks, pause/resume checks, toggle check alerts, and create maintenance windows.

**Architecture:** One small API client sends batched commands to the single JSON endpoint. Pure tool handlers take the client and config, and return MCP results. `index.ts` reads env, builds the client, and registers the tools on an `McpServer`.

**Tech Stack:** Node ≥ 20, TypeScript (ESM), `@modelcontextprotocol/sdk` ^1.27, `zod` ^3, `vitest`, built-in `fetch`, `@anthropic-ai/mcpb` for packing.

**Spec:** `docs/superpowers/specs/2026-11-23-serverguard24-mcp-design.md`

## Global Constraints

- Endpoint: `POST https://www.serverguard24.de/de/api/json.html`, body `{"token": "...", "requests": [...]}`, `Content-Type: application/json`.
- Success code is `100`; `code` may be a string or a number.
- Token only from env `SG24_API_TOKEN`. Check IDs only from env `SG24_CHECK_IDS` (comma-separated integers).
- The token never appears in logs, errors or tool output. Nothing is written to stdout except MCP traffic (log to stderr).
- Public repo: test fixtures use fake data only (`example.com`, IDs like `111`, `222`). No real host names, contacts or IDs from the account.
- No create/edit/delete tools for hosts, checks or contacts. No generic command tool.
- Downtime type is always `1` (maintenance). Max downtime duration 23:59:59 (provider docs).
- tsconfig: copy from `trello-mcp-agital`, but `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.

## Review Focus

1. A thrown `fetch` error or API message contains the token → the error text shows `***` instead. (Task 1 test `redacts token`.)
2. `SG24_CHECK_IDS` is `" 111, 222 ,,"` or contains `abc` → whitespace and empty parts are ignored; a non-numeric part stops startup with a message that names the bad value. Missing/empty → server starts; check tools answer "No check IDs configured. Set SG24_CHECK_IDS." (Task 2 tests.)
3. One configured check ID was deleted (`300`/`210`) → `sg24_list_checks` still lists the others and marks that one with its error. (Task 3 test `one bad id`.)
4. Downtime times given without a timezone (`2026-11-24 02:00`) → rejected; Claude must send ISO 8601 with offset or `Z`. End ≤ start, duration > 23:59:59, or start more than 1 hour in the past → rejected before any API call. (Task 4 tests.)
5. The API returns HTML or an array shorter than the request list → a clear error `Unexpected API response`, not a crash. (Task 1 tests.)

---

### Task 1: Project setup and API client

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts` (none needed if defaults work), `src/client.ts`
- Test: `test/client.test.ts`

**Interfaces:**
- Produces (`src/client.ts`):
  - `type Sg24Command = { command: string; [k: string]: unknown }`
  - `type Sg24Result = { ok: true; data: unknown } | { ok: false; code: string; message: string }`
  - `class Sg24ApiError extends Error { code: string }`
  - `class Sg24Client { constructor(token: string, opts?: { endpoint?: string; fetch?: typeof fetch; timeoutMs?: number; retries?: number; retryDelayMs?: number }) ; batch(cmds: Sg24Command[]): Promise<Sg24Result[]> ; call(cmd: Sg24Command): Promise<unknown> }`
  - `call` returns `data` on `100`, else throws `Sg24ApiError` with `message` = `"API error <code>: <message or errmessage or 'no message'>"`.
  - Defaults: `timeoutMs` 30000, `retries` 3, `retryDelayMs` 500 (doubling). Retry only on network errors and HTTP 5xx. HTTP 4xx → throw `Error("HTTP status <n>")` at once.

- [ ] **Step 1:** `npm init`, set `"type": "module"`, `"private": true`, `"bin": {"serverguard24-mcp": "dist/index.js"}`, scripts `build: tsc`, `test: vitest run`, `type-check: tsc --noEmit`, `build:mcpb: mcpb pack`. Install `@modelcontextprotocol/sdk zod` and dev `typescript @types/node vitest`. Write `tsconfig.json` per Global Constraints, with `test/` excluded from `include`.
- [ ] **Step 2: Write failing tests** in `test/client.test.ts`, with a fake `fetch` that records the request and returns a canned `Response`:
  - `sends token and requests`: `batch([{command:"get_nodes"}])` → body equals `{"token":"tok","requests":[{"command":"get_nodes"}]}`, method `POST`, header `content-type: application/json`.
  - `code as number or string`: `[{code:100,data:[1]},{code:"100",data:[2]}]` → both `{ok:true}`.
  - `error result`: `{code:210,message:"Invalid API parameter"}` → `{ok:false,code:"210",message:"Invalid API parameter"}`; `{code:"300",errmessage:"x"}` → message `"x"`.
  - `call throws`: `call` on a `210` result rejects with `Sg24ApiError`, `.code === "210"`.
  - `retries 5xx then succeeds`: 500, 500, 200 → resolves; fetch called 3 times (use `retryDelayMs: 0`).
  - `no retry on 4xx`: 403 → rejects `"HTTP status 403"`; fetch called once.
  - `unexpected response`: body `<html>` → rejects matching `/Unexpected API response/`; array of length 1 for 2 requests → same.
  - `redacts token`: fake fetch throws `new Error("boom tok")` on every try → rejection message contains `***`, not `tok`.
- [ ] **Step 3:** Run `npx vitest run test/client.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4:** Implement `src/client.ts`. Use `AbortSignal.timeout(timeoutMs)`. Redact with `message.split(token).join("***")` on every error that leaves the client.
- [ ] **Step 5:** Run `npx vitest run test/client.test.ts`. Expected: all PASS.
- [ ] **Step 6: Commit** `git add package.json package-lock.json tsconfig.json src/client.ts test/client.test.ts && git commit -m "feat: add ServerGuard24 API client"`

### Task 2: Config

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `type Config = { token: string; checkIds: number[] }` and `loadConfig(env: Record<string, string | undefined>): Config`. Throws `Error` with a readable message.

- [ ] **Step 1: Write failing tests:**
  - `missing token`: `loadConfig({})` throws `/SG24_API_TOKEN is not set/`.
  - `parses ids`: `{SG24_API_TOKEN:"t", SG24_CHECK_IDS:" 111, 222 ,,"}` → `checkIds` `[111, 222]`.
  - `no ids`: `{SG24_API_TOKEN:"t"}` → `checkIds` `[]`.
  - `bad id`: `SG24_CHECK_IDS:"111,abc"` throws `/SG24_CHECK_IDS.*"abc"/`.
  - `dedupes`: `"111,111"` → `[111]`.
- [ ] **Step 2:** Run `npx vitest run test/config.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/config.ts`. A valid ID matches `/^\d+$/`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add env config`.

### Task 3: Read tools

**Files:**
- Create: `src/tools/read.ts`, `src/tools/result.ts`
- Test: `test/read.test.ts`

**Interfaces:**
- Consumes: `Sg24Client`, `Sg24Result`, `Sg24ApiError` (Task 1), `Config` (Task 2).
- Produces:
  - `src/tools/result.ts`: `type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean }`, `ok(value: unknown): ToolResult` (compact `JSON.stringify`), `fail(message: string): ToolResult` (`isError: true`).
  - `src/tools/read.ts`, all `(client: Sg24Client, config: Config, args) => Promise<ToolResult>`:
    - `listHosts(client, config, { filter?: string })` — `get_hosts`; case-insensitive substring match on `address` or `alias`.
    - `listResource(client, config, { resource: "contacts"|"groups"|"nodes"|"downtimes"|"distributors"|"integrations" })` — `get_<resource>`.
    - `getCheck(client, config, { id: number })` — `service_show`.
    - `listChecks(client, config, {})` — one `batch` of `service_status` per configured ID. Output: array of `{ id, shortname, name, state, output, last_check, next_check }` (from `last_state`, `last_output`, `gmt_last_check`, `gmt_next_check`), or `{ id, error: "API error <code>: <msg>" }` per failed item.
    - `listProblems(client, config, {})` — same data as `listChecks`, keep items with `state !== "OK"` or with `error`. Empty → `ok({ problems: [], checked: <n> })`; else `ok({ problems, checked: <n> })`.
  - Empty `config.checkIds` → `listChecks`/`listProblems` return `fail("No check IDs configured. Set SG24_CHECK_IDS.")`.
  - Any thrown error → `fail(error.message)`.

- [ ] **Step 1: Write failing tests** with a stub client (`{ batch: vi.fn(), call: vi.fn() }` cast to `Sg24Client`):
  - `listHosts filter`: data `[{id:"1",address:"a.example.com",alias:"Shop"},{id:"2",address:"b.example.com",alias:"Blog"}]`, filter `"shop"` → only id `"1"`.
  - `listResource` sends `{command:"get_downtimes"}`.
  - `listChecks maps fields`: one `service_status` result → `{id:111,shortname:"web",name:"HTTP",state:"OK",output:"HTTP/2 200",last_check:"2026-11-23 07:56:30",next_check:"2026-11-23 08:01:30"}`; batch called once with `[{command:"service_status",id:111},{command:"service_status",id:222}]` for IDs `[111,222]`.
  - `one bad id`: results `[ok OK, {ok:false,code:"300",message:"None"}]` → two items; second is `{id:222,error:"API error 300: None"}`; `isError` not set.
  - `listProblems`: states `OK`, `CRITICAL`, `WARNING` → two problems, `checked: 3`.
  - `no ids`: `checkIds: []` → `isError: true`, text `No check IDs configured. Set SG24_CHECK_IDS.`
  - `getCheck error`: `call` rejects `Sg24ApiError("API error 210: Invalid API parameter")` → `isError: true` with that text.
- [ ] **Step 2:** Run `npx vitest run test/read.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/tools/result.ts` and `src/tools/read.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add read tools`.

### Task 4: Write tools

**Files:**
- Create: `src/tools/write.ts`
- Test: `test/write.test.ts`

**Interfaces:**
- Consumes: Task 1 client, Task 3 `ok`/`fail`.
- Produces (`src/tools/write.ts`):
  - `setCheckMonitoring(client, config, { id: number; enabled: boolean })` — `service_monitoring` with `monitoring: 1|0`. Output `ok({ id, monitoring: "enabled"|"paused" })`.
  - `setCheckNotifications(client, config, { id: number; enabled: boolean })` — `service_notification` with `notification: 1|0`. Output `ok({ id, notifications: "enabled"|"disabled" })`.
  - `createDowntime(client, config, { hostname: string; start: string; end: string; description: string; check_ids?: number[]; host_ids?: number[] }, now: () => Date = () => new Date())`.
    - `start`/`end` must match ISO 8601 with `Z` or `±hh:mm` offset; else `fail("start and end need a timezone, e.g. 2026-11-24T02:00:00+01:00")`.
    - Reject end ≤ start, end − start > 86399 s, start < now − 3600 s. All before any API call.
    - Call `downtime_add` `{hostname, starttime, endtime (Unix seconds), description, type: 1}`. The ID is in `data.dt_id`.
    - Then `downtime_link {id, services: check_ids}` and `downtime_link {id, hosts: host_ids}` when given and non-empty. If a link fails, return `fail` that says the downtime `<id>` exists but is not linked, and that only the dashboard can remove it.
    - Success: `ok({ id, hostname, start, end, linked_checks, linked_hosts, note: "Cannot be edited or deleted through the API." })`.

- [ ] **Step 1: Write failing tests:**
  - `pause`: `{id:111,enabled:false}` → `call` with `{command:"service_monitoring",id:111,monitoring:0}`.
  - `notifications on`: `{id:111,enabled:true}` → `notification: 1`.
  - `downtime ok`: now `2026-11-23T10:00:00Z`, start `2026-11-24T02:00:00+01:00`, end `2026-11-24T03:00:00+01:00`, `check_ids:[111]` → first call `{command:"downtime_add",hostname:"web.example.com",starttime:1795482000,endtime:1795485600,description:"Deploy",type:1}`; stub returns `{dt_id:"5"}`; second call `{command:"downtime_link",id:"5",services:[111]}`; no host link call.
  - `no timezone`: start `2026-11-24 02:00` → `isError`, `call` not called.
  - `end before start`, `too long` (start +24 h), `past` (start = now − 2 h) → each `isError`, `call` not called.
  - `link fails`: link rejects → `isError`, text contains `5` and `dashboard`.
- [ ] **Step 2:** Run `npx vitest run test/write.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/tools/write.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add operational write tools`.

### Task 5: Server wiring, packaging, docs, live smoke test

**Files:**
- Create: `src/index.ts`, `manifest.json`, `README.md`, `.env.example`, `scripts/smoke.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildServer(client: Sg24Client, config: Config): McpServer` exported from `src/server.ts`; `src/index.ts` (shebang) calls `loadConfig(process.env)`, prints errors to stderr and exits 1, else connects `buildServer` to `StdioServerTransport`.

Tool registration (`server.registerTool`, zod input schemas, descriptions in English):

| Name | Handler | Annotations |
|------|---------|-------------|
| `sg24_list_hosts` | `listHosts` | readOnly |
| `sg24_list` | `listResource` | readOnly |
| `sg24_get_check` | `getCheck` | readOnly |
| `sg24_list_checks` | `listChecks` | readOnly |
| `sg24_problems` | `listProblems` | readOnly |
| `sg24_set_check_monitoring` | `setCheckMonitoring` | readOnly false, destructive false, idempotent true |
| `sg24_set_check_notifications` | `setCheckNotifications` | readOnly false, destructive false, idempotent true |
| `sg24_create_downtime` | `createDowntime` | readOnly false, destructive true, idempotent false |

The `sg24_create_downtime` description must say: the window cannot be edited or deleted through the API, the times need a timezone, and Claude must confirm the details with the user first.

- [ ] **Step 1: Write failing test** `test/index.test.ts`: connect `buildServer` (stub client) to a `Client` over `InMemoryTransport.createLinkedPair()`; `listTools` returns exactly the 8 names above; `sg24_create_downtime` has `annotations.destructiveHint === true`; all `sg24_list*`, `sg24_get_check`, `sg24_problems` have `readOnlyHint === true`.
- [ ] **Step 2:** Run `npx vitest run test/index.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/server.ts` and `src/index.ts`.
- [ ] **Step 4:** Run `npm test && npm run type-check && npm run build`. Expected: all PASS, `dist/index.js` exists.
- [ ] **Step 5:** Write `manifest.json` like the Trello one: name `serverguard24`, `user_config` `api_token` (sensitive, required) and `check_ids` (string, optional), mapped to `SG24_API_TOKEN` / `SG24_CHECK_IDS`; list the 8 tools. Write `.env.example` with empty `SG24_API_TOKEN=` and `SG24_CHECK_IDS=`. Write `README.md`: what it does, the API limits (no check list, no downtime delete, write-once flags), setup for Claude Code (`claude mcp add serverguard24 -e SG24_API_TOKEN=... -e SG24_CHECK_IDS=... -- node /path/dist/index.js`), and how to find check IDs in the dashboard.
- [ ] **Step 6:** Write `scripts/smoke.ts`: build the real client from env and run only `listResource nodes`, `listHosts`, `listChecks`, `listProblems`; print counts and states, not host names. Run `SG24_API_TOKEN=… SG24_CHECK_IDS=… npx tsx scripts/smoke.ts` (the human partner supplies the env). Expected: no errors, at least one check with a state. Do **not** call write tools against the live account.
- [ ] **Step 7:** Run `npm run build:mcpb`. Expected: a `.mcpb` file (ignored by git).
- [ ] **Step 8: Commit** `feat: wire MCP server, manifest and docs`. Before the commit, run `git grep -nF "$SG24_API_TOKEN"` (expect no output) and scan `git diff --cached` for real host names, contacts or IDs from the account, and confirm no token and no account data. Do not push without the human partner's OK.
