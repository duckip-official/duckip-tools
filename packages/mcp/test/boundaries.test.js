import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, createMcpContext, listTools } from '../src/mcp.js';

async function fixture(t, handler = () => ({ code: 200, data: {} })) {
  const directory = await mkdtemp(join(tmpdir(), 'duckip-mcp-boundary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const context = createMcpContext({
    env: { DUCKIP_CONFIG: join(directory, 'config.json'), DUCKIP_APP_KEY: 'fixture-key' },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(handler()), { headers: { 'content-type': 'application/json' } });
    },
  });
  const call = (name, args) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { context });
  return { context, requests, call };
}

test('all notifications are silent and cannot execute a mutation', async (t) => {
  const f = await fixture(t);
  for (const request of [
    { method: 'notifications/initialized' },
    { method: 'notifications/roots/list_changed' },
    { method: 'ping' },
    { method: 'tools/call', params: { name: 'duckip_ip_extract', arguments: { confirm: true } } },
  ]) {
    assert.equal(await dispatch({ jsonrpc: '2.0', ...request }, { context: f.context }), null);
  }
  assert.equal(f.requests.length, 0);
});

test('invalid request IDs and params are protocol errors without side effects', async (t) => {
  const f = await fixture(t);
  for (const id of [null, true, [], {}, 0.5]) {
    const result = await dispatch({ jsonrpc: '2.0', id, method: 'ping' }, { context: f.context });
    assert.equal(result.error.code, -32600);
    assert.equal(result.id, null);
  }
  for (const params of [null, [], 'invalid']) {
    const result = await dispatch({ jsonrpc: '2.0', id: 0, method: 'tools/call', params }, { context: f.context });
    assert.equal(result.error.code, -32602);
  }
  assert.deepEqual((await dispatch({ jsonrpc: '2.0', id: 0, method: 'ping' })).result, {});
  assert.equal(f.requests.length, 0);
});

test('schema-invalid tool arguments never reach the API', async (t) => {
  const f = await fixture(t);
  for (const [name, input] of [
    ['duckip_whitelist_add', { ips: 'not-an-ip', product_type: 9, confirm: true }],
    ['duckip_whitelist_delete', { ips: '192.0.2.1,999.0.0.1', confirm: true }],
    ['duckip_accounts_update', { account: 'demo', password: '', confirm: true }],
    ['duckip_accounts_quota', { product_type: '9' }],
    ['duckip_orders_info', { trade_no: '   ' }],
    ['duckip_auth_status', { unknown: true }],
    ['duckip_auth_status', []],
  ]) {
    const result = await f.call(name, input);
    assert.equal(result.result.isError, true, name);
  }
  assert.equal(f.requests.length, 0);
  const valid = await f.call('duckip_whitelist_add', { ips: '192.0.2.1,2001:db8::1', product_type: 9, confirm: true });
  assert.equal(valid.result.isError, undefined);
  assert.equal(f.requests.length, 1);
});

test('submitted proxy passwords and verification codes are masked in API errors and messages', async (t) => {
  for (const code of [200, 400]) {
    const f = await fixture(t, () => ({ code, msg: 'Rejected AuditSecret123 / VerifyTestCode', data: { message: 'Echo AuditSecret123 / VerifyTestCode' } }));
    for (const [name, input] of [
      ['duckip_accounts_password', { account: 'demo', password: 'AuditSecret123', confirm: true }],
      ['duckip_accounts_add', { accounts: 'demo:AuditSecret123', product_type: 9, confirm: true }],
      ['duckip_whitelist_delete', { ips: '192.0.2.1', verify_type: 'email', verify_code: 'VerifyTestCode', confirm: true }],
    ]) {
      const result = await f.call(name, input);
      const secret = input.verify_code || 'AuditSecret123';
      assert.ok(!JSON.stringify(result).includes(secret), name);
    }
  }
});

test('no mutation advertises an undocumented retry guarantee', () => {
  for (const tool of listTools().filter((item) => !item.annotations.readOnlyHint)) {
    assert.equal(tool.annotations.idempotentHint, false, tool.name);
  }
});
