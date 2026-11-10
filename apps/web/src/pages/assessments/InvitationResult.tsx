import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, MinusCircle, RotateCw, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, scoreTone } from '@/lib/format';
import type { InvitationDetail } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { ProctoringPanel } from '@/components/assessments/ProctoringPanel';
import { QUESTION_TYPE_LABEL, isChoice } from '@/components/assessments/QuestionEditor';
import { Avatar, Badge, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageLoader, ScoreRing, cx } from '@/components/ui';

type Answer = InvitationDetail['answers'][number];

function AnswerView({ a }: { a: Answer }) {
  if (isChoice(a.type)) {
    const chosen = new Set<number>(Array.isArray(a.response) ? (a.response as number[]) : typeof a.response === 'number' ? [a.response] : []);
    return (
      <div className="mt-3 space-y-1.5">
        {a.options.map((opt, i) => {
          const correct = a.correctOptions.includes(i);
          const picked = chosen.has(i);
          return (
            <div
              key={i}
              className={cx(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                correct ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : picked ? 'border-red-200 bg-red-50 text-red-900' : 'border-zinc-100 text-zinc-600',
              )}
            >
              {picked ? correct ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" /> : <Circle className="size-4 text-zinc-300" />}
              <span className="flex-1">{opt}</span>
              {correct && <span className="text-xs font-medium text-emerald-700">Correct</span>}
              {picked && <span className="text-xs text-zinc-500">Candidate</span>}
            </div>
          );
        })}
      </div>
    );
  }
  const text = typeof a.response === 'string' ? a.response : a.response == null ? '' : JSON.stringify(a.response);
  return (
    <div className="mt-3 space-y-2">
      {text ? (
        <pre className={cx('rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm whitespace-pre-wrap text-zinc-800', a.type === 'code' ? 'font-mono text-xs' : 'font-sans')}>{text}</pre>
      ) : (
        <p className="text-sm text-zinc-400 italic">No answer</p>
      )}
      {a.aiFeedback && (
        <div className="flex gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" />
          <p>{a.aiFeedback}</p>
        </div>
      )}
    </div>
  );
}

export default function InvitationResult() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const { isHR } = useAuth();
  const q = useQuery({
    queryKey: ['invitations', invitationId],
    queryFn: () => api.get<InvitationDetail>(`/invitations/${invitationId}`),
    refetchInterval: (query) => (query.state.data?.status === 'submitted' ? 5000 : false),
  });
  const regrade = useApiMutation(() => api.post(`/invitations/${invitationId}/regrade`), { success: 'Regrading started', invalidate: [['invitations']] });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const inv = q.data;
  const answers = [...inv.answers].sort((a, b) => a.position - b.position);

  return (
    <div>
      <PageHeader
        back={
          <Link to={`/assessments/${inv.testId}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> {inv.testTitle}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar name={inv.candidateName} />
            {inv.candidateName}
          </span>
        }
        subtitle={
          <Link to={`/candidates/${inv.candidateId}`} className="hover:underline">
            {inv.candidateEmail} · view candidate profile
          </Link>
        }
        actions={
          isHR &&
          ['submitted', 'graded'].includes(inv.status) && (
            <Button variant="outline" icon={<RotateCw className="size-4" />} loading={regrade.isPending} onClick={() => regrade.mutate()}>
              Regrade
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <ScoreRing score={inv.percent !== null ? Math.round(inv.percent) : null} size={88} label="Score %" />
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={inv.status} />
                  {inv.passed !== null && (
                    <Badge tone={inv.passed ? 'green' : 'red'}>
                      {inv.passed ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                      {inv.passed ? 'Passed' : 'Did not pass'}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-zinc-600">
                  {inv.score !== null ? (
                    <>
                      <strong className="text-zinc-900">{inv.score}</strong> / {inv.maxScore} points
                    </>
                  ) : inv.status === 'submitted' ? (
                    'Grading in progress…'
                  ) : (
                    'Not graded yet'
                  )}
                </p>
                {inv.aiSummary && <p className="text-sm text-zinc-600">{inv.aiSummary}</p>}
              </div>
            </div>
          </Card>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-zinc-900">Answers</h2>
            {!answers.length ? (
              <EmptyState title="No answers yet" description="Answers appear once the candidate starts the test." />
            ) : (
              <div className="space-y-4">
                {answers.map((a) => (
                  <Card key={a.questionId}>
                    <div className="flex items-start gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">{a.position}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge tone="violet">{QUESTION_TYPE_LABEL[a.type]}</Badge>
                          <span className="flex items-center gap-1.5 text-sm">
                            {a.isCorrect === true ? (
                              <CheckCircle2 className="size-4 text-emerald-600" />
                            ) : a.isCorrect === false ? (
                              <XCircle className="size-4 text-red-600" />
                            ) : (
                              <MinusCircle className="size-4 text-zinc-300" />
                            )}
                            <strong>{a.pointsAwarded ?? '–'}</strong>
                            <span className="text-zinc-400">/ {a.points}</span>
                          </span>
                        </div>
                        <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-900">{a.prompt}</p>
                        <AnswerView a={a} />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Timeline" />
            <DescriptionList
              cols={1}
              items={[
                { label: 'Invited', value: fmtDateTime(inv.createdAt) },
                { label: 'Started', value: fmtDateTime(inv.startedAt) },
                { label: 'Submitted', value: fmtDateTime(inv.submittedAt) },
                { label: 'Graded', value: fmtDateTime(inv.gradedAt) },
                { label: 'Link expires', value: fmtDateTime(inv.expiresAt) },
              ]}
            />
          </Card>
          <ProctoringPanel integrityScore={inv.integrityScore} proctoring={inv.proctoring} />
          {inv.integrityScore !== null && inv.integrityScore < 60 && (
            <p className={cx('rounded-lg bg-red-50 p-3 text-xs', scoreTone(inv.integrityScore))}>Low integrity score — consider reviewing this attempt before advancing the candidate.</p>
          )}
        </div>
      </div>
    </div>
  );
}
