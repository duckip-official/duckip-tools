import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { run, parseCommand } from '../src/cli.js';
import { commands, validateFields } from '../src/commands.js';
import { commands as mcpCommands } from '../../mcp/src/commands.js';
import { version } from '../src/metadata.js';
import { createClient, maskSecrets } from '../src/client.js';
import { readConfig, saveConfig } from '../src/config.js';

function json(data = {}, code = 200) {
  return new Response(JSON.stringify({ code, message: 'ok', data }), { headers: { 'content-type': 'application/json' } });
}

async function harness(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'duckip-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'config.json');
  const requests = [];
  const env = { DUCKIP_CONFIG: config, DUCKIP_APP_KEY: 'test-app-key', DUCKIP_TOKEN: 'test-token', ...overrides.env };
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), ...init, json: init.body ? JSON.parse(init.body) : undefined });
    return overrides.handler ? overrides.handler(requests.at(-1), requests.length) : json({ list: [] });
  };
  return {
    config, requests, env,
    async invoke(argv, extra = {}) {
      let stdout = '';
      let stderr = '';
      const code = await run(argv, {
        env, fetchImpl,
        io: { stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } }, stdin: Readable.from([]) },
        ...extra,
      });
      return { code, stdout, stderr };
    },
  };
}

test('help is available for every command without network or config', async (t) => {
  const h = await harness(t);
  for (const command of Object.keys(commands)) {
    const result = await h.invoke([...command.split(' '), '--help']);
    assert.equal(result.code, 0, command);
    assert.match(result.stdout, /Usage: duckip/);
  }
  assert.equal(h.requests.length, 0);
});

test('CLI and MCP API contracts and HTTP clients stay synchronized', async () => {
  assert.deepEqual(commands, mcpCommands);
  const cli = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const mcp = await readFile(new URL('../../mcp/src/client.js', import.meta.url), 'utf8');
  assert.equal(cli.replaceAll('\r\n', '\n'), mcp.replaceAll('\r\n', '\n'));
});

test('CLI help and version read package metadata', async (t) => {
  const h = await harness(t);
  assert.equal((await h.invoke(['--version'])).stdout, `${version}\n`);
  assert.ok((await h.invoke(['--help'])).stdout.startsWith(`DuckIP CLI ${version}\n`));
});

