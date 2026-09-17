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

test('balance payment checks exact order and only sends pay_method 7', async (t) => {
  const h = await harness(t, { handler: () => json({ trade_no: 'order1', pay_fee: '18.20', status: 0 }) });
  assert.equal((await h.invoke(['orders', 'pay', '--trade-no', 'order1', '--yes'])).code, 0);
  assert.equal(h.requests[0].url.pathname, '/web_v1/order/info');
  assert.equal(h.requests[1].url.pathname, '/web_v1/pay');
  assert.equal(h.requests[1].json.pay_method, 7);
  assert.equal(h.requests[1].json.app_key, undefined);
  assert.equal(h.requests[1].headers.Authorization, 'Bearer test-token');
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
  const result = await h.invoke(['ip', 'extract', '--num', '2']);
  assert.equal(result.stdout, '1.2.3.4:80\n1.2.3.5:81\n');
  assert.equal(h.requests[0].url.searchParams.get('format'), 'json');
});

test('plain-text extraction is accepted but JSON API errors and HTML are rejected', async (t) => {
  const plain = await harness(t, { handler: () => new Response('1.2.3.4:80\n', { headers: { 'content-type': 'text/plain' } }) });
  assert.equal((await plain.invoke(['ip', 'extract', '--format', 'text'])).stdout, '1.2.3.4:80\n');
  const failed = await harness(t, { handler: () => json({}, 3) });
  assert.equal((await failed.invoke(['ip', 'extract', '--format', 'text'])).code, 3);
  const html = await harness(t, { handler: () => new Response('<html>login</html>') });
  assert.equal((await html.invoke(['ip', 'extract', '--format', 'text'])).code, 1);
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
