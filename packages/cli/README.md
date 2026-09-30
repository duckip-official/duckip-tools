# DuckIP CLI

使用 App Key 查询套餐、流量、代理账户、白名单、团队、订单和发票，也可在确认后提取代理或执行变更。

> 本文描述当前源码。GitHub 提交不会自动更新 npm；新增命令必须随新版 @duckip/cli 发布。先用 --version 和命令 --help 核对运行版本。

## 首次使用

需要 Node.js 22+。Windows PowerShell、macOS、Linux 使用相同入口：

```sh
npx -y @duckip/cli --help
npx -y @duckip/cli auth key
npx -y @duckip/cli auth status
npx -y @duckip/cli usage flow-total --unit GB --json
```

auth key 在终端隐藏输入并校验 App Key，随后保存在用户主目录的 .duckip/config.json。不要将真实 Key 放入命令参数、聊天或仓库。
自动化可由运行环境注入 DUCKIP_APP_KEY；环境变量优先于文件。配置文件包含凭据，应通过操作系统权限保护，它不是加密保险库。
CLI 与同一用户运行的 MCP 可共享此配置。

要获取 npm 当前发布版本，可用 `npx -y @duckip/cli@latest --help`；这仍不会运行本地未发布修改。
开发者在仓库根目录使用 `node packages/cli/bin/duckip.js --help` 运行源码，无需构建。

## 常用命令

下表子命令均加前缀 `npx -y @duckip/cli`。完整参数以每个命令的 --help 为准。

| 客户需求 | 子命令 | 说明 |
| --- | --- | --- |
| 流量总量和余量 | usage flow-total --unit GB | App Key；不是现金余额 |
| 已购套餐/汇总 | packages list / packages summary | App Key |
| 每日流量 | usage daily | App Key；最多约 5 分钟延迟 |
| 个人资料/现金余额 | whoami / balance | 后台 Token；新文档未提供可替代的个人余额公共端点 |
| 团队/详情/资产 | team list / team detail / team assets | 详情、资产需 --team-id |
| 团队钱包/流水 | team wallet / team wallet-records | 需 --team-id 和 VIEW_BILLING 权限 |
| Key 元数据 | keys list | Key 默认脱敏；支持 --page、--page-size |
| 代理账户及数量配额 | accounts list / accounts quota / accounts quotas | 单类型 quota 需 --product-type |
| 白名单及数量配额 | whitelist list / whitelist quota / whitelist quotas | 单类型 quota 需 --product-type |
| 静态 IP/库存/地区 | ip static / ip inventory / regions ... | App Key |
| 商品/支付方式 | products list / payments list / payments groups | 使用查询返回的真实 ID |
| 订单/付款费用预览 | orders list / orders info / orders pay-check | 后两者需 --trade-no |
| 自动续费配置/记录 | renewal preview / renewal logs | preview 需 --user-product-id；只读 |
| 发票抬头/记录/统计/可开票订单 | invoices list / records / statistics / eligible-orders | 只读，不提交开票 |

例如：

```sh
npx -y @duckip/cli accounts quota --product-type 9 --json
npx -y @duckip/cli renewal preview --user-product-id 123 --json
npx -y @duckip/cli invoices statistics --json
npx -y @duckip/cli orders pay --help
```

123 等示例 ID 必须替换为实际查询返回值。

## 个人与团队空间

```sh
npx -y @duckip/cli team list --json
npx -y @duckip/cli team wallet --team-id A12345 --json
npx -y @duckip/cli packages list --team-id A12345 --json
npx -y @duckip/cli usage flow-total --team-id A12345 --unit GB --json
```

A12345 仅为格式示例。真实团队公开 ID 是 6–12 位 ASCII 字母数字，首字符为字母；不能使用数据库数字 ID 或 0。
支持资源空间的接口接受 --team-id；个人 Key 查询个人空间时省略。
团队绑定 Key 的隐式空间遵循接口规则；显式传入时必须与绑定团队一致，不能越权访问其他团队。
只有帮助列出的接口接受该参数；例如新文档没有给 ip static 定义 team_id，不擅自附加。

团队钱包独立于个人余额。流水金额为正，资金方向由 direction 表示。
资源数量配额、流量 GB 与现金余额是不同概念，不要相互替代。

## 订单与支付