test('new package, quota, renewal, and invoice commands follow the reference contract', async (t) => {
  const cases = [
    ['team list', { page: 2, page_size: 5 }, 'GET', '/developers/team/list', 200],
    ['team detail', { team_id: 'A12345' }, 'GET', '/developers/team/detail', 200],
    ['team assets', { team_id: 'A12345' }, 'GET', '/developers/team/assets', 200],
    ['team wallet-records', { team_id: 'A12345' }, 'GET', '/developers/team/wallet/records', 200],
    ['accounts quotas', { team_id: 'A12345' }, 'GET', '/developers/whitelist-account/quotas', 0],
    ['whitelist quota', { product_type: 9 }, 'GET', '/developers/white-ip/quota', 200],
    ['renewal preview', { team_id: 'A12345', user_product_id: 12 }, 'POST', '/developers/user-product/get-auto-renewal', 200],
    ['renewal logs', { page: 2, size: 5 }, 'POST', '/developers/user-product/auto-renewal-logs', 200],
    ['invoices list', {}, 'GET', '/developers/user-invoice/list', 200],
    ['invoices records', { status: 2 }, 'GET', '/developers/user-invoice/record-list', 200],
    ['invoices eligible-orders', {}, 'GET', '/developers/user-invoice/invoiceable-orders', 200],
  ];
  for (const [name, input, method, path, code] of cases) {
    const h = await harness(t, { handler: () => json({ list: [] }, code) });
    const args = Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll('_', '-')}`, String(value)]);
    const result = await h.invoke([...name.split(' '), ...args]);
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    const request = h.requests[0];
    assert.equal(request.url.origin, 'https://api.duckip.com');
    assert.equal(request.url.pathname, path);
    assert.equal(request.method, method);
    assert.equal(request.headers.Authorization, undefined);
    for (const [key, value] of Object.entries(input)) {
      assert.equal(method === 'GET' ? request.url.searchParams.get(key) : request.json[key], method === 'GET' ? String(value) : value);
    }
  }
});

test('resource-space validation rejects numeric IDs and preserves personal empty scope', () => {
  for (const team_id of ['0', 0, '123456', 'abc', 'A123456789012', 'A1234!', ' A12345', null]) {
    assert.throws(() => validateFields('usage flow-total', { team_id }));
  }
  assert.equal(validateFields('usage flow-total', { team_id: '' }).team_id, '');
  assert.throws(() => validateFields('team wallet', { team_id: '' }), /empty/);
  assert.throws(() => validateFields('accounts update', { team_id: 'A12345', account: 'user' }), /at least/);
});

test('key metadata supports page-size and redacts api_key fields', async (t) => {
  const h = await harness(t, { handler: () => json({ list: [{ id: 1, api_key: 'sensitive-key-value' }] }, 0) });
  const result = await h.invoke(['keys', 'list', '--page-size', '10', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(h.requests[0].url.pathname, '/developers/api-keys');
  assert.equal(h.requests[0].url.searchParams.get('pageSize'), '10');
  assert.equal(h.requests[0].url.searchParams.has('page_size'), false);
  assert.doesNotMatch(result.stdout, /sensitive-key-value/);
});

test('all externally mutating CLI operations require confirmation before their write', async (t) => {
  for (const args of [
    ['ip', 'extract', '--num', '1'],
    ['accounts', 'add', '--accounts', 'demo:Pass123', '--product-type', '9'],
    ['accounts', 'enable', '--accounts', 'demo'],
    ['accounts', 'limit', '--account', 'demo', '--limit', '1'],
    ['whitelist', 'add', '--ips', '192.0.2.1', '--product-type', '9'],
  ]) {
    const h = await harness(t);
    const result = await h.invoke(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--yes/);
    assert.equal(h.requests.length, 0);
  }
});

test('payment preview failure or changed method never submits payment', async (t) => {
  for (const quote of [
    { trade_no: 'other', pay_fee: 1, pm_id: 3 },
    { trade_no: 'T-2', pay_fee: null, pm_id: 3 },
    { trade_no: 'T-2', pay_fee: 1, pm_id: 4 },
  ]) {
    const h = await harness(t, { handler: (_r, count) => json(count === 1 ? { trade_no: 'T-2', status: 0, pay_fee: 1 } : quote) });
    const result = await h.invoke(['orders', 'pay', '--trade-no', 'T-2', '--pm-id', '3', '--yes']);
    assert.equal(result.code, 1);
    assert.equal(h.requests.length, 2);
  }
});

test('strict parsing rejects unknown commands, inappropriate and duplicate flags', () => {
  assert.throws(() => parseCommand(['orders', 'typo']), /Unknown command/);
  assert.throws(() => parseCommand(['products', 'list', '--pid', '1']), /Unknown option/);
  assert.throws(() => parseCommand(['orders', 'create', '--pid', '1', '--pid', '2']), /Duplicate/);
  assert.throws(() => validateFields('orders create', { pid: true, pm_id: 1 }), /Invalid/);
  assert.throws(() => validateFields('orders create', { pid: 1, pm_id: 1, amount: 0 }), /must be/);
  assert.throws(() => validateFields('accounts update', { account: 'user' }), /at least/);
  assert.throws(() => validateFields('whitelist add', { ips: '1.1.1.1', product_type: 11 }), /user-product-id/);
  assert.equal(validateFields('orders check', { pid: 1, pm_id: 0, renew_duration: '1m' }).renew_duration, '1m');
});

test('public requests use app_key and never include the dashboard token', async (t) => {
  const h = await harness(t);
  assert.equal((await h.invoke(['packages', 'list', '--page', '2', '--json'])).code, 0);
  const request = h.requests[0];
  assert.equal(request.url.pathname, '/developers/user-product/list');
  assert.equal(request.url.searchParams.get('app_key'), 'test-app-key');
  assert.equal(request.url.searchParams.get('page'), '2');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.redirect, 'error');
});

test('dry-run never calls network and masks secrets even with show-secrets', async (t) => {
  const h = await harness(t);
  const result = await h.invoke(['accounts', 'add', '--accounts', 'user:Secret123', '--product-type', '9', '--dry-run', '--show-secrets']);
  assert.equal(result.code, 0);
  assert.equal(h.requests.length, 0);
  assert.doesNotMatch(result.stdout, /test-app-key|test-token|Secret123/);
});

test('auth status shows configuration state without hiding boolean fields', async (t) => {
  const h = await harness(t);
  const result = await h.invoke(['auth', 'status', '--json']);
  assert.equal(JSON.parse(result.stdout).public_api.configured, true);
  assert.equal(JSON.parse(result.stdout).dashboard.source, 'environment');
  assert.doesNotMatch(result.stdout, /test-app-key|test-token/);
});

test('purchase checks first and stops if confirmation is declined', async (t) => {
  const h = await harness(t, { handler: () => json({ pay_fee: 12, title: 'Traffic' }, 0) });
  const result = await h.invoke(['orders', 'create', '--pid', '1', '--pm-id', '0'], { prompt: async () => 'no' });
  assert.equal(result.code, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.pathname, '/developers/order/check');
  assert.match(result.stderr, /12/);
});

test('confirmed purchase sends identical parameters after successful preflight', async (t) => {
  const h = await harness(t, { handler: (_request, count) => json(count === 1 ? { pay_fee: 12 } : { trade_no: 'order1' }, 0) });
  const result = await h.invoke(['orders', 'create', '--pid', '1', '--pm-id', '0', '--yes', '--json']);
  assert.equal(result.code, 0);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0].json, h.requests[1].json);
  assert.equal(JSON.parse(result.stdout).data.trade_no, 'order1');
  assert.match(result.stderr, /preview/);
});

test('failed preflight never creates an order', async (t) => {
  const h = await harness(t, { handler: () => json({}, 156) });
  assert.equal((await h.invoke(['orders', 'create', '--pid', '1', '--pm-id', '1', '--yes'])).code, 1);
  assert.equal(h.requests.length, 1);
});

test('preflight without a valid price never creates an order', async (t) => {
  for (const pay_fee of [undefined, null, '', ' ', false, -1, 'NaN']) {
    const h = await harness(t, { handler: () => json({ pay_fee }, 0) });
    assert.equal((await h.invoke(['orders', 'create', '--pid', '1', '--pm-id', '1', '--yes'])).code, 1);
    assert.equal(h.requests.length, 1);
  }
});

test('public payment checks exact order and uses the App Key contract', async (t) => {
  const h = await harness(t, { handler: () => json({ trade_no: 'order1', pay_fee: '18.20', status: 0 }) });
  assert.equal((await h.invoke(['orders', 'pay', '--trade-no', 'order1', '--yes'])).code, 0);
  assert.equal(h.requests[0].url.pathname, '/developers/order/info');
  assert.equal(h.requests[1].url.pathname, '/developers/pay/pay-check');
  assert.equal(h.requests[2].url.pathname, '/developers/pay');
  assert.equal(h.requests[2].url.searchParams.get('app_key'), 'test-app-key');
  assert.equal(h.requests[2].url.searchParams.get('trade_no'), 'order1');
  assert.equal(h.requests[2].json, undefined);
  assert.equal(h.requests[2].headers.Authorization, undefined);
  assert.equal(h.requests[0].url.searchParams.has('team_id'), false);
  assert.doesNotMatch((await h.invoke(['orders', 'pay', '--trade-no', 'order1', '--dry-run'])).stdout, /pay_method|undefined/);
});

test('new public read-only commands use documented paths and resource-space parameters', async (t) => {
  const h = await harness(t, { handler: () => json({ list: [] }) });
  for (const [args, pathname] of [
    [['usage', 'flow-total', '--unit', 'GB'], '/developers/user-usage-flow/flow-total'],
    [['team', 'wallet', '--team-id', 'A12345'], '/developers/team/wallet/detail'],
    [['accounts', 'quota', '--product-type', '9'], '/developers/whitelist-account/quota'],
    [['whitelist', 'quotas'], '/developers/white-ip/quotas'],
    [['invoices', 'statistics'], '/developers/user-invoice/statistics'],
  ]) {
    assert.equal((await h.invoke(args)).code, 0);
    assert.equal(h.requests.at(-1).url.pathname, pathname);
    assert.equal(h.requests.at(-1).url.searchParams.get('app_key'), 'test-app-key');
  }
  assert.equal(h.requests[1].url.searchParams.get('team_id'), 'A12345');
  assert.throws(() => validateFields('team wallet', { team_id: '0' }), /team-id/);
});

test('payment check sends POST query parameters without a JSON body', async (t) => {
  const h = await harness(t);
  assert.equal((await h.invoke(['orders', 'pay-check', '--trade-no', 'T-2', '--pm-id', '3'])).code, 0);
  assert.equal(h.requests[0].method, 'POST');
  assert.equal(h.requests[0].url.pathname, '/developers/pay/pay-check');
  assert.equal(h.requests[0].url.searchParams.get('pm_id'), '3');
  assert.equal(h.requests[0].json, undefined);
});

test('payment refuses already paid orders, mismatched IDs and missing prices', async (t) => {
  for (const data of [
    { trade_no: 'order1', status: 1, pay_fee: 1 },
    { trade_no: 'different', status: 0, pay_fee: 1 },
    { trade_no: 'order1', status: 0 },
    { trade_no: 'order1', status: null, pay_fee: 1 },
    { trade_no: 'order1', status: 0, pay_fee: false },
  ]) {
    const h = await harness(t, { handler: () => json(data) });
    assert.equal((await h.invoke(['orders', 'pay', '--trade-no', 'order1', '--yes'])).code, 1);
    assert.equal(h.requests.length, 1);
  }
});

test('noninteractive mutation requires --yes', async (t) => {
  const h = await harness(t);
  const result = await h.invoke(['accounts', 'delete', '--accounts', 'testuser']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--yes/);
  assert.equal(h.requests.length, 0);
});

test('phone login saves returned token and openid, never password or old credentials', async (t) => {
  const h = await harness(t, {
    env: { DUCKIP_PASSWORD: 'privatePassword' },
    handler: () => json({ access_token: 'new-token', openid: 'new-key' }),
  });
  await saveConfig(h.config, { token: 'old-token', appKey: 'old-key' });
  const result = await h.invoke(['auth', 'login', '--phone', '13000000000']);
  assert.equal(result.code, 0);
  assert.equal(h.requests[0].json.code, '86');
  assert.equal(h.requests[0].json.ted, 1);
  assert.equal(h.requests[0].json.password, 'privatePassword');
  assert.equal(h.requests[0].headers.Authorization, undefined);
  assert.match(h.requests[0].headers.hash, /^[a-f0-9]{32}$/);
  const saved = await readConfig(h.config);
  assert.equal(saved.token, 'new-token');
  assert.equal(saved.appKey, 'new-key');
  assert.doesNotMatch(await readFile(h.config, 'utf8'), /privatePassword|old-token|old-key/);
  assert.doesNotMatch(result.stdout, /new-token|new-key|privatePassword/);
});

test('failed MFA leaves config intact and returns authentication exit code', async (t) => {
  const h = await harness(t, { env: { DUCKIP_PASSWORD: 'privatePassword' }, handler: () => json({ methods: ['totp'] }, 348) });
  await saveConfig(h.config, { token: 'original' });
  const result = await h.invoke(['auth', 'login', '--email', 'user@example.test']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /--verify-type/);
  assert.deepEqual(await readConfig(h.config), { token: 'original' });
});

test('token login fetches user info and discovers app key', async (t) => {
  const h = await harness(t, { handler: () => json({ openid: 'discovered-key' }) });
  assert.equal((await h.invoke(['auth', 'token'])).code, 0);
  assert.equal(h.requests[0].url.pathname, '/web_v1/user/info');
  assert.equal((await readConfig(h.config)).appKey, 'discovered-key');
});

test('auth key validates the candidate and replaces stale dashboard credentials', async (t) => {
  const h = await harness(t);
  await saveConfig(h.config, { appKey: 'old-key', token: 'old-token' });
  assert.equal((await h.invoke(['auth', 'key'])).code, 0);
  assert.equal(h.requests[0].url.searchParams.get('app_key'), 'test-app-key');
  assert.equal((await readConfig(h.config)).token, undefined);
});

test('rejected App Key explains auth mode and preserves previous credentials', async (t) => {
  const h = await harness(t, {
    handler: () => new Response(JSON.stringify({ code: 3, msg: 'Your session has expired, please log in again' })),
  });
  await saveConfig(h.config, { appKey: 'previous-key', token: 'previous-token' });
  const result = await h.invoke(['auth', 'key', '--json']);
  assert.equal(result.code, 3);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 3);
  assert.match(error.message, /App Key authentication was rejected/);
  assert.match(error.message, /\/developers\/user-product\/list/);
  assert.doesNotMatch(error.message, /test-app-key|previous-key|previous-token/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].headers.Authorization, undefined);
  assert.deepEqual(await readConfig(h.config), { appKey: 'previous-key', token: 'previous-token' });
});

test('expired dashboard token advises login, including HTTP 401 responses', async (t) => {
  for (const status of [200, 401]) {
    const h = await harness(t, {
      handler: () => new Response(JSON.stringify({ code: 3, msg: 'Session expired' }), { status }),
    });
    const result = await h.invoke(['whoami']);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /Login token expired or invalid/);
    assert.doesNotMatch(result.stderr, /App Key authentication/);
  }
});

test('logout clears saved credentials but reports environment credentials', async (t) => {
  const h = await harness(t);
  await saveConfig(h.config, { appKey: 'old-key', token: 'old-token', deviceId: 'device' });
  const result = await h.invoke(['auth', 'logout', '--json']);
  assert.equal(result.code, 0);
  assert.deepEqual(await readConfig(h.config), { deviceId: 'device' });
  assert.equal(JSON.parse(result.stdout).environment_credentials_present, true);
});

test('JSON parameter files preserve booleans and flag overrides', async (t) => {
  const h = await harness(t);
  const file = join(h.config, '..', 'params.json');
  await writeFile(file, JSON.stringify({ pid: 1, pm_id: 2, amount: 4, use_invitation_registration_discount: false }));
  const result = await h.invoke(['orders', 'check', '--params', file, '--amount', '2']);
  assert.equal(result.code, 0);
  assert.equal(h.requests[0].json.amount, 2);
  assert.equal(h.requests[0].json.use_invitation_registration_discount, false);
});

test('piped parameters work and unknown JSON fields fail before network', async (t) => {
  const h = await harness(t);
  const result = await h.invoke(['orders', 'check', '--params', '-'], {
    io: { stdin: Readable.from(['{"pid":1,"pm_id":2}']), stdout: { write() {} }, stderr: { write() {} } },
  });
  assert.equal(result.code, 0);
  assert.throws(() => validateFields('orders check', { pid: 1, pm_id: 1, app_key: 'override' }), /Unknown/);
});

test('extracted nested IP lists become pipe-friendly lines', async (t) => {
  const h = await harness(t, { handler: () => json({ list: [['1.2.3.4:80', '1.2.3.5:81']] }) });
  const result = await h.invoke(['ip', 'extract', '--num', '2', '--yes']);
  assert.equal(result.stdout, '1.2.3.4:80\n1.2.3.5:81\n');
  assert.equal(h.requests[0].url.searchParams.get('format'), 'json');
});

test('plain-text extraction is accepted but JSON API errors and HTML are rejected', async (t) => {
  const plain = await harness(t, { handler: () => new Response('1.2.3.4:80\n', { headers: { 'content-type': 'text/plain' } }) });
  assert.equal((await plain.invoke(['ip', 'extract', '--format', 'text', '--yes'])).stdout, '1.2.3.4:80\n');
  const failed = await harness(t, { handler: () => json({}, 3) });
  assert.equal((await failed.invoke(['ip', 'extract', '--format', 'text', '--yes'])).code, 3);
  const html = await harness(t, { handler: () => new Response('<html>login</html>') });
  assert.equal((await html.invoke(['ip', 'extract', '--format', 'text', '--yes'])).code, 1);
});

test('zero success is scoped to documented newer public APIs', async () => {
  const client = createClient({ credentials: { appKey: 'key' }, fetchImpl: async () => json([], 0) });
  assert.equal((await client.request(commands['products list'])).code, 0);
  await assert.rejects(client.request(commands['packages list']), /ok/);
});

test('network failures do not retry or print secrets', async (t) => {
  const h = await harness(t, { handler: () => { throw new Error('https://api.duckip.cn?app_key=test-app-key'); } });
  const result = await h.invoke(['packages', 'list', '--json']);
  assert.equal(result.code, 1);
  assert.equal(h.requests.length, 1);
  assert.doesNotMatch(result.stderr, /test-app-key/);
  assert.match(result.stderr, /No automatic retry/);
});

test('nested secret fields and embedded app keys are masked', () => {
  const value = maskSecrets({ list: [{ password: 'pass', access_token: 'tok' }], url: 'https://example.test?app_key=abc', accounts: 'name:pass,name2:pass2' });
  assert.equal(value.list[0].password, '[REDACTED]');
  assert.equal(value.list[0].access_token, '[REDACTED]');
  assert.equal(value.accounts, 'name:[REDACTED],name2:[REDACTED]');
  assert.doesNotMatch(value.url, /abc/);
});

test('insecure or non-origin API URLs and invalid timeouts are rejected', () => {
  for (const baseUrl of ['http://api.duckip.cn', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?x=1']) {
    assert.throws(() => createClient({ baseUrl }));
  }
  assert.throws(() => createClient({ timeout: NaN }));
  assert.throws(() => createClient({ timeout: 0 }));
});

test('malformed config fails explicitly instead of discarding it', async (t) => {
  const h = await harness(t);
  await writeFile(h.config, '{broken');
  const result = await h.invoke(['auth', 'status']);
  assert.equal(result.code, 1);
  assert.equal(await readFile(h.config, 'utf8'), '{broken');
});

test('real executable talks to a local HTTP fixture without a build', async (t) => {
  const h = await harness(t);
  let received;
  const server = createServer((request, response) => {
    received = request.url;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ code: 0, data: [{ id: 9, title: 'Fixture product' }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const child = spawn(process.execPath, ['bin/duckip.js', 'products', 'list', '--json', '--api-url', `http://127.0.0.1:${server.address().port}`], {
    cwd: new URL('..', import.meta.url), env: { ...process.env, ...h.env }, windowsHide: true,
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, errors);
  assert.match(output, /Fixture product/);
  assert.match(received, /app_key=test-app-key/);
});
