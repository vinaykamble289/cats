import { AppError, optional, z, type FastifyBaseLoggerLike } from './deps.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const models = {
  main: () => optional('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  fast: () => optional('GROQ_FAST_MODEL', 'llama-3.1-8b-instant'),
};

export function isConfigured(): boolean {
  return !!optional('GROQ_API_KEY');
}

function apiKey(): string {
  const key = optional('GROQ_API_KEY');
  if (!key) throw new AppError(503, 'AI is not configured', 'AI_NOT_CONFIGURED');
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extracts the first JSON object from model output (handles code fences / stray text). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Model did not return JSON');
  }
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

interface ChatOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  fast?: boolean;
  temperature?: number;
  maxTokens?: number;
  log?: FastifyBaseLoggerLike;
}

async function callGroq(model: string, body: Record<string, unknown>, log?: FastifyBaseLoggerLike): Promise<string> {
  const key = apiKey();
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, ...body }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      lastError = (err as Error).message;
      log?.warn({ attempt, err: lastError }, 'Groq request failed');
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new AppError(502, 'AI returned an empty response', 'AI_ERROR');
      return content;
    }
    const text = await res.text().catch(() => '');
    lastError = `${res.status} ${text.slice(0, 300)}`;
    if (res.status === 401 || res.status === 403) throw new AppError(503, 'AI API key is invalid', 'AI_NOT_CONFIGURED');
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20_000) : 1000 * 2 ** attempt;
      log?.warn({ attempt, status: res.status, wait }, 'Groq rate limited / unavailable, retrying');
      await sleep(wait);
      continue;
    }
    // 400 with json_validate_failed etc. - surface for the outer retry
    throw new AppError(502, `AI request failed: ${lastError}`, 'AI_ERROR');
  }
  throw new AppError(503, `AI service is busy, please retry shortly (${lastError})`, 'AI_UNAVAILABLE');
}

/** JSON-mode chat completion validated & normalized with a zod schema. Retries once on invalid output. */
export async function chatJson<T>(opts: ChatOptions<T>): Promise<T> {
  const model = opts.fast ? models.fast() : models.main();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const content = await callGroq(
        model,
        {
          messages: [
            { role: 'system', content: `${opts.system}\n\nRespond with a single valid JSON object only.` },
            { role: 'user', content: opts.user },
          ],
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 2048,
          response_format: { type: 'json_object' },
        },
        opts.log,
      );
      return opts.schema.parse(extractJson(content));
    } catch (err) {
      if (err instanceof AppError && err.code !== 'AI_ERROR') throw err;
      lastErr = err;
      opts.log?.warn({ attempt, err: (err as Error).message }, 'AI output invalid, retrying');
    }
  }
  throw lastErr instanceof AppError ? lastErr : new AppError(502, 'AI returned an invalid response. Please try again.', 'AI_ERROR');
}
