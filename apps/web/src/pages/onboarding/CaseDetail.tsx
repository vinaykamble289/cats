import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Eye, FileText, PartyPopper, RotateCw, ShieldCheck, UserMinus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { fmtBytes, fmtDate, fmtDateTime } from '@/lib/format';
import type { BgvRequest, BgvVendor, CaseDocument, OnboardingCaseDetail, Paginated } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  ProgressBar,
  Select,
  Textarea,
  cx,
} from '@/components/ui';

function DocumentRow({ caseId, doc }: { caseId: string; doc: CaseDocument }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [opening, setOpening] = useState(false);
  const review = useApiMutation((body: { status: 'verified' | 'rejected'; note?: string }) => api.post(`/onboarding/${caseId}/documents/${doc.id}/review`, body), {
    success: (_r) => 'Document updated',
    invalidate: [['onboarding']],
    onSuccess: () => setRejecting(false),
  });
  const view = async () => {
    setOpening(true);
    try {
      const { url } = await api.get<{ url: string }>(`/onboarding/${caseId}/documents/${doc.id}/url`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setOpening(false);
    }
  };
  const hasFile = doc.status !== 'pending';
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          doc.status === 'verified' ? 'bg-emerald-50 text-emerald-600' : doc.status === 'rejected' ? 'bg-red-50 text-red-600' : hasFile ? 'bg-sky-50 text-sky-600' : 'bg-zinc-100 text-zinc-400',
        )}
      >
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">
          {doc.name} {!doc.isRequired && <span className="text-xs font-normal text-zinc-400">(optional)</span>}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {hasFile ? `${doc.fileName} · ${fmtBytes(doc.sizeBytes)} · ${fmtDateTime(doc.uploadedAt)}` : doc.description ?? 'Not uploaded yet'}
        </p>
        {doc.status === 'rejected' && doc.reviewNote && <p className="mt-0.5 text-xs text-red-600">Rejected: {doc.reviewNote}</p>}
      </div>
      <StatusBadge value={doc.status} />
      {hasFile && (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" loading={opening} onClick={view} icon={<Eye className="size-3.5" />}>
            View
          </Button>
          {doc.status !== 'verified' && (
            <Button size="sm" variant="outline" className="text-emerald-700" loading={review.isPending && !rejecting} onClick={() => review.mutate({ status: 'verified' })} icon={<Check className="size-3.5" />}>
              Verify
            </Button>
          )}
          {doc.status !== 'rejected' && <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setRejecting(true)} icon={<X className="size-3.5" />} />}
        </div>
      )}
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        size="sm"
        title={`Reject ${doc.name}?`}
        description="The candidate is emailed and asked to upload it again."
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={review.isPending} disabled={!note.trim()} onClick={() => review.mutate({ status: 'rejected', note })}>
              Reject & notify
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The image is blurry, please upload a clear scan." />
        </Field>
      </Modal>
    </div>
  );
}

