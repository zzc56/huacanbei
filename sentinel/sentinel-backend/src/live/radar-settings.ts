import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RadarSettings = { host: string; port: number; localAddress: string };
type DeviceConfig = Record<string, unknown> & { radar?: Partial<RadarSettings> };
const example = new URL('../../../../config/devices.example.json', import.meta.url);
export const devicesPath = fileURLToPath(new URL('../../../../config/devices.json', import.meta.url));

export function parseRadarSettings(raw: unknown): RadarSettings | undefined {
  const { host, port, localAddress } = (raw ?? {}) as Partial<RadarSettings>;
  if (typeof host !== 'string' || !isIPv4(host) || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return;
  if (localAddress != null && (typeof localAddress !== 'string' || (localAddress !== '' && !isIPv4(localAddress)))) return;
  return { host, port, localAddress: localAddress ?? '' };
}

function parseConfig(content: string): DeviceConfig {
  return JSON.parse(content.replace(/^\uFEFF/, '')) as DeviceConfig;
}

export function readDeviceConfig(path: string): DeviceConfig {
  try {
    return parseConfig(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {};
  }
}

export async function updateDeviceConfig(path: string, update: (config: DeviceConfig, isNew: boolean) => void) {
  let isNew = false;
  const contents = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    isNew = true;
    return readFile(example, 'utf8');
  });
  const config = parseConfig(contents);
  update(config, isNew);
  const temp = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}
