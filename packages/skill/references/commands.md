# DuckIP CLI routing reference

Use this file when choosing a command. Run `<command> --help` for the complete
field list and current validation rules.

| Need | Command family | Authentication |
| --- | --- | --- |
| Save/check public App Key | `auth key` | App Key entered by hidden prompt |
| Dashboard login/account info | `auth login`, `auth token`, `whoami`, `balance` | Dashboard token |
| Available products and payment IDs | `products list`, `payments list` | App Key |
| Purchased packages and traffic | `packages list`, `packages summary`, `usage daily` | App Key |
| Dynamic or static IPs | `ip extract`, `ip static`, `ip inventory` | App Key |
| Regions | `regions ...` | App Key |
| Proxy accounts | `accounts ...` | App Key |
| IP whitelist | `whitelist ...` | App Key |
| Order preview/create/cancel | `orders check`, `orders create`, `orders close` | App Key |
| Balance payment | `orders pay` | Dashboard token |

`orders create` uses public `pm_id`. Dashboard balance payment uses
`pay_method: 7` internally; these identifiers must not be substituted for each
other. Public responses may use code 200 or code 0 depending on the API family;
the CLI only accepts code 0 for documented newer product/order/payment/activity
commands.

Useful safe probes:

```powershell
.\duckip.cmd auth status
.\duckip.cmd products list --type 9 --json
.\duckip.cmd orders create --params examples\static-order.json --dry-run
```
