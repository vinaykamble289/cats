import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useUsers } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Avatar, Input, Spinner, cx } from '@/components/ui';

/** Searchable checkbox list of active team members. */
export function UserMultiSelect({
  value,
  onChange,
  roles,
  maxHeight = 'max-h-64',
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Restrict to these roles (admins always included) */
  roles?: Role[];
  maxHeight?: string;
}) {
  const { data: users, isLoading } = useUsers();
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.isActive)
        .filter((u) => !roles || u.role === 'admin' || roles.includes(u.role))
        .filter((u) => !q || `${u.fullName} ${u.email}`.toLowerCase().includes(q.toLowerCase())),
    [users, roles, q],
  );
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="rounded-lg border border-zinc-200">
      <div className="border-b border-zinc-100 p-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="h-8" />
      </div>
      <div className={cx('scroll-thin overflow-y-auto p-1', maxHeight)}>
        {isLoading && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {!isLoading && !list.length && <p className="px-3 py-4 text-center text-sm text-zinc-500">No matching team members.</p>}
        {list.map((u) => {
          const selected = value.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className={cx('flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm', selected ? 'bg-brand-50' : 'hover:bg-zinc-50')}
            >
              <Avatar name={u.fullName || u.email} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-800">{u.fullName || u.email}</p>
                <p className="truncate text-xs text-zinc-500">
                  {ROLE_LABEL[u.role]} · {u.email}
                </p>
              </div>
              <span className={cx('flex size-5 items-center justify-center rounded border', selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-300')}>
                {selected && <Check className="size-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Single user select (native) */
export function UserSelect({ value, onChange, roles, placeholder = 'Unassigned' }: { value: string | null; onChange: (id: string | null) => void; roles?: Role[]; placeholder?: string }) {
  const { data: users } = useUsers();
  const list = (users ?? []).filter((u) => u.isActive && (!roles || u.role === 'admin' || roles.includes(u.role)));
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-9 w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 text-sm shadow-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.fullName || u.email} ({ROLE_LABEL[u.role]})
        </option>
      ))}
    </select>
  );
}
