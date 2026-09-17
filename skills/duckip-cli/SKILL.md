---
name: duckip-cli
description: "Use the DuckIP CLI and MCP tools to inspect products, proxies, usage, orders, and account settings."
---

# DuckIP CLI

Use `duckip` for commands and `duckip-mcp` for MCP clients. On Windows use `duckip.cmd`; elsewhere use `duckip` or `node bin/duckip.js`.

Keep credentials out of command text and chat. Prefer `DUCKIP_APP_KEY`, `DUCKIP_TOKEN`, and `DUCKIP_PASSWORD`. Use `--json` for machine-readable output and `--dry-run` before mutations. Orders, payments, account changes, whitelist changes, and proxy extraction require an explicit confirmation.

Read the repository CLI README and `packages/cli/docs/api-notes.md` when diagnosing authentication or API contract issues.
