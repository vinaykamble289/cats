import { clsx } from 'clsx';
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import { initials } from '@/lib/format';

export const cx = clsx;

/* ------------------------------------------------------------------ Button */
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantCls: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 active:bg-zinc-950',
  outline: 'border border-zinc-300 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100',
  ghost: 'text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
};
const sizeCls: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0',
        variantCls[variant],
        sizeCls[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Form controls */
const controlCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 transition-[border-color,box-shadow] duration-150 hover:border-zinc-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-500 aria-invalid:border-red-400';

/** Quiet chevron for native selects (no wrapper element, so width classes still land on the select). */
const chevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23736e65' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(controlCls, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(controlCls, 'py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, style, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(controlCls, 'h-9 cursor-pointer appearance-none bg-no-repeat pr-9', className)}
      style={{ backgroundImage: chevron, backgroundPosition: 'right 0.6rem center', backgroundSize: '16px 16px', ...style }}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-sm text-zinc-700 select-none', className)}>
      <input type="checkbox" className="size-4 shrink-0 cursor-pointer rounded border-zinc-300 accent-brand-600" {...rest} />
      {label}
    </label>
  );
}

export function Field({ label, hint, error, required, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && (
        <label className="block text-sm font-medium text-zinc-800">
          {label}
          {required && (
            <span className="ml-0.5 text-red-600" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] leading-snug text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
      <Input
        type="search"
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Surfaces */
export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cx('rounded-xl border border-zinc-200 bg-white', padded && 'p-5', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-8">
      {back && <div className="mb-4 -ml-2">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[28px] leading-tight font-medium text-zinc-900 sm:text-[32px]">{title}</h1>
          {subtitle && <div className="mt-1.5 text-[15px] text-zinc-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Number-first metric tile. `tone` tints only the small icon, keeping the grid calm. */
export function StatCard({ label, value, hint, icon, tone = 'brand' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'brand' | 'green' | 'amber' | 'violet' | 'sky' | 'rose' }) {
  const iconTone = {
    brand: 'text-brand-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
    sky: 'text-sky-600',
    rose: 'text-rose-600',
  }[tone];
  return (
    <Card className="flex flex-col justify-between gap-4">
      <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-500">
        {icon && <span className={cx('[&_svg]:size-4', iconTone)}>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div>
        <p className="tabular text-[28px] leading-none font-semibold tracking-tight text-zinc-900">{value}</p>
        {hint && <p className="mt-2 truncate text-[13px] text-zinc-500">{hint}</p>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ Badge */
export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
const toneCls: Record<Tone, { pill: string; dot: string }> = {
  gray: { pill: 'bg-zinc-100 text-zinc-700', dot: 'bg-zinc-400' },
  blue: { pill: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' },
  green: { pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  amber: { pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  red: { pill: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  violet: { pill: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
};
export function Badge({ tone = 'gray', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap', toneCls[tone].pill, className)}>
      {dot && <span className={cx('size-1.5 shrink-0 rounded-full', toneCls[tone].dot)} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Feedback */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-label="Loading" className={cx('size-5 animate-spin text-zinc-400', className)} />;
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-zinc-500">
      <Spinner className="size-6" />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-12 text-center', className)}>
      <div className="mb-3 text-zinc-400 [&_svg]:size-6">{icon ?? <Inbox />}</div>
      <p className="text-[15px] font-medium text-zinc-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">Something went wrong while loading this</p>
      <p className="mt-1 text-red-700">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Avatar */
const avatarColors = [
  'bg-brand-100 text-brand-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-800',
  'bg-zinc-200 text-zinc-700',
];
export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const n = name || '?';
  const color = avatarColors[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % avatarColors.length];
  const sz = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' }[size];
  return (
    <div aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide', color, sz, className)}>
      {initials(n)}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal & Drawer */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEscape(open, onClose);
  if (!open) return null;
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-zinc-950/35" onClick={onClose} />
      <div className={cx('page-in relative w-full rounded-t-2xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-2 cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3.5 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-zinc-950/30" onClick={onClose} />
      <div className={cx('absolute top-0 right-0 flex h-full w-full flex-col bg-white shadow-2xl', width)}>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
          <div className="min-w-0 text-[15px] font-semibold text-zinc-900">{title}</div>
          <button onClick={onClose} aria-label="Close" className="-mr-2 cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog. `onConfirm` may be async; dialog shows loading until it resolves. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => unknown | Promise<unknown>;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                /* caller shows toast */
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-[15px] leading-relaxed text-zinc-600">{message}</p>}
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('scroll-thin flex gap-6 overflow-x-auto border-b border-zinc-200', className)}>
      {tabs.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px flex cursor-pointer items-center gap-2 border-b-2 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'border-brand-600 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-900',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx('tabular rounded-md px-1.5 py-0.5 text-[11px] leading-none font-semibold', active ? 'bg-brand-50 text-brand-700' : 'bg-zinc-200/70 text-zinc-600')}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control for filters / modes */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition',
            value === o.value ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5' : 'text-zinc-500 hover:text-zinc-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Table */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('scroll-thin overflow-x-auto rounded-xl border border-zinc-200 bg-white', className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-[13px] font-medium whitespace-nowrap text-zinc-500', className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('border-b border-zinc-200/70 px-4 py-3.5 align-middle text-zinc-700', className)}>
      {children}
    </td>
  );
}
export function Tr({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr onClick={onClick} className={cx('transition-colors last:[&>td]:border-b-0', onClick && 'cursor-pointer hover:bg-zinc-50', className)}>
      {children}
    </tr>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-zinc-500">
      <span className="tabular">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft className="size-4" />}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Menu */
export function Menu({ trigger, items, align = 'right' }: { trigger: ReactNode; items: ({ label: ReactNode; onClick: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean } | false | null | undefined)[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div role="menu" className={cx('page-in absolute z-30 mt-1.5 min-w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter(Boolean).map((item, i) => {
            const it = item as Exclude<typeof item, false | null | undefined>;
            return (
              <button
                key={i}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={cx(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4',
                  it.danger ? 'text-red-700 hover:bg-red-50' : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900',
                )}
              >
                {it.icon}
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Score visuals */
export function ScoreRing({ score, size = 56, label }: { score: number | null | undefined; size?: number; label?: string }) {
  const s = score ?? 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = score === null || score === undefined ? 'var(--color-zinc-300)' : s >= 75 ? 'var(--color-emerald-500)' : s >= 50 ? 'var(--color-amber-500)' : 'var(--color-red-500)';
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} style={{ stroke: 'var(--color-zinc-100)' }} strokeWidth={5} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            style={{ stroke: color, transition: 'stroke-dashoffset 400ms ease' }}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (c * s) / 100}
          />
        </svg>
        <span className="tabular absolute inset-0 flex items-center justify-center text-sm font-semibold text-zinc-900">{score ?? '–'}</span>
      </div>
      {label && <span className="text-xs text-zinc-500">{label}</span>}
    </div>
  );
}

export function ProgressBar({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'green' | 'amber' | 'red' }) {
  const color = { brand: 'bg-brand-600', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }[tone];
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} className={cx('h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70', className)}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stars({ value, onChange, size = 'md' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cx(size === 'sm' ? 'text-base' : 'text-2xl', 'leading-none transition', onChange && 'cursor-pointer hover:scale-110', n <= value ? 'text-amber-400' : 'text-zinc-300')}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Key/value list for detail panels */
export function DescriptionList({ items, cols = 2 }: { items: { label: string; value: ReactNode }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-4', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[13px] text-zinc-500">{it.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium text-zinc-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
