const str = (required = false) => ({ type: 'string', required });
const int = (min = 0, required = false, choices) => ({ type: 'integer', min, required, choices });
const num = (min = 0) => ({ type: 'number', min });
const choice = (...choices) => ({ type: 'string', choices });
const yesNo = () => ({ type: 'boolean' });
const page = { page: int(1), size: int(1), product_type: int(1), trade_no: str() };
const order = {
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
const names = { accounts: str(true) };

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
  'packages list': get('user-product/list', 'List purchased packages.', page),
  'packages summary': get('user-product/summary', 'Summarize purchased traffic packages.', { product_type: int(1, false, [9, 12]) }),
  'usage daily': get('user-usage-flow/total', 'Query daily traffic usage (up to 5 minutes delayed).', {
    start_time: str(), end_time: str(), username: str(), product_type: int(1),
  }),
  'ip extract': get('ip/v3', 'Extract dynamic proxies. Extraction may consume your quota.', {
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
  'accounts list': get('whitelist-account/list', 'List proxy accounts; passwords are masked by default.'),
  'accounts add': post('whitelist-account/add', 'Add comma-separated username:password pairs.', {
    accounts: str(true), product_type: int(1, true, [9, 11, 14, 25]), remark: str(),
  }),
  'accounts delete': post('whitelist-account/delete', 'Permanently delete accounts and their usage history.', names, mutable),
  'accounts enable': post('whitelist-account/enable', 'Enable proxy accounts.', names),
  'accounts disable': post('whitelist-account/disable', 'Disable proxy accounts.', names),
  'accounts password': post('whitelist-account/change-password', 'Change a proxy password (propagation can take 5 minutes).', { account: str(true), password: str(true) }),
  'accounts remark': post('whitelist-account/change-remark', 'Change a proxy account remark.', { account: str(true), remark: str(true) }),
  'accounts limit': post('whitelist-account/change-limit', 'Set traffic limit in GB; 0 means unlimited.', { account: str(true), limit: int(0, true) }),
  'accounts update': post('proxy-account/change', 'Update proxy credentials, limits, status, or UDP.', {
    account: str(true), password: str(), remark: str(), limit: int(), daily_limit: int(),
    status: int(0, false, [0, 1]), udp: int(0, false, [0, 1]),
  }),
  'whitelist list': get('proxy-ip/list', 'List whitelisted IP addresses.', { product_type: int(1) }),
  'whitelist add': post('proxy-ip/add', 'Whitelist IP addresses.', {
    ips: str(true), product_type: int(1, true), user_product_id: int(1), remark: str(),
  }),
  'whitelist delete': post('proxy-ip/delete', 'Remove IP addresses from the whitelist.', {
    ips: str(true), verify_type: choice('phone', 'email', 'wechat', 'totp'), verify_code: str(),
  }, mutable),
  'orders list': get('order/list', 'List orders and payment status.', {
    page_no: int(1), page_size: int(1), trade_no: str(), start_time: str(), end_time: str(),
    status: int(0, false, [0, 1, 2, 3]), product_type: int(1), invoice: int(-1, false, [-1, 0, 1]),
    pay_fee_status: int(1, false, [1, 2]),
  }, { zeroSuccess: true }),
  'orders check': post('order/check', 'Preview price and discounts without creating an order.', order, { zeroSuccess: true }),
  'orders create': post('order/create', 'Check price, confirm, then create an order.', order, { zeroSuccess: true, action: 'create' }),
  'orders close': post('order/close', 'Cancel an unpaid order.', { trade_no: str(true) }, { ...mutable, zeroSuccess: true }),
  'orders info': web('POST', 'order/info', 'Inspect an order using the dashboard API.', { trade_no: str(true) }),
  'orders pay': web('POST', 'pay', 'Pay an existing unpaid order using account balance.', { trade_no: str(true) }, { action: 'pay' }),
  'payments list': get('payment/list', 'List payment IDs used by --pm-id.', { trade_no: str(), currency: str() }, { zeroSuccess: true }),
  'payments groups': get('payment/groups', 'List grouped payment methods.', { trade_no: str() }, { zeroSuccess: true }),
  'activity recharge-gift': get('activity/balance-recharge-gift-ratio', 'Show balance recharge bonus ratios.', {}, { zeroSuccess: true }),
};

export const flagName = (key) => key.replaceAll('_', '-');

export function validateFields(commandName, input) {
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
    if (field.required && value === '' && key !== 'remark') throw new Error(`--${flagName(key)} cannot be empty`);
    if (field.choices && !field.choices.includes(value)) throw new Error(`--${flagName(key)} must be one of: ${field.choices.join(', ')}`);
    result[key] = value;
  }
  if (commandName === 'accounts add' && !/^[a-z\d]+:[a-z\d]+(?:,[a-z\d]+:[a-z\d]+)*$/i.test(result.accounts)) {
    throw new Error('--accounts must be username:password pairs, using letters and digits only');
  }
  if (result.account && !/^[a-z\d]+$/i.test(result.account)) throw new Error('--account must contain letters and digits only');
  if (result.password && commandName.startsWith('accounts ') && !/^[a-z\d]+$/i.test(result.password)) throw new Error('Proxy passwords must contain letters and digits only');
  if (commandName === 'accounts update') {
    if (Object.keys(result).length === 1) throw new Error('Provide at least one field to update');
    if (result.password && !/^[a-z\d]{6,16}$/i.test(result.password)) throw new Error('Proxy password must be 6-16 letters or digits');
  }
  if (['accounts delete', 'accounts enable', 'accounts disable'].includes(commandName) && !/^[a-z\d]+(?:,[a-z\d]+)*$/i.test(result.accounts)) throw new Error('Invalid account list');
  if (commandName === 'whitelist add' && result.product_type === 11 && !result.user_product_id) throw new Error('--user-product-id is required for product type 11');
  return result;
}
