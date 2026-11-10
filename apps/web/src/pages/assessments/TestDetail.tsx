import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, MoreHorizontal, Plus, RotateCw, Save, Send, Sparkles, Trash2, UserPlus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiMutation, useJobMap, useJobs } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, scoreTone } from '@/lib/format';
import type { Application, Invitation, Paginated, Question, QuestionType, Test } from '@/lib/types';
import { StatusBadge, StageBadge } from '@/components/StatusBadge';
import { QUESTION_TYPE_LABEL, QuestionCard, blankQuestion, isChoice } from '@/components/assessments/QuestionEditor';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Menu,
  Modal,
  PageHeader,
  PageLoader,
  Segmented,
  Select,
  Spinner,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cx,
} from '@/components/ui';

type Tab = 'questions' | 'invitations' | 'settings';

function validate(questions: Question[]): string | null {
  for (const [i, q] of questions.entries()) {
    if (!q.prompt.trim()) return `Question ${i + 1} has no prompt`;
    if (isChoice(q.type)) {
      if (q.options.some((o) => !o.trim())) return `Question ${i + 1} has an empty option`;
      if (!q.correctOptions.length) return `Question ${i + 1} needs a correct answer`;
    }
  }
  return null;
}

function GenerateModal({ open, onClose, test, dirty }: { open: boolean; onClose: () => void; test: Test; dirty: boolean }) {
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [types, setTypes] = useState<QuestionType[]>(['mcq', 'multi_select', 'short_text']);
  const [topics, setTopics] = useState('');
  const [append, setAppend] = useState(true);
  const gen = useApiMutation(() => api.post<Test>(`/tests/${test.id}/generate`, { count, difficulty, types, topics: topics || undefined, append }), {
    success: (t) => `Generated questions · ${t.questionCount} total`,
    invalidate: [['tests']],
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-violet-600" /> Generate questions with AI
        </span>
      }
      description={test.jobId ? 'Questions are tailored to the linked job description and skills.' : 'Tip: link a job to tailor questions to its description.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={gen.isPending}>
            Cancel
          </Button>
          <Button loading={gen.isPending} disabled={!types.length} onClick={() => gen.mutate()} icon={<Sparkles className="size-4" />}>
            {gen.isPending ? 'Generating…' : 'Generate'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {dirty && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">You have unsaved question edits. They will be replaced by the server version after generating.</p>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Number of questions">
            <Input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Difficulty">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
        </div>
        <Field label="Question types">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
              <Checkbox key={t} label={QUESTION_TYPE_LABEL[t]} checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} />
            ))}
          </div>
        </Field>
        <Field label="Focus topics (optional)">
          <Textarea rows={2} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. SQL joins, REST API design, system design basics" />
        </Field>
        <Segmented
          value={append ? 'append' : 'replace'}
          onChange={(v) => setAppend(v === 'append')}
          options={[
            { value: 'append', label: 'Add to existing' },
            { value: 'replace', label: 'Replace all' },
          ]}
        />
      </div>
    </Modal>
  );
}

