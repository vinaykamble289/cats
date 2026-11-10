import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Clock, Plus, Send, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiMutation, useJobMap, useJobs } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fromNow } from '@/lib/format';
import type { Paginated, Test } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, SearchInput, Segmented, Select, StatCard, Textarea } from '@/components/ui';

interface InvitationStats {
  byStatus: Record<string, number>;
  passed: number;
  failed: number;
}

function CreateTestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: jobs } = useJobs();
  const [form, setForm] = useState({ title: '', description: '', jobId: '', durationMin: 45, passPercent: 60, proctoringEnabled: true, shuffleQuestions: false });
  const create = useApiMutation(() => api.post<Test>('/tests', { ...form, jobId: form.jobId || null, description: form.description || null }), {
    success: 'Test created',
    invalidate: [['tests']],
    onSuccess: (t) => {
      onClose();
      navigate(`/assessments/${t.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New assessment"
      description="Create the test, then add questions manually or generate them with AI."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!form.title.trim()} onClick={() => create.mutate()}>
            Create test
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Backend Engineer – Technical Test" autoFocus />
        </Field>
        <Field label="Linked job" hint="Used to tailor AI-generated questions and suggest this test in the pipeline.">
          <Select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>
            <option value="">— Not linked —</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} · {j.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description / instructions">
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (minutes)">
            <Input type="number" min={5} max={300} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} />
          </Field>
          <Field label="Pass mark (%)">
            <Input type="number" min={0} max={100} value={form.passPercent} onChange={(e) => setForm({ ...form, passPercent: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Proctoring (full-screen, tab & camera monitoring)" checked={form.proctoringEnabled} onChange={(e) => setForm({ ...form, proctoringEnabled: e.target.checked })} />
          <Checkbox label="Shuffle questions" checked={form.shuffleQuestions} onChange={(e) => setForm({ ...form, shuffleQuestions: e.target.checked })} />
        </div>
      </div>
    </Modal>
  );
}

export default function TestsList() {
  const { isHR } = useAuth();
  const jobMap = useJobMap();
  const [status, setStatus] = useState<'all' | 'active' | 'draft' | 'archived'>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const tests = useQuery({ queryKey: ['tests', { status }], queryFn: () => api.get<Paginated<Test>>('/tests', { status: status === 'all' ? undefined : status }) });
  const stats = useQuery({ queryKey: ['invitations', 'stats'], queryFn: () => api.get<InvitationStats>('/invitations/stats') });

  const filtered = useMemo(() => (tests.data?.data ?? []).filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())), [tests.data, q]);
  const s = stats.data;
  const inProgress = (s?.byStatus.invited ?? 0) + (s?.byStatus.started ?? 0);

  return (
    <div>
      <PageHeader
        title="Assessments"
        subtitle="Online tests with AI-generated questions, auto-grading and proctoring"
        actions={isHR && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New test</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tests" value={tests.data?.total ?? '—'} icon={<ClipboardCheck className="size-5" />} />
        <StatCard label="Awaiting candidates" value={s ? inProgress : '—'} icon={<Send className="size-5" />} tone="sky" />
        <StatCard label="Passed" value={s?.passed ?? '—'} icon={<CheckCircle2 className="size-5" />} tone="green" />
        <StatCard label="Failed" value={s?.failed ?? '—'} icon={<XCircle className="size-5" />} tone="rose" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'draft', label: 'Draft' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Search tests…" className="w-full sm:w-72" />
      </div>

      {tests.isLoading ? (
        <PageLoader />
      ) : tests.error ? (
        <ErrorState error={tests.error} onRetry={() => tests.refetch()} />
      ) : !filtered.length ? (
        <EmptyState
          icon={<ClipboardCheck className="size-5" />}
          title="No tests yet"
          description="Create a test and let AI draft questions from the job description."
          action={isHR && <Button icon={<Sparkles className="size-4" />} onClick={() => setCreating(true)}>Create first test</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => {
            const job = t.jobId ? jobMap.get(t.jobId) : undefined;
            return (
              <Link key={t.id} to={`/assessments/${t.id}`}>
                <Card className="h-full transition hover:border-zinc-300 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-zinc-900">{t.title}</h3>
                    <StatusBadge value={t.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-zinc-500">{job ? `${job.code} · ${job.title}` : 'Not linked to a job'}</p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <ClipboardCheck className="size-3.5" /> {t.questionCount} questions · {t.totalPoints} pts
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {t.durationMin} min
                    </span>
                    <span>Pass {t.passPercent}%</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                    <span>{t.invitationCount} invited</span>
                    <span>Updated {fromNow(t.updatedAt)}</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <CreateTestModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
