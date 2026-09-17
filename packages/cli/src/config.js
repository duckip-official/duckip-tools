import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export function configPath(env = process.env) {
  return env.DUCKIP_CONFIG ? resolve(env.DUCKIP_CONFIG) : join(homedir(), '.duckip', 'config.json');
}

export async function readConfig(path) {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid object');
    for (const key of ['appKey', 'token', 'deviceId']) {
      if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`invalid ${key}`);
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot read config at ${path}; repair or move the file before retrying.`);
  }
}

export async function saveConfig(path, config) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function credentials(config, env = process.env) {
  return { appKey: env.DUCKIP_APP_KEY || config.appKey, token: env.DUCKIP_TOKEN || config.token, deviceId: config.deviceId };
}
