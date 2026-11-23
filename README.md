# serverguard24-mcp

An [MCP](https://modelcontextprotocol.io) server for the [ServerGuard24](https://www.serverguard24.de) monitoring API.

With it, Claude can:

- tell you what is down right now,
- show the status and details of checks,
- list hosts, contacts, groups, monitoring nodes, maintenance windows, distributors and integrations,
- pause and resume checks, and turn their alerts on or off,
- create maintenance windows.

It cannot create, change or delete hosts, checks or contacts. This is on purpose.

## Tools

| Tool | What it does | Changes data |
|------|--------------|--------------|
| `sg24_problems` | Configured checks that are not OK | no |
| `sg24_list_checks` | State, output and last/next run of all configured checks | no |
| `sg24_get_check` | Full details of one check | no |
| `sg24_list_hosts` | Hosts, with optional text filter | no |
| `sg24_list` | contacts, groups, nodes, downtimes, distributors, integrations | no |
| `sg24_set_check_monitoring` | Pause or resume a check | yes (reversible) |
| `sg24_set_check_notifications` | Turn the alerts of a check on or off | yes (reversible) |
| `sg24_create_downtime` | Create a maintenance window and link checks/hosts | yes (**not reversible via API**) |

## API limits you must know

- **The API cannot list checks.** `get_hosts` returns hosts only, and there is no list command for checks. So you must configure the check IDs in `SG24_CHECK_IDS`. `sg24_problems` and `sg24_list_checks` look only at these checks.
- **Maintenance windows cannot be edited or deleted through the API.** Only the ServerGuard24 dashboard can remove them. The tool checks the input before the call (timezone required, end after start, max. 23:59:59, start not more than 1 hour in the past).
- The API has no uptime or statistics command.

The [Terraform provider](https://github.com/dg-i/terraform-provider-serverguard24) was the reference for the API.

## Setup

Requirements: Node.js 22 or newer.

```sh
npm install
npm run build
```

### Find the check IDs

Open a check in the ServerGuard24 dashboard. The check (service) ID is shown in the check details and in the URL. Collect the IDs of all checks that Claude must watch.

### Claude Code

```sh
claude mcp add serverguard24 \
  -e SG24_API_TOKEN=<your token> \
  -e SG24_CHECK_IDS=123456,123457 \
  -- node /path/to/serverguard24-mcp/dist/index.js
```

### Claude Desktop (.mcpb)

```sh
npm run build:mcpb   # builds serverguard24-mcp.mcpb with production dependencies only
```

Open the `.mcpb` file and enter the token and the check IDs.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SG24_API_TOKEN` | yes | API token from the ServerGuard24 customer area |
| `SG24_CHECK_IDS` | no | Comma-separated check IDs. Without it, `sg24_problems` and `sg24_list_checks` return an error. |

Never commit the token. See `.env.example`.

## Development

```sh
npm test            # unit tests (mocked API)
npm run type-check
SG24_API_TOKEN=... SG24_CHECK_IDS=... npx tsx scripts/smoke.ts   # live, read-only
```

The smoke test calls only read commands and prints counts and states, not host names.
