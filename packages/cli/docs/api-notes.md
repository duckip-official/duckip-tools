# API Contract Notes

Sources reviewed: the public API Markdown supplied on 2026-09-10 and the local
`D:/project/smart_cn_dash` dashboard code. No server source was available there.

## Authentication

Public endpoints use `app_key`: a query parameter for GET and a JSON body field
for POST. Dashboard requests use `Authorization: Bearer <access_token>`.
Credentials are not sent together. Account details and balance payment need a
dashboard token even when the public App Key is already configured.

Dashboard references:

- `src/api/controller.ts`: POST `/web_v1/user/login`, GET `/web_v1/user/info`.
- `src/pages/login/modules/PhoneLoginForm.vue`: phone, code, password, ted=1.
- `src/pages/login/modules/EmailLoginForm.vue`: email, password, type=1.
- `src/pages/agent-login.vue`: username, password, type=2.
- `src/pages/login.vue`: code 348 requires MFA; success returns access_token.
- `src/components/proxy/dynamic-residential/SubApiExtract.vue`: personal App Key
  is the current user's openid.
- `src/utils/request.ts`: Language header and language parameter, Bearer token,
  hash header; successful dashboard responses use code 200.

The CLI persists a random 32-character hexadecimal device identifier for the
dashboard hash header. The browser derives this field from a browser fingerprint
and first-load time. The server's acceptance of a CLI identifier has not been
verified. The CLI does not simulate a browser fingerprint or bypass challenges;
App Key authentication remains available independently of password login.

## Public Command Mapping

| CLI group | Public API prefix |
| --- | --- |
| products | `/developers/product` |
| packages | `/developers/user-product/` |
| usage | `/developers/user-usage-flow/total` |
| accounts | `/developers/whitelist-account/` and `/developers/proxy-account/change` |
| whitelist | `/developers/proxy-ip/` |
| ip | `/developers/ip/` |
| regions | `/developers/ip/` and `/developers/host-pool/regions` |
| orders list/check/create/close | `/developers/order/` |
| payments | `/developers/payment/` |
| activity | `/developers/activity/` |

Exact HTTP methods, paths and supported fields are defined in
`src/commands.js` and displayed by `<command> --help`.

## Orders and Payment

The public API accepts `pid` and `pm_id`. Dashboard purchase pages use
`pay_method`, `cdk_sn`, and other product-specific fields. These contracts are
kept distinct; the public order schema is used for public purchases.

`src/api/product.ts` and `src/pages/pay.vue` show a separate balance payment:
POST `/web_v1/pay` with `trade_no` and `pay_method: 7`.
`src/pages/order-pending-payment.vue` obtains order details through POST
`/web_v1/order/info`, returning the order directly in `data`. The CLI reads that
order before payment and requires status 0 and a valid `pay_fee`.

Creating an order does not establish that it has been paid. Order status must be
queried, and payment URLs are handled externally. There are no automatic retries
or invented idempotency keys because neither source defines such a contract.

## Documentation Differences

- The public introduction states code 200 is success. Newer product, payment,
  activity and order examples show code 0 instead. Only these newer public
  commands accept both 0 and 200. Other public commands and dashboard endpoints
  require 200. HTTP failures remain failures regardless of a JSON code.
- `renew_duration` is an integer in the create table, but the order-check table
  explicitly defines `1m`, `2m`, `em`. The CLI uses those documented strings and
  sends the same parameters to check and create.
- Unlimited plans list duration SKU ID as required in parameter descriptions.
  The CLI supports it alongside bandwidth/concurrency IDs, while allowing the
  server preflight to validate product-specific combinations.
- The public extraction endpoint `/developers/ip/v3` has fewer documented
  options than the dashboard's `/web_v1/ip/get-ip-v3`. This release implements
  the public endpoint and its documented parameters. No guessed product or
  protocol fields are sent.
- Public samples for static IP output do not fully define the response data.
  The CLI preserves that data instead of assuming a static proxy schema.
- Proxy-account limit inputs use GB. Usage fields are documented as KB; the
  CLI preserves server values and does not guess billing unit conversions.

These differences require authenticated staging or account testing before a
production release. Current tests establish request construction and local
behavior, not live server compatibility or payment completion.
