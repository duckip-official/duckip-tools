import { isIP } from 'node:net';

const str = (required = false) => ({ type: 'string', required });
const int = (min = 0, required = false, choices) => ({ type: 'integer', min, required, choices });
const num = (min = 0) => ({ type: 'number', min });
const choice = (...choices) => ({ type: 'string', choices });
const yesNo = () => ({ type: 'boolean' });
const space = { team_id: str() };
const page = { page: int(1), size: int(1), product_type: int(1), trade_no: str() };
const order = {
  ...space,
  pid: int(1, true), pm_id: int(0, true), upids: str(), amount: int(1),
  region_list: str(), coupon_sn: str(), use_invitation_registration_discount: yesNo(),
  renew_duration: choice('1m', '2m', 'em'), product_sku_bandwidth_id: int(1),
  product_sku_concurrency_id: int(1), product_sku_duration_id: int(1),
  etd: int(1), recharge_amount: num(0.01),
};
const command = (method, path, description, fields = {}, extra = {}) => ({
  method, path, description, fields, auth: 'app', ...extra,
});
const get = (path, description, fields, extra) => command('GET', `/developers/${path}`, description, fields, extra);
const post = (path, description, fields, extra) => command('POST', `/developers/${path}`, description, fields, extra);
const web = (method, path, description, fields, extra) => command(method, `/web_v1/${path}`, description, fields, { auth: 'token', ...extra });
const mutable = { confirm: true };
const names = { ...space, accounts: str(true) };

