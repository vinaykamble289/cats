import { useRef, useState } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { fmtBytes } from '@/lib/format';
import { cx } from '../ui';

/** Drag & drop / click-to-pick file input with client-side type & size validation. */
export function FileDrop({
  file,
  onFile,
  accept,
  maxMb = 10,
  label = 'Drop your file here or click to browse',
  hint,
  compact,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept: string;
  maxMb?: number;
  label?: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const exts = accept.split(',').map((s) => s.trim().toLowerCase());
    const name = f.name.toLowerCase();
    if (!exts.some((e) => (e.startsWith('.') ? name.endsWith(e) : f.type === e))) {
      setError(`Unsupported file type. Allowed: ${accept}`);
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setError(`File is larger than ${maxMb} MB`);
      return;
    }
    setError(null);
    onFile(f);
  };

  if (file)
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-white text-brand-600 shadow-xs">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
          <p className="text-xs text-zinc-500">{fmtBytes(file.size)}</p>
        </div>
        {!disabled && (
          <button type="button" className="cursor-pointer rounded-lg p-1 text-zinc-400 hover:bg-white hover:text-zinc-700" onClick={() => onFile(null)}>
            <X className="size-4" />
          </button>
        )}
      </div>
    );

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
        className={cx(
          'flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'gap-1 px-4 py-4' : 'gap-2 px-6 py-8',
          over ? 'border-brand-400 bg-brand-50' : 'border-zinc-200 bg-zinc-50/50 hover:border-brand-300 hover:bg-brand-50/30',
        )}
      >
        <UploadCloud className={cx('text-brand-500', compact ? 'size-5' : 'size-7')} />
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}
