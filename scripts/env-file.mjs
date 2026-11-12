import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(fileName) {
  const path = resolve(fileName);
  if (!existsSync(path)) {
    throw new Error(`Missing ${fileName}. Copy ${fileName}.example and fill it locally.`);
  }
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

export function envFileValue(fileName, key) {
  if (!existsSync(resolve(fileName))) return undefined;
  try {
    return loadEnvFile(fileName)[key];
  } catch {
    return undefined;
  }
}
