import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import proxy from '@fastify/http-proxy';
import {
  env,
  INTERNAL_KEY_HEADER,
  loggerOptions,
  optional,
  registerErrorHandler,
  servicePort,
  serviceUrl,
  USER_HEADERS,
  type ServiceName,
} from '@hireflow/shared';
import { authenticate, invalidateUserCache } from './auth.js';

/** Authenticated routes: /api/<prefix>/* -> <service>/<prefix>/* */
const PRIVATE_ROUTES: [prefix: string, service: ServiceName][] = [
  ['/me', 'identity'],
  ['/users', 'identity'],
  ['/departments', 'identity'],
  ['/jobs', 'jobs'],
  ['/candidates', 'talent'],
  ['/applications', 'talent'],
  ['/reviews', 'talent'],
  ['/tests', 'assessment'],
  ['/invitations', 'assessment'],
  ['/rounds', 'interview'],
  ['/offers', 'offer'],
  ['/onboarding', 'onboarding'],
  ['/bgv-vendors', 'onboarding'],
  ['/document-types', 'onboarding'],
  ['/ai', 'ai'],
  ['/emails', 'notification'],
  ['/templates', 'notification'],
  ['/activity', 'notification'],
];

/** Candidate-facing routes (token based, no login): /api/public/<prefix>/* -> <service>/public/<prefix>/* */
const PUBLIC_ROUTES: [prefix: string, service: ServiceName][] = [
  ['/careers', 'jobs'],
  ['/apply', 'talent'],
  ['/assessment', 'assessment'],
  ['/interview', 'interview'],
  ['/offer', 'offer'],
  ['/onboarding', 'onboarding'],
];

const SERVICES: ServiceName[] = ['db', 'identity', 'jobs', 'talent', 'assessment', 'interview', 'offer', 'onboarding', 'ai', 'notification'];

function stripSpoofableHeaders<H extends Record<string, string | string[] | undefined>>(headers: H): H {
  const out: Record<string, string | string[] | undefined> = { ...headers };
  delete out[INTERNAL_KEY_HEADER];
  for (const h of Object.values(USER_HEADERS)) delete out[h];
  delete out.authorization;
  return out as H;
}

async function main() {
  const app = Fastify({ logger: loggerOptions('gateway'), trustProxy: true, bodyLimit: 25 * 1024 * 1024 });
  registerErrorHandler(app);

  const origins = optional('CORS_ORIGINS', env.appUrl).split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  app.get('/health', async () => ({ status: 'ok', service: 'gateway', uptime: Math.round(process.uptime()) }));

  // Aggregated health of every service (used by the Settings > System status page)
  app.get('/api/system/health', async () => {
    const results = await Promise.all(
      SERVICES.map(async (name) => {
        const started = Date.now();
        try {
          const res = await fetch(`${serviceUrl(name)}/health`, { signal: AbortSignal.timeout(3000) });
          return { name, ok: res.ok, latencyMs: Date.now() - started };
        } catch {
          return { name, ok: false, latencyMs: Date.now() - started };
        }
      }),
    );
    return { services: results };
  });

  const internalKey = env.internalApiKey();

  // ---------- Authenticated API ----------
  await app.register(async (scope: FastifyInstance) => {
    await scope.register(rateLimit, {
      max: 600,
      timeWindow: '1 minute',
      keyGenerator: (req) => (req as FastifyRequest).headers.authorization?.slice(-32) ?? req.ip,
    });

    scope.addHook('onRequest', async (req) => {
      if (req.method === 'OPTIONS') return;
      req.user = await authenticate(req.headers.authorization);
    });

    // Role changes must be visible immediately
    scope.addHook('onResponse', async (req, reply) => {
      if (req.url.startsWith('/api/users') && req.method !== 'GET' && reply.statusCode < 300) invalidateUserCache();
    });

    for (const [prefix, service] of PRIVATE_ROUTES) {
      await scope.register(proxy, {
        upstream: serviceUrl(service),
        prefix: `/api${prefix}`,
        rewritePrefix: prefix,
        http: { requestOptions: { timeout: 120_000 } },
        replyOptions: {
          rewriteRequestHeaders: (req, headers) => {
            const user = (req as FastifyRequest).user!;
            return {
              ...stripSpoofableHeaders(headers),
              [INTERNAL_KEY_HEADER]: internalKey,
              [USER_HEADERS.id]: user.id,
              [USER_HEADERS.email]: user.email,
              [USER_HEADERS.role]: user.role,
              [USER_HEADERS.name]: encodeURIComponent(user.name),
            };
          },
        },
      });
    }
  });

  // ---------- Public candidate portal API ----------
  await app.register(async (scope: FastifyInstance) => {
    await scope.register(rateLimit, { max: 120, timeWindow: '1 minute' });
    for (const [prefix, service] of PUBLIC_ROUTES) {
      await scope.register(proxy, {
        upstream: serviceUrl(service),
        prefix: `/api/public${prefix}`,
        rewritePrefix: `/public${prefix}`,
        http: { requestOptions: { timeout: 120_000 } },
        replyOptions: { rewriteRequestHeaders: (_req, headers) => stripSpoofableHeaders(headers) },
      });
    }
  });

  const port = servicePort('gateway');
  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
