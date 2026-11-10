import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, ClipboardCheck, Hourglass, Maximize, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, errorMessage, publicApi } from '@/lib/api';
import { PortalMessage, PortalShell } from '@/components/layout/PortalShell';
import { Button, Modal, PageLoader, Spinner, Textarea, cx } from '@/components/ui';
import { CameraPreview, ProctorWarning, enterFullscreen, exitFullscreen, formatClock, useCamera, useCountdown, useProctoring } from '@/components/portal/proctoring';
import type { QuestionType } from '@/lib/types';

interface PortalQuestion {
  id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  points: number;
}

interface AssessmentState {
  status: 'invited' | 'started' | 'submitted' | 'graded' | 'expired' | 'cancelled';
  candidateName: string;
  companyName: string;
  expiresAt: string;
  startedAt: string | null;
  deadlineAt: string | null;
  serverTime: string;
  test: { title: string; description: string | null; durationMin: number; questionCount: number; proctoringEnabled: boolean };
  questions?: PortalQuestion[];
  answers?: Record<string, unknown>;
}

type Answers = Record<string, unknown>;

function isAnswered(v: unknown) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function QuestionInput({ q, value, onChange }: { q: PortalQuestion; value: unknown; onChange: (v: unknown) => void }) {
  if (q.type === 'mcq' || q.type === 'multi_select') {
    const multi = q.type === 'multi_select';
    const selected = new Set<number>(multi ? ((value as number[]) ?? []) : typeof value === 'number' ? [value] : []);
    return (
      <div className="space-y-2.5">
        {multi && <p className="text-xs text-zinc-500">Select all that apply</p>}
        {q.options.map((opt, i) => {
          const on = selected.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (!multi) return onChange(i);
                const next = new Set(selected);
                if (on) next.delete(i);
                else next.add(i);
                onChange([...next].sort((a, b) => a - b));
              }}
              className={cx(
                'flex w-full cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition',
                on ? 'border-brand-500 bg-brand-50 text-zinc-900' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 text-[10px] font-bold',
                  multi ? 'rounded-md' : 'rounded-full',
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-300 text-zinc-400',
                )}
              >
                {on ? '✓' : String.fromCharCode(65 + i)}
              </span>
              <span className="whitespace-pre-wrap">{opt}</span>
            </button>
          );
        })}
      </div>
    );
  }
  const code = q.type === 'code';
  return (
    <Textarea
      rows={q.type === 'short_text' ? 4 : 12}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        e.preventDefault();
        toast.warning('Pasting is disabled during the assessment');
      }}
      onDrop={(e) => e.preventDefault()}
      spellCheck={!code}
      placeholder={code ? '// Write your code here' : 'Type your answer…'}
      className={cx(code && 'font-mono text-[13px] leading-relaxed', 'bg-white')}
    />
  );
}

