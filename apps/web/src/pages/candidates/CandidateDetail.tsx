import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, ExternalLink, FileText, Globe, GraduationCap, Linkedin, Mail, MapPin, Pencil, Phone, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtBytes, fmtDate, fmtMoney, fromNow } from '@/lib/format';
import { useApiMutation, useJobMap, useUserMap } from '@/lib/hooks';
import type { CandidateDetail as CandidateDetailT, EmailLog, Paginated } from '@/lib/types';
import { ActivityFeed } from '@/components/ActivityFeed';
import { CandidateAssessments, CandidateInterviews, CandidateOffers, CandidateOnboarding } from '@/components/actions';
import { StatusBadge } from '@/components/StatusBadge';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, DescriptionList, EmptyState, ErrorState, PageHeader, PageLoader, Spinner, Table, Tabs, Td, Textarea, Th, Tr } from '@/components/ui';
import { ApplicationPanel } from '@/components/candidates/ApplicationPanel';
import { CandidateFormModal, sourceLabel } from '@/components/candidates/CandidateFormModal';
import { ComposeEmailModal, EmailDetailDrawer } from '@/components/candidates/EmailViews';
import { AddToJobDialog } from '@/components/jobs/PipelineDialogs';

type Tab = 'applications' | 'resume' | 'assessments' | 'interviews' | 'offers' | 'onboarding' | 'emails' | 'notes' | 'activity';

