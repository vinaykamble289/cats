import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { env, servicePort, type SERVICE_PORTS } from './env.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import { ROLES, type AuthUser, type Role } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The end user (set by the gateway). Undefined for internal and public calls. */
    user?: AuthUser;
  }
}

export const INTERNAL_KEY_HEADER = 'x-internal-key';
export const USER_HEADERS = {
  id: 'x-user-id',
  email: 'x-user-email',
  role: 'x-user-role',
  name: 'x-user-name',
} as const;

export function loggerOptions(name: string): FastifyServerOptions['logger'] {
  return {
    level: env.logLevel,
    base: { service: name },
    redact: ['req.headers.authorization', `req.headers["${INTERNAL_KEY_HEADER}"]`],
    ...(env.isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' } } }),
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isPublicPath(url: string): boolean {
  return url.startsWith('/public/') || url === '/health' || url.startsWith('/health?');
}

/** Registers a consistent JSON error format: { error: { code, message, details? } } */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: err.issues[0] ? `${err.issues[0].path.join('.') || 'body'}: ${err.issues[0].message}` : 'Invalid input', details: err.issues },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    // Postgres errors
    if (typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && err.severity) {
      if (err.code === '23505') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A record with these details already exists', details: err.detail } });
      if (err.code === '23503') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Referenced record does not exist or is still in use' } });
      if (err.code === '23514') return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: `Invalid value (${err.constraint_name ?? 'constraint'})` } });
      if (err.code === '22P02') return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid identifier or value format' } });
    }
    if (err?.validation) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'Unhandled error');
    return reply.status(status).send({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'ERROR', message: status === 500 ? 'Something went wrong' : err.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } }));
}

export interface ServiceOptions {
  name: keyof typeof SERVICE_PORTS;
  /** Register routes. Paths: `/public/*` (no auth, token based), `/internal/*` (service-to-service), everything else = end user via gateway. */
  routes: (app: FastifyInstance) => Promise<void> | void;
  /** Health probe (e.g. `select 1`). */
  healthCheck?: () => Promise<unknown>;
  /** Enable multipart uploads (max file size in MB). */
  multipartMaxMb?: number;
  /** JSON body limit in MB (default 2). */
  bodyLimitMb?: number;
  /** Background workers - started after listen, receive an AbortSignal for shutdown. */
  workers?: ((signal: AbortSignal, app: FastifyInstance) => void)[];
  onClose?: () => Promise<void>;
}

/**
 * Boots a microservice with:
 * - internal-key authentication on every non-public route
 * - end-user context from gateway headers (req.user)
 * - consistent errors, health endpoint, graceful shutdown
 */
export async function startService(opts: ServiceOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(opts.name),
    trustProxy: true,
    bodyLimit: (opts.bodyLimitMb ?? 2) * 1024 * 1024,
    disableRequestLogging: env.isProd,
  });
  const internalKey = env.internalApiKey();

  registerErrorHandler(app);
  if (opts.multipartMaxMb) {
    await app.register(multipart, { limits: { fileSize: opts.multipartMaxMb * 1024 * 1024, files: 20 } });
  }

  app.addHook('onRequest', async (req) => {
    if (isPublicPath(req.url)) return;
    const key = req.headers[INTERNAL_KEY_HEADER];
    if (typeof key !== 'string' || !safeEqual(key, internalKey)) throw unauthorized('Invalid internal credentials');
    const id = req.headers[USER_HEADERS.id];
    const role = req.headers[USER_HEADERS.role];
    if (typeof id === 'string' && typeof role === 'string' && (ROLES as readonly string[]).includes(role)) {
      req.user = {
        id,
        role: role as Role,
        email: String(req.headers[USER_HEADERS.email] ?? ''),
        name: decodeURIComponent(String(req.headers[USER_HEADERS.name] ?? '')),
      };
    }
    // Non-internal, non-public routes are end-user routes and need a user.
    if (!req.url.startsWith('/internal/') && !req.user) throw unauthorized();
  });

  app.get('/health', async (_req, reply) => {
    try {
      await opts.healthCheck?.();
      return { status: 'ok', service: opts.name, uptime: Math.round(process.uptime()) };
    } catch (err) {
      return reply.status(503).send({ status: 'error', service: opts.name, error: (err as Error).message });
    }
  });

  await app.register(async (scope) => opts.routes(scope));

  const controller = new AbortController();
  const port = servicePort(opts.name);
  await app.listen({ port, host: '0.0.0.0' });

  for (const worker of opts.workers ?? []) worker(controller.signal, app);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'Shutting down');
    controller.abort();
    const timer = setTimeout(() => process.exit(1), 10_000);
    try {
      await app.close();
      await opts.onClose?.();
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => app.log.error({ err }, 'Unhandled promise rejection'));

  return app;
}

/** Returns the authenticated end user or throws 401. */
export function getUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Ensures the end user has one of the given roles (admins always pass). */
export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const user = getUser(req);
  if (user.role !== 'admin' && !roles.includes(user.role)) throw forbidden();
  return user;
}

/** Background loop helper: runs `fn` every `intervalMs` until aborted; errors are logged, never crash. */
export function every(intervalMs: number, fn: () => Promise<unknown>, log: FastifyInstance['log'], label: string) {
  return (signal: AbortSignal) => {
    let timer: NodeJS.Timeout | undefined;
    const tick = async () => {
      if (signal.aborted) return;
      try {
        await fn();
      } catch (err) {
        log.error({ err }, `${label} failed`);
      }
      if (!signal.aborted) timer = setTimeout(tick, intervalMs);
    };
    signal.addEventListener('abort', () => timer && clearTimeout(timer));
    timer = setTimeout(tick, 1000);
  };
}
