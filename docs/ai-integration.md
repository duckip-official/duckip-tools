# DuckIP AI 接入与 CLI 发布

本仓库可以提供三种接入方式，和 AdsPower 下载页的三种入口对应：

| 入口 | 用户动作 | 当前实现 | 发布前还需要 |
| --- | --- | --- | --- |
| Skill | `npx skills add ... --skill duckip-cli` | `packages/skill` 有 Skill 内容 | 发布 `skills/duckip-cli/SKILL.md`，并确保引用的 README 存在 |
| MCP | `npx -y duckip-mcp` | stdio JSON-RPC、`tools/list`、确认保护 | 发布 npm 包，提供各客户端配置片段 |
| CLI | `duckip ...` | 命令、认证、`--json`、`--dry-run` | 提供 npm 入口和三端独立可执行文件 |

## 建议的用户命令

Skill：

```powershell
npx skills add https://github.com/duckip-official/duckip-tools --skill duckip-cli
```

Claude Code：

```powershell
claude mcp add duckip -- npx -y duckip-mcp
```

Codex：

```powershell
codex mcp add duckip -- npx -y duckip-mcp
```

需要环境变量时，在对应客户端的 MCP 配置中加入 `DUCKIP_APP_KEY`、`DUCKIP_TOKEN` 和可选的 `DUCKIP_API_URL`。不要把密钥写进复制命令或仓库文件。

## 当前代码还缺少的发布能力

1. `packages/cli` 和 `packages/mcp` 是私有 npm 包，`npx -y` 无法从 npm 安装。
2. Skill 没有 AdsPower 采用的 `skills/duckip-cli` 目录布局。
3. 两个包都声明了不存在的 `README.md`，发布前 `npm pack --dry-run` 会暴露这个问题。
4. CLI 和 MCP 各自维护一份命令定义、客户端和配置代码，长期会产生工具列表与 CLI 行为漂移。发布前应抽出 `packages/core`，让两者共享 API contract、认证和脱敏逻辑。
5. 版本号在 CLI、MCP、User-Agent 和帮助文本中有硬编码，发布流程应从 package version 读取。
6. 目前只有 Node.js 入口，没有 Windows、macOS、Linux 的自包含可执行文件、签名、校验和及更新清单。
7. 缺少发布 smoke test：应在干净机器上验证 `duckip --help`、`duckip-mcp` 的 MCP 初始化、Skill 安装和凭据目录权限。

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
- `npx -y duckip-cli --help` 和 `npx -y duckip-mcp` 在全新用户目录可运行。
- MCP 客户端能看到只读工具；提取、订单、账户和支付工具仍要求明确确认。
- `DUCKIP_APP_KEY` 与 `DUCKIP_TOKEN` 的来源、优先级和脱敏行为在三种分发方式中一致。
- Windows、macOS、Linux 的归档文件名、架构、最低系统版本和校验和在下载页明确显示。