export default function AssessmentPortal() {
  const { token } = useParams<{ token: string }>();
  const base = `/assessment/${token}`;
  const [state, setState] = useState<AssessmentState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [offset, setOffset] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [current, setCurrent] = useState(0);
  const [inSession, setInSession] = useState(false);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef<Set<string>>(new Set());
  const submittedRef = useRef(false);

  const proctored = !!state?.test.proctoringEnabled;
  const camera = useCamera();
  const proctor = useProctoring(base, proctored && inSession);

  const apply = useCallback((s: AssessmentState) => {
    setState(s);
    setOffset(new Date(s.serverTime).getTime() - Date.now());
    if (s.answers) setAnswers((prev) => ({ ...s.answers, ...prev }));
  }, []);

  useEffect(() => {
    publicApi
      .get<AssessmentState>(base)
      .then(apply)
      .catch(setLoadError);
  }, [base, apply]);

  // camera lifecycle → proctoring signals
  useEffect(() => {
    if (!inSession || !proctored) return;
    if (camera.status === 'denied') proctor.record('camera_denied');
    if (camera.status === 'off') proctor.record('camera_off');
  }, [camera.status, inSession, proctored]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!dirty.current.size || submittedRef.current) return;
    const ids = [...dirty.current];
    dirty.current.clear();
    setSaving('saving');
    try {
      await publicApi.put(`${base}/answers`, { answers: ids.map((questionId) => ({ questionId, response: answersRef.current[questionId] ?? null })) });
      setSaving('saved');
    } catch {
      ids.forEach((i) => dirty.current.add(i));
      setSaving('error');
    }
  }, [base]);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  // debounced autosave
  useEffect(() => {
    if (!inSession) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [answers, inSession, save]);

  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        await publicApi.post(`${base}/submit`, { answers: Object.entries(answersRef.current).map(([questionId, response]) => ({ questionId, response })) });
        await proctor.flush();
        setState((s) => (s ? { ...s, status: 'submitted' } : s));
        setInSession(false);
        camera.stream?.getTracks().forEach((t) => t.stop());
        void exitFullscreen();
        if (auto) toast.info('Time is up — your answers were submitted automatically.');
      } catch (err) {
        submittedRef.current = false;
        toast.error(errorMessage(err));
      } finally {
        setSubmitting(false);
        setConfirmSubmit(false);
      }
    },
    [base, proctor, camera.stream],
  );

  const remaining = useCountdown(state?.deadlineAt, offset);
  useEffect(() => {
    if (inSession && remaining !== null && remaining <= 0) void submit(true);
  }, [remaining, inSession, submit]);

  async function begin() {
    setStarting(true);
    try {
      if (proctored) {
        await enterFullscreen();
        if (camera.status !== 'on') await camera.request();
      }
      const s = await publicApi.post<AssessmentState>(`${base}/start`);
      apply(s);
      setInSession(true);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 409)) {
        const s = await publicApi.get<AssessmentState>(base).catch(() => null);
        if (s) apply(s);
      }
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const questions = useMemo(() => [...(state?.questions ?? [])].sort((a, b) => a.position - b.position), [state?.questions]);
  const answeredCount = questions.filter((q) => isAnswered(answers[q.id])).length;

  /* ---------------------------------------------------------------- states */
  if (loadError)
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This link is not valid">
          {errorMessage(loadError)}
        </PortalMessage>
      </PortalShell>
    );
  if (!state)
    return (
      <PortalShell>
        <PageLoader />
      </PortalShell>
    );
  if (state.status === 'submitted' || state.status === 'graded')
    return (
      <PortalShell>
        <PortalMessage icon={<CheckCircle2 className="size-6" />} title="Assessment submitted">
          Thank you, {state.candidateName.split(' ')[0]}! Your answers have been recorded. The {state.companyName} team will get back to you with the next steps.
        </PortalMessage>
      </PortalShell>
    );
  if (state.status === 'expired')
    return (
      <PortalShell>
        <PortalMessage icon={<Hourglass className="size-6" />} title="This assessment link has expired">
          Please reach out to your recruiter if you need a new link.
        </PortalMessage>
      </PortalShell>
    );
  if (state.status === 'cancelled')
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This assessment is no longer available" />
      </PortalShell>
    );

  /* ---------------------------------------------------------------- intro / resume */
  if (!inSession) {
    const resuming = state.status === 'started';
    return (
      <PortalShell>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <ClipboardCheck className="size-5" />
            </div>
            <div>
              <p className="text-sm text-zinc-500">Hi {state.candidateName.split(' ')[0]} 👋</p>
              <h1 className="text-xl font-semibold text-zinc-900">{state.test.title}</h1>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-lg font-semibold text-zinc-900">{state.test.durationMin} min</p>
              <p className="text-xs text-zinc-500">Duration</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-lg font-semibold text-zinc-900">{state.test.questionCount}</p>
              <p className="text-xs text-zinc-500">Questions</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-lg font-semibold text-zinc-900">{proctored ? 'Yes' : 'No'}</p>
              <p className="text-xs text-zinc-500">Proctored</p>
            </div>
          </div>
          {state.test.description && <p className="mt-6 text-sm whitespace-pre-wrap text-zinc-700">{state.test.description}</p>}

          <div className="mt-6 space-y-2 text-sm text-zinc-600">
            <p className="font-medium text-zinc-900">Before you begin</p>
            <ul className="space-y-1.5">
              <li className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-brand-500" /> The timer starts when you click Start and cannot be paused. Answers are saved automatically.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-500" /> Use a laptop or desktop with a stable internet connection.</li>
              {proctored && (
                <>
                  <li className="flex gap-2"><Maximize className="mt-0.5 size-4 shrink-0 text-brand-500" /> The test runs in full-screen. Switching tabs, leaving the window, copying and pasting are recorded.</li>
                  <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" /> Your camera stays on for the whole test. Video is not recorded — only camera availability is checked.</li>
                </>
              )}
            </ul>
          </div>

          {proctored && (
            <div className="mt-6 flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-4 sm:flex-row">
              <CameraPreview stream={camera.stream} status={camera.status} className="h-32 w-44 shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-zinc-900">Camera check</p>
                <p className="mt-0.5 text-zinc-500">
                  {camera.status === 'on' ? 'Looking good! Make sure your face is clearly visible.' : camera.status === 'denied' ? 'Camera access was blocked. Allow camera access in your browser settings and try again.' : 'Allow camera access to continue.'}
                </p>
                {camera.status !== 'on' && (
                  <Button size="sm" variant="outline" className="mt-2" loading={camera.status === 'requesting'} onClick={() => void camera.request()}>
                    Enable camera
                  </Button>
                )}
              </div>
            </div>
          )}

          {proctored && (
            <label className="mt-6 flex items-start gap-2 text-sm text-zinc-600">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand and agree to the proctoring rules above.
            </label>
          )}

          <Button size="lg" className="mt-6 w-full" loading={starting} disabled={proctored && !consent} onClick={begin}>
            {resuming ? 'Resume assessment' : 'Start assessment'}
          </Button>
          {!resuming && <p className="mt-3 text-center text-xs text-zinc-400">Link valid until {new Date(state.expiresAt).toLocaleString()}</p>}
        </div>
      </PortalShell>
    );
  }

  /* ---------------------------------------------------------------- test */
  const q = questions[current];
  const low = remaining !== null && remaining < 5 * 60_000;
  return (
    <div className="flex min-h-full flex-col bg-zinc-50" onCopy={(e) => proctored && e.preventDefault()}>
      <ProctorWarning message={proctor.warning} onDismiss={proctor.dismissWarning} onFullscreen={proctored ? () => void enterFullscreen() : undefined} />
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900">{state.test.title}</p>
            <p className="text-xs text-zinc-500">
              {answeredCount}/{questions.length} answered ·{' '}
              {saving === 'saving' ? 'Saving…' : saving === 'error' ? <span className="text-red-600">Not saved — retrying</span> : saving === 'saved' ? 'All changes saved' : 'Autosave on'}
            </p>
          </div>
          <div className={cx('flex items-center gap-2 rounded-xl px-3 py-1.5 font-mono text-lg font-semibold tabular-nums', low ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-900')}>
            <Clock className="size-4" />
            {remaining !== null ? formatClock(remaining) : '--:--'}
          </div>
          <Button onClick={() => setConfirmSubmit(true)}>Submit</Button>
        </div>
        <div className="h-1 bg-zinc-100">
          <div className="h-full bg-brand-500 transition-all" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_260px]">
        <main>
          {q ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs sm:p-8">
              <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
                <span className="font-medium">
                  Question {current + 1} of {questions.length}
                </span>
                <span>
                  {q.points} point{q.points === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mb-6 text-base leading-relaxed whitespace-pre-wrap text-zinc-900 select-none">{q.prompt}</p>
              <QuestionInput
                key={q.id}
                q={q}
                value={answers[q.id]}
                onChange={(v) => {
                  dirty.current.add(q.id);
                  setAnswers((a) => ({ ...a, [q.id]: v }));
                }}
              />
              <div className="mt-8 flex justify-between">
                <Button variant="outline" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)} icon={<ChevronLeft className="size-4" />}>
                  Previous
                </Button>
                {current < questions.length - 1 ? (
                  <Button onClick={() => setCurrent((c) => c + 1)}>
                    Next <ChevronRight className="size-4" />
                  </Button>
                ) : (
                  <Button variant="success" onClick={() => setConfirmSubmit(true)}>
                    Finish & submit
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          )}
        </main>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {proctored && <CameraPreview stream={camera.stream} status={camera.status} className="aspect-[4/3] w-full" />}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="mb-3 text-xs font-medium text-zinc-500">Questions</p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {questions.map((qq, i) => (
                <button
                  key={qq.id}
                  onClick={() => setCurrent(i)}
                  className={cx(
                    'flex aspect-square cursor-pointer items-center justify-center rounded-lg text-xs font-semibold transition',
                    i === current ? 'bg-brand-600 text-white ring-2 ring-brand-200' : isAnswered(answers[qq.id]) ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-3 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-emerald-100" /> Answered</span>
              <span className="flex items-center gap-1"><span className="size-2.5 rounded bg-zinc-100" /> Not answered</span>
            </div>
          </div>
          {proctored && proctor.violations > 0 && (
            <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="size-4" /> {proctor.violations} proctoring warning{proctor.violations === 1 ? '' : 's'} recorded
            </p>
          )}
        </aside>
      </div>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        size="sm"
        title="Submit your assessment?"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmSubmit(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button loading={submitting} onClick={() => void submit()}>
              Submit now
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600">
          You've answered <strong>{answeredCount}</strong> of {questions.length} questions.
          {answeredCount < questions.length && ' Unanswered questions will score zero.'} You can't change your answers after submitting.
        </p>
      </Modal>
    </div>
  );
}
