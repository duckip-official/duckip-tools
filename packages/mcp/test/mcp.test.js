import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { commands } from '../src/commands.js';
import { createMcpContext, dispatch, listTools, mcpToolName, commandFromToolName, runMcpProcess } from '../src/mcp.js';

function response(code, data, message = 'ok') {
  return new Response(JSON.stringify({ code, message, data }), { headers: { 'content-type': 'application/json' } });
}

function helper(t, handler, env = {}) {
  const requests = [];
  const mergedEnv = { DUCKIP_APP_KEY: 'mcp-app-key', DUCKIP_TOKEN: 'mcp-token', ...env };
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(requests.at(-1), requests.length);
  };
  const context = createMcpContext({ env: mergedEnv, fetchImpl });
  t.after(() => { requests.length = 0; });
  return { context, requests };
}

async function call(t, command, args, handler = () => response(200, { list: [] })) {
  const h = helper(t, handler);
  const result = await dispatch({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: mcpToolName(command), arguments: args },
  }, { context: h.context });
  return { ...h, result };
}

test('MCP tools are derived from CLI commands, including hyphenated commands', () => {
  const tools = listTools();
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  assert.ok(tools.some((tool) => tool.name === 'duckip_products_list'));
  assert.ok(tools.some((tool) => tool.name === 'duckip_regions_search_cities'));
  assert.ok(tools.some((tool) => tool.name === 'duckip_auth_status'));
  assert.equal(commandFromToolName('duckip_regions_search_cities'), 'regions search-cities');
  assert.equal(commandFromToolName('duckip_unknown'), null);
  const destructive = tools.find((tool) => tool.name === 'duckip_accounts_delete');
  assert.equal(destructive.annotations.destructiveHint, true);
  assert.equal(destructive.inputSchema.properties.confirm.type, 'boolean');
  assert.equal(destructive.inputSchema.additionalProperties, false);
});

test('initialize, ping, notification, and unknown method follow JSON-RPC', async () => {
  const init = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'duckip-mcp');
  assert.equal(init.result.capabilities.tools.listChanged, false);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).result.protocolVersion, '2024-11-05');
  assert.deepEqual((await dispatch({ jsonrpc: '2.0', id: 2, method: 'ping' })).result, {});
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 3, method: 'nope' })).error.code, -32601);
});

test('read-only call uses the public App Key and returns structured data', async (t) => {
  const h = await call(t, 'products list', { type: 9 }, () => response(0, [{ id: 12, title: 'Dynamic' }]));
  assert.equal(h.result.result.isError, undefined);
  assert.deepEqual(h.result.result.structuredContent.data, [{ id: 12, title: 'Dynamic' }]);
  assert.equal(h.requests[0].url.pathname, '/developers/product');
  assert.equal(h.requests[0].url.searchParams.get('app_key'), 'mcp-app-key');
  assert.equal(h.requests[0].init.headers.Authorization, undefined);
});

test('auth status is local and does not call the network', async (t) => {
  const h = await call(t, 'auth status', {});
  assert.equal(h.result.result.structuredContent.public_api.configured, true);
  assert.equal(h.result.result.structuredContent.dashboard.configured, true);
  assert.equal(h.requests.length, 0);
});

test('mutating tools require confirm and validate before network', async (t) => {
  const h = await call(t, 'accounts delete', { accounts: 'user01' });
  assert.equal(h.result.result.isError, true);
  assert.match(h.result.result.content[0].text, /confirm=true/);
  assert.equal(h.requests.length, 0);
  const invalid = await call(t, 'accounts delete', { accounts: 'user 01', confirm: true });
  assert.equal(invalid.result.result.isError, true);
  assert.equal(invalid.requests.length, 0);
});

test('order creation preflights and submits identical parameters after confirmation', async (t) => {
  const h = await call(t, 'orders create', { pid: 1, pm_id: 0, confirm: true }, (_request, count) => response(0, count === 1 ? { pay_fee: 3.5 } : { trade_no: 'T-1' }));
  assert.equal(h.result.result.structuredContent.data.trade_no, 'T-1');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url.pathname, '/developers/order/check');
  assert.equal(h.requests[1].url.pathname, '/developers/order/create');
  assert.deepEqual(h.requests[0].body, h.requests[1].body);
});

test('order creation stops when preflight has no valid price', async (t) => {
  const h = await call(t, 'orders create', { pid: 1, pm_id: 0, confirm: true }, () => response(0, { pay_fee: null }));
  assert.equal(h.result.result.isError, true);
  assert.match(h.result.result.content[0].text, /valid payable amount/);
  assert.equal(h.requests.length, 1);
});

test('balance payment verifies order and sends dashboard pay_method 7', async (t) => {
  const h = await call(t, 'orders pay', { trade_no: 'T-1', confirm: true }, (_request, count) => count === 1
    ? response(200, { trade_no: 'T-1', status: 0, pay_fee: '2.50' })
    : response(200, { trade_no: 'T-1', status: 1 }));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url.pathname, '/web_v1/order/info');
  assert.equal(h.requests[1].url.pathname, '/web_v1/pay');
  assert.equal(h.requests[1].body.pay_method, 7);
  assert.equal(h.requests[1].init.headers.Authorization, 'Bearer mcp-token');
  assert.equal(h.requests[1].body.app_key, undefined);
});

test('IP extraction requires confirmation because it consumes quota', async (t) => {
  const h = await call(t, 'ip extract', { cc: 'US', num: 1 });
  assert.equal(h.result.result.isError, true);
  assert.equal(h.requests.length, 0);
  const confirmed = await call(t, 'ip extract', { cc: 'US', num: 1, confirm: true }, () => response(200, { list: [['1.2.3.4:80']] }));
  assert.equal(confirmed.result.result.structuredContent.data.list[0][0], '1.2.3.4:80');
});

test('MCP masks credentials in structured output', async (t) => {
  const h = await call(t, 'accounts list', {}, () => response(200, { list: [{ username: 'u', password: 'secret' }], app_key: 'mcp-app-key' }));
  assert.equal(h.result.result.structuredContent.data.list[0].password, '[REDACTED]');
  assert.equal(h.result.result.structuredContent.data.app_key, '[REDACTED]');
  assert.doesNotMatch(h.result.result.content[0].text, /mcp-app-key|secret/);
});

test('invalid JSON and unknown tools are safe protocol errors', async () => {
  const output = [];
  const input = Readable.from(['not-json\n', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'duckip_missing', arguments: {} } }) + '\n']);
  const writable = new Writable({ write(chunk, encoding, callback) { output.push(JSON.parse(chunk.toString())); callback(); } });
  await runMcpProcess({ input, output: writable });
  assert.equal(output[0].error.code, -32700);
  assert.equal(output[1].error.code, -32602);
});

test('MCP process handles initialize and tools/list over stdio', async () => {
  const input = Readable.from([
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ].join('\n') + '\n');
  const output = [];
  const writable = new Writable({ write(chunk, encoding, callback) { output.push(JSON.parse(chunk.toString())); callback(); } });
  await runMcpProcess({ input, output: writable, env: { DUCKIP_APP_KEY: 'test', DUCKIP_TOKEN: 'test' } });
  assert.equal(output[0].result.serverInfo.name, 'duckip-mcp');
  assert.ok(output[1].result.tools.length >= Object.keys(commands).length - 4);
});
