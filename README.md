# DuckIP Tools

DuckIP 的 CLI、MCP server 和 Codex Skill 集中在一个仓库中。

## 目录

- [`packages/cli`](packages/cli)：命令行工具，支持认证、代理、订单和余额操作。
- [`packages/mcp`](packages/mcp)：通过 stdio 提供 DuckIP MCP 工具。
- [`skills/duckip-cli`](skills/duckip-cli)：可从 GitHub 安装的 DuckIP Skill。

## CLI

```powershell
cd packages/cli
.\duckip.cmd --help
npm test
```

## MCP

```powershell
cd packages/mcp
npm test
npm start
```

CLI 和 MCP 已发布到 npm，Skill 可直接从 GitHub 仓库安装：

```powershell
npx -y @duckip/cli --help
npx -y @duckip/mcp
npx skills add https://github.com/duckip-official/duckip-tools --skill duckip-cli
```