export const commands = {
  'auth login': web('POST', 'user/login', 'Sign in by phone, email, or agent username.', {
    phone: str(), code: str(), email: str(), username: str(),
    verify_type: choice('phone', 'email', 'wechat', 'totp'), verify_code: str(),
    remember_me: yesNo(),
  }, { auth: 'none', action: 'login' }),
  'auth key': { description: 'Validate and save DUCKIP_APP_KEY or a hidden prompt.', fields: {}, action: 'key' },
  'auth token': { description: 'Validate and save DUCKIP_TOKEN or a hidden prompt.', fields: {}, action: 'token' },
  'auth status': { description: 'Show credential availability without revealing secrets.', fields: {}, action: 'status' },
  'auth logout': { description: 'Remove saved local credentials; environment variables are unaffected.', fields: {}, action: 'logout' },
  'whoami': web('GET', 'user/info', 'Show account information (requires a login token).'),
  'balance': web('GET', 'user/info', 'Show account balance (requires a login token).', {}, { action: 'balance' }),
  'products list': get('product', 'List products available for purchase.', {
    type: int(1), parent_product_type: int(1, false, [14, 25]), time_days: int(1), show_type: int(),
  }, { zeroSuccess: true }),
  'packages list': get('user-product/list', 'List purchased packages.', { ...space, ...page }),
  'packages summary': get('user-product/summary', 'Summarize purchased traffic packages.', { ...space, product_type: int(1, false, [9, 12]) }),
  'keys list': get('api-keys', 'List API key metadata; key values are masked by default.', { ...space, page: int(1), pageSize: int(1) }, { zeroSuccess: true }),
  'usage daily': get('user-usage-flow/total', 'Query daily traffic usage (up to 5 minutes delayed).', {
    ...space,
    start_time: str(), end_time: str(), username: str(), product_type: int(1),
  }),
  'usage flow-total': get('user-usage-flow/flow-total', 'Show total and remaining package traffic.', { team_id: str(), unit: choice('KB', 'MB', 'GB', 'TB', 'PB') }),
  'team list': get('team/list', 'List teams accessible to the current App Key.', { page: int(1), page_size: int(1) }),
  'team detail': get('team/detail', 'Show team details.', { team_id: str(true) }),
  'team assets': get('team/assets', 'List team assets.', { team_id: str(true), page: int(1), page_size: int(1) }),
  'team wallet': get('team/wallet/detail', 'Show the separate team wallet (VIEW_BILLING permission required).', { team_id: str(true) }),
  'team wallet-records': get('team/wallet/records', 'List team wallet transactions (VIEW_BILLING permission required).', { team_id: str(true), page: int(1), page_size: int(1) }),
  'renewal preview': post('user-product/get-auto-renewal', 'Preview one package auto-renewal configuration.', { team_id: str(), user_product_id: int(1, true) }),
  'renewal logs': post('user-product/auto-renewal-logs', 'List auto-renewal execution records.', { team_id: str(), user_product_id: int(1), page: int(1), size: int(1) }),
  'ip extract': get('ip/v3', 'Extract dynamic proxies. Extraction may consume your quota.', {
    ...space,
    cc: str(), state: str(), city: str(), format: choice('json', 'text'), lb: str(),
    num: int(1), life: int(1), ep: choice('us', 'hk', 'de'),
  }, { action: 'extract' }),
  'ip static': get('ip/get-static-ip', 'List purchased static IPs.', {
    ...page, country_code: str(), product_type: int(1, false, [14, 25]), status: int(1, false, [1, 2, 3, 4]),
  }),
  'ip inventory': get('ip/static-ip-region', 'Inspect static IP inventory.', {
    isp: int(0, false, [0, 1]), asn: int(0, false, [0, 1]), exclusive: int(0, false, [0, 1]),
  }),
  'regions list': get('host-pool/regions', 'List countries supported by host pools.'),
  'regions cities': get('ip/dynamic-citys', 'List dynamic cities.'),
  'regions states': get('ip/dynamic-states', 'List dynamic states.'),
  'regions search-cities': get('ip/dynamic-citys/search', 'Find cities by country and state.', { country_code: str(true), state: str(true) }),
  'regions search-states': get('ip/dynamic-states/search', 'Find states by country.', { country_code: str(true) }),
  'regions account-cities': get('ip/dcl4', 'List cities available to a proxy account.', { username: str(true) }),
  'regions account-states': get('ip/dsl4', 'List states available to a proxy account.', { username: str(true) }),
  'regions account-areas': get('ip/dal4', 'List combined areas available to a proxy account.', { username: str(true) }),
  'accounts list': get('whitelist-account/list', 'List proxy accounts; passwords are masked by default.', space),
  'accounts quota': get('whitelist-account/quota', 'Show proxy-account quota for a product type.', { team_id: str(), product_type: int(1, true) }, { zeroSuccess: true }),
  'accounts quotas': get('whitelist-account/quotas', 'Show proxy-account quotas for all product types.', { team_id: str() }, { zeroSuccess: true }),
  'accounts add': post('whitelist-account/add', 'Add comma-separated username:password pairs.', {
    ...space,
    accounts: str(true), product_type: int(1, true, [9, 11, 14, 25]), remark: str(),
  }),
  'accounts delete': post('whitelist-account/delete', 'Permanently delete accounts and their usage history.', names, mutable),
  'accounts enable': post('whitelist-account/enable', 'Enable proxy accounts.', names),
  'accounts disable': post('whitelist-account/disable', 'Disable proxy accounts.', names),
  'accounts password': post('whitelist-account/change-password', 'Change a proxy password (propagation can take 5 minutes).', { ...space, account: str(true), password: str(true) }),
  'accounts remark': post('whitelist-account/change-remark', 'Change a proxy account remark.', { ...space, account: str(true), remark: str(true) }),
  'accounts limit': post('whitelist-account/change-limit', 'Set traffic limit in GB; 0 means unlimited.', { ...space, account: str(true), limit: int(0, true) }),
  'accounts update': post('proxy-account/change', 'Update proxy credentials, limits, status, or UDP.', {
    ...space,
    account: str(true), password: str(), remark: str(), limit: int(), daily_limit: int(),
    status: int(0, false, [0, 1]), udp: int(0, false, [0, 1]),
  }),
  'whitelist list': get('proxy-ip/list', 'List whitelisted IP addresses.', { ...space, product_type: int(1) }),
  'whitelist quota': get('white-ip/quota', 'Show IP whitelist quota for a product type.', { team_id: str(), product_type: int(1, true) }),
  'whitelist quotas': get('white-ip/quotas', 'Show IP whitelist quotas for all product types.', { team_id: str() }),
  'whitelist add': post('proxy-ip/add', 'Whitelist IP addresses.', {
    ...space,
    ips: str(true), product_type: int(1, true), user_product_id: int(1), remark: str(),
  }),
  'whitelist delete': post('proxy-ip/delete', 'Remove IP addresses from the whitelist.', {
    ...space,
    ips: str(true), verify_type: choice('phone', 'email', 'wechat', 'totp'), verify_code: str(),
  }, mutable),
  'orders list': get('order/list', 'List orders and payment status.', {
    ...space,
    page_no: int(1), page_size: int(1), trade_no: str(), start_time: str(), end_time: str(),
    status: int(0, false, [0, 1, 2, 3]), product_type: int(1), invoice: int(-1, false, [-1, 0, 1]),
    pay_fee_status: int(1, false, [1, 2]),
  }, { zeroSuccess: true }),
  'orders check': post('order/check', 'Preview price and discounts without creating an order.', order, { zeroSuccess: true }),
  'orders create': post('order/create', 'Check price, confirm, then create an order.', order, { zeroSuccess: true, action: 'create' }),
  'orders close': post('order/close', 'Cancel an unpaid order.', { ...space, trade_no: str(true) }, { ...mutable, zeroSuccess: true }),
  'orders info': get('order/info', 'Inspect an order using the public API.', { team_id: str(), trade_no: str(true) }),
  'orders pay-check': post('pay/pay-check', 'Preview payment fees and method for an unpaid order.', { team_id: str(), trade_no: str(true), pm_id: int(0) }, { query: true }),
  'orders pay': post('pay', 'Start payment for an existing unpaid order; verify final status separately.', { team_id: str(), trade_no: str(true), pm_id: int(0) }, { action: 'pay', query: true, zeroSuccess: true }),
  'invoices list': get('user-invoice/list', 'List invoice profiles.', { team_id: str() }),
  'invoices records': get('user-invoice/record-list', 'List invoice records.', { team_id: str(), status: int(0, false, [0, 1, 2, 3, 4]) }),
  'invoices statistics': get('user-invoice/statistics', 'Show invoiceable, invoiced, and processing amounts.', { team_id: str() }),
  'invoices eligible-orders': get('user-invoice/invoiceable-orders', 'List orders eligible for invoicing.', { team_id: str() }),
  'payments list': get('payment/list', 'List payment IDs used by --pm-id.', { trade_no: str(), currency: str() }, { zeroSuccess: true }),
  'payments groups': get('payment/groups', 'List grouped payment methods.', { trade_no: str() }, { zeroSuccess: true }),
  'activity recharge-gift': get('activity/balance-recharge-gift-ratio', 'Show balance recharge bonus ratios.', {}, { zeroSuccess: true }),
};

