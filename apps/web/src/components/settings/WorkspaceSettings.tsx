import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, FileCheck2, Mail, Pencil, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { fromNow, humanize } from '@/lib/format';
import { useApiMutation, useDebounced } from '@/lib/hooks';
import type { BgvVendor, DocumentType, EmailTemplate, Paginated } from '@/lib/types';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Modal, Spinner, Table, Td, Textarea, Th, Tr, cx } from '@/components/ui';

/* ------------------------------------------------------------------ Email templates */
export function TemplatesTab() {
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.get<{ data: EmailTemplate[] }>('/templates') });
  const [key, setKey] = useState<string | null>(null);
  const templates = list.data?.data ?? [];
  const current = templates.find((t) => t.key === key) ?? templates[0];
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (current) {
      setSubject(current.subject);
      setBody(current.bodyHtml);
    }
  }, [current?.key, current?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dSubject = useDebounced(subject, 500);
  const dBody = useDebounced(body, 500);
  const dirty = !!current && (subject !== current.subject || body !== current.bodyHtml);
  // Preview renders the saved template with sample data; unsaved edits are previewed locally below.
  const preview = useQuery({
    queryKey: ['templates', current?.key, 'preview', current?.updatedAt],
    queryFn: () => api.post<{ subject: string; html: string }>(`/templates/${current!.key}/preview`, {}),
    enabled: !!current,
  });
  const save = useApiMutation(() => api.put(`/templates/${current!.key}`, { subject, bodyHtml: body }), { success: 'Template saved', invalidate: [['templates']] });

  if (list.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!templates.length) return <EmptyState icon={<Mail className="size-5" />} title="No templates" />;

  const localPreview = dirty ? dBody.replace(/\{\{\{?\s*(\w+)\s*\}?\}\}/g, '<mark>$1</mark>') : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="space-y-1">
        {templates.map((t) => (
          <button
            key={t.key}
            onClick={() => setKey(t.key)}
            className={cx('w-full cursor-pointer rounded-lg px-3 py-2 text-left transition', current?.key === t.key ? 'bg-brand-50 text-brand-800' : 'hover:bg-zinc-100')}
          >
            <p className="text-sm font-medium">{t.name}</p>
            <p className="truncate text-xs text-zinc-500">{t.description ?? t.key}</p>
          </button>
        ))}
      </div>
      {current && (
        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={current.name}
              subtitle={<>Key <code className="rounded bg-zinc-100 px-1">{current.key}</code> · updated {fromNow(current.updatedAt)}</>}
              actions={
                <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                  Save
                </Button>
              }
            />
            <div className="space-y-4">
              <Field label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Body (HTML)" hint={<>Use <code>{'{{variable}}'}</code> for values (escaped) and <code>{'{{{variable}}}'}</code> for raw HTML. Add <code>class="btn"</code> to links for a button.</>}>
                <Textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Preview" subtitle={dirty ? 'Unsaved changes — variables highlighted' : 'Rendered with sample data'} actions={preview.isFetching ? <Spinner className="size-4" /> : null} />
            <p className="mb-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
              <span className="text-zinc-500">Subject: </span>
              <span className="font-medium text-zinc-900">{dirty ? dSubject : preview.data?.subject ?? current.subject}</span>
            </p>
            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <iframe title="Template preview" sandbox="" srcDoc={localPreview ?? preview.data?.html ?? ''} className="h-[520px] w-full bg-white" />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ BGV vendors */
export function VendorsTab() {
  const list = useQuery({ queryKey: ['bgv-vendors'], queryFn: () => api.get<Paginated<BgvVendor> | { data: BgvVendor[] }>('/bgv-vendors') });
  const [modal, setModal] = useState<{ open: boolean; vendor?: BgvVendor }>({ open: false });
  const [form, setForm] = useState({ name: '', contactName: '', contactEmail: '', isActive: true });
  useEffect(() => {
    if (modal.open) setForm(modal.vendor ? { name: modal.vendor.name, contactName: modal.vendor.contactName ?? '', contactEmail: modal.vendor.contactEmail, isActive: modal.vendor.isActive } : { name: '', contactName: '', contactEmail: '', isActive: true });
  }, [modal]);
  const save = useApiMutation(
    () => {
      const body = { name: form.name, contactName: form.contactName || null, contactEmail: form.contactEmail.trim().toLowerCase(), isActive: form.isActive };
      return modal.vendor ? api.patch(`/bgv-vendors/${modal.vendor.id}`, body) : api.post('/bgv-vendors', body);
    },
    { success: 'Vendor saved', invalidate: [['bgv-vendors']], onSuccess: () => setModal({ open: false }) },
  );
  const vendors = list.data?.data ?? [];
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-500">Third-party background verification firms. Documents are shared with them via secure, expiring links.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setModal({ open: true })}>Add vendor</Button>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !vendors.length ? (
        <EmptyState icon={<ShieldCheck className="size-5" />} title="No BGV vendors yet" description="Add the verification firm you work with to send cases with one click." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Vendor</Th>
              <Th>Contact</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <Tr key={v.id}>
                <Td className="font-medium text-zinc-900">{v.name}</Td>
                <Td>
                  <p>{v.contactName ?? '—'}</p>
                  <p className="text-xs text-zinc-500">{v.contactEmail}</p>
                </Td>
                <Td>{v.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setModal({ open: true, vendor: v })}>Edit</Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        title={modal.vendor ? 'Edit vendor' : 'Add BGV vendor'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button loading={save.isPending} disabled={!form.name || !form.contactEmail} onClick={() => save.mutate()}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Vendor name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Contact person">
            <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </Field>
          <Field label="Contact email" required hint="BGV requests are emailed here.">
            <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          </Field>
          <Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} label="Active" />
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ Document types */
export function DocumentTypesTab() {
  const list = useQuery({ queryKey: ['document-types'], queryFn: () => api.get<{ data: DocumentType[] }>('/document-types') });
  const [modal, setModal] = useState<{ open: boolean; doc?: DocumentType }>({ open: false });
  const [form, setForm] = useState({ code: '', name: '', description: '', isRequired: true, sortOrder: 0, isActive: true });
  const docs = [...(list.data?.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  useEffect(() => {
    if (modal.open)
      setForm(
        modal.doc
          ? { code: modal.doc.code, name: modal.doc.name, description: modal.doc.description ?? '', isRequired: modal.doc.isRequired, sortOrder: modal.doc.sortOrder, isActive: modal.doc.isActive }
          : { code: '', name: '', description: '', isRequired: true, sortOrder: (docs.at(-1)?.sortOrder ?? 0) + 1, isActive: true },
      );
  }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation(
    () => {
      const body = { ...form, description: form.description || null, code: form.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') };
      return modal.doc ? api.patch(`/document-types/${modal.doc.id}`, body) : api.post('/document-types', body);
    },
    { success: 'Document type saved', invalidate: [['document-types']], onSuccess: () => setModal({ open: false }) },
  );
  const toggle = useApiMutation((d: DocumentType) => api.patch(`/document-types/${d.id}`, { isActive: !d.isActive }), { invalidate: [['document-types']] });

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">Documents requested from every new joiner during pre-joining. Changes apply to new cases.</p>
        <Button icon={<Plus className="size-4" />} onClick={() => setModal({ open: true })}>Add document</Button>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>Required</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <Tr key={d.id} className={!d.isActive ? 'opacity-50' : undefined}>
                <Td>
                  <p className="flex items-center gap-2 font-medium text-zinc-900"><FileCheck2 className="size-4 text-zinc-400" />{d.name}</p>
                  {d.description && <p className="ml-6 text-xs text-zinc-500">{d.description}</p>}
                </Td>
                <Td>{d.isRequired ? <Badge tone="blue">Required</Badge> : <Badge>Optional</Badge>}</Td>
                <Td>
                  <input type="checkbox" className="size-4 cursor-pointer accent-brand-600" checked={d.isActive} onChange={() => toggle.mutate(d)} />
                </Td>
                <Td className="text-right">
                  <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setModal({ open: true, doc: d })}>Edit</Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        size="sm"
        title={modal.doc ? 'Edit document type' : 'Add document type'}
        footer={
          <>
            <Button variant="outline" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button loading={save.isPending} disabled={!form.name || !form.code} onClick={() => save.mutate()}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, code: modal.doc ? form.code : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })}
              autoFocus
            />
          </Field>
          <Field label="Code" required hint="Stable identifier, lowercase">
            <Input value={form.code} disabled={!!modal.doc} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Description / instructions">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Sort order">
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="w-28" />
          </Field>
          <Checkbox checked={form.isRequired} onChange={(e) => setForm({ ...form, isRequired: e.target.checked })} label="Required before joining" />
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ System status */
const SERVICE_LABEL: Record<string, string> = {
  db: 'Database',
  identity: 'Identity & team',
  jobs: 'Jobs',
  talent: 'Candidates & resumes',
  assessment: 'Assessments',
  interview: 'Interviews',
  offer: 'Offers',
  onboarding: 'Pre-joining & BGV',
  ai: 'AI (Groq)',
  notification: 'Email & activity',
};

export function SystemStatusTab() {
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<{ services: { name: string; ok: boolean; latencyMs: number }[] }>('/system/health'),
    refetchInterval: 15_000,
  });
  const ai = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<{ configured: boolean; model: string }>('/ai/status'), retry: false });
  const services = health.data?.services ?? [];
  const up = services.filter((s) => s.ok).length;
  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <div className="flex items-center gap-4">
          <div className={cx('rounded-full p-3', health.isError || up < services.length ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600')}>
            <Activity className="size-5" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-zinc-900">{health.isLoading ? 'Checking…' : health.isError ? 'Gateway unreachable' : up === services.length ? 'All systems operational' : `${services.length - up} service(s) degraded`}</p>
            <p className="text-sm text-zinc-500">{services.length ? `${up}/${services.length} services healthy` : ''} · refreshes every 15s</p>
          </div>
          <Button size="sm" variant="outline" icon={<RefreshCw className={cx('size-4', health.isFetching && 'animate-spin')} />} onClick={() => health.refetch()}>Refresh</Button>
        </div>
      </Card>
      <Card padded={false}>
        <ul className="divide-y divide-zinc-100">
          {services.map((s) => (
            <li key={s.name} className="flex items-center gap-3 px-5 py-3">
              {s.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-red-500" />}
              <span className="flex-1 text-sm font-medium text-zinc-800">{SERVICE_LABEL[s.name] ?? humanize(s.name)}</span>
              <span className="font-mono text-xs text-zinc-400">{s.name}-service</span>
              <span className={cx('w-16 text-right text-xs', s.latencyMs > 500 ? 'text-amber-600' : 'text-zinc-500')}>{s.latencyMs} ms</span>
            </li>
          ))}
          {health.isLoading && <li className="flex justify-center py-6"><Spinner /></li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="AI provider" />
        {ai.isLoading ? (
          <Spinner />
        ) : ai.data?.configured ? (
          <p className="flex items-center gap-2 text-sm text-zinc-700"><CheckCircle2 className="size-4 text-emerald-500" />Groq connected · model <code className="rounded bg-zinc-100 px-1">{ai.data.model}</code></p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-amber-700"><XCircle className="size-4" />GROQ_API_KEY is not configured — AI features are disabled.</p>
        )}
      </Card>
    </div>
  );
}
