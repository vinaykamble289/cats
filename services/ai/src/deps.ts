export { AppError, optional, z } from '@hireflow/shared';

/** Minimal logger shape (fastify's req.log satisfies it). */
export interface FastifyBaseLoggerLike {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}
