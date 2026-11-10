import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, FileCheck2, FileText, RotateCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage, publicApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { PortalMessage, PortalShell } from '@/components/layout/PortalShell';
import { Badge, Button, PageLoader, cx } from '@/components/ui';
import { FileDrop } from '@/components/portal/FileDrop';

interface PortalDoc {
  id: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  fileName: string | null;
  reviewNote: string | null;
}

interface OnboardingState {
  candidateName: string;
  jobTitle: string;
  joiningDate: string | null;
  companyName: string;
  status: string;
  documents: PortalDoc[];
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx';

function DocItem({ doc, base, onUploaded, locked }: { doc: PortalDoc; base: string; onUploaded: () => void; locked: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const canUpload = !locked && (doc.status === 'pending' || doc.status === 'rejected' || (doc.status === 'uploaded' && replace));

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await publicApi.upload(`${base}/documents/${doc.id}`, fd);
      toast.success(`${doc.name} uploaded`);
      setFile(null);
      setReplace(false);
      onUploaded();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const icon =
    doc.status === 'verified' ? (
      <FileCheck2 className="size-5 text-emerald-600" />
    ) : doc.status === 'uploaded' ? (
      <CheckCircle2 className="size-5 text-sky-600" />
    ) : doc.status === 'rejected' ? (
      <XCircle className="size-5 text-red-600" />
    ) : (
      <CircleDashed className="size-5 text-zinc-300" />
    );

  return (
    <li className={cx('rounded-2xl border bg-white p-4 transition sm:p-5', doc.status === 'rejected' ? 'border-red-200' : 'border-zinc-200')}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-zinc-900">{doc.name}</p>
            {doc.isRequired ? <Badge tone="gray">Required</Badge> : <Badge tone="gray" className="opacity-70">Optional</Badge>}
            {doc.status === 'verified' && <Badge tone="green">Verified</Badge>}
            {doc.status === 'uploaded' && <Badge tone="blue">Under review</Badge>}
            {doc.status === 'rejected' && <Badge tone="red">Please re-upload</Badge>}
          </div>
          {doc.description && <p className="mt-0.5 text-sm text-zinc-500">{doc.description}</p>}
          {doc.status === 'rejected' && doc.reviewNote && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{doc.reviewNote}</p>}
          {doc.fileName && doc.status !== 'rejected' && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
              <FileText className="size-3.5" /> {doc.fileName}
              {doc.status === 'uploaded' && !locked && !replace && (
                <button className="ml-2 inline-flex cursor-pointer items-center gap-1 font-medium text-brand-600 hover:underline" onClick={() => setReplace(true)}>
                  <RotateCw className="size-3" /> Replace
                </button>
              )}
            </p>
          )}
          {canUpload && (
            <div className="mt-3 space-y-2">
              <FileDrop file={file} onFile={setFile} accept={ACCEPT} maxMb={10} compact disabled={busy} label="Drop file or click to choose" hint="PDF, image or Word · max 10 MB" />
              {file && (
                <div className="flex justify-end gap-2">
                  {replace && (
                    <Button size="sm" variant="ghost" onClick={() => (setReplace(false), setFile(null))}>
                      Cancel
                    </Button>
                  )}
                  <Button size="sm" loading={busy} onClick={() => void upload()}>
                    Upload
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function OnboardingPortal() {
  const { token } = useParams<{ token: string }>();
  const base = `/onboarding/${token}`;
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => publicApi.get<OnboardingState>(base).then(setState).catch(setLoadError), [base]);
  useEffect(() => {
    void load();
  }, [load]);

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
  if (state.status === 'dropped')
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This onboarding link is no longer active" />
      </PortalShell>
    );

  const docs = [...state.documents].sort((a, b) => Number(b.isRequired) - Number(a.isRequired));
  const required = docs.filter((d) => d.isRequired);
  const requiredDone = required.filter((d) => d.status === 'uploaded' || d.status === 'verified').length;
  const allRequiredDone = requiredDone === required.length;
  const locked = state.status === 'joined';
  const first = state.candidateName.split(' ')[0];

  return (
    <PortalShell>
      <div className="mb-8 rounded-2xl bg-brand-900 p-6 text-brand-50 sm:p-10">
        <p className="text-sm text-brand-200">Pre-joining</p>
        <h1 className="font-display mt-2 text-3xl leading-tight font-normal text-white sm:text-4xl">Welcome to {state.companyName}, {first}.</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-brand-100/90">
          We're glad you're joining as <strong className="font-semibold text-white">{state.jobTitle}</strong>
          {state.joiningDate ? (
            <>
              {' '}
              on <strong className="font-semibold text-white">{fmtDate(state.joiningDate)}</strong>
            </>
          ) : null}
          . Please upload the documents below so we can finish your joining formalities and background check.
        </p>
        <div className="mt-6 max-w-md">
          <div className="mb-2 flex justify-between text-sm text-brand-100">
            <span>Required documents</span>
            <span className="tabular font-medium text-white">
              {requiredDone} of {required.length} done
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-brand-200 transition-all" style={{ width: `${required.length ? (requiredDone / required.length) * 100 : 100}%` }} />
          </div>
        </div>
      </div>

      {allRequiredDone && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          {locked ? 'All set — welcome to the team!' : "All required documents are submitted. Our HR team will review them and let you know if anything else is needed. You can still upload optional documents."}
        </div>
      )}

      <ul className="space-y-3">
        {docs.map((d) => (
          <DocItem key={d.id} doc={d} base={base} onUploaded={() => void load()} locked={locked} />
        ))}
      </ul>
      <p className="mt-6 text-center text-xs text-zinc-400">Your documents are stored securely and shared only with our HR team and verification partner.</p>
    </PortalShell>
  );
}