// HTTP POST can also be read-only (price/renewal previews); classify side effects explicitly.
export const mutatingCommands = new Set([
  'ip extract', 'accounts add', 'accounts delete', 'accounts enable', 'accounts disable',
  'accounts password', 'accounts remark', 'accounts limit', 'accounts update',
  'whitelist add', 'whitelist delete', 'orders create', 'orders close', 'orders pay',
]);
for (const name of mutatingCommands) commands[name].confirm = true;

export const flagName = (key) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replaceAll('_', '-');

export function validateFields(commandName, input, { coerce = true } = {}) {
  const spec = commands[commandName];
  const result = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(spec.fields, key)) throw new Error(`Unknown parameter: ${key}`);
  }
  for (const [key, field] of Object.entries(spec.fields)) {
    let value = input[key];
    if (value === undefined) {
      if (field.required) throw new Error(`Missing --${flagName(key)}`);
      continue;
    }
    if (!coerce) {
      const expected = field.type === 'integer' ? 'number' : field.type;
      if (typeof value !== expected) throw new Error(`--${flagName(key)} must be a JSON ${field.type}`);
    }
    if (field.type === 'integer' || field.type === 'number') {
      if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw new Error(`Invalid --${flagName(key)}`);
      value = Number(value);
      if (!Number.isFinite(value) || value < field.min || (field.type === 'integer' && !Number.isSafeInteger(value))) {
        throw new Error(`--${flagName(key)} must be ${field.type} >= ${field.min}`);
      }
    } else if (field.type === 'boolean') {
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      if (typeof value !== 'boolean') throw new Error(`--${flagName(key)} must be true or false`);
    } else if (typeof value !== 'string') {
      throw new Error(`--${flagName(key)} must be a string`);
    }
    if (field.required && typeof value === 'string' && value.trim() === '' && key !== 'remark') throw new Error(`--${flagName(key)} cannot be empty`);
    if (field.choices && !field.choices.includes(value)) throw new Error(`--${flagName(key)} must be one of: ${field.choices.join(', ')}`);
    result[key] = value;
  }
  if (commandName === 'accounts add' && !/^[a-z\d]+:[a-z\d]+(?:,[a-z\d]+:[a-z\d]+)*$/i.test(result.accounts)) {
    throw new Error('--accounts must be username:password pairs, using letters and digits only');
  }
  if (result.account && !/^[a-z\d]+$/i.test(result.account)) throw new Error('--account must contain letters and digits only');
  if (result.password && commandName.startsWith('accounts ') && !/^[a-z\d]+$/i.test(result.password)) throw new Error('Proxy passwords must contain letters and digits only');
  if (commandName === 'accounts update') {
    if (!Object.keys(result).some((key) => !['account', 'team_id'].includes(key))) throw new Error('Provide at least one field to update');
    if (result.password !== undefined && !/^[a-z\d]{6,16}$/i.test(result.password)) throw new Error('Proxy password must be 6-16 letters or digits');
  }
  if (['accounts delete', 'accounts enable', 'accounts disable'].includes(commandName) && !/^[a-z\d]+(?:,[a-z\d]+)*$/i.test(result.accounts)) throw new Error('Invalid account list');
  if (commandName === 'whitelist add' && result.product_type === 11 && !result.user_product_id) throw new Error('--user-product-id is required for product type 11');
  if (result.team_id && !/^[A-Za-z][A-Za-z0-9]{5,11}$/.test(result.team_id)) throw new Error('--team-id must be a 6-12 character public team ID starting with a letter');
  if (result.ips && result.ips.split(/[,\n]/).some((ip) => !isIP(ip.trim()))) throw new Error('--ips must contain valid IP addresses');
  return result;
}
