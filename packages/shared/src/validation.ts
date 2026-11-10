import { z, type ZodTypeAny } from 'zod';

/** Parses input with a zod schema; ZodErrors are turned into 400 responses by the error handler. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: z.string().uuid() });
export const email = z.string().trim().toLowerCase().email().max(254);
export const optionalText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : v));

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export function toLimitOffset(q: { page: number; pageSize: number }) {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

/** Accepts `a,b,c` or repeated query params and returns a string array. */
export const csvList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));