/** Opens a signed URL in a new tab without being blocked as a popup. */
async function openSigned(getUrl: () => Promise<string>) {
  const w = window.open('about:blank', '_blank');
  try {
    const url = await getUrl();
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (err) {
    w?.close();
    toast.error(errorMessage(err));
  }
}

function ResumeTab({ c, isHR }: { c: CandidateDetailT; isHR: boolean }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const r = c.resume;
  const parsed = r?.parsed;

  async function replace(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      await api.upload(`/candidates/${c.id}/resume`, form);
      toast.success('Resume uploaded and re-parsed');
      qc.invalidateQueries({ queryKey: ['candidates'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-lg bg-red-50 p-2.5 text-red-600">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{r?.fileName ?? 'No resume on file'}</p>
            {r && (
              <p className="text-xs text-zinc-500">
                {fmtBytes(r.sizeBytes)} · uploaded {fromNow(r.uploadedAt)}
              </p>
            )}
          </div>
          {r && (
            <Button variant="outline" icon={<ExternalLink className="size-4" />} onClick={() => openSigned(() => api.get<{ url: string }>(`/candidates/${c.id}/resume/url`).then((x) => x.url))}>
              Open resume
            </Button>
          )}
          {isHR && (
            <>
              <Button variant={r ? 'ghost' : 'primary'} icon={<RefreshCw className="size-4" />} loading={uploading} onClick={() => inputRef.current?.click()}>
                {r ? 'Replace' : 'Upload resume'}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void replace(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </Card>

      {parsed?.experience?.length ? (
        <Card>
          <CardHeader title="Experience" subtitle="Extracted from the resume by AI" />
          <ol className="relative space-y-5 border-l-2 border-zinc-100 pl-5">
            {parsed.experience.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1 -left-[27px] flex size-3 rounded-full border-2 border-white bg-brand-500" />
                <p className="text-sm font-semibold text-zinc-900">
                  {e.title}
                  {e.company && <span className="font-normal text-zinc-500"> · {e.company}</span>}
                </p>
                {(e.start || e.end) && (
                  <p className="text-xs text-zinc-500">
                    {e.start ?? '?'} – {e.end ?? 'Present'}
                  </p>
                )}
                {e.highlights?.length ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-sm text-zinc-600">
                    {e.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {parsed?.education?.length ? (
        <Card>
          <CardHeader title="Education" />
          <ul className="space-y-3">
            {parsed.education.map((e, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="rounded-lg bg-sky-50 p-2 text-sky-600">
                  <GraduationCap className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900">{e.degree}</p>
                  <p className="text-xs text-zinc-500">
                    {e.institution}
                    {e.year ? ` · ${e.year}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {r && !parsed && <p className="text-sm text-zinc-500">The resume hasn't been parsed yet (AI may be unavailable).</p>}
    </div>
  );
}

function EmailsTab({ c, isHR }: { c: CandidateDetailT; isHR: boolean }) {
  const [compose, setCompose] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useJobMap();
  const { data, isLoading } = useQuery({ queryKey: ['emails', { candidateId: c.id }], queryFn: () => api.get<Paginated<EmailLog>>('/emails', { candidateId: c.id, pageSize: 100 }) });
  const firstJob = c.applications[0] ? jobs.get(c.applications[0].jobId)?.title : undefined;
  return (
    <div className="space-y-4">
      {isHR && (
        <div className="flex justify-end">
          <Button icon={<Send className="size-4" />} onClick={() => setCompose(true)}>
            Compose email
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : !data?.data.length ? (
        <EmptyState icon={<Mail className="size-5" />} title="No emails yet" description="Every email sent to this candidate is logged here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((e) => (
              <Tr key={e.id} onClick={() => setOpenId(e.id)}>
                <Td>
                  <p className="max-w-md truncate font-medium text-zinc-800">{e.subject}</p>
                  <p className="text-xs text-zinc-500">{e.toEmail}</p>
                </Td>
                <Td>
                  <StatusBadge value={e.status} />
                </Td>
                <Td className="whitespace-nowrap text-zinc-500">{fromNow(e.sentAt ?? e.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <ComposeEmailModal open={compose} onClose={() => setCompose(false)} to={c.email} candidateId={c.id} candidateName={c.fullName} jobTitle={firstJob} />
      <EmailDetailDrawer emailId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function NotesTab({ candidateId }: { candidateId: string }) {
  const users = useUserMap();
  const [body, setBody] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['candidates', candidateId, 'notes'],
    queryFn: () => api.get<{ data: { id: string; authorId: string | null; body: string; createdAt: string }[] }>(`/candidates/${candidateId}/notes`),
  });
  const add = useApiMutation(() => api.post(`/candidates/${candidateId}/notes`, { body }), {
    success: 'Note added',
    invalidate: [['candidates', candidateId, 'notes']],
    onSuccess: () => setBody(''),
  });
  return (
    <div className="space-y-4">
      <Card>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a private note for the hiring team… (Ctrl+Enter to save)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) add.mutate();
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Add note
          </Button>
        </div>
      </Card>
      {isLoading ? (
        <Spinner />
      ) : !data?.data.length ? (
        <p className="text-center text-sm text-zinc-400">No notes yet.</p>
      ) : (
        data.data.map((n) => {
          const author = n.authorId ? users.get(n.authorId)?.fullName : undefined;
          return (
            <div key={n.id} className="flex gap-3">
              <Avatar name={author ?? '?'} size="sm" />
              <div className="flex-1 rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-xs text-zinc-500">
                  <span className="font-medium text-zinc-800">{author ?? 'Unknown'}</span> · {fromNow(n.createdAt)}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-700">{n.body}</p>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isHR, hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>('applications');
  const [editOpen, setEditOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const q = useQuery({ queryKey: ['candidates', id], queryFn: () => api.get<CandidateDetailT>(`/candidates/${id}`) });
  const del = useApiMutation(() => api.delete(`/candidates/${id}`), {
    success: 'Candidate deleted',
    invalidate: [['candidates'], ['applications']],
    onSuccess: () => navigate('/candidates'),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const canSeeTeamTabs = isHR || hasRole('hiring_manager');

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'applications', label: 'Applications', count: c.applications.length },
    { value: 'resume', label: 'Resume' },
    ...(canSeeTeamTabs
      ? ([
          { value: 'assessments', label: 'Assessments' },
          { value: 'interviews', label: 'Interviews' },
          { value: 'offers', label: 'Offers' },
          { value: 'onboarding', label: 'Pre-joining' },
        ] as const)
      : []),
    ...(isHR ? [{ value: 'emails' as Tab, label: 'Emails' }] : []),
    { value: 'notes', label: 'Notes' },
    { value: 'activity', label: 'Activity' },
  ];

  const contact = [
    { icon: <Mail className="size-3.5" />, label: c.email, href: `mailto:${c.email}` },
    c.phone && { icon: <Phone className="size-3.5" />, label: c.phone, href: `tel:${c.phone}` },
    c.location && { icon: <MapPin className="size-3.5" />, label: c.location },
    c.linkedinUrl && { icon: <Linkedin className="size-3.5" />, label: 'LinkedIn', href: c.linkedinUrl },
    c.portfolioUrl && { icon: <Globe className="size-3.5" />, label: 'Portfolio', href: c.portfolioUrl },
  ].filter(Boolean) as { icon: React.ReactNode; label: string; href?: string }[];

  return (
    <div>
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} className="inline-flex cursor-pointer items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Back
          </button>
        }
        title={
          <span className="flex items-center gap-4">
            <Avatar name={c.fullName} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{c.fullName}</span>
              <span className="block truncate text-sm font-normal text-zinc-500">{[c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || 'No current role'}</span>
            </span>
          </span>
        }
        subtitle={
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {contact.map((x) =>
              x.href ? (
                <a key={x.label} href={x.href} target={x.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="flex items-center gap-1 hover:text-brand-700">
                  {x.icon}
                  {x.label}
                </a>
              ) : (
                <span key={x.label} className="flex items-center gap-1">
                  {x.icon}
                  {x.label}
                </span>
              ),
            )}
          </span>
        }
        actions={
          isHR && (
            <>
              <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => setAddJobOpen(true)}>
                Add to job
              </Button>
              {hasRole('admin') && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="size-4" />} onClick={() => setDeleteOpen(true)} aria-label="Delete candidate" />}
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Tabs className="mb-5" tabs={tabs} value={tab} onChange={setTab} />
          {tab === 'applications' &&
            (c.applications.length ? (
              <div className="space-y-5">
                {c.applications.map((a) => (
                  <ApplicationPanel key={a.id} app={a} candidateName={c.fullName} isHR={isHR} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Briefcase className="size-5" />}
                title="Not in any pipeline"
                description="Add this candidate to a job to start the hiring process."
                action={
                  isHR && (
                    <Button icon={<Plus className="size-4" />} onClick={() => setAddJobOpen(true)}>
                      Add to job
                    </Button>
                  )
                }
              />
            ))}
          {tab === 'resume' && <ResumeTab c={c} isHR={isHR} />}
          {tab === 'assessments' && <CandidateAssessments candidateId={c.id} />}
          {tab === 'interviews' && <CandidateInterviews candidateId={c.id} />}
          {tab === 'offers' && <CandidateOffers candidateId={c.id} />}
          {tab === 'onboarding' && <CandidateOnboarding candidateId={c.id} />}
          {tab === 'emails' && <EmailsTab c={c} isHR={isHR} />}
          {tab === 'notes' && <NotesTab candidateId={c.id} />}
          {tab === 'activity' && (
            <Card>
              <ActivityFeed candidateId={c.id} limit={100} />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Profile" />
            <DescriptionList
              cols={1}
              items={[
                { label: 'Experience', value: c.experienceYears !== null ? `${c.experienceYears} years` : '—' },
                { label: 'Notice period', value: c.noticePeriodDays !== null ? `${c.noticePeriodDays} days` : '—' },
                { label: 'Current CTC', value: fmtMoney(c.currentCtc) },
                { label: 'Expected CTC', value: fmtMoney(c.expectedCtc) },
                { label: 'Source', value: `${sourceLabel(c.source)}${c.sourceDetail ? ` · ${c.sourceDetail}` : ''}` },
                { label: 'Added', value: fmtDate(c.createdAt) },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Skills" />
            {c.skills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {c.skills.map((s) => (
                  <Badge key={s}>
                    {s}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No skills recorded.</p>
            )}
          </Card>
          {c.summary && (
            <Card>
              <CardHeader title="Summary" />
              <p className="text-sm leading-relaxed text-zinc-600">{c.summary}</p>
            </Card>
          )}
        </aside>
      </div>

      {isHR && (
        <>
          <CandidateFormModal open={editOpen} onClose={() => setEditOpen(false)} candidate={c} />
          <AddToJobDialog open={addJobOpen} onClose={() => setAddJobOpen(false)} candidateId={c.id} excludeJobIds={c.applications.map((a) => a.jobId)} />
          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => del.mutateAsync()}
            danger
            title="Delete candidate?"
            message={`This permanently removes ${c.fullName}, their resumes and all applications. This cannot be undone.`}
            confirmLabel="Delete"
          />
        </>
      )}
    </div>
  );
}
