import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FilePen, MoreHorizontal, Send, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useApiMutation, useUserMap } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fromNow } from '@/lib/format';
import type { OfferDetail as OfferDetailT, OfferVersion } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { OfferFormFields, fromVersion, toBody, type OfferFormValues } from '@/components/offers/OfferForm';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Menu,
  Modal,
  PageHeader,
  PageLoader,
  Textarea,
  cx,
} from '@/components/ui';

const FIELDS: { key: keyof OfferVersion; label: string; money?: boolean; date?: boolean }[] = [
  { key: 'designation', label: 'Designation' },
  { key: 'baseSalary', label: 'Base salary', money: true },
  { key: 'variablePay', label: 'Variable pay', money: true },
  { key: 'joiningBonus', label: 'Joining bonus', money: true },
  { key: 'equity', label: 'Equity' },
  { key: 'joiningDate', label: 'Joining date', date: true },
  { key: 'location', label: 'Location' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'additionalTerms', label: 'Additional terms' },
];

function display(v: OfferVersion, f: (typeof FIELDS)[number]) {
  const val = v[f.key];
  if (val === null || val === undefined || val === '') return '—';
  if (f.money) return fmtMoney(Number(val), v.currency);
  if (f.date) return fmtDate(String(val));
  return String(val);
}

