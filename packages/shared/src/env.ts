import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Load the monorepo-level .env (walks up from cwd) so every service shares one config file.
function findEnvFile(start = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findEnvFile();
if (envFile) loadDotenv({ path: envFile, quiet: true } as Parameters<typeof loadDotenv>[0]);

export function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required environment variable ${name}`);
  return value.trim();
}

export function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: optional('NODE_ENV', 'development') === 'production',
  logLevel: optional('LOG_LEVEL', 'info'),
  appUrl: optional('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  companyName: optional('COMPANY_NAME', 'Our Company'),
  defaultCurrency: optional('DEFAULT_CURRENCY', 'INR'),
  internalApiKey: () => required('INTERNAL_API_KEY'),
};

export const SERVICE_PORTS = {
  gateway: 4000,
  identity: 4001,
  jobs: 4002,
  talent: 4003,
  assessment: 4004,
  interview: 4005,
  offer: 4006,
  onboarding: 4007,
  ai: 4008,
  notification: 4009,
  db: 4010,
} as const;

export type ServiceName = Exclude<keyof typeof SERVICE_PORTS, 'gateway'>;

export function serviceUrl(name: ServiceName): string {
  return optional(`${name.toUpperCase()}_URL`, `http://localhost:${SERVICE_PORTS[name]}`).replace(/\/$/, '');
}

export function servicePort(name: keyof typeof SERVICE_PORTS): number {
  if (name === 'gateway') return Number(optional('GATEWAY_PORT', optional('PORT', '4000')));
  return Number(optional('PORT', String(SERVICE_PORTS[name])));
}
