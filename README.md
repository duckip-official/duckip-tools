# DuckIP Tools

DuckIP 的 CLI、MCP server 和 Codex Skill 集中在一个仓库中。

## 目录

- [`packages/cli`](packages/cli)：命令行工具，支持认证、代理、订单和余额操作。
- [`packages/mcp`](packages/mcp)：通过 stdio 提供 DuckIP MCP 工具。
- [`packages/skill`](packages/skill)：供 Codex 使用的 DuckIP Skill。

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

每个模块都可以独立发布。GitHub Release 可上传 CLI/MCP 压缩包，Skill 可直接通过仓库路径安装或引用。
