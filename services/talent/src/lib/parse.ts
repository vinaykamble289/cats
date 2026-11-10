import { callService } from '@hireflow/shared';
import type { FastifyBaseLogger } from 'fastify';

export interface ParsedProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  experienceYears: number | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  summary: string | null;
  skills: string[];
  education: { degree?: string; institution?: string; year?: string }[];
  experience: { title?: string; company?: string; start?: string; end?: string; highlights?: string[] }[];
  /** true when produced by AI, false for the regex fallback */
  ai: boolean;
}

const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 80 ? Math.round(n * 10) / 10 : null;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{8,16}\d)/;
const LINKEDIN_RE = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i;

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && EMAIL_RE.test(e) ? (EMAIL_RE.exec(e)![0] ?? null) : null;
}

/** Best-effort name from a file name like "John_Doe_Resume.pdf" */
export function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ');
  const cleaned = base.replace(/\b(resume|cv|curriculum vitae|updated|final|latest|new|\d{2,})\b/gi, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'Unknown candidate')
    .split(' ')
    .slice(0, 4)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function fallbackParse(text: string, fileName: string): ParsedProfile {
  const email = normalizeEmail(EMAIL_RE.exec(text)?.[0]);
  const phone = PHONE_RE.exec(text)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const linkedin = LINKEDIN_RE.exec(text)?.[0] ?? null;
  // First non-empty short line often is the name
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l && l.length < 50 && !EMAIL_RE.test(l) && /^[A-Za-z][A-Za-z .'-]+$/.test(l));
  return {
    fullName: firstLine ?? nameFromFileName(fileName),
    email,
    phone,
    location: null,
    currentTitle: null,
    currentCompany: null,
    experienceYears: null,
    linkedinUrl: linkedin ? (linkedin.startsWith('http') ? linkedin : `https://${linkedin}`) : null,
    portfolioUrl: null,
    summary: null,
    skills: [],
    education: [],
    experience: [],
    ai: false,
  };
}

/** Parses resume text into a structured profile using the AI service, falling back to regex extraction. */
export async function parseResume(text: string, fileName: string, log?: FastifyBaseLogger): Promise<ParsedProfile> {
  const fallback = fallbackParse(text, fileName);
  if (text.length < 40) return fallback;
  try {
    const r = await callService<Record<string, unknown>>('ai', '/internal/resume/parse', { method: 'POST', body: { text }, timeoutMs: 60_000 });
    const skills = Array.isArray(r.skills)
      ? [...new Map((r.skills as unknown[]).map((s) => str(s, 60)).filter((s): s is string => !!s).map((s) => [s.toLowerCase(), s])).values()].slice(0, 60)
      : [];
    return {
      fullName: str(r.fullName, 120) ?? fallback.fullName,
      email: normalizeEmail(str(r.email)) ?? fallback.email,
      phone: str(r.phone, 40) ?? fallback.phone,
      location: str(r.location, 120),
      currentTitle: str(r.currentTitle, 150),
      currentCompany: str(r.currentCompany, 150),
      experienceYears: num(r.experienceYears),
      linkedinUrl: str(r.linkedinUrl, 300) ?? fallback.linkedinUrl,
      portfolioUrl: str(r.portfolioUrl, 300),
      summary: str(r.summary, 2000),
      skills,
      education: Array.isArray(r.education) ? (r.education as ParsedProfile['education']).slice(0, 10) : [],
      experience: Array.isArray(r.experience) ? (r.experience as ParsedProfile['experience']).slice(0, 15) : [],
      ai: true,
    };
  } catch (err) {
    log?.warn({ err: (err as Error).message }, 'AI resume parse unavailable, using fallback');
    return fallback;
  }
}
