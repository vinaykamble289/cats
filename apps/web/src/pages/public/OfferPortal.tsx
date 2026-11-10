import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Hourglass, MapPin, MessageSquare, PartyPopper, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, publicApi } from '@/lib/api';
import { fmtDate, fmtMoney, fromNow } from '@/lib/format';
import type { NegotiationMessage, OfferStatus, OfferVersion } from '@/lib/types';
import { PortalMessage, PortalShell } from '@/components/layout/PortalShell';
import { Button, Field, Input, Modal, PageLoader, Textarea, cx } from '@/components/ui';

interface OfferState {
  status: OfferStatus;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  expiresAt: string | null;
  current: OfferVersion;
  messages: NegotiationMessage[];
}

type Action = 'accept' | 'counter' | 'decline' | null;

export default function OfferPortal() {
  const { token } = useParams<{ token: string }>();
  const base = `/offer/${token}`;
  const [offer, setOffer] = useState<OfferState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [joiningDate, setJoiningDate] = useState('');
  const [message, setMessage] = useState('');
  const [reqSalary, setReqSalary] = useState('');
  const [reqDate, setReqDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(() => publicApi.get<OfferState>(base).then(setOffer).catch(setLoadError), [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = (a: Action) => {
    setJoiningDate(offer?.current.joiningDate ?? '');
    setMessage('');
    setReqSalary('');
    setReqDate('');
    setReason('');
    setAction(a);
  };

  async function submit() {
    setBusy(true);
    try {
      if (action === 'accept') await publicApi.post(`${base}/accept`, { joiningDate: joiningDate || undefined });
      if (action === 'decline') await publicApi.post(`${base}/decline`, { reason });
      if (action === 'counter')
        await publicApi.post(`${base}/counter`, {
          message,
          requestedBaseSalary: reqSalary ? Number(reqSalary) : undefined,
          requestedJoiningDate: reqDate || undefined,
        });
      if (action === 'counter') toast.success('Your request was sent to the recruiter');
      setAction(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This offer link is not valid">
          {errorMessage(loadError)}
        </PortalMessage>
      </PortalShell>
    );
  if (!offer)
    return (
      <PortalShell>
        <PageLoader />
      </PortalShell>
    );

  const v = offer.current;
  const first = offer.candidateName.split(' ')[0];
  const ctc = v.baseSalary + v.variablePay;
  const actionable = offer.status === 'sent' || offer.status === 'negotiating';

  const banner =
    offer.status === 'accepted' ? (
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <PartyPopper className="size-6 shrink-0 text-emerald-600" />
        <div>
          <p className="font-semibold">Welcome aboard, {first}.</p>
          <p>You've accepted this offer. We'll email you shortly with pre-joining steps and a link to upload your documents.</p>
        </div>
      </div>
    ) : offer.status === 'declined' ? (
      <div className="mb-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">You declined this offer. Thank you for letting us know — we wish you the very best.</div>
    ) : offer.status === 'negotiating' ? (
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <MessageSquare className="size-5 shrink-0" /> Your request is with our team. We'll update the offer or get back to you soon.
      </div>
    ) : null;

  if (offer.status === 'expired' || offer.status === 'withdrawn')
    return (
      <PortalShell>
        <PortalMessage icon={<Hourglass className="size-6" />} title={offer.status === 'expired' ? 'This offer has expired' : 'This offer is no longer active'}>
          Please reach out to your recruiter at {offer.companyName} if you have any questions.
        </PortalMessage>
      </PortalShell>
    );

  return (
    <PortalShell>
      {banner}
      <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 bg-brand-900 px-6 py-10 text-brand-50 sm:px-10 sm:py-12">
          <p className="text-sm text-brand-200">{offer.companyName} · Offer of employment</p>
          <h1 className="font-display mt-3 text-4xl leading-tight font-normal text-white sm:text-5xl">Congratulations, {first}.</h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-brand-100/90">
            We're delighted to offer you the role of <strong className="font-semibold text-white">{v.designation}</strong>. Everything you need to decide is on this page.
          </p>
        </div>

        <div className="space-y-8 px-6 py-8 sm:px-10">
          <section>
            <p className="text-sm font-medium text-zinc-500">Total annual compensation</p>
            <p className="tabular mt-1 text-4xl font-semibold tracking-tight text-zinc-900">{fmtMoney(ctc, v.currency)}</p>
            <table className="mt-5 w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {[
                  ['Base salary (annual)', fmtMoney(v.baseSalary, v.currency)],
                  ['Variable / performance pay', fmtMoney(v.variablePay, v.currency)],
                  ...(v.joiningBonus ? [['One-time joining bonus', fmtMoney(v.joiningBonus, v.currency)]] : []),
                  ...(v.equity ? [['Equity', v.equity]] : []),
                ].map(([l, val]) => (
                  <tr key={l}>
                    <td className="py-2.5 text-zinc-500">{l}</td>
                    <td className="py-2.5 text-right font-medium text-zinc-900">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4">
              <CalendarDays className="mt-0.5 size-5 text-brand-600" />
              <div>
                <p className="text-xs text-zinc-500">Joining date</p>
                <p className="font-medium text-zinc-900">{v.joiningDate ? fmtDate(v.joiningDate) : 'To be confirmed'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4">
              <MapPin className="mt-0.5 size-5 text-brand-600" />
              <div>
                <p className="text-xs text-zinc-500">Location</p>
                <p className="font-medium text-zinc-900">{v.location ?? '—'}</p>
              </div>
            </div>
          </section>

          {v.benefits && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-900">Benefits</h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-600">{v.benefits}</p>
            </section>
          )}
          {v.additionalTerms && (
            <section>
              <h2 className="text-sm font-semibold text-zinc-900">Terms</h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-600">{v.additionalTerms}</p>
            </section>
          )}

          {actionable && (
            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5">
              <p className="text-sm text-zinc-600">
                {offer.expiresAt ? (
                  <>
                    Please respond by <strong className="text-zinc-900">{fmtDate(offer.expiresAt)}</strong>.
                  </>
                ) : (
                  'Please let us know your decision.'
                )}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button size="lg" variant="success" className="flex-1" icon={<CheckCircle2 className="size-5" />} onClick={() => open('accept')}>
                  Accept offer
                </Button>
                <Button size="lg" variant="outline" className="flex-1" icon={<MessageSquare className="size-5" />} onClick={() => open('counter')}>
                  Request changes
                </Button>
                <Button size="lg" variant="ghost" className="text-zinc-500" onClick={() => open('decline')}>
                  Decline
                </Button>
              </div>
            </section>
          )}
        </div>
      </article>

      {offer.messages.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900">Conversation</h2>
          <div className="space-y-3">
            {offer.messages.map((m) => {
              const mine = m.actor === 'candidate';
              return (
                <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%]', mine && 'text-right')}>
                    <div className={cx('inline-block rounded-2xl px-4 py-2.5 text-left text-sm whitespace-pre-wrap', mine ? 'rounded-tr-sm bg-brand-600 text-white' : 'rounded-tl-sm border border-zinc-200 bg-white text-zinc-800')}>
                      {m.message}
                      {(m.requestedBaseSalary !== null || m.requestedJoiningDate) && (
                        <div className="mt-2 border-t border-white/20 pt-2 text-xs opacity-90">
                          {m.requestedBaseSalary !== null && <p>Requested base: {fmtMoney(m.requestedBaseSalary, v.currency)}</p>}
                          {m.requestedJoiningDate && <p>Requested joining: {fmtDate(m.requestedJoiningDate)}</p>}
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {mine ? 'You' : `${offer.companyName} team`} · {fromNow(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action === 'accept' ? 'Accept this offer' : action === 'counter' ? 'Request changes' : 'Decline this offer'}
        description={
          action === 'accept'
            ? `You're accepting the ${v.designation} role at ${offer.companyName}.`
            : action === 'counter'
              ? "Tell us what you'd like to discuss. Our team will review and get back to you."
              : "We're sorry to hear that. A short reason helps us improve."
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={action === 'decline' ? 'danger' : action === 'accept' ? 'success' : 'primary'}
              loading={busy}
              disabled={(action === 'counter' && !message.trim()) || (action === 'decline' && !reason.trim())}
              onClick={() => void submit()}
            >
              {action === 'accept' ? 'Confirm & accept' : action === 'counter' ? 'Send request' : 'Decline offer'}
            </Button>
          </>
        }
      >
        {action === 'accept' && (
          <Field label="Confirm your joining date" hint="You can adjust it if needed.">
            <Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
          </Field>
        )}
        {action === 'counter' && (
          <div className="space-y-4">
            <Field label="Your message" required>
              <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. I'm very excited about the role. Based on my current compensation, I was hoping for…" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Expected base (${v.currency})`}>
                <Input type="number" min={0} value={reqSalary} onChange={(e) => setReqSalary(e.target.value)} />
              </Field>
              <Field label="Preferred joining date">
                <Input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
        {action === 'decline' && (
          <Field label="Reason" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </Modal>
    </PortalShell>
  );
}
