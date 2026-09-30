# DuckIP 发布验收

本次修改不会自动发布 npm、推送 GitHub 或更新网站。先对源码与有授权的服务端验证，再由维护者执行发布。
本项目没有必需的编译步骤；D:/project 下禁止任何构建命令。

## 1. 源码检查

仓库根目录：

```sh
node --test packages/cli/test/*.test.js packages/mcp/test/*.test.js
node packages/cli/bin/duckip.js --help
git diff --check
```

CLI 与 MCP 的接口契约/客户端代码有一致性测试。修改一边时必须同步另一边。
skills/duckip-cli 和 packages/skill 的说明、引用文件也必须同步；GitHub 入口应可独立安装，不依赖仓库外路径。

本版将代理提取、账户新增/变更和白名单新增也统一纳入确认。
更新自动化脚本时，只有已获用户授权的具体操作才添加 --yes；不要为所有请求机械追加。

## 2. 授权只读联调

使用专门测试账户，通过隐藏提示或安全环境变量配置 Key，不将凭据写到聊天、源码或测试夹具。
在仓库中运行源码 CLI（替换下面示例中的实际团队 ID）：

```sh
node packages/cli/bin/duckip.js auth status
node packages/cli/bin/duckip.js usage flow-total --unit GB --json
node packages/cli/bin/duckip.js accounts quotas --json
node packages/cli/bin/duckip.js whitelist quotas --json
node packages/cli/bin/duckip.js team list --json
node packages/cli/bin/duckip.js invoices statistics --json
```

另选实际团队、已购套餐和未付款测试订单，检查 team wallet、renewal preview、orders info、orders pay-check。
记录接口、业务 code、request_id、单位、权限和团队边界，不记录 Key/Token。
特别确认白名单配额成功码、个人/团队 Key 权限、续费参数矛盾与付款费用预览。
生产下单、付款、转账、提取不属于这个只读验收步骤。

MCP 需在实际目标客户端中确认 initialize、tools/list、只读调用、缺少 confirm 时拒绝变更，以及敏感字段脱敏。
模拟测试与只读联调都不能宣称支付到账已验证。

## 3. npm 文件清单与版本

分别进入 packages/cli、packages/mcp，检查包清单（禁用生命周期脚本）：

```sh
npm pack --dry-run --ignore-scripts
```

核对 bin、src、package.json、README，以及 CLI 的 docs 被包含；不能包含用户配置、凭据、附件或测试输出。
此命令只检查打包清单，不构建项目。

由维护者选择并在两个 package.json 中更新尚未发布的新版本号。不能覆盖 npm 已存在的版本。
帮助、CLI --version、MCP initialize.serverInfo.version 与 User-Agent 会读取各包版本，无需手动修改源码版本常量。
再检查目标 registry、npm 账户和 @duckip scope 发布权限。

## 4. 发布与验收

以下发布命令只由有发布权限的维护者在完成审核后执行，本任务不会自动运行：

```sh
npm publish --access public --ignore-scripts
```

必须在 packages/cli 与 packages/mcp 分别发布；按 registry 提示完成所需验证，不把 Token 放在共享命令中。
发布后在干净环境检查：

```sh
npx -y @duckip/cli@latest --version
npx -y @duckip/cli@latest usage flow-total --help
npx -y @duckip/cli@latest orders pay --help
```

刷新 MCP 到新包版本并重启客户端，核对实际工具列表。脚本或生产客户端可固定经过验收的包版本，避免自动升级改变行为。

## 5. GitHub Skill 与网站

审核并提交代码及文档；推送到实际用于分发的 GitHub 分支后，验证 skills/duckip-cli/SKILL.md 及其 references/commands.md 都可获取。
再用目标 AI 客户端/安装器实际测试安装，不把未验证的 Hermes 等命令直接标为可用。
网站同步 npm 版本、CLI/MCP 使用说明和 GitHub Skill 路径；不要宣传未接入的团队转账、自动续费设置、发票申请等功能。

npm 分发要求 Node.js 22+。三端自包含可执行文件、签名和校验和属于独立发行工作，本次未生成。
