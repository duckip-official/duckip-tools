---
name: duckip-cli
description: "Use the DuckIP CLI in this repository to inspect products, proxies, usage, orders, and account settings; apply when a user asks to operate or troubleshoot DuckIP through the CLI."
---

# DuckIP CLI

Use this skill for work performed through `packages/cli`, including
running a command, diagnosing an API response, adding a supported CLI command,
or explaining the DuckIP public API and dashboard flows. Do not route generic
CLI design or unrelated proxy-provider work here.

## Before running a command

- Work from `packages/cli` and use `duckip.cmd` on Windows or
  `node bin/duckip.js` elsewhere.
- Read [README.md](../cli/README.md) for usage and
  [api-notes.md](../cli/docs/api-notes.md) when the request involves authentication,
  orders, payments, or a mismatch between public API and dashboard behavior.
- Keep credentials out of command text, logs, chat, parameter files, and source
  code. Prefer `DUCKIP_APP_KEY`, `DUCKIP_TOKEN`, and `DUCKIP_PASSWORD`, or let
  the CLI collect secrets through its hidden prompt. Do not ask the user to
  paste a secret into the conversation.
- Use `--json` when another command or script needs structured output. Ordinary
  output masks proxy passwords and credential-like fields.

## Authentication model

Public `/developers/*` endpoints authenticate with `app_key`. Dashboard
`/web_v1/*` endpoints authenticate with `Authorization: Bearer <access_token>`.
Do not combine these modes or assume that a dashboard login fixes a rejected
public App Key. `auth key` validates only the App Key; `auth login` obtains a
dashboard token and may discover the user's `openid` for public API use.

When an endpoint reports code 3 or “session expired”, preserve the exact endpoint
and authentication mode in the diagnosis. Check `auth status` for environment
variables overriding the saved file before asking the user to change credentials.

## Side-effect boundary

Treat proxy extraction as quota-consuming, and treat account changes, whitelist
changes, order creation, order cancellation, and payment as external mutations.

- Use `--dry-run` first when preparing an order or unfamiliar request.
- `orders create` must complete a fresh `orders check` preflight and show the
  returned price before confirmation. Do not skip this check or retry blindly.
- `orders pay` must read the exact order, verify it is unpaid and has a valid
  price, then confirm immediately before balance payment.
- Ask for confirmation immediately before destructive or financial actions unless
  the user explicitly authorized that exact action and supplied the scope. The
  CLI's `--yes` is a confirmation mechanism, not a reason to invent scope.
- After timeout or uncertain payment, query order status before retrying. The
  CLI intentionally does not retry orders or payments automatically.

## Verification

Use `node --test` for the repository's tests. Do not run project build commands
under `D:/project`; the repository has an explicit build ban. For changes to the
skill itself, run the bundled validator:

```powershell
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py `
  D:\project\skills\duckip-cli
```

Keep the skill focused. Add a reference or script only when the workflow needs
maintained, reusable detail; do not copy the entire public API document here.
