# DuckIP Tools

DuckIP 的 CLI、MCP 和可从 GitHub 安装的 Skill。面向客户的主要入口使用 npm 包，GitHub Skill 提供操作说明。

> 当前 README 描述源码能力。新增命令需要发布新版 npm 包后才会出现在客户的 npx 环境中。

## 快速开始

需要 Node.js 22+：

```sh
npx -y @duckip/cli --help
npx -y @duckip/cli auth key
npx -y @duckip/cli usage flow-total --unit GB --json
```

App Key 由终端隐藏提示录入，不要放进命令或聊天。
查个人现金余额需要后台 Token；查团队钱包使用 team wallet，并指定实际团队 ID。

## 文档入口

- [CLI 使用说明](packages/cli/README.md)：认证、命令、资源空间、报价付款和排错。
- [MCP 配置与工具](packages/mcp/README.md)：stdio 配置、参数映射和确认机制。
- [GitHub Skill](skills/duckip-cli/SKILL.md)：客户安装入口，自带 references/commands.md。
- [API 契约与覆盖边界](packages/cli/docs/api-notes.md)：与新版 API、后台业务核对后的能力和未开放操作。
- [AI 接入与三端分发](docs/ai-integration.md)：下载页与分发渠道。
- [发布验收](docs/release.md)：更新 npm/GitHub Skill 前的检查和上线顺序。

新版查询涵盖团队资产/钱包、流量余量、账户/白名单配额、API Key 元数据、自动续费预览/日志与发票查询。
代理提取和外部变更需要 CLI --yes/终端确认，或 MCP confirm=true；npx -y 不替代业务确认。

packages/skill 是与 GitHub 入口同步维护的镜像，安装入口统一指向 skills/duckip-cli，避免误用开发机路径。

## 本地源码检查

在仓库根目录执行，不需要构建：

```sh
node packages/cli/bin/duckip.js --help
node --test packages/cli/test/*.test.js packages/mcp/test/*.test.js
git diff --check
```

测试使用模拟 API/本地 HTTP，不能替代有授权的线上只读验证。D:/project 下禁止执行项目构建命令。