function InviteFromJobModal({ open, onClose, test }: { open: boolean; onClose: () => void; test: Test }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState(3);
  const { data, isLoading } = useQuery({
    queryKey: ['applications', { jobId: test.jobId, status: 'active' }],
    queryFn: () => api.get<Paginated<Application>>('/applications', { jobId: test.jobId!, status: 'active', pageSize: 500 }),
    enabled: open && !!test.jobId,
  });
  const apps = useMemo(() => {
    const order = ['shortlisted', 'screening', 'applied', 'assessment'];
    return [...(data?.data ?? [])].filter((a) => order.includes(a.stage)).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  }, [data]);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);
  const invite = useApiMutation(() => api.post<{ created: number; skipped: number; errors: { error: string }[] }>('/invitations', { testId: test.id, applicationIds: selected, expiresInDays: days }), {
    success: (r) => `${r.created} sent${r.skipped ? `, ${r.skipped} skipped` : ''}${r.errors.length ? `, ${r.errors.length} failed` : ''}`,
    invalidate: [['invitations'], ['applications'], ['tests']],
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Invite candidates"
      description="Candidates from the linked job who haven't taken an assessment yet."
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-sm text-zinc-600">
            Valid for
            <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value) || 3)} className="h-8 w-16" /> days
          </div>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={invite.isPending} disabled={!selected.length} onClick={() => invite.mutate()} icon={<Send className="size-4" />}>
            Invite {selected.length || ''}
          </Button>
        </>
      }
    >
      {!test.jobId ? (
        <EmptyState title="This test is not linked to a job" description="Link a job in Settings, or send this test from a job pipeline." />
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !apps.length ? (
        <EmptyState title="No eligible candidates" description="Shortlist candidates in the job pipeline first." />
      ) : (
        <div className="space-y-1">
          <Checkbox
            className="mb-2"
            label="Select all"
            checked={selected.length === apps.length}
            onChange={(e) => setSelected(e.target.checked ? apps.map((a) => a.id) : [])}
          />
          {apps.map((a) => (
            <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-zinc-50">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={selected.includes(a.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((x) => x !== a.id))}
              />
              <Avatar name={a.candidate.fullName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.candidate.fullName}</p>
                <p className="truncate text-xs text-zinc-500">{a.candidate.email}</p>
              </div>
              {a.aiMatchScore !== null && <span className={cx('text-xs font-semibold', scoreTone(a.aiMatchScore))}>{a.aiMatchScore}% match</span>}
              <StageBadge stage={a.stage} />
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

function SettingsForm({ test }: { test: Test }) {
  const { data: jobs } = useJobs();
  const [f, setF] = useState({
    title: test.title,
    description: test.description ?? '',
    jobId: test.jobId ?? '',
    durationMin: test.durationMin,
    passPercent: test.passPercent,
    proctoringEnabled: test.proctoringEnabled,
    shuffleQuestions: test.shuffleQuestions,
  });
  const save = useApiMutation(() => api.patch<Test>(`/tests/${test.id}`, { ...f, jobId: f.jobId || null, description: f.description || null }), {
    success: 'Settings saved',
    invalidate: [['tests']],
  });
  return (
    <Card className="max-w-2xl">
      <div className="space-y-4">
        <Field label="Title" required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Linked job">
          <Select value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}>
            <option value="">— Not linked —</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} · {j.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Instructions shown to candidates">
          <Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Duration (minutes)">
            <Input type="number" min={5} max={300} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />
          </Field>
          <Field label="Pass mark (%)">
            <Input type="number" min={0} max={100} value={f.passPercent} onChange={(e) => setF({ ...f, passPercent: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Proctoring enabled" checked={f.proctoringEnabled} onChange={(e) => setF({ ...f, proctoringEnabled: e.target.checked })} />
          <Checkbox label="Shuffle questions" checked={f.shuffleQuestions} onChange={(e) => setF({ ...f, shuffleQuestions: e.target.checked })} />
        </div>
        <div className="flex justify-end">
          <Button loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()} icon={<Save className="size-4" />}>
            Save settings
          </Button>
        </div>
      </div>
    </Card>
  );
}

function InvitationsTab({ test }: { test: Test }) {
  const navigate = useNavigate();
  const { isHR } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['invitations', { testId: test.id }],
    queryFn: () => api.get<Paginated<Invitation>>('/invitations', { testId: test.id, pageSize: 200 }),
    refetchInterval: 20_000,
  });
  const action = useApiMutation(({ id, op }: { id: string; op: 'resend' | 'cancel' }) => api.post(`/invitations/${id}/${op}`), {
    success: 'Done',
    invalidate: [['invitations']],
  });
  if (isLoading) return <PageLoader />;
  if (!data?.data.length) return <EmptyState icon={<Send className="size-5" />} title="No invitations yet" description="Invite candidates from the linked job or from a job pipeline." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Candidate</Th>
          <Th>Status</Th>
          <Th>Score</Th>
          <Th>Integrity</Th>
          <Th>Submitted</Th>
          <Th>Expires</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {data.data.map((inv) => (
          <Tr key={inv.id} onClick={() => navigate(`/assessments/results/${inv.id}`)}>
            <Td>
              <div className="flex items-center gap-3">
                <Avatar name={inv.candidateName} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-900">{inv.candidateName}</p>
                  <p className="truncate text-xs text-zinc-500">{inv.candidateEmail}</p>
                </div>
              </div>
            </Td>
            <Td>
              <div className="flex items-center gap-1.5">
                <StatusBadge value={inv.status} />
                {inv.passed !== null && <Badge tone={inv.passed ? 'green' : 'red'}>{inv.passed ? 'Passed' : 'Failed'}</Badge>}
              </div>
            </Td>
            <Td>{inv.percent !== null ? <span className={cx('font-semibold', scoreTone(inv.percent))}>{Math.round(inv.percent)}%</span> : '—'}</Td>
            <Td>{inv.integrityScore !== null ? <span className={cx('font-medium', scoreTone(inv.integrityScore))}>{inv.integrityScore}</span> : '—'}</Td>
            <Td className="text-xs whitespace-nowrap">{fmtDateTime(inv.submittedAt)}</Td>
            <Td className="text-xs whitespace-nowrap">{fmtDate(inv.expiresAt)}</Td>
            <Td>
              {isHR && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Menu
                    trigger={<Button size="xs" variant="ghost" icon={<MoreHorizontal className="size-4" />} />}
                    items={[
                      { label: 'Resend link', icon: <RotateCw className="size-4" />, onClick: () => action.mutate({ id: inv.id, op: 'resend' }), disabled: !['invited', 'expired', 'started'].includes(inv.status) },
                      { label: 'Cancel invitation', icon: <XCircle className="size-4" />, danger: true, onClick: () => action.mutate({ id: inv.id, op: 'cancel' }), disabled: !['invited', 'started'].includes(inv.status) },
                    ]}
                  />
                </div>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function TestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isHR } = useAuth();
  const jobMap = useJobMap();
  const [tab, setTab] = useState<Tab>('questions');
  const [draft, setDraft] = useState<Question[] | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const q = useQuery({ queryKey: ['tests', id], queryFn: () => api.get<Test>(`/tests/${id}`) });
  const test = q.data;

  // Reset local draft whenever server data changes and there are no local edits
  useEffect(() => {
    if (test) setDraft(null);
  }, [test]);

  const questions = draft ?? test?.questions ?? [];
  const dirty = draft !== null;

  const saveQuestions = useApiMutation((qs: Question[]) => api.put<Test>(`/tests/${id}/questions`, { questions: qs.map(({ id: _i, position: _p, ...rest }) => rest) }), {
    success: 'Questions saved',
    invalidate: [['tests']],
  });
  const setStatus = useApiMutation((status: Test['status']) => api.patch<Test>(`/tests/${id}`, { status }), { success: 'Status updated', invalidate: [['tests']] });
  const remove = useApiMutation(() => api.delete(`/tests/${id}`), { success: 'Test removed', invalidate: [['tests']], onSuccess: () => navigate('/assessments') });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !test) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const job = test.jobId ? jobMap.get(test.jobId) : undefined;
  const totalPoints = questions.reduce((s, x) => s + (x.points || 0), 0);
  const update = (i: number, nq: Question) => setDraft(questions.map((x, j) => (j === i ? nq : x)));
  const move = (i: number, dir: -1 | 1) => {
    const arr = [...questions];
    [arr[i], arr[i + dir]] = [arr[i + dir], arr[i]];
    setDraft(arr);
  };

  return (
    <div>
      <PageHeader
        back={
          <Link to="/assessments" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Assessments
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {test.title} <StatusBadge value={test.status} />
          </span>
        }
        subtitle={
          <>
            {job ? (
              <Link to={`/jobs/${job.id}`} className="hover:underline">
                {job.code} · {job.title}
              </Link>
            ) : (
              'Not linked to a job'
            )}{' '}
            · {test.durationMin} min · pass {test.passPercent}% · {test.proctoringEnabled ? 'proctored' : 'not proctored'}
          </>
        }
        actions={
          isHR && (
            <>
              {test.status !== 'active' ? (
                <Button
                  variant="success"
                  onClick={() => (test.questionCount ? setStatus.mutate('active') : toast.error('Add and save questions before activating'))}
                  loading={setStatus.isPending}
                >
                  Activate
                </Button>
              ) : (
                <Button variant="outline" icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
                  Invite candidates
                </Button>
              )}
              <Menu
                trigger={<Button variant="outline" icon={<MoreHorizontal className="size-4" />} />}
                items={[
                  test.status === 'active' && { label: 'Move to draft', onClick: () => setStatus.mutate('draft') },
                  test.status !== 'archived' && { label: 'Archive', icon: <Archive className="size-4" />, onClick: () => setStatus.mutate('archived') },
                  { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => setConfirmDelete(true) },
                ]}
              />
            </>
          )
        }
      />

      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'questions', label: 'Questions', count: questions.length },
          { value: 'invitations', label: 'Candidates', count: test.invitationCount },
          ...(isHR ? [{ value: 'settings' as Tab, label: 'Settings' }] : []),
        ]}
      />

      {tab === 'questions' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            {questions.length === 0 ? (
              <EmptyState
                title="No questions yet"
                description="Generate a full question set from the job description in seconds, or write your own."
                action={
                  isHR && (
                    <div className="flex gap-2">
                      <Button icon={<Sparkles className="size-4" />} onClick={() => setGenOpen(true)}>
                        Generate with AI
                      </Button>
                      <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => setDraft([blankQuestion()])}>
                        Add manually
                      </Button>
                    </div>
                  )
                }
              />
            ) : (
              questions.map((qq, i) => (
                <QuestionCard
                  key={qq.id ?? `new-${i}`}
                  q={qq}
                  index={i}
                  total={questions.length}
                  editable={isHR}
                  onChange={(nq) => update(i, nq)}
                  onRemove={() => setDraft(questions.filter((_, j) => j !== i))}
                  onMove={(d) => move(i, d)}
                />
              ))
            )}
            {isHR && questions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(['mcq', 'multi_select', 'short_text', 'long_text', 'code'] as QuestionType[]).map((t) => (
                  <Button key={t} size="sm" variant="outline" icon={<Plus className="size-3.5" />} onClick={() => setDraft([...questions, blankQuestion(t)])}>
                    {QUESTION_TYPE_LABEL[t]}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card>
              <CardHeader title="Summary" />
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Questions</dt>
                  <dd className="font-medium">{questions.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Total points</dt>
                  <dd className="font-medium">{totalPoints}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Auto-graded</dt>
                  <dd className="font-medium">{questions.filter((x) => isChoice(x.type)).length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">AI-graded</dt>
                  <dd className="font-medium">{questions.filter((x) => !isChoice(x.type)).length}</dd>
                </div>
              </dl>
              {isHR && (
                <div className="mt-4 space-y-2">
                  <Button
                    className="w-full"
                    disabled={!dirty}
                    loading={saveQuestions.isPending}
                    icon={<Save className="size-4" />}
                    onClick={() => {
                      const err = validate(questions);
                      if (err) return toast.error(err);
                      saveQuestions.mutate(questions);
                    }}
                  >
                    {dirty ? 'Save changes' : 'All changes saved'}
                  </Button>
                  {dirty && (
                    <Button className="w-full" variant="ghost" onClick={() => setDraft(null)}>
                      Discard changes
                    </Button>
                  )}
                  <Button className="w-full" variant="outline" icon={<Sparkles className="size-4 text-violet-600" />} onClick={() => setGenOpen(true)}>
                    Generate with AI
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'invitations' && <InvitationsTab test={test} />}
      {tab === 'settings' && isHR && <SettingsForm key={test.updatedAt} test={test} />}

      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} test={test} dirty={dirty} />
      <InviteFromJobModal open={inviteOpen} onClose={() => setInviteOpen(false)} test={test} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutateAsync()}
        danger
        title="Delete this test?"
        message="Tests with invitations are archived instead of deleted, so candidate results are kept."
        confirmLabel="Delete"
      />
    </div>
  );
}