function OfferCard({ v }: { v: OfferVersion }) {
  const ctc = v.baseSalary + v.variablePay;
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-zinc-200 bg-zinc-50 px-6 py-5">
        <p className="text-[13px] text-zinc-500">Version {v.version}</p>
        <p className="mt-0.5 text-lg font-semibold text-zinc-900">{v.designation}</p>
        <p className="tabular mt-3 text-3xl font-semibold tracking-tight text-zinc-900">
          {fmtMoney(ctc, v.currency)} <span className="text-sm font-normal text-zinc-500">annual CTC</span>
        </p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-zinc-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          ['Base', v.baseSalary],
          ['Variable', v.variablePay],
          ['Joining bonus', v.joiningBonus],
        ].map(([l, n]) => (
          <div key={l as string} className="px-6 py-4">
            <p className="text-xs text-zinc-500">{l}</p>
            <p className="tabular mt-0.5 font-semibold text-zinc-900">{fmtMoney(n as number, v.currency)}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-zinc-100 px-6 py-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Joining date</p>
            <p className="text-zinc-900">{fmtDate(v.joiningDate)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Location</p>
            <p className="text-zinc-900">{v.location ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Equity</p>
            <p className="text-zinc-900">{v.equity ?? '—'}</p>
          </div>
        </div>
        {v.benefits && (
          <div>
            <p className="text-xs text-zinc-500">Benefits</p>
            <p className="whitespace-pre-wrap text-zinc-700">{v.benefits}</p>
          </div>
        )}
        {v.additionalTerms && (
          <div>
            <p className="text-xs text-zinc-500">Additional terms</p>
            <p className="whitespace-pre-wrap text-zinc-700">{v.additionalTerms}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function VersionHistory({ versions }: { versions: OfferVersion[] }) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return (
    <Card>
      <CardHeader title="Version history" subtitle="Changes between revisions" />
      <ol className="space-y-4">
        {sorted.map((v, i) => {
          const prev = sorted[i + 1];
          const changes = prev ? FIELDS.filter((f) => String(v[f.key] ?? '') !== String(prev[f.key] ?? '')) : [];
          return (
            <li key={v.id} className="border-l-2 border-zinc-200 pl-4">
              <div className="flex items-center gap-2">
                <Badge tone={i === 0 ? 'violet' : 'gray'}>v{v.version}</Badge>
                <span className="text-xs text-zinc-500">{fmtDateTime(v.createdAt)}</span>
              </div>
              {prev ? (
                changes.length ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {changes.map((f) => (
                      <li key={f.key} className="text-zinc-600">
                        <span className="font-medium text-zinc-800">{f.label}:</span> <span className="text-red-600 line-through">{display(prev, f)}</span> →{' '}
                        <span className="font-medium text-emerald-700">{display(v, f)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">No changes to terms</p>
                )
              ) : (
                <p className="mt-1 text-xs text-zinc-500">Initial offer · {fmtMoney(v.baseSalary + v.variablePay, v.currency)}</p>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Thread({ offer }: { offer: OfferDetailT }) {
  const users = useUserMap();
  const { isHR } = useAuth();
  const [msg, setMsg] = useState('');
  const send = useApiMutation(() => api.post(`/offers/${offer.id}/messages`, { message: msg }), {
    success: 'Message sent to candidate',
    invalidate: [['offers']],
    onSuccess: () => setMsg(''),
  });
  const canMessage = isHR && ['sent', 'negotiating'].includes(offer.status);
  return (
    <Card>
      <CardHeader title="Negotiation" subtitle="Messages between you and the candidate" />
      {!offer.messages.length ? (
        <EmptyState title="No messages" description="Counter-offers and questions from the candidate appear here." className="py-8" />
      ) : (
        <div className="space-y-3">
          {offer.messages.map((m) => {
            const mine = m.actor === 'recruiter';
            return (
              <div key={m.id} className={cx('flex gap-2', mine && 'flex-row-reverse')}>
                <Avatar name={mine ? (users.get(m.authorId ?? '')?.fullName ?? 'Recruiter') : offer.candidateName} size="sm" />
                <div className={cx('max-w-[85%]', mine && 'text-right')}>
                  <div className={cx('inline-block rounded-2xl px-3.5 py-2 text-left text-sm whitespace-pre-wrap', mine ? 'rounded-tr-sm bg-brand-600 text-white' : 'rounded-tl-sm bg-zinc-100 text-zinc-800')}>
                    {m.message}
                    {(m.requestedBaseSalary !== null || m.requestedJoiningDate) && (
                      <div className="mt-2 space-y-0.5 border-t border-black/10 pt-2 text-xs">
                        {m.requestedBaseSalary !== null && <p>Requested base: <strong>{fmtMoney(m.requestedBaseSalary, offer.current.currency)}</strong></p>}
                        {m.requestedJoiningDate && <p>Requested joining: <strong>{fmtDate(m.requestedJoiningDate)}</strong></p>}
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {mine ? users.get(m.authorId ?? '')?.fullName ?? 'Recruiter' : offer.candidateName} · {fromNow(m.createdAt)}
                    {m.offerVersion ? ` · on v${m.offerVersion}` : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canMessage && (
        <div className="mt-4 flex gap-2">
          <Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Write a message to the candidate…" />
          <Button className="self-end" loading={send.isPending} disabled={!msg.trim()} onClick={() => send.mutate()} icon={<Send className="size-4" />} />
        </div>
      )}
    </Card>
  );
}

export default function OfferDetail() {
  const { id } = useParams<{ id: string }>();
  const { isHR } = useAuth();
  const [editMode, setEditMode] = useState<'edit' | 'revise' | null>(null);
  const [form, setForm] = useState<OfferFormValues | null>(null);
  const [reviseMsg, setReviseMsg] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [acceptOpen, setAcceptOpen] = useState(false);

  const q = useQuery({ queryKey: ['offers', id], queryFn: () => api.get<OfferDetailT>(`/offers/${id}`) });
  const inv = [['offers'], ['applications']];
  const save = useApiMutation(
    () => (editMode === 'edit' ? api.patch(`/offers/${id}`, toBody(form!)) : api.post(`/offers/${id}/revise`, { ...toBody(form!), message: reviseMsg || undefined })),
    { success: editMode === 'edit' ? 'Draft updated' : 'Offer revised', invalidate: inv, onSuccess: () => setEditMode(null) },
  );
  const send = useApiMutation(() => api.post(`/offers/${id}/send`, { expiresInDays: days }), { success: 'Offer sent to candidate', invalidate: inv, onSuccess: () => setSendOpen(false) });
  const withdraw = useApiMutation(() => api.post(`/offers/${id}/withdraw`, { reason: withdrawReason || undefined }), { success: 'Offer withdrawn', invalidate: inv });
  const markAccepted = useApiMutation(() => api.post(`/offers/${id}/mark-accepted`), { success: 'Offer marked as accepted · pre-joining started', invalidate: [...inv, ['onboarding']] });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const offer = q.data;
  const open = ['sent', 'negotiating'].includes(offer.status);

  const openEditor = (mode: 'edit' | 'revise') => {
    setForm(fromVersion(offer.current as unknown as Record<string, unknown>));
    setReviseMsg('');
    setEditMode(mode);
  };

  return (
    <div>
      <PageHeader
        back={
          <Link to="/offers" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Offers
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {offer.candidateName} <StatusBadge value={offer.status} />
          </span>
        }
        subtitle={
          <>
            <Link to={`/candidates/${offer.candidateId}`} className="hover:underline">
              {offer.candidateEmail}
            </Link>{' '}
            · {offer.jobTitle}
            {offer.expiresAt && open ? ` · expires ${fmtDate(offer.expiresAt)}` : ''}
          </>
        }
        actions={
          isHR && (
            <>
              {offer.status === 'draft' && (
                <>
                  <Button variant="outline" icon={<FilePen className="size-4" />} onClick={() => openEditor('edit')}>
                    Edit
                  </Button>
                  <Button icon={<Send className="size-4" />} onClick={() => setSendOpen(true)}>
                    Send offer
                  </Button>
                </>
              )}
              {open && (
                <Button icon={<FilePen className="size-4" />} onClick={() => openEditor('revise')}>
                  Revise offer
                </Button>
              )}
              {['draft', 'sent', 'negotiating'].includes(offer.status) && (
                <Menu
                  trigger={<Button variant="outline" icon={<MoreHorizontal className="size-4" />} />}
                  items={[
                    open && { label: 'Mark as accepted (offline)', icon: <CheckCircle2 className="size-4" />, onClick: () => setAcceptOpen(true) },
                    { label: 'Withdraw offer', icon: <Undo2 className="size-4" />, danger: true, onClick: () => setWithdrawOpen(true) },
                  ]}
                />
              )}
            </>
          )
        }
      />

      {offer.status === 'declined' && offer.declineReason && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Declined:</strong> {offer.declineReason}
        </div>
      )}
      {offer.status === 'negotiating' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">The candidate has requested changes. Review the negotiation thread and revise the offer or reply.</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <OfferCard v={offer.current} />
          <Thread offer={offer} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Timeline" />
            <dl className="space-y-2 text-sm">
              {[
                ['Created', fmtDateTime(offer.createdAt)],
                ['Sent', fmtDateTime(offer.sentAt)],
                ['Expires', fmtDateTime(offer.expiresAt)],
                ['Responded', fmtDateTime(offer.respondedAt)],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4">
                  <dt className="text-zinc-500">{l}</dt>
                  <dd className="text-right text-zinc-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <VersionHistory versions={offer.versions} />
        </div>
      </div>

      <Modal
        open={!!editMode && !!form}
        onClose={() => setEditMode(null)}
        size="lg"
        title={editMode === 'edit' ? 'Edit draft offer' : `Revise offer (v${offer.currentVersion + 1})`}
        description={editMode === 'revise' ? 'A new version is created and the candidate is emailed the updated offer.' : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditMode(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              onClick={() => {
                if (!form?.designation.trim() || form.baseSalary === '') return toast.error('Designation and base salary are required');
                save.mutate();
              }}
            >
              {editMode === 'edit' ? 'Save draft' : 'Create revision & notify'}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <OfferFormFields value={form} onChange={setForm} />
            {editMode === 'revise' && (
              <Field label="Message to candidate (optional)">
                <Textarea rows={2} value={reviseMsg} onChange={(e) => setReviseMsg(e.target.value)} placeholder="We've updated the base salary as discussed…" />
              </Field>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        size="sm"
        title="Send offer"
        description={`${offer.candidateName} will receive a secure link to view and respond to the offer.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button loading={send.isPending} onClick={() => send.mutate()} icon={<Send className="size-4" />}>
              Send
            </Button>
          </>
        }
      >
        <Field label="Offer valid for (days)">
          <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value) || 7)} />
        </Field>
      </Modal>

      <ConfirmDialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} onConfirm={() => withdraw.mutateAsync()} danger title="Withdraw this offer?" confirmLabel="Withdraw">
        <Field label="Reason (internal)" className="mt-3">
          <Textarea rows={2} value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        onConfirm={() => markAccepted.mutateAsync()}
        title="Mark offer as accepted?"
        message="Use this when the candidate accepted outside the portal. Pre-joining document collection starts automatically."
        confirmLabel="Mark accepted"
      />
    </div>
  );
}
