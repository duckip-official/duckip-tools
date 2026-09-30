# DuckIP command routing

Commands below use the prefix `npx -y @duckip/cli`.
For a connected MCP, replace spaces and hyphens in the command with underscores and prefix duckip_.
The installed command help/tools schema is authoritative when versions differ.

## Authentication and common options

| Need | CLI command | Notes |
| --- | --- | --- |
| Save App Key | auth key | User runs hidden prompt in terminal |
| Inspect local configuration | auth status | Local only, no secret values |
| Save dashboard Token | auth token | Hidden prompt; needed for personal cash balance |
| Dashboard login | auth login | Phone/email/agent login; password via hidden input or environment |
| Clear saved credentials | auth logout | Does not revoke Keys or clear environment variables |
| Account information / cash | whoami / balance | Dashboard Token required |

--json retains the API envelope. --params file.json (or - for stdin) accepts one JSON object; explicit flags override matching fields.
--dry-run makes no API call. --yes authorizes the specific mutation after the caller has obtained user authorization.
Do not use --show-secrets in shared output.

CLI uses kebab-case flags; MCP uses actual API names: --team-id becomes team_id, --product-type becomes product_type.
Exception worth checking: keys list --page-size becomes pageSize in API/MCP, while team list --page-size becomes page_size.
No arbitrary app_key/token fields are accepted in parameter JSON; credentials come from config/environment.

## Query routing

| Need | Command | Main parameters |
| --- | --- | --- |
| Product catalogue | products list | --type, --parent-product-type |
| Purchased packages | packages list | --team-id, --page, --size, --product-type, --trade-no |
| Traffic package summary | packages summary | --team-id, --product-type 9 or 12 |
| Daily traffic | usage daily | --team-id, --start-time, --end-time, --username, --product-type |
| Total/remaining traffic | usage flow-total | --team-id, --unit KB/MB/GB/TB/PB |
| Available teams | team list | --page, --page-size |
| Team details | team detail | required --team-id |
| Team assets | team assets | required --team-id; --page, --page-size |
| Team wallet | team wallet | required --team-id, VIEW_BILLING permission |
| Team wallet records | team wallet-records | required --team-id; --page, --page-size |
| API Key metadata | keys list | --team-id, --page, --page-size; values masked |
| Proxy accounts | accounts list | --team-id |
| Account count limits | accounts quota / accounts quotas | --team-id; single quota requires --product-type |
| Whitelisted IPs | whitelist list | --team-id, --product-type |
| Whitelist count limits | whitelist quota / whitelist quotas | --team-id; single quota requires --product-type |
| Purchased static IPs | ip static | --country-code, --product-type, --trade-no, --status, --page, --size |
| Static inventory | ip inventory | --isp, --asn, --exclusive |
| Countries/cities/states | regions list / cities / states | See command help |
| Regional search | regions search-cities / search-states | --country-code; city search also --state |
| Account regions | regions account-cities / account-states / account-areas | required --username |
| Orders | orders list | --team-id, --page-no, --page-size, --trade-no, --status |
| One order | orders info | required --trade-no; --team-id |
| Payment fees preview | orders pay-check | required --trade-no; --team-id, --pm-id |
| Payment methods | payments list / payments groups | --trade-no; list also --currency |
| Recharge bonus ratios | activity recharge-gift | No parameters |
| Auto-renewal preview | renewal preview | required --user-product-id; --team-id |
| Auto-renewal records | renewal logs | --team-id, --user-product-id, --page, --size |
| Invoice profiles | invoices list | --team-id |
| Invoice records | invoices records | --team-id, --status |
| Invoice amounts | invoices statistics | --team-id |
| Invoiceable orders | invoices eligible-orders | --team-id |

An omitted optional team_id follows the endpoint and Key's scope rules; it does not always mean personal space for a team-bound Key.
Empty string denotes personal space only where supported. "0" is invalid.
Do not pass --team-id to ip static: the supplied API contract does not define it there.
Wallet balances are independent; positive wallet transaction amounts use direction for debit/credit.
Daily traffic may lag by about five minutes. Retain each endpoint's unit.

## Changes

| Operation | Command | Important inputs |
| --- | --- | --- |
| Extract proxies | ip extract | --cc, --state, --city, --num, --life, --format, --ep, --team-id |
| Add proxy accounts | accounts add | --accounts, --product-type; optional --team-id, --remark |
| Delete/enable/disable accounts | accounts delete / enable / disable | --accounts; optional --team-id |
| Password/remark/limit | accounts password / remark / limit | --account plus corresponding field; --team-id |
| Update account | accounts update | --account and at least one real update field, --team-id |
| Add whitelist entries | whitelist add | --ips, --product-type; product type 11 also --user-product-id |
| Remove whitelist entries | whitelist delete | --ips; optional --team-id and verification fields |
| Price quote | orders check | --pid, --pm-id; other fields by actual product |
| Create order | orders create | Same input as quote; automatically requotes |
| Cancel unpaid order | orders close | --trade-no, optional --team-id |
| Start payment | orders pay | --trade-no; optional --team-id, --pm-id; verifies order and fees |

orders check is read-only. All other operations in this table consume quota or mutate resources and need authorization.
Accounts are comma-separated names; account creation uses username:password pairs containing letters/digits.
Avoid placing proxy passwords into shell history or shared logs. Use a protected parameter file only for proxy-specific data when needed, and never include the API login credential.
Limit/daily-limit uses GB; 0 means unlimited. Account deletion also removes usage history.

## Example read-only sequence

```sh
npx -y @duckip/cli auth status --json
npx -y @duckip/cli usage flow-total --unit GB --json
npx -y @duckip/cli team list --json
npx -y @duckip/cli team wallet --team-id A12345 --json
npx -y @duckip/cli renewal preview --user-product-id 123 --json
npx -y @duckip/cli invoices statistics --json
```

Replace A12345 and 123 with actual user-selected IDs.
Equivalent MCP traffic query: tool duckip_usage_flow_total with {"unit":"GB"}.
Equivalent MCP team wallet query: duckip_team_wallet with {"team_id":"A12345"}.

## Order workflow

Query products list and payments list, then prepare non-secret input with actual IDs.
Run orders check --params order.json --json; show quoted amount/currency.
After authorization run orders create with the same input, then inspect its returned trade_no.
For payment, call orders info and orders pay-check using that exact trade_no and the same team_id.
Show the payment quote and obtain authorization before orders pay. Query orders info again afterward.

Orders create does not imply payment. Payment initiation does not imply completion.
pm_id comes from public payment methods, never from a hardcoded dashboard pay_method.
The source API has a renew_duration discrepancy: create documents integer but check documents 1m/2m/em.
The CLI preserves the latter values; do not promise static renewal compatibility before server validation.

## Failure handling and boundaries

- Unknown command/tool: check installed version and help; GitHub source changes do not update published npm packages.
- Missing App Key: user sets it via auth key or execution secrets; never request it in chat.
- Token required for balance: explain personal cash uses a different endpoint; do not report traffic as cash.
- code 3: keep exact endpoint/auth mode; check environment overriding config and intended API origin.
- code 348 or verification codes 286/287: follow user-driven MFA/dashboard verification.
- Team permission failure: stop; do not switch to another space or credential.
- Rate limit/network failure: no automatic retries; check order status before repeating a write.
- Successful HTTP alone is insufficient; only accepted API business codes count as success.

Key creation/revocation, team membership/invitations, transfers, renewal configuration writes,
invoice submission/cancellation and credit operations are not exposed. Use the dashboard.
