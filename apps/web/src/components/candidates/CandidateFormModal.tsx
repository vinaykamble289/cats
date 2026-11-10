import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useApiMutation, useJobs } from '@/lib/hooks';
import type { Candidate } from '@/lib/types';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { SkillsInput, type SkillItem } from '@/components/jobs/SkillsInput';
import { toast } from 'sonner';

const SOURCES = ['manual_upload', 'referral', 'linkedin', 'job_board', 'agency', 'career_page', 'email', 'other'];
const SOURCE_LABEL: Record<string, string> = {
  manual_upload: 'Manual entry',
  referral: 'Referral',
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  agency: 'Agency',
  career_page: 'Career page',
  email: 'Email',
  bulk_upload: 'Bulk upload',
  other: 'Other',
};
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

type Form = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  experienceYears: string;
  linkedinUrl: string;
  portfolioUrl: string;
  summary: string;
  source: string;
  sourceDetail: string;
  noticePeriodDays: string;
  currentCtc: string;
  expectedCtc: string;
};

const empty: Form = {
  fullName: '',
  email: '',
  phone: '',
  location: '',
  currentTitle: '',
  currentCompany: '',
  experienceYears: '',
  linkedinUrl: '',
  portfolioUrl: '',
  summary: '',
  source: 'manual_upload',
  sourceDetail: '',
  noticePeriodDays: '',
  currentCtc: '',
  expectedCtc: '',
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const str = (v: string) => (v.trim() === '' ? null : v.trim());

/** Create (candidate undefined) or edit a candidate profile. */
export function CandidateFormModal({ open, onClose, candidate, defaultJobId }: { open: boolean; onClose: () => void; candidate?: Candidate; defaultJobId?: string }) {
  const navigate = useNavigate();
  const { data: jobs } = useJobs();
  const [form, setForm] = useState<Form>(empty);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [jobId, setJobId] = useState(defaultJobId ?? '');

  useEffect(() => {
    if (!open) return;
    if (candidate) {
      const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
      setForm({
        fullName: candidate.fullName,
        email: candidate.email,
        phone: s(candidate.phone),
        location: s(candidate.location),
        currentTitle: s(candidate.currentTitle),
        currentCompany: s(candidate.currentCompany),
        experienceYears: s(candidate.experienceYears),
        linkedinUrl: s(candidate.linkedinUrl),
        portfolioUrl: s(candidate.portfolioUrl),
        summary: s(candidate.summary),
        source: candidate.source,
        sourceDetail: s(candidate.sourceDetail),
        noticePeriodDays: s(candidate.noticePeriodDays),
        currentCtc: s(candidate.currentCtc),
        expectedCtc: s(candidate.expectedCtc),
      });
      setSkills(candidate.skills.map((name) => ({ name, isRequired: true })));
    } else {
      setForm(empty);
      setSkills([]);
      setJobId(defaultJobId ?? '');
    }
  }, [open, candidate, defaultJobId]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const body = () => ({
    fullName: form.fullName.trim(),
    email: form.email.trim().toLowerCase(),
    phone: str(form.phone),
    location: str(form.location),
    currentTitle: str(form.currentTitle),
    currentCompany: str(form.currentCompany),
    experienceYears: num(form.experienceYears),
    linkedinUrl: str(form.linkedinUrl),
    portfolioUrl: str(form.portfolioUrl),
    summary: str(form.summary),
    source: form.source,
    sourceDetail: str(form.sourceDetail),
    noticePeriodDays: num(form.noticePeriodDays),
    currentCtc: num(form.currentCtc),
    expectedCtc: num(form.expectedCtc),
    skills: skills.map((s) => s.name),
  });

  const save = useApiMutation(
    async () => {
      if (candidate) return api.patch<Candidate>(`/candidates/${candidate.id}`, body());
      try {
        return await api.post<Candidate>('/candidates', { ...body(), jobId: jobId || undefined });
      } catch (err) {
        const existing = err instanceof ApiError && err.status === 409 ? (err.details as { candidateId?: string } | undefined)?.candidateId : undefined;
        if (existing) {
          toast.info('A candidate with this email already exists', { action: { label: 'Open', onClick: () => navigate(`/candidates/${existing}`) } });
        }
        throw err;
      }
    },
    {
      success: candidate ? 'Candidate updated' : 'Candidate added',
      invalidate: [['candidates'], ['applications']],
      onSuccess: (res) => {
        onClose();
        if (!candidate && res) navigate(`/candidates/${(res as Candidate).id}`);
      },
    },
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={candidate ? 'Edit candidate' : 'Add candidate'}
      description={candidate ? undefined : 'Tip: uploading a resume fills this in automatically with AI.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!form.fullName.trim() || !form.email.trim()} onClick={() => save.mutate()}>
            {candidate ? 'Save changes' : 'Add candidate'}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Full name" required>
          <Input value={form.fullName} onChange={set('fullName')} autoFocus />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Current title">
          <Input value={form.currentTitle} onChange={set('currentTitle')} />
        </Field>
        <Field label="Current company">
          <Input value={form.currentCompany} onChange={set('currentCompany')} />
        </Field>
        <Field label="Experience (years)">
          <Input type="number" min={0} step={0.5} value={form.experienceYears} onChange={set('experienceYears')} />
        </Field>
        <Field label="Notice period (days)">
          <Input type="number" min={0} value={form.noticePeriodDays} onChange={set('noticePeriodDays')} />
        </Field>
        <Field label="Current CTC">
          <Input type="number" min={0} value={form.currentCtc} onChange={set('currentCtc')} />
        </Field>
        <Field label="Expected CTC">
          <Input type="number" min={0} value={form.expectedCtc} onChange={set('expectedCtc')} />
        </Field>
        <Field label="LinkedIn URL">
          <Input value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Portfolio / GitHub">
          <Input value={form.portfolioUrl} onChange={set('portfolioUrl')} />
        </Field>
        <Field label="Source">
          <Select value={form.source} onChange={set('source')}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source detail" hint="e.g. referrer name, agency">
          <Input value={form.sourceDetail} onChange={set('sourceDetail')} />
        </Field>
        <Field label="Skills" className="sm:col-span-2">
          <SkillsInput value={skills} onChange={setSkills} withRequired={false} />
        </Field>
        <Field label="Summary" className="sm:col-span-2">
          <Textarea rows={3} value={form.summary} onChange={set('summary')} />
        </Field>
        {!candidate && (
          <Field label="Add to job" className="sm:col-span-2">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">— Talent pool only —</option>
              {(jobs ?? [])
                .filter((j) => j.status !== 'closed' && j.status !== 'filled')
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} ({j.code})
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
