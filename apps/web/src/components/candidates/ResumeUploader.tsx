import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, FileUp, RefreshCw, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { useJobs } from '@/lib/hooks';
import { Button, Field, Select, cx } from '@/components/ui';

interface UploadResult {
  fileName: string;
  status: 'created' | 'updated' | 'failed';
  candidateId?: string;
  applicationId?: string;
  candidateName?: string;
  error?: string;
}

const ACCEPT = '.pdf,.doc,.docx,.txt';

/** Drag & drop multi-resume upload → AI parsing → candidates (+ applications when jobId set). */
export function ResumeUploader({ jobId, allowJobPick, onDone }: { jobId?: string; allowJobPick?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [pickedJob, setPickedJob] = useState(jobId ?? '');
  const { data: jobs } = useJobs();

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok = Array.from(list).filter((f) => /\.(pdf|docx?|txt)$/i.test(f.name));
    if (ok.length < list.length) toast.warning('Only PDF, DOC, DOCX and TXT files are supported');
    const tooBig = ok.filter((f) => f.size > 10 * 1024 * 1024);
    if (tooBig.length) toast.warning(`${tooBig.length} file(s) exceed 10 MB and were skipped`);
    setFiles((prev) => [...prev, ...ok.filter((f) => f.size <= 10 * 1024 * 1024 && !prev.some((p) => p.name === f.name && p.size === f.size))]);
    setResults(null);
  };

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      const targetJob = allowJobPick ? pickedJob : jobId;
      if (targetJob) form.append('jobId', targetJob);
      form.append('source', files.length > 1 ? 'bulk_upload' : 'manual_upload');
      for (const f of files) form.append('files', f, f.name);
      const res = await api.upload<{ results: UploadResult[] }>('/candidates/upload', form);
      setResults(res.results);
      const ok = res.results.filter((r) => r.status !== 'failed').length;
      if (ok) toast.success(`${ok} resume(s) processed`);
      if (ok < res.results.length) toast.error(`${res.results.length - ok} file(s) failed`);
      setFiles([]);
      qc.invalidateQueries({ queryKey: ['candidates'] });
      qc.invalidateQueries({ queryKey: ['applications'] });
      onDone?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {allowJobPick && (
        <Field label="Add to job (optional)" hint="Candidates will be added to this job's pipeline and AI-matched.">
          <Select value={pickedJob} onChange={(e) => setPickedJob(e.target.value)}>
            <option value="">— Talent pool only —</option>
            {(jobs ?? [])
              .filter((j) => j.status === 'open' || j.status === 'draft' || j.status === 'on_hold')
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} ({j.code})
                </option>
              ))}
          </Select>
        </Field>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition',
          drag ? 'border-brand-500 bg-brand-50' : 'border-zinc-200 hover:border-brand-300 hover:bg-zinc-50',
        )}
      >
        <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">
          <UploadCloud className="size-6" />
        </div>
        <p className="text-sm font-medium text-zinc-900">Drop resumes here or click to browse</p>
        <p className="mt-1 text-xs text-zinc-500">PDF, DOC, DOCX or TXT · up to 10 MB each · AI extracts the profile automatically</p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
      </div>

      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div key={f.name + i} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm">
              <FileUp className="size-4 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-zinc-400">{fmtBytes(f.size)}</span>
              <button className="cursor-pointer text-zinc-400 hover:text-zinc-700" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFiles([])} disabled={busy}>
              Clear
            </Button>
            <Button onClick={upload} loading={busy} icon={<UploadCloud className="size-4" />}>
              {busy ? 'Parsing with AI…' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      )}

      {results && (
        <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              {r.status === 'failed' ? (
                <AlertCircle className="size-4 shrink-0 text-red-500" />
              ) : r.status === 'updated' ? (
                <RefreshCw className="size-4 shrink-0 text-sky-500" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-800">{r.candidateName ?? r.fileName}</p>
                <p className="truncate text-xs text-zinc-500">{r.status === 'failed' ? r.error : `${r.status === 'created' ? 'New candidate' : 'Existing candidate updated'} · ${r.fileName}`}</p>
              </div>
              {r.candidateId && (
                <Link to={`/candidates/${r.candidateId}`} className="text-xs font-medium text-brand-600 hover:underline">
                  View
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
