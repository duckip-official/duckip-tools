import { createInterface } from 'node:readline';
import { commands, validateFields } from './commands.js';
import { configPath, readConfig, credentials } from './config.js';
import { createClient, maskSecrets } from './client.js';

const PROTOCOL_VERSION = '2025-06-18';
const COMPATIBLE_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2024-11-05']);
const SERVER_VERSION = '0.1.0';
const MUTATING_COMMANDS = new Set([
  'ip extract',
  'accounts add', 'accounts delete', 'accounts enable', 'accounts disable',
  'accounts password', 'accounts remark', 'accounts limit', 'accounts update',
  'whitelist add', 'whitelist delete', 'orders create', 'orders close', 'orders pay',
]);
const LOCAL_COMMANDS = new Map([
  ['auth status', { description: 'Show whether App Key and dashboard token are configured without revealing secrets.' }],
]);

export function mcpToolName(commandName) {
  return `duckip_${commandName.replaceAll(' ', '_').replaceAll('-', '_')}`;
}

export function commandFromToolName(name) {
  if (typeof name !== 'string' || !name.startsWith('duckip_')) return null;
  for (const candidate of [...Object.keys(commands), ...LOCAL_COMMANDS.keys()]) {
    if (mcpToolName(candidate) === name) return candidate;
  }
  return null;
}

function schemaForField(field) {
  const schema = { type: field.type };
  if (field.choices) schema.enum = field.choices;
  if (field.type === 'integer' || field.type === 'number') schema.minimum = field.min;
  return schema;
}

function toolDefinition(commandName, spec) {
  const fields = spec.fields || {};
  const mutating = MUTATING_COMMANDS.has(commandName);
  const properties = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, schemaForField(field)]));
  if (mutating) {
    properties.confirm = { type: 'boolean', description: 'Must be true immediately before this quota-consuming or external mutation.' };
  }
  const required = Object.entries(fields).filter(([, field]) => field.required).map(([key]) => key);
  if (mutating) required.push('confirm');
  const inputSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length) inputSchema.required = required;
  return {
    name: mcpToolName(commandName),
    description: `${spec.description}${mutating ? ' Requires confirm=true; use the CLI or a read-only tool to review details first.' : ''}`,
    inputSchema,
    annotations: {
      readOnlyHint: !mutating,
      destructiveHint: ['accounts delete', 'whitelist delete', 'orders close'].includes(commandName),
      idempotentHint: !['orders create', 'orders pay', 'ip extract'].includes(commandName),
      openWorldHint: true,
    },
  };
}

export function listTools() {
  return [
    ...Object.entries(commands)
      .filter(([name]) => !['auth login', 'auth key', 'auth token', 'auth logout', 'auth status'].includes(name))
      .map(([name, spec]) => toolDefinition(name, spec)),
    {
      name: mcpToolName('auth status'),
      description: LOCAL_COMMANDS.get('auth status').description,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function textResult(value) {
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] };
  const text = JSON.stringify(value ?? null, null, 2);
  const result = { content: [{ type: 'text', text }] };
  if (value && typeof value === 'object' && !Array.isArray(value)) result.structuredContent = value;
  return result;
}

function errorResult(error, secrets = []) {
  const code = error?.code ?? 'MCP_ERROR';
  const message = maskSecrets(String(error?.message || error), secrets);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }] };
}

function confirmError(commandName) {
  return new Error(`${commandName} requires confirm=true. Review the corresponding read-only result or orders check first.`);
}

