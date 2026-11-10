export interface PublicJob {
  id: string;
  title: string;
  slug: string;
  code: string;
  location: string | null;
  employmentType: string;
  workMode: string;
  experienceMin: number | null;
  experienceMax: number | null;
  publishedAt: string | null;
  skills: (string | { name: string })[];
  description?: string;
}

export const EMPLOYMENT_LABEL: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship' };
export const WORK_MODE_LABEL: Record<string, string> = { onsite: 'On-site', remote: 'Remote', hybrid: 'Hybrid' };

export const skillName = (s: string | { name: string }) => (typeof s === 'string' ? s : s.name);

export function experienceLabel(min: number | null, max: number | null) {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${min}–${max} yrs`;
  if (min !== null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}
