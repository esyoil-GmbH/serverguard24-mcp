# ServerGuard24 MCP Server – Design

Date: 2026-11-23

## Intent

Claude must be able to use the agital ServerGuard24 account. Claude answers
monitoring questions ("What is down?", "What does check X say?") and does
daily operational actions (pause a check during a deploy, set a maintenance
window). Claude does not build or change the monitoring setup.

## Goals

- Read: hosts, configured checks with current status, check details,
  contacts, groups, nodes, maintenance windows, distributors, integrations.
- Answer "what is down now?" for the configured checks.
- Operational actions: pause/resume a check, turn alerts for a check on/off,
  create a maintenance window and link it to checks or hosts.

## Non-goals

- Create, edit or delete hosts, checks or contacts.
- Change links between checks and contacts, distributors or integrations.
- A generic "send any command" tool.

## Anti-goals

- The token appears in code, logs, error messages or tool output.
- Claude creates a maintenance window by accident. The API cannot edit or
  delete maintenance windows, so the only fix is the dashboard.

## Constraints (from the API)

- One endpoint: `POST https://www.serverguard24.de/de/api/json.html`.
  Body: `{"token": "...", "requests": [{"command": "...", ...}]}`.
  Response: an array, one element per request, with `code`, `message` or
  `errmessage`, and `data`. `code` can be a string or a number. `100` = OK.
- Error codes: `210` = invalid parameter or not found, `300` = generic
  (also "deleted check" for `service_show`), `220`/`270` = auth/permission,
  `310` = already exists. `200` = unknown command.
- `get_hosts` and `get_contacts` ignore an ID filter. They always return the
  full account. Filter on the client side.
- No `downtime_show`, no `downtime_edit`, no `downtime_delete`.
- **No command lists checks, and no uptime command exists** (about 40 names
  probed on 2026-11-23, all "Unknown command" = code `200`). `get_hosts` returns
  only `id`, `address`, `alias`, `groups`.
- `service_show {id}` returns `id, shortname, description, name, state,
  output, active, notifications, check_interval, address, params{...},
  notification{...}, contacts, distributors, downtimes`. Passwords come back
  as `******`.
- `service_status {id}` returns `id, shortname, name, ts_next_check,
  ts_last_check, gmt_next_check, gmt_last_check, last_state, last_output`.
  Other parameter names give `210`.
- `get_downtimes` items: `id, description, downtype, startdate, datelist,
  datemult, starttime, duration, utc, live`.
- One HTTP request can carry many commands. The response array keeps the
  order of the requests.
- `downtime_add` takes `hostname`, `starttime`/`endtime` (Unix seconds),
  `description`, `type`, optional `readonly`. `downtime_link` takes `id`
  plus `services` or `hosts` (integer arrays).
- `service_monitoring` and `service_notification` take `id` and `0`/`1`.
- Source of truth for parameters: `github.com/dg-i/terraform-provider-serverguard24`,
  `internal/client/client.go` and `internal/provider/*.go`.

## Approaches

1. **Read + operational actions** – picked. Covers the daily questions and
   actions. Small risk surface.
2. Full CRUD behind `SG24_ALLOW_WRITES` – rejected for now. More surface, and
   the API has write-once flags and fields that cannot be cleared.
3. Read-only – rejected. Claude cannot even pause a check.

## Decided

- Stack like `trello-mcp-agital`: TypeScript, ESM, `@modelcontextprotocol/sdk`,
  zod, stdio transport, `.mcpb` build with `manifest.json`.
- Token from env var `SG24_API_TOKEN` (same name as the Terraform provider).
  The server fails at start with a clear message if the variable is missing.
- Check discovery (option c, picked 2026-11-23): env var `SG24_CHECK_IDS`,
  comma-separated check IDs copied from the dashboard. Replace this with a
  list command if the official API docs show one.
- The repo `esyoil-GmbH/serverguard24-mcp` is public. No token, no real
  account data (host names, contacts) in code, tests or docs.
- Location: `/home/bennet/source/serverguard24-mcp`.

## Tools (proposal, Claude's call)

| Tool | API command | Kind |
|------|-------------|------|
| `sg24_list_hosts` (optional name filter) | `get_hosts` | read |
| `sg24_get_check` (id) | `service_show` | read |
| `sg24_list_checks` – status of all configured checks | `service_status` × N in one HTTP request | read |
| `sg24_list` (resource: contacts, groups, nodes, downtimes, distributors, integrations) | `get_*` | read |
| `sg24_problems` – configured checks with `last_state` ≠ `OK` | `service_status` × N | read |
| `sg24_set_check_monitoring` (id, enabled) | `service_monitoring` | write, reversible |
| `sg24_set_check_notifications` (id, enabled) | `service_notification` | write, reversible |
| `sg24_create_downtime` (hostname, start, end, description, type, check_ids?, host_ids?) | `downtime_add` + `downtime_link` | write, irreversible |

- Read tools get `readOnlyHint: true`. Write tools get `readOnlyHint: false`.
  `sg24_create_downtime` gets `destructiveHint: true`, and its description
  says that the window cannot be removed through the API.
- `sg24_create_downtime` checks that end > start and that start is not far in
  the past before the call.
- Tool output: compact JSON of the API `data`. Errors: code + message, never
  the request body.

## Left to the builder

- The valid values of the downtime `type` (see the Terraform provider's
  `downtime_resource.go`).
- Retry and timeout (proposal: 30 s timeout, 3 retries on network errors and
  HTTP 5xx only).

## Testing

- Unit tests (vitest) with a mocked `fetch`: request body, code handling
  (string/number), error mapping, token never in error text.
- Live checks only with read commands. Write tools are not run against the
  live account without an explicit OK from the user.