function BgvSection({ c }: { c: OnboardingCaseDetail }) {
  const [sendOpen, setSendOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [ref, setRef] = useState('');
  const [editing, setEditing] = useState<BgvRequest | null>(null);
  const [status, setStatus] = useState<BgvRequest['status']>('in_progress');
  const [summary, setSummary] = useState('');
  const vendors = useQuery({ queryKey: ['bgv-vendors'], queryFn: () => api.get<Paginated<BgvVendor>>('/bgv-vendors'), select: (r) => r.data.filter((v) => v.isActive) });
  const send = useApiMutation(() => api.post(`/onboarding/${c.id}/bgv`, { vendorId, referenceNo: ref || undefined }), {
    success: 'Verification request sent to vendor',
    invalidate: [['onboarding']],
    onSuccess: () => setSendOpen(false),
  });
  const update = useApiMutation(() => api.patch(`/onboarding/${c.id}/bgv/${editing!.id}`, { status, resultSummary: summary || undefined }), {
    success: 'BGV status updated',
    invalidate: [['onboarding']],
    onSuccess: () => setEditing(null),
  });
  const uploaded = c.documents.filter((d) => d.status === 'uploaded' || d.status === 'verified').length;
  const closed = ['joined', 'dropped'].includes(c.status);

  return (
    <Card>
      <CardHeader
        title="Background verification"
        subtitle="Documents are shared with the vendor through 7-day secure links"
        actions={
          !closed && (
            <Button
              size="sm"
              icon={<ShieldCheck className="size-4" />}
              onClick={() => {
                if (!uploaded) return toast.error('No documents uploaded yet');
                setVendorId(vendors.data?.[0]?.id ?? '');
                setRef('');
                setSendOpen(true);
              }}
            >
              Send to vendor
            </Button>
          )
        }
      />
      {!c.bgvRequests.length ? (
        <EmptyState title="Not initiated" description="Send the candidate's documents to your verification partner once they're uploaded." className="py-8" />
      ) : (
        <div className="divide-y divide-zinc-100">
          {c.bgvRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">
                  {r.vendorName} {r.referenceNo && <span className="font-normal text-zinc-500">· Ref {r.referenceNo}</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  Sent {fmtDateTime(r.sentAt)}
                  {r.completedAt ? ` · completed ${fmtDateTime(r.completedAt)}` : ''}
                </p>
                {r.resultSummary && <p className="mt-1 text-xs text-zinc-700">{r.resultSummary}</p>}
              </div>
              <StatusBadge value={r.status} />
              {!['cleared', 'flagged', 'cancelled'].includes(r.status) && !closed && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(r);
                    setStatus(r.status === 'sent' ? 'in_progress' : 'cleared');
                    setSummary(r.resultSummary ?? '');
                  }}
                >
                  Update
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send for background verification"
        description={`${uploaded} uploaded document(s) will be shared with the vendor.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button loading={send.isPending} disabled={!vendorId} onClick={() => send.mutate()}>
              Send request
            </Button>
          </>
        }
      >
        {vendors.data && !vendors.data.length ? (
          <EmptyState title="No vendors configured" description={<>Add your verification partner in <Link to="/settings" className="text-brand-600 underline">Settings</Link>.</>} />
        ) : (
          <div className="space-y-4">
            <Field label="Vendor" required>
              <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                {(vendors.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.contactEmail})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference number" hint="Optional - auto-generated if left empty">
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="sm"
        title="Update verification status"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={update.isPending} onClick={() => update.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as BgvRequest['status'])}>
              <option value="in_progress">In progress</option>
              <option value="cleared">Cleared</option>
              <option value="flagged">Flagged (discrepancy found)</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Result summary">
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary of the vendor report…" />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [dropOpen, setDropOpen] = useState(false);
  const [dropReason, setDropReason] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [newDate, setNewDate] = useState('');

  const q = useQuery({ queryKey: ['onboarding', id], queryFn: () => api.get<OnboardingCaseDetail>(`/onboarding/${id}`) });
  const inv = [['onboarding'], ['applications'], ['jobs']];
  const resend = useApiMutation(() => api.post(`/onboarding/${id}/resend-invite`), { success: 'Upload link re-sent to candidate' });
  const updateDate = useApiMutation(() => api.patch(`/onboarding/${id}`, { joiningDate: newDate }), { success: 'Joining date updated', invalidate: inv, onSuccess: () => setDateOpen(false) });
  const join = useApiMutation(() => api.post(`/onboarding/${id}/join`, { joinedAt: new Date(joinDate).toISOString() }), { success: 'Marked as joined', invalidate: inv });
  const drop = useApiMutation(() => api.post(`/onboarding/${id}/drop`, { reason: dropReason }), { success: 'Marked as dropped', invalidate: inv });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const docs = [...c.documents].sort((a, b) => Number(b.isRequired) - Number(a.isRequired));
  const s = c.documentStats;
  const closed = ['joined', 'dropped'].includes(c.status);
  const requiredOk = c.documents.filter((d) => d.isRequired).every((d) => d.status === 'verified');

  return (
    <div>
      <PageHeader
        back={
          <Link to="/onboarding" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Pre-joining
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.candidateName} <StatusBadge value={c.status} />
          </span>
        }
        subtitle={
          <>
            <Link to={`/candidates/${c.candidateId}`} className="hover:underline">
              {c.candidateEmail}
            </Link>{' '}
            · {c.jobTitle}
          </>
        }
        actions={
          !closed && (
            <>
              <Button variant="outline" icon={<RotateCw className="size-4" />} loading={resend.isPending} onClick={() => resend.mutate()}>
                Resend upload link
              </Button>
              <Button variant="outline" className="text-red-600" icon={<UserMinus className="size-4" />} onClick={() => setDropOpen(true)}>
                Drop
              </Button>
              <Button variant="success" icon={<PartyPopper className="size-4" />} onClick={() => setJoinOpen(true)}>
                Mark as joined
              </Button>
            </>
          )
        }
      />

      {c.status === 'joined' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <PartyPopper className="size-5" /> Joined on {fmtDate(c.joinedAt)}. The position has been updated.
        </div>
      )}
      {c.status === 'dropped' && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Dropped{c.droppedReason ? `: ${c.droppedReason}` : ''}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Documents" subtitle={`${s.uploaded + s.verified} of ${s.total} uploaded · ${s.verified} verified`} />
            <ProgressBar value={s.total ? (s.verified / s.total) * 100 : 0} tone="green" className="mb-2" />
            <div className="divide-y divide-zinc-100">
              {docs.map((d) => (
                <DocumentRow key={d.id} caseId={c.id} doc={d} />
              ))}
            </div>
          </Card>
          <BgvSection c={c} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Joining"
              actions={
                !closed && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setNewDate(c.joiningDate ?? '');
                      setDateOpen(true);
                    }}
                  >
                    Change
                  </Button>
                )
              }
            />
            <p className="text-2xl font-semibold text-zinc-900">{fmtDate(c.joiningDate)}</p>
            <div className="mt-4 space-y-2 text-sm">
              {[
                ['Required documents verified', requiredOk],
                ['Background verification cleared', c.bgvRequests.some((r) => r.status === 'cleared')],
              ].map(([label, ok]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <span className={cx('flex size-5 items-center justify-center rounded-full', ok ? 'bg-emerald-100 text-emerald-600' : 'bg-zinc-100 text-zinc-400')}>
                    <Check className="size-3" />
                  </span>
                  <span className={ok ? 'text-zinc-900' : 'text-zinc-500'}>{label as string}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Case info" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Created</dt>
                <dd>{fmtDateTime(c.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Updated</dt>
                <dd>{fmtDateTime(c.updatedAt)}</dd>
              </div>
              {c.offerId && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Offer</dt>
                  <dd>
                    <Link to={`/offers/${c.offerId}`} className="text-brand-600 hover:underline">
                      View offer
                    </Link>
                  </dd>
                </div>
              )}
              {s.rejected > 0 && (
                <div className="pt-2">
                  <Badge tone="amber">{s.rejected} document(s) awaiting re-upload</Badge>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onConfirm={() => join.mutateAsync()}
        title={`Confirm ${c.candidateName} has joined?`}
        message={requiredOk ? 'The application is marked as hired and the job opening is filled (the job closes when all openings are filled).' : 'Not all required documents are verified yet. You can still confirm joining.'}
        confirmLabel="Confirm joining"
      >
        <Field label="Joining date" className="mt-3">
          <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dropOpen}
        onClose={() => setDropOpen(false)}
        onConfirm={() => (dropReason.trim() ? drop.mutateAsync() : Promise.reject(toast.error('Please add a reason')))}
        danger
        title="Mark candidate as dropped?"
        message="Use this if the candidate will not join. The application is marked as withdrawn."
        confirmLabel="Drop candidate"
      >
        <Field label="Reason" required className="mt-3">
          <Textarea rows={2} value={dropReason} onChange={(e) => setDropReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <Modal
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        size="sm"
        title="Change joining date"
        footer={
          <>
            <Button variant="outline" onClick={() => setDateOpen(false)}>
              Cancel
            </Button>
            <Button loading={updateDate.isPending} disabled={!newDate} onClick={() => updateDate.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
      </Modal>
    </div>
  );
}
