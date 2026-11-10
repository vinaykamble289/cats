import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, CheckCircle2, Clock, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, errorMessage, publicApi } from '@/lib/api';
import { COMPANY_NAME } from '@/lib/format';
import { Markdown } from '@/components/Markdown';
import { PortalMessage, PortalShell } from '@/components/layout/PortalShell';
import { Button, Field, Input, PageLoader, Textarea } from '@/components/ui';
import { FileDrop } from '@/components/portal/FileDrop';
import { EMPLOYMENT_LABEL, WORK_MODE_LABEL, experienceLabel, skillName, type PublicJob } from '@/components/portal/jobs';

const EMPTY = { fullName: '', email: '', phone: '', location: '', linkedinUrl: '', experienceYears: '', noticePeriodDays: '', currentCtc: '', expectedCtc: '', coverNote: '' };

export default function CareerApply() {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState(EMPTY);
  const [resume, setResume] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);

  const { data: job, isLoading, error } = useQuery({ queryKey: ['public', 'careers', slug], queryFn: () => publicApi.get<PublicJob>(`/careers/${slug}`), retry: false });
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!resume) return toast.error('Please attach your resume');
    setBusy(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) if (v.trim()) fd.append(k, v.trim());
      fd.append('resume', resume);
      await publicApi.upload(`/apply/${slug}`, fd);
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast.info(err.message);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading)
    return (
      <PortalShell>
        <PageLoader />
      </PortalShell>
    );
  if (error || !job)
    return (
      <PortalShell>
        <PortalMessage icon={<Briefcase className="size-6" />} title="This role is no longer open">
          <Link to="/careers" className="text-brand-600 underline">
            See all open roles
          </Link>
        </PortalMessage>
      </PortalShell>
    );
  if (done)
    return (
      <PortalShell>
        <PortalMessage icon={<CheckCircle2 className="size-6" />} title="Application received!">
          <p>
            Thanks for applying for <strong>{job.title}</strong>. We've sent a confirmation to {form.email}. Our team reviews every application and will be in touch about next steps.
          </p>
          <Link to="/careers" className="mt-4 inline-block text-brand-600 underline">
            Browse other roles
          </Link>
        </PortalMessage>
      </PortalShell>
    );

  const exp = experienceLabel(job.experienceMin, job.experienceMax);
  return (
    <PortalShell wide>
      <Link to="/careers" className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="size-4" /> All roles
      </Link>
      <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
        <div>
          <p className="text-sm font-medium text-brand-700">{COMPANY_NAME}</p>
          <h1 className="font-display mt-2 text-4xl leading-tight font-normal text-zinc-900">{job.title}</h1>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-zinc-500">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="size-4" /> {job.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Briefcase className="size-4" /> {EMPLOYMENT_LABEL[job.employmentType] ?? job.employmentType} · {WORK_MODE_LABEL[job.workMode] ?? job.workMode}
            </span>
            {exp && (
              <span className="flex items-center gap-1">
                <Clock className="size-4" /> {exp}
              </span>
            )}
          </div>
          {job.skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {job.skills.map((s) => (
                <span key={skillName(s)} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {skillName(s)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
            <Markdown text={job.description} />
          </div>
        </div>

        <form onSubmit={submit} className="h-fit space-y-4 rounded-xl border border-zinc-200 bg-white p-6 lg:sticky lg:top-6">
          <div className="pb-1">
            <h2 className="text-lg font-semibold text-zinc-900">Apply for this role</h2>
            <p className="mt-0.5 text-sm text-zinc-500">Takes about 2 minutes. Fields marked * are required.</p>
          </div>
          <Field label="Resume" required>
            <FileDrop file={resume} onFile={setResume} accept=".pdf,.doc,.docx" maxMb={10} label="Upload your resume" hint="PDF or Word, up to 10 MB" />
          </Field>
          <Field label="Full name" required>
            <Input required value={form.fullName} onChange={set('fullName')} autoComplete="name" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input required type="email" value={form.email} onChange={set('email')} autoComplete="email" />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Current location">
              <Input value={form.location} onChange={set('location')} />
            </Field>
            <Field label="Experience (years)">
              <Input type="number" min={0} step="0.5" value={form.experienceYears} onChange={set('experienceYears')} />
            </Field>
          </div>
          <Field label="LinkedIn profile">
            <Input type="url" value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://linkedin.com/in/…" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Notice (days)">
              <Input type="number" min={0} value={form.noticePeriodDays} onChange={set('noticePeriodDays')} />
            </Field>
            <Field label="Current CTC">
              <Input type="number" min={0} value={form.currentCtc} onChange={set('currentCtc')} />
            </Field>
            <Field label="Expected CTC">
              <Input type="number" min={0} value={form.expectedCtc} onChange={set('expectedCtc')} />
            </Field>
          </div>
          <Field label="Anything you'd like us to know?">
            <Textarea rows={3} value={form.coverNote} onChange={set('coverNote')} />
          </Field>
          <label className="flex items-start gap-2 text-xs text-zinc-500">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree that {COMPANY_NAME} may store and process my data for recruitment purposes.
          </label>
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!consent}>
            Submit application
          </Button>
        </form>
      </div>
    </PortalShell>
  );
}
