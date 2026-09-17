import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { isIP } from 'node:net';
import { commands, flagName, validateFields } from './commands.js';
import { configPath, readConfig, saveConfig, credentials } from './config.js';
import { createClient, maskSecrets } from './client.js';

const globals = {
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' }, 'show-secrets': { type: 'boolean' },
  'dry-run': { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
  config: { type: 'string' }, 'api-url': { type: 'string' }, timeout: { type: 'string' },
  language: { type: 'string' }, params: { type: 'string' },
};

export function parseCommand(argv) {
  const allOptions = { ...globals };
  for (const spec of Object.values(commands)) {
    for (const key of Object.keys(spec.fields)) allOptions[flagName(key)] = { type: 'string' };
  }
  const { values, positionals, tokens } = parseArgs({ args: argv, options: allOptions, allowPositionals: true, strict: true, tokens: true });
  const used = new Set();
  for (const token of tokens.filter((token) => token.kind === 'option')) {
    if (used.has(token.name)) throw new Error(`Duplicate option: --${token.name}`);
    used.add(token.name);
  }
  if (positionals[0] === 'help') {
    values.help = true;
    positionals.shift();
  }
  const name = positionals.join(' ');
  const spec = commands[name];
  if (values.version) return { values, name, spec };
  if (!spec && !(values.help && (!name || Object.keys(commands).some((key) => key.startsWith(`${name} `)))) && name) throw new Error(`Unknown command: ${name}. Run duckip --help.`);
  if (spec) {
    for (const key of Object.keys(values)) {
      if (!Object.hasOwn(globals, key) && !Object.hasOwn(spec.fields, key.replaceAll('-', '_'))) throw new Error(`Unknown option for ${name}: --${key}`);
    }
  }
  return { values, name, spec };
}

function help(name, spec) {
  const lines = ['DuckIP CLI 0.1.0', ''];
  if (spec) {
    lines.push(`Usage: duckip ${name} [options]`, '', spec.description, '');
    if (spec.path) lines.push(`${spec.method} ${spec.path}`, `Authentication: ${spec.auth}`, '');
    for (const [key, field] of Object.entries(spec.fields)) {
      lines.push(`  --${flagName(key)} <${field.type}>${field.required ? ' (required)' : ''}${field.choices ? ` [${field.choices.join(', ')}]` : ''}`);
    }
  } else {
    lines.push(`Usage: duckip ${name ? `${name} ` : ''}<command> [options]`, '');
    for (const [key, item] of Object.entries(commands)) {
      if (!name || key.startsWith(`${name} `)) lines.push(`  ${key.padEnd(26)} ${item.description}`);
    }
  }
  lines.push('', 'Global options:',
    '  --json                     Output the API envelope as JSON',
    '  --params <file.json|->      Read API parameters from a JSON object (or stdin)',
    '  --dry-run                  Print a redacted request without calling the API',
    '  --yes, -y                  Confirm an order, payment, or destructive operation',
    '  --show-secrets             Reveal proxy passwords in successful output',
    '  --config <path>            Use an alternate credential file',
    '  --api-url <origin>         API origin (default https://api.duckip.cn)',
    '  --timeout <ms>             Request timeout (default 20000)',
    '  --language <zh|en>         API response language (default zh)',
    '  --help, -h                 Show help for a command',
    '', 'Credentials: DUCKIP_APP_KEY, DUCKIP_TOKEN, DUCKIP_PASSWORD.',
    'Use duckip auth login --phone <phone> --code 86, or duckip auth key.',
  );
  return lines.join('\n');
}

async function prompt(label, secret, io) {
  if (!io.stdin.isTTY || !io.stderr.isTTY) throw new Error('Interactive input requires a terminal. Use environment variables for credentials and --yes for confirmations.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) io.stderr.write(chunk); callback(); } });
  const readline = createInterface({ input: io.stdin, output, terminal: true });
  let rejectClosed;
  const closed = new Promise((_, reject) => { rejectClosed = reject; });
  readline.once('close', () => rejectClosed(new Error('Input cancelled')));
  readline.on('SIGINT', () => readline.close());
  try {
    const question = readline.question(label);
    muted = secret;
    return await Promise.race([question, closed]);
  } finally {
    readline.close();
    output.end();
    if (secret) io.stderr.write('\n');
  }
}

function printResult(result, options, io, secrets) {
  const data = options['show-secrets'] ? result : maskSecrets(result, secrets);
  if (options.json) {
    io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  const content = data && typeof data === 'object' && Object.hasOwn(data, 'code') ? data.data : data;
  if (typeof content === 'string') io.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
  else io.stdout.write(`${JSON.stringify(content ?? data, null, 2)}\n`);
}

export async function run(argv, options = {}) {
  const io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, ...options.io };
  const env = options.env || process.env;
  const ask = options.prompt || ((label, secret = false) => prompt(label, secret, io));
  let flags = {};
  const secrets = [env.DUCKIP_APP_KEY, env.DUCKIP_TOKEN, env.DUCKIP_PASSWORD];
  try {
    const parsed = parseCommand(argv);
    flags = parsed.values;
    const { spec, name } = parsed;
    if (flags.version) { io.stdout.write('0.1.0\n'); return 0; }
    if (flags.help || !name) { io.stdout.write(`${help(name, spec)}\n`); return 0; }

    let input = {};
    if (flags.params) {
      let text;
      if (flags.params === '-') {
        if (io.stdin.isTTY) throw new Error('--params - requires piped JSON input');
        text = '';
        for await (const chunk of io.stdin) text += chunk.toString();
      } else text = await readFile(flags.params, 'utf8');
      try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Parameter input must contain valid JSON'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Parameter input must be a JSON object');
    }
    for (const key of Object.keys(spec.fields)) {
      if (Object.hasOwn(flags, flagName(key))) input[key] = flags[flagName(key)];
    }
    const params = validateFields(name, input);
    for (const [key, value] of Object.entries(params)) {
      if (/password|verify_code/.test(key)) secrets.push(value);
      if (key === 'accounts' && name === 'accounts add') secrets.push(...value.split(',').map((pair) => pair.split(':')[1]));
    }
    if (params.ips && params.ips.split(/[,\n]/).some((ip) => !isIP(ip.trim()))) throw new Error('--ips must contain valid IP addresses');
    if (flags.language && !['zh', 'en'].includes(flags.language)) throw new Error('--language must be zh or en');
    const path = flags.config || configPath(env);
    const config = await readConfig(path);
    secrets.push(config.appKey, config.token);
    let creds = credentials(config, env);
    const makeClient = () => createClient({
      baseUrl: flags['api-url'] || env.DUCKIP_API_URL || 'https://api.duckip.cn',
      credentials: creds, timeout: flags.timeout === undefined ? 20000 : Number(flags.timeout),
      language: flags.language || 'zh', fetchImpl: options.fetchImpl,
    });
    let client = makeClient();
    const print = (value) => printResult(value, flags, io, secrets);
    const confirm = async (message) => {
      if (flags.yes) return;
      if ((await ask(`${message} Type yes to continue: `)).trim().toLowerCase() !== 'yes') throw new Error('Operation cancelled');
    };

    if (spec.action === 'status') {
      print({ config: path,
        public_api: { configured: Boolean(creds.appKey), source: env.DUCKIP_APP_KEY ? 'environment' : config.appKey ? 'file' : 'none' },
        dashboard: { configured: Boolean(creds.token), source: env.DUCKIP_TOKEN ? 'environment' : config.token ? 'file' : 'none' } });
      return 0;
    }
    if (spec.action === 'logout') {
      if (!flags['dry-run']) await saveConfig(path, config.deviceId ? { deviceId: config.deviceId } : {});
      print({ saved_credentials_removed: !flags['dry-run'], dry_run: Boolean(flags['dry-run']), environment_credentials_present: Boolean(env.DUCKIP_APP_KEY || env.DUCKIP_TOKEN) });
      return 0;
    }
    if (['login', 'key', 'token'].includes(spec.action)) {
      if (spec.action === 'login') {
        const identities = [params.phone, params.email, params.username].filter(Boolean);
        if (identities.length !== 1) throw new Error('Specify exactly one of --phone, --email, or --username');
        if (params.phone) {
          params.code = (params.code || '86').replace(/^\+/, '');
          if (!/^\d+$/.test(params.code) || !/^\d+$/.test(params.phone)) throw new Error('Use digits for --phone and --code; do not include the country code in --phone');
          params.ted = 1;
        } else {
          if (params.code) throw new Error('--code is only used with --phone');
          params.type = params.email ? 1 : 2;
        }
        if (Boolean(params.verify_type) !== Boolean(params.verify_code)) throw new Error('Provide --verify-type and --verify-code together');
      }
      if (flags['dry-run']) {
        print(spec.action === 'login' ? client.preview(spec, { ...params, password: '<PASSWORD>' }) : { action: spec.action, validates_before_saving: true, config: path });
        return 0;
      }
      creds = { deviceId: config.deviceId || randomBytes(16).toString('hex') };
      let info;
      if (spec.action === 'key') {
        creds.appKey = (env.DUCKIP_APP_KEY || await ask('App key: ', true)).trim();
        if (!creds.appKey) throw new Error('App key cannot be empty');
        secrets.push(creds.appKey);
        client = makeClient();
        await client.request(commands['packages list'], { page: 1, size: 1 });
      } else {
        if (spec.action === 'login') {
          params.password = env.DUCKIP_PASSWORD || await ask('Password: ', true);
          if (!params.password) throw new Error('Password cannot be empty');
          secrets.push(params.password);
          client = makeClient();
          const response = await client.request(spec, params);
          info = response.data;
          creds.token = info?.access_token;
          if (typeof creds.token !== 'string' || !creds.token) throw new Error('Login succeeded but access_token is missing; no credentials saved');
          secrets.push(creds.token);
        } else {
          creds.token = (env.DUCKIP_TOKEN || await ask('Access token: ', true)).trim();
          if (!creds.token) throw new Error('Token cannot be empty');
          secrets.push(creds.token);
        }
        client = makeClient();
        if (!info?.openid) info = (await client.request(commands.whoami)).data;
        if (typeof info?.openid === 'string' && info.openid) creds.appKey = info.openid;
      }
      // Replacing both credentials avoids accidentally combining different users.
      await saveConfig(path, creds);
      print({ authenticated: true, saved: path, public_api_ready: Boolean(creds.appKey), dashboard_ready: Boolean(creds.token) });
      return 0;
    }

    if (name === 'ip extract' && !params.format) params.format = 'json';
    if (flags['dry-run']) {
      if (spec.action === 'create') print({ steps: [client.preview(commands['orders check'], params), client.preview(spec, params)], confirmation_required: true });
      else if (spec.action === 'pay') print({ steps: [client.preview(commands['orders info'], params), client.preview(spec, { ...params, pay_method: 7 })], confirmation_required: true });
      else print(client.preview(spec, params));
      return 0;
    }
    if (spec.action === 'create') {
      const quote = await client.request(commands['orders check'], params);
      const price = quote.data?.pay_fee;
      if (!['number', 'string'].includes(typeof price) || String(price).trim() === '' || !Number.isFinite(Number(price)) || Number(price) < 0) throw new Error('Preflight returned no valid payable amount; order not created');
      io.stderr.write(`Order preview:\n${JSON.stringify(maskSecrets(quote.data, secrets), null, 2)}\n`);
      await confirm('Create this order?');
    } else if (spec.action === 'pay') {
      const result = await client.request(commands['orders info'], params);
      const order = result.data;
      if (!order || String(order.trade_no) !== params.trade_no) throw new Error('Order response does not match --trade-no');
      if (order.status !== 0 && order.status !== '0') throw new Error('Only an unpaid order (status 0) can be paid');
      const fee = Number(order.pay_fee);
      if (!['number', 'string'].includes(typeof order.pay_fee) || String(order.pay_fee).trim() === '' || !Number.isFinite(fee) || fee < 0) throw new Error('Order has no valid payable amount');
      io.stderr.write(`Balance payment preview:\n${JSON.stringify(maskSecrets({ trade_no: order.trade_no, title: order.title, pay_fee: order.pay_fee, payment_method: 'balance (7)' }, secrets), null, 2)}\n`);
      await confirm('Debit account balance for this order?');
      params.pay_method = 7;
    } else if (spec.confirm) {
      io.stderr.write(`${JSON.stringify(maskSecrets(params, secrets), null, 2)}\n`);
      await confirm(spec.description);
    }
    const response = await client.request(spec, params);
    if (spec.action === 'balance') print({ balance: response.data?.balance, total_recharge_fee: response.data?.total_recharge_fee });
    else if (spec.action === 'extract' && !flags.json && typeof response !== 'string' && Array.isArray(response.data?.list)) print(response.data.list.flat(Infinity).join('\n'));
    else print(response);
    return 0;
  } catch (error) {
    const code = error.code ?? 'CLI_ERROR';
    const message = maskSecrets(String(error.message || error), secrets);
    io.stderr.write(flags.json ? `${JSON.stringify({ error: { code, message } })}\n` : `Error [${code}]: ${message}\n`);
    return [3, 348, 286, 287].includes(code) ? 3 : 1;
  }
}
