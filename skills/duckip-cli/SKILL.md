---
name: duckip-cli
description: "Operate DuckIP through its CLI or MCP tools when a user asks about proxy extraction, purchased packages, traffic remaining, proxy accounts, IP whitelists, teams, wallets, orders, payment, invoices, or DuckIP API troubleshooting. 适用于 DuckIP 代理、套餐余量、团队钱包、订单和接入排错。"
---

# DuckIP

Use the published CLI as `npx -y @duckip/cli <command>`, or use the connected DuckIP MCP tools.
This skill is an operating guide, not an API credential or a replacement for the CLI/MCP package.

## Start here

1. Inspect `npx -y @duckip/cli --version` and the relevant command's `--help`, or the connected MCP tool schema.
   The installed package may predate this GitHub skill. If a command is missing, report the version mismatch rather than inventing a command.
2. Use `auth status` / `duckip_auth_status` to inspect credential availability. This checks configuration, not live permissions.
3. Choose the user's intended resource space and meaning of “balance”; use the routing reference below.
4. Read [references/commands.md](references/commands.md) for command routes, required identifiers, example workflows and troubleshooting.

## Credentials and space

- Public commands use an App Key. Have the user run `npx -y @duckip/cli auth key` in a terminal, or use a secret supplied through the execution environment.
- Never ask the user to paste credentials into chat. Do not print config files, expose environment values, or embed secrets in shell commands, source, logs or JSON parameter files.
- DUCKIP_APP_KEY and DUCKIP_TOKEN override saved credentials. Default config is the user's .duckip/config.json; DUCKIP_CONFIG overrides it.
- CLI and MCP can share configuration only when they run under the same user/filesystem. Remote or container clients need their own protected setup.
- Default API origin is https://api.duckip.com. Use another origin only when it is the user's intended account environment; never switch hosts automatically on authentication failure.
- A team ID is a public 6–12 character ASCII alphanumeric ID starting with a letter, obtained from team list, not an internal numeric ID.
- Pass the same team_id through related operations. Only supported commands accept it. A team-bound Key cannot be used to select an unrelated team.
- Never silently fall back to personal space when a team request fails.

## Select the right measurement

- Remaining traffic: `usage flow-total --unit GB` / `duckip_usage_flow_total`.
- Purchased packages: `packages list` and `packages summary`.
- Personal cash balance: `balance` / `duckip_balance`, currently requires a dashboard Token.
- Team cash balance: `team wallet --team-id TEAM_ID` / `duckip_team_wallet`; requires VIEW_BILLING permission.
- Account/whitelist capacity: `accounts quota(s)` / `whitelist quota(s)`, resource counts, not GB or cash.
- If “balance” remains ambiguous after context, clarify cash versus traffic and the intended team before accessing financial data.
- Preserve returned units/currency, timestamps, request_id and pagination. Do not label one page as the full account total.

## Authorization and side effects

Extraction may consume quota. Account/whitelist changes, order creation/cancellation and payment change external state.
Use --dry-run to inspect a request without calling the API; it does not prove availability or permission.
CLI mutations require a terminal confirmation or --yes; MCP mutations require confirm=true.
npx -y only approves package execution, not a DuckIP purchase or extraction.

Proceed within an already authorized exact scope. Otherwise obtain user authorization for the specific target, quantity, cost and action.
Do not add --yes or confirm=true merely to bypass a failed tool call. Do not invent product IDs, payment IDs, package IDs or team IDs.

For purchases, query products and payment methods, run orders check, show the actual quote and obtain authorization before orders create.
For payment, inspect the exact order and orders pay-check; show amount, currency and payment method before orders pay.
These write commands recheck the corresponding state/quote, but a quote is not a price lock.
Keep the authorized amount/method in scope; if they change, review with the user.
A public pm_id is not the dashboard pay_method; never assume ID 7 selects balance.

After payment, query the order. An order number, payment URL or successful payment initiation is not proof of payment.
After timeout, inspect status before any retry. Do not retry financial operations blindly.

## Results and errors

Prefer --json for structured output. MCP already returns structured objects with text.
Keep secrets masked; do not use --show-secrets in chat or shared logs.
Distinguish command/API success, authorized live verification and an actual published release.
For code 3, preserve the endpoint and auth mode; check credential source and intended origin, not just password login.
Stop on permission errors, rate limits, MFA requirements or uncertain financial outcomes and explain the concrete next step.

## Current boundaries

The CLI supports read-only queries for API Key metadata, teams/assets/wallets, automatic renewal and invoices.
It does not yet create/revoke Keys, manage team members/invitations, transfer assets/funds, enable automatic renewal, apply/cancel invoices, or manage credit.
Route those actions to the DuckIP dashboard. Do not construct unsupported HTTP requests to bypass this boundary.
This guide is self-contained after installation; do not assume access to the source repository or a developer's local disk paths.
