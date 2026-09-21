# DuckIP MCP Server

通过 stdio 提供 DuckIP 工具：

```powershell
npx -y @duckip/mcp
```

Claude Code：`claude mcp add duckip -- npx -y @duckip/mcp`

Codex：`codex mcp add duckip -- npx -y @duckip/mcp`

凭据从 `DUCKIP_APP_KEY`、`DUCKIP_TOKEN` 或 CLI 配置文件读取。会消耗配额或产生外部变更的工具要求 `confirm: true`。