先用 products list、payments list 获取真实 pid 和 pm_id。
将非凭据参数保存到 order.json，例如 `{"pid":123,"pm_id":456,"amount":1}`，其中 ID 仅为示例。

```sh
npx -y @duckip/cli orders check --params order.json --json
npx -y @duckip/cli orders create --params order.json --dry-run
npx -y @duckip/cli orders create --params order.json
```

创建时重新检查报价、显示金额并在终端确认。创建成功不表示已付款。
把返回的真实订单号代入 ORDER_NO：

```sh
npx -y @duckip/cli orders info --trade-no ORDER_NO --json
npx -y @duckip/cli orders pay-check --trade-no ORDER_NO --json
npx -y @duckip/cli orders pay --trade-no ORDER_NO
npx -y @duckip/cli orders info --trade-no ORDER_NO --json
```

orders pay 先检查订单号、未付款状态和金额，再调用付款费用预览，确认后才拉起支付。
选择支付方式时加 --pm-id，并在预览和付款中保持一致；团队订单各步骤保持相同 --team-id。
公共 pm_id 与后台 pay_method 不同，不能硬编码“7 就是余额”。
报价不锁价；支付链接或拉起成功不等于到账，以最终订单状态为准。超时后先查订单，不能盲目重试。

## 确认与输出

所有消耗配额或修改服务端资源的命令均需终端确认；已明确授权的自动化使用 --yes。
包括 ip extract、账户和白名单变更、订单创建/关闭/支付。

```sh
npx -y @duckip/cli ip extract --cc US --num 1 --dry-run
npx -y @duckip/cli ip extract --cc US --num 1 --yes
```

npx -y 只确认运行 npm 包，不等于 DuckIP 的 --yes。
--dry-run 不调用 API、不验证权限或余额，只显示脱敏请求；付款会显示三步请求。

| 选项 | 行为 |
| --- | --- |
| --json | 保留 API envelope，包括 code、data、request_id 等实际字段 |
| --params file.json / --params - | 从 JSON 对象文件/标准输入读参数，命令行覆盖同名字段 |
| --show-secrets | 显式显示成功输出中的敏感字段；不要用于共享日志，MCP 无此开关 |
| --config PATH | 覆盖配置文件；MCP 对应 DUCKIP_CONFIG |
| --api-url ORIGIN | 覆盖 API 域名，也可用 DUCKIP_API_URL |
| --timeout 20000 | 请求超时毫秒数，范围 1–300000 |
| --language zh | 响应语言 zh/en |

默认 API 为 https://api.duckip.com；中国站按实际账户环境设置 https://api.duckip.cn。
不自动切换域名或跟随重定向。仅设置可信域名，因为该地址会收到凭据。

## 后台登录与排错

公共接口用 App Key 即可；个人资料和个人现金余额当前需要后台 Token。
auth token 可隐藏录入已有 Token；auth login --email EMAIL 或 auth login --phone PHONE --code 86 可交互登录。
密码来自隐藏提示或 DUCKIP_PASSWORD，不放进参数文件。

auth key 保存新 Key 时会清除文件中的旧 Token；auth login/auth token 校验后台会话并可能从用户资料发现个人 App Key。
auth logout 仅清除本地保存的凭据，不撤销服务端 Key，也不清除环境变量。

| 错误 | 处理 |
| --- | --- |
| Unknown command | 核对 --version、--help；新增命令可能尚未发布 |
| code 3 / 会话过期 | 根据错误中的接口和认证方式排查，用 auth status 查环境变量覆盖 |
| Login token required | 该命令需后台 Token，不能用 App Key 替代 |
| code 348 | 按提示处理 MFA，需要时传 --verify-type、--verify-code |
| code 286 / 287 | 在后台完成对应验证，或提供所需验证码 |
| 团队权限不足 | 核对公开 ID、Key 绑定和角色权限，不自动改查个人空间 |
| HTTP 429 | 停止高频轮询，等待服务端允许；变更先核对结果 |
| 超时 | 不自动重试；订单/付款先查询状态 |

退出码：成功 0；一般参数/网络/业务错误 1；上述认证/验证业务错误 3。
HTTP 200 不等于业务成功，具体成功码按接口处理。
完整差异与未开放操作见 [API 契约说明](docs/api-notes.md)。
