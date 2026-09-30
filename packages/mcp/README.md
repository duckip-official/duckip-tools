# DuckIP MCP Server

通过 stdio 为 AI 客户端提供 DuckIP 工具，需要 Node.js 22+。
公共接口用 App Key；CLI 与同一系统用户下的 MCP 可共享配置。

> 本文描述源码能力。新增工具必须随新版 @duckip/mcp 发布，重启 MCP 客户端后才会出现；GitHub 提交不会自动更新 npm。

## 配置

先在实际运行 MCP 的用户环境中设置凭据：

```sh
npx -y @duckip/cli auth key
npx -y @duckip/cli auth status
```

支持 mcpServers JSON 的客户端可添加以下配置；其他客户端将 command/args/env 填入对应字段：

```json
{
  "mcpServers": {
    "duckip": {
      "command": "npx",
      "args": ["-y", "@duckip/mcp"]
    }
  }
}
```

Windows 客户端若不能直接启动 npx，可使用：

```json
{
  "mcpServers": {
    "duckip": {
      "command": "cmd",
      "args": ["/d", "/s", "/c", "npx -y @duckip/mcp"]
    }
  }
}
```

重启服务并刷新工具列表。MCP 是客户端启动的 stdio 进程，手动运行后等待输入是正常行为，不会显示交互菜单。
标准输入/输出用于逐行 JSON-RPC，不是普通聊天窗口。

若客户端运行在容器、远程主机或另一用户下，本机凭据不会自动同步。
通过实际运行环境的秘密管理机制注入 DUCKIP_APP_KEY，或指定受保护的 DUCKIP_CONFIG。
不要把真实凭据放进共享配置或仓库。

| 环境变量 | 用途 |
| --- | --- |
| DUCKIP_APP_KEY | 公共接口凭据，优先于配置文件 |
| DUCKIP_TOKEN | 后台 Token，仅个人资料/个人余额等后台命令需要 |
| DUCKIP_CONFIG | 默认用户主目录 .duckip/config.json |
| DUCKIP_API_URL | 默认 https://api.duckip.com；按账户环境选择域名 |
| DUCKIP_TIMEOUT | 毫秒数，默认 20000 |
| DUCKIP_LANGUAGE | 响应语言，默认 zh |

## 工具映射

工具名为 CLI 子命令加 duckip_ 前缀，空格和连字符换成下划线。
参数采用 API 字段名，如 team_id、product_type。以客户端实际 tools/list 的 schema 为准。

| 需求 | 工具 | 参数示例 |
| --- | --- | --- |
| 检查本地配置 | duckip_auth_status | {} |
| 剩余流量 | duckip_usage_flow_total | {"unit":"GB"} |
| 套餐/汇总 | duckip_packages_list / duckip_packages_summary | {} |
| 每日流量 | duckip_usage_daily | {"product_type":9} |
| 团队/详情/资产 | duckip_team_list / duckip_team_detail / duckip_team_assets | 后两者需 team_id |
| 团队钱包/流水 | duckip_team_wallet / duckip_team_wallet_records | {"team_id":"A12345"} |
| 代理账户配额 | duckip_accounts_quota / duckip_accounts_quotas | 单类型需 product_type |
| 白名单配额 | duckip_whitelist_quota / duckip_whitelist_quotas | 单类型需 product_type |
| 自动续费配置/记录 | duckip_renewal_preview / duckip_renewal_logs | 预览需 user_product_id |
| 发票统计/记录 | duckip_invoices_statistics / duckip_invoices_records | {} |
| Key 元数据 | duckip_keys_list | {"pageSize":10}；Key 脱敏 |
| 订单/付款费用 | duckip_orders_info / duckip_orders_pay_check | {"trade_no":"ORDER_NO"} |
| 个人现金余额 | duckip_balance | {}；需后台 Token |

ID/订单号示例必须替换为真实查询结果。查团队应明确目标，并遵循 Key 的绑定空间规则。
不能把流量 GB、账户数量配额与现金余额混为一谈。

可向 AI 提出：“查剩余 GB 流量”“列出团队，再查指定团队钱包”“只查自动续费配置，不修改”“查订单付款状态”。

## 确认与付款

只读工具无需 confirm，包括以 POST 实现的报价和自动续费预览。
代理提取、账户/白名单变更、订单创建/关闭/支付必须传 confirm: true。
这表示用户已授权具体操作、目标与范围，模型不能为绕过错误随意补上；它不是服务端权限或价格锁。

本 MCP 不公开交互式登录工具。凭据先在终端/环境中设置，不经模型会话接收密码。

付款时先通过 duckip_orders_check 或 duckip_orders_pay_check 展示实际报价、币种和方式，并取得授权。
orders create 会重新检查价格；orders pay 会重新检查订单未付款状态和付款预览，再提交。
预览不锁价，若授权金额/方式发生变化应重新确认。所有团队步骤保持同一 team_id。
创建、返回支付链接或拉起成功都不表示已付款；超时先查订单，不重复提交。服务没有自动重试或自造幂等键。

## 输出与排错

对象结果以文本 JSON 与 structuredContent 返回；业务错误包含 isError: true 和脱敏错误内容。
默认隐藏密码、App Key、API Key、Token 等字段。MCP 不提供 show-secrets。

- 工具列表缺少新增命令：核对已发布版本，更新并重启 MCP 服务。
- 找不到 npx：确认客户端能找到 Node.js/npm；Windows 可用上述 cmd 配置。
- 缺凭据：核对实际用户/容器内的环境变量、DUCKIP_CONFIG 和 auth status。
- code 3：按返回的接口和认证方式排查，不把所有错误解释为密码会话过期。
- 团队钱包被拒：核对团队 ID、Key 绑定与 VIEW_BILLING 权限。
- 付款失败或超时：先在同一空间查订单，再决定下一步。

## 源码检查

在仓库根目录运行：

```sh
node --test packages/cli/test/*.test.js packages/mcp/test/*.test.js
node packages/mcp/bin/duckip-mcp.js
```

测试使用模拟响应/本地 HTTP，不证明生产权限、支付到账或 npm 已更新。
能力边界见仓库 packages/cli/docs/api-notes.md。
