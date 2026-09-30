# DuckIP API 契约与覆盖范围

校对日期：2026-09-29。依据用户提供的新版 API 文档，以及 smart_cn_dash 的 src/api/team.ts、src/api/common.ts、src/api/controller.ts、src/api/product.ts、src/utils/request.ts、src/config/domain.ts。
后台代码是浏览器客户端，不能替代服务端实现或证明线上行为。

## 域名与认证

- 默认采用新文档 https://api.duckip.com，通过 DUCKIP_API_URL / CLI --api-url 显式选择账户环境。不自动切换 com/cn 或跟随重定向。
- /developers/* 使用 app_key：GET 放 query，通常 POST 放 JSON body。
- 例外：POST /developers/pay 与 /developers/pay/pay-check 的 app_key、team_id、trade_no、pm_id 放 query，不发 JSON body。
- whoami/balance 仍走 GET /web_v1/user/info 和 Bearer Token；新文档没有提供可替换的个人现金余额公共端点。
- 不可根据路径断言所有 /web_v1/* 都只支持 Token。新文档还列出 App Key 可用的 /web_v1/credit/*，本版未接入信用业务。
- 每个请求只使用声明的凭据模式。环境变量优先于文件；失败不自动切换认证或资源空间。

后台 /web_v1/team/*、套餐与自动续费页面用于核对业务含义，对外实现使用文档的 /developers/* 路径。
后台登录的 Language、hash、Bearer 约定保留；CLI 的 hash 使用保存的随机设备标识，服务端接受情况仍需授权联调。App Key 不依赖后台登录。

## 资源空间

team_id 是公开标识：6–12 位 ASCII 字母数字，以字母开头，禁止数字 0 和字符串 "0"。
支持个人空间的接口可省略或传空字符串；团队 Key 的隐式空间按接口绑定规则处理。
团队详情/资产/钱包必须提供 ID；显式 ID 不得与 Key 绑定团队冲突。
仅向参数表已声明的接口发送 team_id，例如静态 IP 旧接口不增加此参数。

团队钱包独立于个人余额，需 VIEW_BILLING 权限。流水金额为正，方向看 direction。
flow-total 的总量/余量是流量；账户和白名单 quota 是资源数量，都不是现金。

## 已接入的公共接口

精确方法、路径、字段见两个包的 src/commands.js；测试检查 CLI/MCP contract 和 HTTP client 保持同步。

| 命令组 | 路径/能力 |
| --- | --- |
| products / payments / activity | 商品、支付方式、充值赠送比例 |
| packages | user-product/list、summary |
| usage | user-usage-flow/total、flow-total |
| team | list、detail、assets、wallet/detail、wallet/records |
| keys list | api-keys，API pageSize 对应 CLI --page-size |
| accounts | whitelist-account 列表/变更/quota/quotas，proxy-account/change |
| whitelist | proxy-ip 列表/增删、white-ip/quota/quotas |
| ip / regions | 公共提取、静态 IP、库存、地区 |
| renewal | user-product/get-auto-renewal、auto-renewal-logs，只读 POST |
| invoices | user-invoice/list、record-list、statistics、invoiceable-orders |
| orders | order/list/check/create/close/info、pay/pay-check、pay |

## 订单与付款

公共 pid/pm_id 与后台 pay_method 不可互换。
创建订单先检查有效报价；付款先核对订单号、status=0、金额，再检查 pay/pay-check 返回的真实报价。
指定 pm_id 时核对预览返回的方法。CLI 展示报价并确认，MCP 要求 AI 先通过只读工具向用户展示并获得授权。
预览不锁价；本地检查不能提供服务端未定义的幂等或价格锁保证。

/developers/pay 是拉起支付，不能声称一定直接扣余额。
返回订单号/支付链接不等于到账，最终查订单状态。网络异常不自动重试付款。

## 状态码与未明确的契约

- HTTP 200 不等于业务成功。按 command.zeroSuccess 显式允许部分接口 code 0，否则要求 code 200。
- code 0 兼容覆盖既有商品/订单/支付/活动、新版 API Key 列表与代理账户配额。白名单配额缺少响应示例，暂按 200，需授权联调确认。
- order/create 的 renew_duration 写 integer，order/check 明确写 1m/2m/em。保留既有字符串并对相同参数报价和创建，不杜撰整数映射；生产续费需确认服务端约定。
- create 的 region_list 示例为地区代码、数量、可选 ASN；check 描述用了地区 ID。工具保留字符串原样，不自行重写。
- 套餐 11 的带宽/并发/时长 SKU 使用实际商品结果，由报价验证组合，不编造 ID。
- 公共提取选项少于后台提取页，不附加未定义的 product/protocol 参数。
- 部分静态 IP 响应结构不全，保留原始结果，不假设代理 schema。
- flow-total 支持 KB/MB/GB/TB/PB；其他流量保留接口单位；账户限额单位 GB，0 为不限额。
- 本地测试证明请求构造与错误处理，不代表服务端已部署、角色可用或支付到账。

## 尚未开放的操作

本版增加常用查询并保留既有代理/订单变更，不将全部文档端点自动暴露给 AI。以下操作仍需后台完成：

- API Key 创建/启停/删除/改备注；完整 Key 仅创建时返回，需要独立安全交付设计。
- 团队创建/解散、成员/邀请管理、资产迁移、个人与团队钱包转账。
- 自动续费开关、批量设置、默认续费规则修改。
- 发票抬头创建/删除、开票申请/取消、补开发票。
- 信用额度业务、CSV 报表下载和命令帮助未列出的其他端点。

后续逐项核对权限、字段、空间、金额、确认和测试；不要提供通用原始 HTTP 工具绕过这些边界。

## 验证与发布

源码、npm、GitHub Skill 是独立发布面，新增能力需分别同步。
本轮测试不使用客户真实凭据，不调用生产写接口，不自动发布 npm 或推送 GitHub。
D:/project 下禁止构建，使用 node --test、语法检查、git diff --check 和文件清单检查。