function validPrice(value) {
  return ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function createMcpContext({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    env,
    fetchImpl,
    async load() {
      const path = configPath(env);
      const config = await readConfig(path);
      const creds = credentials(config, env);
      const secrets = [creds.appKey, creds.token, env.DUCKIP_PASSWORD].filter(Boolean);
      const client = createClient({
        baseUrl: env.DUCKIP_API_URL || 'https://api.duckip.cn',
        credentials: creds,
        timeout: env.DUCKIP_TIMEOUT === undefined ? 20000 : Number(env.DUCKIP_TIMEOUT),
        language: env.DUCKIP_LANGUAGE || 'zh',
        fetchImpl,
      });
      return { path, config, creds, client, secrets };
    },
  };
}

function authStatus(context, loaded) {
  const { env } = context;
  const { path, config, creds } = loaded;
  return {
    config: path,
    public_api: { configured: Boolean(creds.appKey), source: env.DUCKIP_APP_KEY ? 'environment' : config.appKey ? 'file' : 'none' },
    dashboard: { configured: Boolean(creds.token), source: env.DUCKIP_TOKEN ? 'environment' : config.token ? 'file' : 'none' },
  };
}

async function callCommand(commandName, arguments_, loaded) {
  const spec = commands[commandName];
  const input = arguments_ && typeof arguments_ === 'object' && !Array.isArray(arguments_) ? { ...arguments_ } : {};
  const confirmed = input.confirm === true;
  delete input.confirm;
  if (MUTATING_COMMANDS.has(commandName) && !confirmed) throw confirmError(commandName);
  if (commandName === 'ip extract' && input.format === undefined) input.format = 'json';
  const params = validateFields(commandName, input);
  if (commandName === 'orders create') {
    const quote = await loaded.client.request(commands['orders check'], params);
    if (!validPrice(quote.data?.pay_fee)) throw new Error('Preflight returned no valid payable amount; order was not created');
    return loaded.client.request(spec, params);
  }
  if (commandName === 'orders pay') {
    const info = await loaded.client.request(commands['orders info'], params);
    const order = info.data;
    if (!order || String(order.trade_no) !== params.trade_no) throw new Error('Order response does not match trade_no');
    if (order.status !== 0 && order.status !== '0') throw new Error('Only an unpaid order (status 0) can be paid');
    if (!validPrice(order.pay_fee)) throw new Error('Order has no valid payable amount');
    return loaded.client.request(spec, { ...params, pay_method: 7 });
  }
  return loaded.client.request(spec, params);
}

export async function dispatch(request, options = {}) {
  const context = options.context || createMcpContext(options);
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  if (request.method === 'notifications/initialized' || request.method === 'notifications/cancelled') return null;
  if (request.method === 'ping') return { jsonrpc: '2.0', id: request.id, result: {} };
  if (request.method === 'initialize') {
    const requestedVersion = request.params?.protocolVersion;
    const protocolVersion = COMPATIBLE_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : PROTOCOL_VERSION;
    return {
      jsonrpc: '2.0', id: request.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'duckip-mcp', version: SERVER_VERSION },
        instructions: 'DuckIP tools use public App Key or dashboard token credentials from the local environment/config. Mutating tools require confirm=true.',
      },
    };
  }
  if (request.method === 'tools/list') return { jsonrpc: '2.0', id: request.id, result: { tools: listTools() } };
  if (request.method !== 'tools/call') return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
  const name = request.params?.name;
  const commandName = commandFromToolName(name);
  if (!commandName) return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: `Unknown tool: ${name}` } };
  let loaded;
  try {
    loaded = await context.load();
    if (commandName === 'auth status') return { jsonrpc: '2.0', id: request.id, result: textResult(authStatus(context, loaded)) };
    const data = await callCommand(commandName, request.params?.arguments, loaded);
    const masked = maskSecrets(data, loaded.secrets);
    return { jsonrpc: '2.0', id: request.id, result: textResult(masked) };
  } catch (error) {
    return { jsonrpc: '2.0', id: request.id, result: errorResult(error, loaded?.secrets || [context.env.DUCKIP_APP_KEY, context.env.DUCKIP_TOKEN]) };
  }
}

export async function runMcpProcess({ input = process.stdin, output = process.stdout, errorOutput = process.stderr, ...options } = {}) {
  const context = createMcpContext(options);
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    try {
      const response = await dispatch(request, { context });
      if (response) output.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      errorOutput.write(`duckip-mcp: ${error?.message || error}\n`);
      if (request.id !== undefined) output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } })}\n`);
    }
  }
}
