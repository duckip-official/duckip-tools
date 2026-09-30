import { createInterface } from 'node:readline';
import { commands, validateFields, mutatingCommands as MUTATING_COMMANDS } from './commands.js';
import { configPath, readConfig, credentials } from './config.js';
import { createClient, maskSecrets } from './client.js';
import { version as SERVER_VERSION } from './metadata.js';

const PROTOCOL_VERSION = '2025-06-18';
const COMPATIBLE_PROTOCOL_VERSIONS = new Set(['2025-06-18', '2024-11-05']);
const HIDDEN_COMMANDS = new Set(['auth login', 'auth key', 'auth token', 'auth logout', 'auth status']);
const LOCAL_COMMANDS = new Map([
  ['auth status', { description: 'Show whether App Key and dashboard token are configured without revealing secrets.' }],
]);

export function mcpToolName(commandName) {
  return `duckip_${commandName.replaceAll(' ', '_').replaceAll('-', '_')}`;
}

export function commandFromToolName(name) {
  if (typeof name !== 'string' || !name.startsWith('duckip_')) return null;
  for (const candidate of [...Object.keys(commands), ...LOCAL_COMMANDS.keys()]) {
    if (HIDDEN_COMMANDS.has(candidate) && !LOCAL_COMMANDS.has(candidate)) continue;
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
      idempotentHint: !mutating,
      openWorldHint: true,
    },
  };
}

export function listTools() {
  return [
    ...Object.entries(commands)
      .filter(([name]) => !HIDDEN_COMMANDS.has(name))
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
        baseUrl: env.DUCKIP_API_URL || 'https://api.duckip.com',
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
  if (arguments_ !== undefined && (!arguments_ || typeof arguments_ !== 'object' || Array.isArray(arguments_))) throw new Error('Tool arguments must be an object');
  const input = { ...arguments_ };
  const confirmed = input.confirm === true;
  delete input.confirm;
  if (MUTATING_COMMANDS.has(commandName) && !confirmed) throw confirmError(commandName);
  if (commandName === 'ip extract' && input.format === undefined) input.format = 'json';
  const params = validateFields(commandName, input, { coerce: false });
  if (commandName === 'orders create') {
    const quote = await loaded.client.request(commands['orders check'], params);
    if (!validPrice(quote.data?.pay_fee)) throw new Error('Preflight returned no valid payable amount; order was not created');
    return loaded.client.request(spec, params);
  }
  if (commandName === 'orders pay') {
    const info = await loaded.client.request(commands['orders info'], { team_id: params.team_id, trade_no: params.trade_no });
    const order = info.data;
    if (!order || String(order.trade_no) !== params.trade_no) throw new Error('Order response does not match trade_no');
    if (order.status !== 0 && order.status !== '0') throw new Error('Only an unpaid order (status 0) can be paid');
    if (!validPrice(order.pay_fee)) throw new Error('Order has no valid payable amount');
    const quote = (await loaded.client.request(commands['orders pay-check'], params)).data;
    if (!quote || String(quote.trade_no) !== params.trade_no) throw new Error('Payment preview does not match trade_no');
    if (!validPrice(quote.pay_fee)) throw new Error('Payment preview has no valid payable amount');
    if (params.pm_id !== undefined && String(quote.pm_id) !== String(params.pm_id)) throw new Error('Payment preview does not match pm_id');
    return loaded.client.request(spec, params);
  }
  return loaded.client.request(spec, params);
}

export async function dispatch(request, options = {}) {
  const context = options.context || createMcpContext(options);
  const validId = typeof request?.id === 'string' || (typeof request?.id === 'number' && Number.isSafeInteger(request.id));
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (Object.hasOwn(request, 'id') && !validId)) {
    return { jsonrpc: '2.0', id: validId ? request.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  // Notifications never receive responses and must not invoke tools by omitting an ID.
  if (!Object.hasOwn(request, 'id')) return null;
  if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) {
    return { jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'Params must be an object' } };
  }
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
  const input = request.params?.arguments;
  const submittedSecrets = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const field of ['password', 'verify_code']) {
      if (typeof input[field] === 'string' && input[field]) submittedSecrets.push(input[field]);
    }
    if (commandName === 'accounts add' && typeof input.accounts === 'string') {
      submittedSecrets.push(...input.accounts.split(',').map((pair) => pair.split(':')[1]).filter(Boolean));
    }
  }
  try {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new Error('Tool arguments must be an object');
    if (commandName === 'auth status') validateFields(commandName, input || {}, { coerce: false });
    loaded = await context.load();
    loaded.secrets.push(...submittedSecrets);
    if (commandName === 'auth status') return { jsonrpc: '2.0', id: request.id, result: textResult(authStatus(context, loaded)) };
    const data = await callCommand(commandName, request.params?.arguments, loaded);
    const masked = maskSecrets(data, loaded.secrets);
    return { jsonrpc: '2.0', id: request.id, result: textResult(masked) };
  } catch (error) {
    return { jsonrpc: '2.0', id: request.id, result: errorResult(error, loaded?.secrets || [...submittedSecrets, context.env.DUCKIP_APP_KEY, context.env.DUCKIP_TOKEN]) };
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
      errorOutput.write('duckip-mcp: Internal error while processing a request\n');
      if (request?.id !== undefined) output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'Internal error' } })}\n`);
    }
  }
}
