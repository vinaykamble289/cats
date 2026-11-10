import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCw, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { fmtDateTime, humanize } from '@/lib/format';
import { useApiMutation } from '@/lib/hooks';
import type { EmailLog } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';
import { Button, DescriptionList, Drawer, Field, Input, Modal, Select, Spinner, Textarea } from '@/components/ui';

/** Converts plain text (paragraphs / line breaks) to simple HTML. Leaves HTML untouched. */
function toHtml(text: string) {
  if (/<\/?[a-z][\s\S]*>/i.test(text)) return text;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

export function ComposeEmailModal({
  open,
  onClose,
  to,
  candidateId,
  candidateName,
  jobTitle,
}: {
  open: boolean;
  onClose: () => void;
  to: string;
  candidateId?: string;
  candidateName?: string;
  jobTitle?: string;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cc, setCc] = useState('');
  const [purpose, setPurpose] = useState('');
  const [tone, setTone] = useState('friendly');
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setCc('');
      setPurpose('');
    }
  }, [open]);

  const send = useApiMutation(
    () =>
      api.post('/emails', {
        to,
        cc: cc
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subject,
        bodyHtml: toHtml(body),
        candidateId,
      }),
    { success: 'Email queued for delivery', invalidate: [['emails']], onSuccess: onClose },
  );

  async function draft() {
    if (!purpose.trim()) return toast.error('Describe what the email is about');
    setDrafting(true);
    try {
      const res = await api.post<{ subject: string; bodyHtml: string }>('/ai/email-draft', { purpose, candidateName, jobTitle, tone });
      setSubject(res.subject);
      setBody(htmlToText(res.bodyHtml));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Compose email"
      description={`To ${to}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Send className="size-4" />} disabled={!subject.trim() || !body.trim()} loading={send.isPending} onClick={() => send.mutate()}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-violet-700">
            <Sparkles className="size-3.5" /> Draft with AI
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input className="flex-1 bg-white" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Ask for availability for a call next week" />
            <Select value={tone} onChange={(e) => setTone(e.target.value)} className="bg-white sm:w-32">
              <option value="friendly">Friendly</option>
              <option value="formal">Formal</option>
              <option value="concise">Concise</option>
            </Select>
            <Button variant="secondary" loading={drafting} onClick={draft}>
              Draft
            </Button>
          </div>
        </div>
        <Field label="CC" hint="Comma-separated">
          <Input value={cc} onChange={(e) => setCc(e.target.value)} />
        </Field>
        <Field label="Subject" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message" required hint="Plain text — paragraphs are formatted automatically. Sent with your company email layout.">
          <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function EmailDetailDrawer({ emailId, onClose }: { emailId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['emails', emailId], queryFn: () => api.get<EmailLog>(`/emails/${emailId}`), enabled: !!emailId });
  const retry = useApiMutation(() => api.post(`/emails/${emailId}/retry`), { success: 'Email re-queued', invalidate: [['emails']] });
  return (
    <Drawer open={!!emailId} onClose={onClose} title={data?.subject ?? 'Email'} width="max-w-2xl">
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          <DescriptionList
            items={[
              { label: 'To', value: data.toEmail },
              { label: 'CC', value: data.cc?.length ? data.cc.join(', ') : '—' },
              { label: 'Status', value: <StatusBadge value={data.status} /> },
              { label: 'Template', value: humanize(data.templateKey) },
              { label: 'Created', value: fmtDateTime(data.createdAt) },
              { label: 'Sent', value: fmtDateTime(data.sentAt) },
              { label: 'Attempts', value: data.attempts },
            ]}
          />
          {data.lastError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs break-words text-red-700">{data.lastError}</div>}
          {data.status === 'failed' && (
            <Button size="sm" variant="outline" icon={<RotateCw className="size-4" />} loading={retry.isPending} onClick={() => retry.mutate()}>
              Retry sending
            </Button>
          )}
          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <iframe title="Email preview" sandbox="" srcDoc={data.bodyHtml ?? ''} className="h-[60vh] w-full bg-white" />
          </div>
        </div>
      )}
    </Drawer>
  );
}
