# DuckIP AI 接入与 CLI 发布

本仓库可以提供三种接入方式，和 AdsPower 下载页的三种入口对应：

| 入口 | 用户动作 | 当前实现 | 发布前还需要 |
| --- | --- | --- | --- |
| Skill | `npx skills add ... --skill duckip-cli` | `skills/duckip-cli/SKILL.md`，从 GitHub 安装 | 保持 Skill 文档和 CLI 版本同步 |
| MCP | `npx -y @duckip/mcp` | stdio JSON-RPC、`tools/list`、确认保护 | 已发布到 npm；可继续补充客户端配置 |
| CLI | `npx -y @duckip/cli ...` | 命令、认证、`--json`、`--dry-run` | 已发布到 npm；可继续补充独立二进制 |

## 建议的用户命令

Skill：

```powershell
npx skills add https://github.com/duckip-official/duckip-tools --skill duckip-cli
```

Claude Code：

```powershell
claude mcp add duckip -- npx -y @duckip/mcp
```

Codex：

```powershell
codex mcp add duckip -- npx -y @duckip/mcp
```

需要环境变量时，在对应客户端的 MCP 配置中加入 `DUCKIP_APP_KEY`、`DUCKIP_TOKEN` 和可选的 `DUCKIP_API_URL`。不要把密钥写进复制命令或仓库文件。

## 后续可完善的发布能力

1. CLI 和 MCP 暂时各自携带命令定义、客户端和配置代码，便于独立发布；已增加 contract/client 一致性测试。后续可评估共享核心包，但不能破坏独立安装。
2. CLI 帮助、--version、MCP serverInfo 和 User-Agent 已从各自 package.json 读取版本；发布时仍需分别更新两个包的版本。
3. 目前只有 Node.js 入口，没有 Windows、macOS、Linux 的自包含可执行文件、签名、校验和及更新清单。
4. 需要在干净用户目录持续验证 `npx -y @duckip/cli --help`、MCP 初始化和 Skill 安装。

## 三端 CLI 的推荐方案

把 npm 包作为主分发渠道，把自包含二进制作为下载页的三端下载渠道。使用 Node.js SEA（Single Executable Applications）时，先用 esbuild 将 `packages/cli/bin/duckip.js` 捆绑为一个 CommonJS 文件，再用同版本 Node 生成 SEA；不要在不同 Node 主版本之间混用生成器和目标二进制。

下载页至少应发布以下构建产物：

| 系统 | 产物 |
| --- | --- |
| Windows | `duckip-windows-x64.exe`，需要 ARM 时再加 `duckip-windows-arm64.exe` |
| macOS | `duckip-macos-x64`、`duckip-macos-arm64`；可选用 `lipo` 合并为 universal |
| Linux | `duckip-linux-x64`、`duckip-linux-arm64`（明确 glibc 最低版本） |

建议用 GitHub Actions 的矩阵构建，每个 runner 原生构建本机目标，避免交叉编译造成 SEA 注入和系统库差异。每次 tag 发布时：

1. 从一个版本号生成 CLI、MCP 和 Skill 的版本信息。
2. 运行现有 Node 测试和打包清单检查；本地项目位于 `D:/project` 时不要执行仓库构建命令。
3. 生成 SEA 二进制，运行 `--help` 和 MCP `initialize/tools/list` smoke test。
4. 生成 `SHA256SUMS`、版本 manifest 和 GitHub Release 附件。
5. Windows 使用 Authenticode，macOS 使用 Developer ID 签名与 notarization；Linux 至少提供校验和和签名文件。

如果暂时不需要单文件体验，优先发布 npm 包：它最容易支持三端，用户只需安装 Node.js 22+。自包含二进制适合下载页，但会增加签名、杀毒误报、更新和架构维护成本。

## 发布前验收清单

- `npm pack --dry-run` 的文件列表不包含测试、凭据或本地配置。
- `npx -y @duckip/cli --help` 和 `npx -y @duckip/mcp` 在全新用户目录可运行。
- MCP 客户端能看到只读工具；提取、订单、账户和支付工具仍要求明确确认。
- `DUCKIP_APP_KEY` 与 `DUCKIP_TOKEN` 的来源、优先级和脱敏行为在三种分发方式中一致。
- Windows、macOS、Linux 的归档文件名、架构、最低系统版本和校验和在下载页明确显示。

## 新接口与下载页同步

当前源码新增：流量总量/余量、团队列表/详情/资产/钱包/流水、账户与白名单配额、Key 元数据、自动续费预览/日志、发票查询及付款费用预览。
订单详情与付款使用公共 App Key 接口；个人现金余额仍需要后台 Token。详见 [CLI](../packages/cli/README.md)、[MCP](../packages/mcp/README.md) 和 [契约边界](../packages/cli/docs/api-notes.md)。

下载页应分别列出 CLI、MCP 和 GitHub Skill，并链接对应说明，不应将 Skill 安装命令误写成运行本地 skill 的命令。
GitHub Skill 路径为本仓库 skills/duckip-cli，目录内自带 references/commands.md；不要使用开发机绝对路径。
第三方安装器（包括 Hermes）的具体命令应在对应已安装版本上验证后再对客户标为可用，仓库有文件不等于安装器已验证成功。

新增能力需先按 [发布验收](release.md) 发布 CLI/MCP，再更新 GitHub Skill 和下载页能力说明。
本轮未生成三端独立二进制，也未执行构建、推送或 npm publish。
